// 片段的增删改：在时间线上直接建片段、配置片段、删片段。
//
// 拖动改的是时间（timeline-edit.ts），这里改的是「有哪些片段、它们是什么」。
// 两条规矩：
//   1. 用户和助手语音不在这里建也不在这里删——那是录音和导入的事。
//   2. 片段背后的数据要跟着走：工具片段带一对 Events 和工具定义，用户控制 / 世界
//      带一个事件，表达控制带一条 Annotation。删片段就把它们一起删掉。
import { withExpressionMode } from './expression-mode.ts';
import { formatToolCall } from '../lib/tool-label.ts';
import baseMeta from './meta-data.json' with { type: 'json' };
import type { Scenario, Clip } from '../app/page';

type Track = Scenario['tracks'][number];
type Tool = { type: 'function'; function: { name: string; description: string; parameters: any } };
export type ClipForm = {
  label: string;
  sub?: string;
  a: number;
  b: number;
  tool?: Tool;
  args?: Record<string, unknown>;
  results?: Record<string, unknown>;
  source?: string;
  action?: string;
  context?: Record<string, unknown>;
  assistantIndex?: number;
  annotation?: string;
};
// 常用工具字典：建片段时不用手写 schema。真实 Case 自带的工具优先。
const CATALOG: [string, string, Record<string, any>][] = [
  ['memory.get', '读取历史事实、偏好或地点', { key: { type: 'string', enum: ['preference', 'locations', 'home'] } }],
  ['memory.search', '搜索记忆', { query: { type: 'string' } }],
  ['memory.set', '写入已确认记忆', { key: { type: 'string' }, value: { type: 'string' } }],
  ['memory.delete', '删除记忆', { key: { type: 'string' } }],
  ['system.get', '读取系统状态', { key: { type: 'string', enum: ['date', 'timezone', 'battery', 'network'] } }],
  ['location.current', '获取当前位置', {}],
  ['location.match', '匹配已保存地点', { current_location: { type: 'object' }, saved_locations: { type: 'array', items: { type: 'object' } } }],
  ['ui.show_card', '展示信息卡', { card_id: { type: 'string' }, card_content: { type: 'object' } }],
  ['audio.play', '播放等待音效', { sound: { type: 'string', enum: ['loading'] }, duration_ms: { type: 'integer' } }],
  ['audio.stop', '停止等待音效', { playback_event_id: { type: 'string' } }],
  ['light.blink', '灯光闪烁', { color: { type: 'string', enum: ['yellow', 'white', 'blue', 'green', 'red'] }, duration_ms: { type: 'integer' } }],
  ['mcps.search', '查找可用连接器', { query: { type: 'string' } }],
  ["mcp.connect('gmail').search_messages", '查询邮件', { mail_query: { type: 'string' } }],
  ["mcp.connect('gmail').get_message", '读取邮件', { message_id: { type: 'string' } }],
  ["mcp.connect('calendar').list_events", '查询日程', { time_range: { type: 'object' } }],
  ["mcp.connect('coffee').create_order", '创建订单', { order_params: { type: 'object' } }],
  ["mcp.connect('coffee').get_order", '查询订单', { order_id: { type: 'string' } }],
];
export const TOOL_GROUPS = ['Memory 工具', '系统工具', 'MCP 工具', '其他工具'] as const;
export const toolGroup = (name: string) =>
  name.startsWith('memory.') ? 'Memory 工具'
  : /^(mcp|connectors\.)/.test(name) ? 'MCP 工具'
  : /^(system|location|gps|position|device|audio|ui|light|living_edge|information_card)\./.test(name) ? '系统工具'
  : '其他工具';
export function availableTools(s: Scenario): Tool[] {
  const tools = new Map<string, Tool>();
  for (const tool of (baseMeta as any).static_context.tools as Tool[]) tools.set(tool.function.name, tool);
  for (const [name, description, properties] of CATALOG)
    tools.set(name, { type: 'function', function: { name, description, parameters: { type: 'object', properties, required: Object.keys(properties) } } });
  for (const tool of ((s.meta as any)?.static_context?.tools ?? []) as Tool[]) tools.set(tool.function.name, tool);
  return [...tools.values()];
}
export const editableTrack = (name: string) => !['用户', '助手'].includes(name);
export const EXPRESSIONS = ['垫句', '慢说', '持续平调鼻音', '仅文字回复', '其他表达'];
export const SOURCES: Record<string, string[]> = {
  世界: ['sms', 'screen', 'device', 'calendar', 'payment', 'external'],
  用户控制: ['card', 'living_edge', 'button'],
};
// 工具片段和它那对 Events 的对应关系：优先看 toolEventId，其次按起止时间反查。
export function toolEventOf(s: Scenario, clip: Clip): string | undefined {
  if (clip.toolEventId) return clip.toolEventId;
  const requests = s.inputEvents.filter(
    (e) => e.tool_name && e.query !== undefined && Math.round(e.time_at_ms) === Math.round(clip.a) &&
      s.inputEvents.some((r) => r.event_id === e.event_id && r.query === undefined && Math.round(r.time_at_ms) === Math.round(clip.b)),
  );
  return requests.find((e) => clip.label.includes(e.tool_name!))?.event_id ?? (requests.length === 1 ? requests[0].event_id : undefined);
}
function normalize(s: Scenario): Scenario {
  s.END = Math.max(s.END, ...s.tracks.flatMap((t) => t.clips.map((c) => Math.ceil(c.b / 400) * 400)));
  s.playableClips = s.tracks.flatMap((t) => t.clips).filter((c) => c.audioKey);
  s.inputEvents.sort((a, b) => a.time_at_ms - b.time_at_ms);
  s.edited = true;
  const meta = s.meta as any;
  if (meta?.meta_data?.media?.audio) meta.meta_data.media.audio.duration_ms = s.END;
  return withExpressionMode(s);
}
export function deleteClip(base: Scenario, ti: number, ci: number, cascade = true): Scenario {
  const track = base.tracks[ti];
  if (!editableTrack(track.name)) throw Error('用户和助手语音片段不支持删除');
  const s = structuredClone(base);
  const target = s.tracks[ti], clip = target.clips[ci];
  const eventId = target.name === '工具调用' ? toolEventOf(s, clip) : undefined;
  const dropped = new Set([eventId, clip.inputEventId].filter(Boolean) as string[]);
  // 删掉 audio.play 就把配对的 audio.stop 一起删：停止必须挂在一次真实播放上。
  if (eventId && cascade)
    for (const e of s.inputEvents)
      if (e.query && e.tool_name === 'audio.stop')
        try { if (JSON.parse(e.query).playback_event_id === eventId) dropped.add(e.event_id); } catch { /* 不是 JSON 就不是这一对 */ }
  s.inputEvents = s.inputEvents.filter(
    (e) => !dropped.has(e.event_id) &&
      !(!e.tool_name && !clip.inputEventId && ['用户控制', '世界'].includes(target.name) && e.time_at_ms === clip.a),
  );
  target.clips.splice(ci, 1);
  if (eventId)
    for (const t of s.tracks.filter((t) => t.name === '工具调用'))
      t.clips = t.clips.filter((c) => !dropped.has(toolEventOf(base, c) ?? ''));
  if (target.name === '表达控制') {
    for (const key of Object.keys(s.controlAnnotations))
      (s.controlAnnotations as any)[key] = (s.controlAnnotations as any)[key].filter((a: any) =>
        clip.annotationId ? a.annotation_id !== clip.annotationId : !(a.start_at_ms === clip.a && a.end_at_ms === clip.b));
    // 悄悄话那条是按助手文字回复自动生成的，删掉就要记下来，不然下一次渲染又长回来。
    if (clip.label === '悄悄话模式 · 仅文字回复')
      s.suppressedExpressionIds = [...(s.suppressedExpressionIds ?? []), clip.messageId ?? `${clip.a}:${clip.b}`];
  }
  return normalize(s);
}
export function saveClip(base: Scenario, ti: number, ci: number | null, form: ClipForm): Scenario {
  if (!editableTrack(base.tracks[ti].name)) throw Error('此轨道不支持创建片段');
  if (!Number.isSafeInteger(form.a) || !Number.isSafeInteger(form.b) || form.a < 0 || form.b <= form.a)
    throw Error('请填写有效的开始和结束时间');
  const old = ci === null ? undefined : base.tracks[ti].clips[ci];
  // 改片段 = 先按不级联的方式删掉旧的，再按新表单建一个，省得两套写法各错一半。
  const s = ci === null ? structuredClone(base) : deleteClip(base, ti, ci, false);
  const track = s.tracks[ti];
  const clip: Clip = { ...old, a: Math.round(form.a / 400) * 400, b: Math.round(form.b / 400) * 400, label: form.label.trim(), sub: form.sub };
  if (clip.b <= clip.a) throw Error('片段至少占 400 ms');
  if (!clip.label && track.name !== '工具调用') throw Error('请填写片段名称');
  if (track.name === '工具调用') {
    if (!form.tool) throw Error('请选择工具');
    const eventId = (old && toolEventOf(base, old)) || crypto.randomUUID();
    clip.toolEventId = eventId;
    if (old?.audioKey) {
      // 带音频的片段（比如 Loading）长度由音频决定，只允许整体挪。
      clip.b = clip.a + (old.b - old.a);
      if (old.audioEnd !== undefined) clip.audioEnd = old.audioEnd + clip.a - old.a;
      if (old.gainPoints) clip.gainPoints = old.gainPoints.map(([time, gain]) => [time + clip.a - old.a, gain]);
    }
    clip.label = formatToolCall(form.tool.function.name, JSON.stringify(form.args ?? {}));
    s.inputEvents.push(
      { event_id: eventId, event_type: 'function_call', tool_name: form.tool.function.name, time_at_ms: clip.a, query: JSON.stringify(form.args ?? {}) },
      { event_id: eventId, event_type: 'function_call', tool_name: form.tool.function.name, time_at_ms: clip.b, results: form.results ?? {} },
    );
    const meta = (s.meta ?? structuredClone(baseMeta)) as any;
    const context = meta.static_context ?? {};
    s.meta = {
      ...meta,
      static_context: { ...context, tools: [...(context.tools ?? []).filter((t: Tool) => t.function.name !== form.tool!.function.name), form.tool] },
    };
  } else if (['用户控制', '世界'].includes(track.name)) {
    clip.inputEventId = old?.inputEventId ?? crypto.randomUUID();
    s.inputEvents.push({
      event_id: clip.inputEventId, event_type: track.name === '世界' ? 'world_event' : 'ui_event',
      time_at_ms: clip.a, context: { ...form.context, source: form.source, action: form.action, description: clip.label },
    });
  } else if (track.name === '表达控制') {
    // 表达控制只标助手：起止时间跟着选中的那句助手语音，不单独设。
    const host = s.tracks.find((t) => t.name === '助手')?.clips[form.assistantIndex ?? -1];
    if (!host) throw Error('请选择对应的助手回复');
    if (form.annotation === '仅文字回复' && host.outputMode !== 'text') throw Error('仅文字标注需要选择文字回复');
    clip.a = host.a;
    clip.b = host.b;
    clip.messageId = host.messageId;
    clip.utteranceId = host.utteranceId ?? s.utterances.find((u) => u.speaker === 'assistant' && u.start_at_ms === host.a && u.end_at_ms === host.b)?.id;
    clip.annotationId = crypto.randomUUID();
    const annotation = { annotation_id: clip.annotationId, role: 'assistant', start_at_ms: clip.a, end_at_ms: clip.b };
    if (['垫句', '慢说'].includes(form.annotation ?? ''))
      s.controlAnnotations.fdx_annotation.push({ ...annotation, fdx_type: form.annotation } as any);
    else
      (s.controlAnnotations.custom_annotation as any[]).push({
        ...annotation,
        ...(form.annotation === '仅文字回复'
          ? { annotation_type: 'output_mode', mode: 'text_only', message_id: host.messageId }
          : { annotation_type: 'expression', value: form.annotation }),
        description: clip.sub,
      });
  }
  let lane = 0;
  while (track.clips.some((c) => (c.lane ?? 0) === lane && c.a < clip.b && clip.a < c.b)) lane++;
  clip.lane = lane;
  track.clips.push(clip);
  return normalize(s);
}
