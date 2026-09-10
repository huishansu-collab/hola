// 脚本 → Case 包。把人写的一段脚本编成七轨时间线，让平台自动切轨、
// 自动标注，之后人再拖。
//
// 一行一件事，行首的词决定它落在哪条轨道：
//
//   用户 帮我点一杯瑞幸的茉莉花奶茶。          [低语]
//   判断 识别下单意图：饮品下单 / 瑞幸 / 茉莉花奶茶
//   助手 嗯……                                 [垫句]
//   工具 quote: delivery.quote(product=茉莉花奶茶) => price_cny=12 [时长 1.6秒]
//   助手 好的，一杯茉莉花奶茶，送到公司，对吧？  [依赖 quote]
//
// 时间不用写：台词按字数估时长，助手起点对齐 400 ms 微轮次，跨轨道依赖
// 自动留出 400 ms。写了 [依赖 x] 就等 x 返回，没写就顺着脚本往下排。
// 估出来的是 planned 时间，配音之后按录音重排——所以包里 timing_status
// 一律是 planned，不冒充实测。
import type { CasePackage } from '../lib/case-package/index.ts';

export type Issue = { line: number; message: string; text?: string };
export type Row = {
  line: number;
  track: string;
  start: number;
  end: number;
  label: string;
  note?: string;
  lane: number;
  tag?: string;
};
export type Compiled = {
  pack?: CasePackage;
  title: string;
  group: string;
  errors: Issue[];
  warnings: Issue[];
  rows: Row[];
  stats: { user: number; assistant: number; tools: number; duration: number };
};
type Mod = { name: string; value: string };
type Line = {
  line: number;
  kind: string;
  text: string;
  mods: Mod[];
  raw: string;
};

const KIND: Record<string, string> = {
  用户: 'user', user: 'user',
  助手: 'assistant', assistant: 'assistant',
  判断: 'reasoning', 后台判断: 'reasoning', reasoning: 'reasoning',
  表达: 'expression', 表达控制: 'expression', expression: 'expression',
  世界: 'world', world: 'world',
  控制: 'control', 用户控制: 'control', control: 'control',
  工具: 'tool', tool: 'tool',
};
const HEAD: Record<string, string> = {
  标题: 'title', title: 'title',
  分组: 'group', group: 'group',
  目标: 'goal', goal: 'goal',
  边界: 'boundary', boundary: 'boundary',
  说明: 'note', note: 'note',
  角色: 'roles', roles: 'roles',
  ID: 'id', id: 'id',
};
const TRACK_NAME: Record<string, string> = {
  user: '用户', control: '用户控制', assistant: '助手', expression: '表达控制',
  world: '世界', reasoning: '后台判断', tools: '工具调用',
};
const FLAGS = ['打断', '附和', '垫句', '慢说', '低语', '耳语', 'whisper', '不等', '并行'];
const grid = (t: number) => Math.ceil(Math.max(0, t) / 400) * 400;
const PAUSE: Record<string, number> = { '，': 150, '、': 150, '；': 150, ',': 150, '。': 250, '？': 250, '！': 250, '：': 150, '…': 250 };

// 台词时长按字数估：中文约每字 200 ms，标点各自留一个换气。真值等配音。
export function speechMs(text: string) {
  let ms = 250;
  for (const ch of text.replace(/\s/g, '')) {
    if (PAUSE[ch] !== undefined) ms += PAUSE[ch];
    else if (/[A-Za-z0-9]/.test(ch)) ms += 90;
    else if (!/[「」『』"'()（）\[\]]/.test(ch)) ms += 200;
  }
  return Math.max(600, Math.round(ms / 50) * 50);
}
const msValue = (raw: string, fallback: number) => {
  const m = /^(\d+(?:\.\d+)?)\s*(秒|s|ms|毫秒)?$/.exec(raw.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  return Math.round(m[2] === '秒' || m[2] === 's' ? n * 1000 : n);
};
// 逗号分隔，但花括号和引号里的逗号不算分隔。
function splitArgs(s: string) {
  const out: string[] = [];
  let depth = 0, quote = '', current = '';
  for (const ch of s) {
    if (quote) { current += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') depth--;
    if ((ch === ',' || ch === '，') && depth === 0) { out.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out.map((x) => x.trim()).filter(Boolean);
}
function value(raw: string): unknown {
  const v = raw.trim();
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  if (v === 'null') return null;
  if (/^[{[]/.test(v)) { try { return JSON.parse(v); } catch { return v; } }
  return v.replace(/^["']|["']$/g, '');
}
function pairs(list: string[]) {
  const out: Record<string, unknown> = {};
  for (const [i, item] of list.entries()) {
    const at = item.indexOf('=');
    if (at < 0) out[`arg_${i + 1}`] = value(item);
    else out[item.slice(0, at).trim()] = value(item.slice(at + 1));
  }
  return out;
}
const schema = (args: Record<string, unknown>) => ({
  type: 'object',
  properties: Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      { type: typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v === 'boolean' ? 'boolean' : v && typeof v === 'object' ? 'object' : 'string' },
    ]),
  ),
  required: Object.keys(args),
});

export function parseScript(text: string) {
  const head: Record<string, string> = {};
  const lines: Line[] = [];
  const errors: Issue[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = i + 1, trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    const m = /^([^\s：:]+)\s*[：:]?\s*([\s\S]*)$/.exec(trimmed)!;
    const word = m[1], rest = m[2].trim();
    if (HEAD[word]) { head[HEAD[word]] = rest; continue; }
    const kind = KIND[word];
    if (!kind) { errors.push({ line, text: trimmed, message: `行首「${word}」不是轨道关键词，可用：${Object.keys(KIND).filter((k) => /[一-龥]/.test(k)).join('、')}` }); continue; }
    // 修饰只认开头和结尾的方括号，台词里的方括号留给台词。
    const mods: Mod[] = [];
    let body = rest;
    const take = (re: RegExp) => {
      for (;;) {
        const found = re.exec(body);
        if (!found) return;
        const inner = found[1].trim();
        const at = inner.search(/[\s：:]/);
        mods.push(at < 0 ? { name: inner, value: '' } : { name: inner.slice(0, at), value: inner.slice(at + 1).trim() });
        body = (re.source.startsWith('^') ? body.slice(found[0].length) : body.slice(0, found.index)).trim();
      }
    };
    take(/^[[【]([^\]】]*)[\]】]\s*/);
    take(/\s*[[【]([^\]】]*)[\]】]$/);
    lines.push({ line, kind, text: body.trim(), mods, raw: trimmed });
  }
  return { head, lines, errors };
}

export function compileScript(text: string, options: { baseMeta: Record<string, any>; caseId?: string; uuid?: string }): Compiled {
  const { head, lines, errors: parseErrors } = parseScript(text);
  const errors = [...parseErrors], warnings: Issue[] = [];
  const fail = (line: number, message: string) => errors.push({ line, message });
  const title = head.title?.trim() || '未命名脚本';
  const caseId = options.caseId ?? (head.id?.trim() || 'script-draft');
  const utterances: any[] = [], events: any[] = [], rows: Row[] = [];
  const clips: Record<string, any[]> = { user: [], control: [], assistant: [], expression: [], world: [], reasoning: [], tools: [] };
  const fdx: any[] = [], paralinguistic: any[] = [], interruptions: any[] = [], backchannels: any[] = [], links: any[] = [], dependencies: any[] = [];
  const tools = new Map<string, any>();
  const toolEnd = new Map<string, number>();
  const toolLine = new Map<string, number>();

  let voiceClock = 0;      // 最后一句人声的末端：对话往前走的钟
  let sideClock = 0;       // 后台、工具那边的钟，用户一开口就跟着重置
  let flowEnd = 0;         // 上一句人声之后，非人声片段最靠后的末端
  let lastUser: any = null, lastAssistant: any = null, lastSide: { start: number; end: number } | null = null;
  let index = 0;

  const modOf = (l: Line, name: string) => l.mods.find((x) => x.name === name);
  const has = (l: Line, name: string) => l.mods.some((x) => x.name === name);
  const notes = (l: Line) =>
    l.mods.filter((x) => !FLAGS.includes(x.name) && !['等', '时长', '依赖', 'lane', '丢弃', '备注', '@'].includes(x.name) && !x.name.startsWith('@'))
      .map((x) => (x.value ? `${x.name} ${x.value}` : x.name))
      .concat(modOf(l, '备注')?.value ?? [])
      .filter(Boolean)
      .join(' · ');
  const dependsOn = (l: Line) => (modOf(l, '依赖')?.value ?? '').split(/[,，\s]+/).filter(Boolean);
  const after = (l: Line) => {
    let at = 0;
    for (const id of dependsOn(l)) {
      const end = toolEnd.get(id);
      if (end === undefined) fail(l.line, `[依赖 ${id}] 找不到这个工具；工具行要写成「工具 ${id}: 名字(...)」`);
      else at = Math.max(at, end + 400);
    }
    const explicit = l.mods.find((x) => x.name.startsWith('@'));
    if (explicit) at = Math.max(at, msValue(explicit.name.slice(1) || explicit.value, at));
    return at;
  };

  for (const l of lines) {
    const gap = msValue(modOf(l, '等')?.value ?? '', 0);
    const note = notes(l);
    if (l.kind === 'user' || l.kind === 'assistant') {
      if (!l.text) { fail(l.line, '这一行没有台词'); continue; }
      const id = `u${String(++index).padStart(3, '0')}`;
      let start: number, end: number, tag = '';
      const duration = msValue(modOf(l, '时长')?.value ?? '', speechMs(l.text));
      if (l.kind === 'user' && has(l, '打断')) {
        if (!lastAssistant) { fail(l.line, '[打断] 前面没有助手在说话，打断无从谈起'); continue; }
        const host = lastAssistant;
        start = Math.round(host.start_at_ms + (host.end_at_ms - host.start_at_ms) * 0.6);
        end = start + duration;
        // 停声就是助手这句的末端：检出 200 ms，再 200 ms 发停播指令，淡出 400 ms。
        const detected = start + 200, stopCommand = detected + 200, stop = stopCommand + 400;
        host.end_at_ms = stop;
        const discarded = modOf(lines.find((x) => x.line === host.__line)!, '丢弃')?.value ?? '';
        interruptions.push({
          user_id: id, assistant_id: host.id, control_type: 'speech_interruption',
          user_voice_onset_at_ms: start, detected_at_ms: detected,
          stop_command_at_ms: stopCommand, fade_start_at_ms: stopCommand, stop_at_ms: stop,
          ...(discarded ? { discarded_text: discarded } : {}),
        });
        tag = '打断';
      } else if (l.kind === 'assistant' && has(l, '附和')) {
        if (!lastUser) { fail(l.line, '[附和] 前面没有用户在说话，附和没有落点'); continue; }
        const host = lastUser;
        start = grid(host.start_at_ms + (host.end_at_ms - host.start_at_ms) * 0.4);
        end = Math.min(start + duration, host.end_at_ms - 200);
        if (end - start < 400 || start <= host.start_at_ms) {
          fail(l.line, `[附和] 塞不进「${host.text}」里：附和必须整段压在用户人声内部，把用户那句写长一点，或者去掉 [附和] 当正常接话`);
          continue;
        }
        backchannels.push({ over_user_id: host.id, assistant_id: id });
        tag = '附和';
      } else {
        const opening = !utterances.length;
        const floor = opening ? gap : Math.max(after(l), has(l, '不等') ? 0 : flowEnd + 400, voiceClock + (gap || (l.kind === 'user' ? 500 : 400)));
        start = l.kind === 'assistant' ? grid(floor) : Math.round(floor);
        end = start + duration;
        if (l.kind === 'assistant' && lastUser && lastUser.end_at_ms + 400 <= start && lastUser.end_at_ms > (lastAssistant?.end_at_ms ?? -1))
          links.push({ user_id: lastUser.id, assistant_id: id });
      }
      const u = { id, speaker: l.kind === 'user' ? 'user' : 'assistant', speaker_id: l.kind === 'user' ? 'user_1' : 'assistant', text: l.text, start_at_ms: start, end_at_ms: end, __line: l.line } as any;
      utterances.push(u);
      clips[l.kind].push({ kind: 'speech', utterance_id: id, __start: start, __end: end });
      rows.push({ line: l.line, track: TRACK_NAME[l.kind], start, end, label: l.text, note, lane: 0, tag });
      clips[l.kind].at(-1).__row = rows.length - 1;
      for (const name of ['垫句', '慢说'] as const)
        if (has(l, name)) {
          fdx.push({ fdx_type: name, role: 'assistant', start_at_ms: start, end_at_ms: end });
          clips.expression.push({ kind: 'expression', label: `${name} · ${l.text}`, description: note || (name === '垫句' ? '只表示在等结果，不是回答' : '局部放慢，随后恢复常规语速'), start_at_ms: start, end_at_ms: end, __start: start, __end: end, __row: rows.length });
          rows.push({ line: l.line, track: '表达控制', start, end, label: `${name} · ${l.text}`, lane: 0, tag: name });
        }
      if (['低语', '耳语', 'whisper'].some((f) => has(l, f)))
        paralinguistic.push({ type: '低语', role: u.speaker, start_at_ms: start, end_at_ms: end });
      if (tag === '附和') { lastAssistant = u; continue; }
      voiceClock = Math.max(voiceClock, end);
      flowEnd = 0;
      if (l.kind === 'user') { lastUser = u; sideClock = 0; }
      else lastAssistant = u;
      continue;
    }
    // 非人声：后台判断、世界、用户控制、工具，都在 400 ms 网格上。
    const parallel: boolean = has(l, '并行') && !!lastSide;
    // 后台不等助手自己说完:它只跟着用户输入和上一件后台的事走。相邻两件默认
    // 有前后依赖,留 400 ms;真正同时开始的写 [并行]。
    const base = parallel ? lastSide!.start : Math.max(sideClock, lastUser?.end_at_ms ?? 0, after(l) - 400) + 400 + gap;
    const start: number = parallel ? lastSide!.start : grid(base);
    if (l.kind === 'tool') {
      const m = /^(?:([A-Za-z0-9_.-]+)\s*:\s*)?([A-Za-z0-9_.]+)\s*\(([\s\S]*?)\)\s*(?:=>\s*([\s\S]*))?$/.exec(l.text);
      if (!m) { fail(l.line, '工具行写成「工具 编号: 名字(参数=值) => 结果=值」'); continue; }
      const [, given, name, argText, resultText] = m;
      const eventId = (given || `${name.split('.').pop()}_${clips.tools.length + 1}`).replace(/[^A-Za-z0-9_-]/g, '_');
      if (toolEnd.has(eventId)) { fail(l.line, `工具编号 ${eventId} 重复了`); continue; }
      const args = pairs(splitArgs(argText));
      const results = { ...pairs(splitArgs(resultText ?? '')), simulated: true };
      const end = start + msValue(modOf(l, '时长')?.value ?? '', 1200);
      if (!tools.has(name))
        tools.set(name, { type: 'function', function: { name, description: `模拟：${name}`, parameters: schema(args) } });
      else {
        // 同名工具的第二次调用可能带别的参数：字段取并集，必填取交集，
        // 不然「这次没传」会被当成缺字段。
        const f = tools.get(name).function, s = schema(args);
        Object.assign(f.parameters.properties, s.properties);
        f.parameters.required = f.parameters.required.filter((k: string) => s.required.includes(k));
      }
      events.push({ event_id: eventId, event_type: 'function_call', tool_name: name, time_at_ms: start, query: JSON.stringify(args) });
      events.push({ event_id: eventId, event_type: 'function_call', tool_name: name, time_at_ms: grid(end), results });
      clips.tools.push({ kind: 'tool', event_id: eventId, ...(note ? { description: note } : {}), __start: start, __end: grid(end), __row: rows.length });
      toolEnd.set(eventId, grid(end));
      toolLine.set(eventId, l.line);
      const parents = dependsOn(l).filter((x) => toolEnd.has(x) && x !== eventId);
      if (parents.length) dependencies.push({ event_id: eventId, depends_on: parents });
      rows.push({ line: l.line, track: '工具调用', start, end: grid(end), label: `${name}(${Object.keys(args).join(', ')})`, note, lane: 0 });
      lastSide = { start, end: grid(end) };
      sideClock = Math.max(sideClock, grid(end));
      flowEnd = Math.max(flowEnd, grid(end));
      continue;
    }
    if (!l.text) { fail(l.line, '这一行没有内容'); continue; }
    if (l.kind === 'expression') {
      // 表达控制只标助手：一律贴在上一句助手语音上，区间跟它一样。
      if (!lastAssistant) { fail(l.line, '表达控制必须跟着一句助手语音，前面还没有'); continue; }
      clips.expression.push({ kind: 'expression', label: l.text, description: note || l.text, start_at_ms: lastAssistant.start_at_ms, end_at_ms: lastAssistant.end_at_ms, __start: lastAssistant.start_at_ms, __end: lastAssistant.end_at_ms, __row: rows.length });
      rows.push({ line: l.line, track: '表达控制', start: lastAssistant.start_at_ms, end: lastAssistant.end_at_ms, label: l.text, note, lane: 0 });
      continue;
    }
    const end = start + msValue(modOf(l, '时长')?.value ?? '', l.kind === 'reasoning' ? 800 : 400);
    const kind = l.kind === 'reasoning' ? 'state' : l.kind === 'world' ? 'world' : 'action';
    clips[l.kind].push({ kind, label: l.text, ...(note ? { description: note } : {}), start_at_ms: start, end_at_ms: grid(end), __start: start, __end: grid(end), __row: rows.length });
    rows.push({ line: l.line, track: TRACK_NAME[l.kind], start, end: grid(end), label: l.text, note, lane: 0 });
    lastSide = { start, end: grid(end) };
    sideClock = Math.max(sideClock, grid(end));
    flowEnd = Math.max(flowEnd, grid(end));
  }

  if (!utterances.length) fail(0, '脚本里一句台词都没有');
  // 同轨并发分 lane：谁先开始谁先挑，挑最靠前的空行。
  for (const list of Object.values(clips)) {
    list.sort((a, b) => a.__start - b.__start || a.__end - b.__end);
    const lanes: number[] = [];
    for (const c of list) {
      let lane = lanes.findIndex((end) => end <= c.__start);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = c.__end;
      if (lane) c.lane = lane;
      if (rows[c.__row]) rows[c.__row].lane = lane;
      delete c.__start; delete c.__end; delete c.__row;
    }
  }
  utterances.sort((a, b) => a.start_at_ms - b.start_at_ms);
  events.sort((a, b) => a.time_at_ms - b.time_at_ms || (a.query ? 0 : 1) - (b.query ? 0 : 1));
  const duration = Math.max(0, ...utterances.map((u) => u.end_at_ms), ...Object.values(clips).flat().map((c: any) => c.end_at_ms ?? 0), ...events.map((e) => e.time_at_ms));
  // 长静默要有人接住：用户说完到助手开口之间静太久，中间得有一句垫句。
  // 同一轮里已经垫过一句就不再报——不为了填满等待反复「嗯」。
  for (const r of utterances.filter((u) => u.speaker === 'assistant')) {
    const before = utterances.filter((x) => x.end_at_ms <= r.start_at_ms);
    if (!before.length) continue;
    const quiet = Math.max(...before.map((x) => x.end_at_ms));
    const turn = Math.max(0, ...utterances.filter((x) => x.speaker !== 'assistant' && x.end_at_ms <= r.start_at_ms).map((x) => x.end_at_ms));
    if (r.start_at_ms - quiet > 2000 && !fdx.some((f) => f.fdx_type === '垫句' && f.start_at_ms >= turn && f.end_at_ms <= r.start_at_ms))
      warnings.push({ line: r.__line, message: `${quiet} ms 起静了 ${r.start_at_ms - quiet} ms 才轮到「${r.text}」，这一轮没人垫一句` });
  }
  for (const u of utterances) delete u.__line;
  const meta = {
    ...options.baseMeta,
    static_context: {
      ...options.baseMeta.static_context,
      tools: [...tools.values()],
      constraints: {
        ...options.baseMeta.static_context?.constraints,
        simulated: true, timing_status: 'planned', audio_status: 'none', stream_step_ms: 400,
        ...(options.uuid ? { uuid_v7: options.uuid } : {}),
        ...(head.goal ? { task_goal: head.goal } : {}),
        ...(head.boundary ? { completion_boundary: head.boundary } : {}),
        audio_note: head.note || '语音待生成；时间按字数估算，配音后按录音重排。',
      },
    },
    meta_data: {
      ...options.baseMeta.meta_data,
      sample: { ...options.baseMeta.meta_data?.sample, case_id: caseId, case_name: title, source_type: 'simulated_case' },
      media: { ...options.baseMeta.meta_data?.media, audio: { ...options.baseMeta.meta_data?.media?.audio, duration_ms: duration, file: null, tracks: [{ track_ref: 'Channel 1', role: 'user' }, { track_ref: 'Channel 2', role: 'assistant' }] } },
    },
  };
  const pack: CasePackage = {
    format: 'interaction-case/1',
    manifest: { schema_version: 1, case_id: caseId, title, ...(head.group ? { group: head.group } : {}), files: { case: 'case.json', timeline: 'timeline.json', alignment: 'generation/alignment.json', brief: 'brief.md', script: 'script.md' } },
    case: { ...meta, utterances, events, fdx_annotation: fdx, emotion_annotation: [], paralinguistic_annotation: paralinguistic, custom_annotation: [] },
    timeline: {
      schema_version: 1,
      tracks: ['user', 'control', 'assistant', 'expression', 'world', 'reasoning', 'tools'].map((id) => ({ id, clips: clips[id] })),
      ...(links.length ? { response_links: links } : {}),
      ...(interruptions.length ? { interruptions } : {}),
      ...(backchannels.length ? { backchannels } : {}),
      ...(dependencies.length ? { tool_dependencies: dependencies } : {}),
    },
    alignment: { schema_version: 1, clips: [] },
    sources: {},
  };
  rows.sort((a, b) => a.start - b.start || a.end - b.end);
  return {
    pack: errors.length ? undefined : pack,
    title, group: head.group ?? '',
    errors, warnings, rows,
    stats: { user: utterances.filter((u) => u.speaker !== 'assistant').length, assistant: utterances.filter((u) => u.speaker === 'assistant').length, tools: toolEnd.size, duration },
  };
}
