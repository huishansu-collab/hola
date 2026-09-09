import { decodeWav, wav, peaks, base64, unbase64 } from './audio.ts';
export const roles = [
  ['user', '用户', 'green'],
  ['control', '用户控制', 'pink'],
  ['assistant', '助手', 'blue'],
  ['expression', '表达控制', 'purple'],
  ['world', '世界', 'teal'],
  ['reasoning', '后台判断', 'amber'],
  ['tools', '工具调用', 'teal'],
] as const;
// JSON records are validated at this boundary before the renderer consumes them.
export type RecordData = Record<string, any>;
export type CasePackage = {
  format: 'interaction-case/1';
  manifest: RecordData;
  case: RecordData;
  timeline: RecordData;
  alignment: RecordData;
  sources: Record<string, string>;
};
export type AudioClip = {
  src: string;
  start: number;
  duration: number;
  peaks: number[];
  sourceStart: number;
  sourceEnd: number;
  source: string;
};
export type RuntimeCase = {
  manifest: RecordData;
  case: RecordData;
  timeline: RecordData;
  audio: Record<string, AudioClip>;
};
const check = (ok: unknown, message: string) => {
  if (!ok) throw Error(message);
};
const ms = (n: unknown) =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export const safePath = (p: unknown): p is string =>
  typeof p === 'string' &&
  p.length > 0 &&
  !p.startsWith('/') &&
  !p.includes('\\') &&
  !p.includes(':') &&
  p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
function interval(a: any, b: any, end: number, label: string) {
  check(ms(a) && ms(b) && a < b && b <= end, `${label}：起止时间无效`);
}
function params(value: any, s: any, path: string) {
  if (s.type === 'object') {
    check(
      value && typeof value === 'object' && !Array.isArray(value),
      `${path} 应为对象`,
    );
    for (const k of s.required ?? [])
      check(Object.hasOwn(value, k), `${path} 缺少 ${k}`);
    for (const [k, v] of Object.entries(value))
      if (s.properties?.[k]) params(v, s.properties[k], `${path}.${k}`);
  } else if (s.type === 'array') {
    check(Array.isArray(value), `${path} 应为数组`);
    if (s.items) for (const v of value) params(v, s.items, path);
  } else if (s.type === 'integer')
    check(Number.isSafeInteger(value), `${path} 应为整数`);
  else if (s.type) check(typeof value === s.type, `${path} 类型错误`);
  if (s.enum) check(s.enum.includes(value), `${path} 不在允许值中`);
}
export function validatePackage(input: unknown): CasePackage {
  const p = input as CasePackage;
  check(p && p.format === 'interaction-case/1', '不支持的 Case 包版本');
  const { manifest: m, case: d, timeline: t, alignment: a } = p;
  check(
    m && m.schema_version === 1 && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(m.case_id),
    'manifest：Case ID 或版本无效',
  );
  check(
    typeof m.title === 'string' && m.title.trim() && m.title.length <= 200,
    'manifest：标题无效',
  );
  for (const key of ['case', 'timeline', 'alignment', 'brief', 'script'])
    check(safePath(m.files?.[key]), `manifest.files.${key} 路径无效`);
  check(
    d?.meta_data?.sample?.case_id === m.case_id &&
      d.meta_data.sample.case_name === m.title,
    'Case ID / 标题与 manifest 不一致',
  );
  const duration = d.meta_data?.media?.audio?.duration_ms;
  const planning = d.static_context?.constraints?.timing_status === 'planned';
  // Voiced cases stay inside ten minutes — that is a rendering and delivery
  // limit. A planned case carries no audio and may legitimately span hours:
  // a geofenced reminder that fires when you get home, a heavy job that
  // reports back twenty minutes later.
  check(
    ms(duration) && duration > 0 && duration <= (planning ? 21600000 : 600000),
    planning
      ? 'Case 时长必须在 0–6 小时之间'
      : 'Case 时长必须在 0–600 秒之间',
  );
  check(
    JSON.stringify(d.meta_data.media.audio.tracks) ===
      JSON.stringify([
        { track_ref: 'Channel 1', role: 'user' },
        { track_ref: 'Channel 2', role: 'assistant' },
      ]),
    '声道必须为用户左、助手右',
  );
  const constraints = d.static_context?.constraints ?? {};
  // A package may be authored before its speech exists. Planned packages carry
  // no audio at all; anything half-aligned is rejected rather than half-checked.
  const planned = constraints.timing_status === 'planned';
  check(
    planned || constraints.timing_status === 'aligned',
    'constraints.timing_status 必须为 planned 或 aligned',
  );
  check(
    planned
      ? constraints.audio_status === 'none'
      : constraints.audio_status === 'generated',
    'planned 包不得声明已生成音频，aligned 包必须声明 generated',
  );
  for (const k of [
    'utterances',
    'events',
    'fdx_annotation',
    'emotion_annotation',
    'paralinguistic_annotation',
    'custom_annotation',
  ])
    check(Array.isArray(d[k]), `case.json 缺少数组 ${k}`);
  check(
    t?.schema_version === 1 &&
      a?.schema_version === 1 &&
      Array.isArray(t.tracks) &&
      Array.isArray(a.clips),
    'timeline / alignment 版本或结构无效',
  );
  check(
    t.tracks.length === 7 &&
      roles.every(
        ([id]) => t.tracks.filter((x: any) => x.id === id).length === 1,
      ),
    '必须包含七条轨道，各一次',
  );
  const utterances = new Map<string, any>();
  for (const u of d.utterances) {
    check(
      typeof u.id === 'string' &&
        /^[a-zA-Z0-9_-]+$/.test(u.id) &&
        !utterances.has(u.id),
      'Utterance ID 重复或无效',
    );
    check(
      ['user', 'assistant', 'third_party'].includes(u.speaker) &&
        typeof u.speaker_id === 'string' &&
        typeof u.text === 'string' &&
        u.text.trim(),
      'Utterance 角色或台词无效',
    );
    interval(u.start_at_ms, u.end_at_ms, duration, u.id);
    if (u.speaker === 'assistant')
      check(u.start_at_ms % 400 === 0, `${u.id} 助手起点未对齐 400 ms`);
    utterances.set(u.id, u);
  }
  const tools = new Map<string, any>();
  check(Array.isArray(d.static_context?.tools), '缺少工具定义');
  for (const x of d.static_context.tools) {
    check(
      x.function?.name && !tools.has(x.function.name),
      '工具定义重复或无效',
    );
    tools.set(x.function.name, x.function);
  }
  const groups = new Map<string, any[]>(),
    used = new Set<string>();
  let previous = -1;
  for (const e of d.events) {
    check(
      ms(e.time_at_ms) && e.time_at_ms <= duration && e.time_at_ms >= previous,
      'Events 时间无效或未排序',
    );
    previous = e.time_at_ms;
    check(typeof e.event_id === 'string', 'Event ID 无效');
    if (e.tool_name) {
      check(tools.has(e.tool_name), `未定义工具 ${e.tool_name}`);
      used.add(e.tool_name);
    }
    const g = groups.get(e.event_id) ?? [];
    g.push(e);
    groups.set(e.event_id, g);
  }
  check(
    [...tools.keys()].every((k) => used.has(k)),
    'Meta 包含未使用的工具',
  );
  for (const [id, g] of groups)
    if (g[0].tool_name) {
      const q = g.filter((e) => e.query !== undefined),
        r = g.filter((e) => e.results !== undefined || e.result !== undefined);
      check(
        g.length === 2 &&
          q.length === 1 &&
          r.length === 1 &&
          q[0].tool_name === r[0].tool_name &&
          q[0].time_at_ms <= r[0].time_at_ms,
        `${id} 请求 / 返回配对错误`,
      );
      let v;
      try {
        v = JSON.parse(q[0].query);
      } catch {
        throw Error(`${id} query 必须是 JSON 字符串`);
      }
      params(v, tools.get(q[0].tool_name).parameters, id);
    }
  const dependencies = t.tool_dependencies ?? [];
  check(Array.isArray(dependencies), 'tool_dependencies 必须为数组');
  const dependencyIds = new Set<string>();
  for (const dep of dependencies) {
    check(
      groups.get(dep.event_id)?.[0].tool_name &&
        !dependencyIds.has(dep.event_id) &&
        Array.isArray(dep.depends_on),
      '工具依赖重复或无效',
    );
    dependencyIds.add(dep.event_id);
    for (const parent of dep.depends_on) {
      const before = groups.get(parent),
        after = groups.get(dep.event_id);
      check(
        parent !== dep.event_id &&
          before?.[0].tool_name &&
          before[1].time_at_ms <= after![0].time_at_ms,
        '工具在依赖完成前启动',
      );
    }
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string) {
    check(!visiting.has(id), '工具依赖存在循环');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of dependencies.find((x: any) => x.event_id === id)
      ?.depends_on ?? [])
      visit(parent);
    visiting.delete(id);
    visited.add(id);
  }
  for (const dep of dependencies) visit(dep.event_id);
  const referenced = new Set<string>(),
    toolRefs = new Set<string>();
  for (const tr of t.tracks) {
    check(Array.isArray(tr.clips), '轨道 clips 必须为数组');
    const lanes = new Map<number, [number, number][]>();
    for (const c of tr.clips) {
      let start, end;
      if (c.kind === 'speech') {
        const u = utterances.get(c.utterance_id);
        check(u && !referenced.has(u.id), '语音引用缺失或重复');
        check(
          (tr.id === 'assistant' && u.speaker === 'assistant') ||
            (tr.id === 'user' && u.speaker !== 'assistant'),
          '语音轨道角色不匹配',
        );
        check(
          !('label' in c) && !('start_at_ms' in c) && !('end_at_ms' in c),
          '语音台词和时间仅保存在 case.json',
        );
        referenced.add(u.id);
        start = u.start_at_ms;
        end = u.end_at_ms;
      } else if (c.kind === 'tool') {
        const g = groups.get(c.event_id);
        check(
          tr.id === 'tools' &&
            g?.length === 2 &&
            g[0].tool_name &&
            !toolRefs.has(c.event_id),
          '工具引用缺失或重复',
        );
        toolRefs.add(c.event_id);
        start = g![0].time_at_ms;
        end = g![1].time_at_ms;
        check(
          !('start_at_ms' in c) && !('end_at_ms' in c),
          '工具时间仅保存在 Events',
        );
      } else {
        check(
          ['state', 'action', 'world', 'expression'].includes(c.kind),
          '未知片段类型',
        );
        start = c.start_at_ms;
        end = c.end_at_ms;
        check(typeof c.label === 'string', '片段缺少名称');
      }
      interval(start, end, duration, c.utterance_id ?? c.event_id ?? c.label);
      if (!['user', 'control', 'world'].includes(tr.id))
        check(start % 400 === 0, '非用户轨道起点未对齐 400 ms');
      const lane = c.lane ?? 0;
      check(ms(lane), 'lane 无效');
      const list = lanes.get(lane) ?? [];
      list.push([start, end]);
      lanes.set(lane, list);
    }
    for (const list of lanes.values()) {
      list.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < list.length; i++)
        check(
          list[i - 1][1] <= list[i][0],
          `${tr.id} 同行片段重叠，请设置 lane`,
        );
    }
  }
  check(referenced.size === utterances.size, '部分 Utterance 未映射轨道');
  check(
    [...groups]
      .filter(([, g]) => g[0].tool_name)
      .every(([id]) => toolRefs.has(id)),
    '部分工具未映射轨道',
  );
  const aligned = new Map<string, any>(),
    decoded = new Map<string, ReturnType<typeof decodeWav>>();
  check(p.sources && typeof p.sources === 'object', '缺少音频 sources');
  for (const c of a.clips) {
    check(
      utterances.has(c.utterance_id) && !aligned.has(c.utterance_id),
      '音频关联缺失或重复',
    );
    check(safePath(c.source), '音频路径无效');
    const data = p.sources[c.source];
    check(
      typeof data === 'string' && data.length < 90000000,
      '缺少音频或音频过大',
    );
    if (!decoded.has(c.source))
      decoded.set(c.source, decodeWav(unbase64(data)));
    const samples = decoded.get(c.source)!.samples;
    check(
      ms(c.source_start_ms) &&
        ms(c.source_end_ms) &&
        c.source_end_ms > c.source_start_ms &&
        c.source_end_ms * 48 <= samples.length,
      `${c.utterance_id} 音频切点越界`,
    );
    const u = utterances.get(c.utterance_id);
    check(
      c.source_end_ms - c.source_start_ms === u.end_at_ms - u.start_at_ms,
      `${u.id} 音频长度与台词时间不一致`,
    );
    aligned.set(c.utterance_id, c);
  }
  check(
    planned ? aligned.size === 0 : aligned.size === utterances.size,
    planned
      ? 'planned 包不得携带音频关联，补录并改为 aligned 后再对齐'
      : '每句台词必须关联一段实际音频',
  );
  check(
    Object.keys(p.sources).every((k) =>
      a.clips.some((c: any) => c.source === k),
    ),
    '包含未引用的音频',
  );
  for (const l of t.response_links ?? []) {
    const u = utterances.get(l.user_id),
      r = utterances.get(l.assistant_id);
    check(
      u &&
        r &&
        u.speaker !== 'assistant' &&
        r.speaker === 'assistant' &&
        r.start_at_ms >= u.end_at_ms + 400,
      '助手回应应在用户结束至少 400 ms 后',
    );
  }
  for (const i of t.interruptions ?? []) {
    const u = utterances.get(i.user_id),
      r = utterances.get(i.assistant_id);
    check(
      u &&
        r &&
        u.speaker !== 'assistant' &&
        r.speaker === 'assistant' &&
        u.start_at_ms >= r.start_at_ms &&
        u.start_at_ms < r.end_at_ms,
      '打断没有时间重叠',
    );
    check(
      u.start_at_ms <= i.detected_at_ms &&
        i.detected_at_ms <= i.stop_command_at_ms &&
        i.stop_command_at_ms === i.fade_start_at_ms &&
        i.fade_start_at_ms < i.stop_at_ms &&
        i.stop_at_ms === r.end_at_ms,
      '打断检出 / 淡出 / 停声顺序错误',
    );
    if (!planned) {
    const c = aligned.get(u.id),
      s = decoded.get(c.source)!.samples;
    const from = c.source_start_ms * 48,
      to =
        Math.min(
          c.source_end_ms,
          c.source_start_ms + r.end_at_ms - u.start_at_ms,
        ) * 48;
    check(
      s.subarray(from, to).some((v) => Math.abs(v) > 0.003),
      '打断重叠区没有用户实际声音',
    );
    const assistantCut = aligned.get(r.id),
      assistantSamples = decoded.get(assistantCut.source)!.samples;
    let simultaneous = false;
    for (let at = 0; at < to - from; at++)
      if (
        Math.abs(s[from + at]) > 0.003 &&
        Math.abs(
          assistantSamples[
            assistantCut.source_start_ms * 48 +
              (u.start_at_ms - r.start_at_ms) * 48 +
              at
          ],
        ) > 0.003
      ) {
        simultaneous = true;
        break;
      }
    check(simultaneous, '打断区没有双方实际声音重叠');
    }
    const stop = [...groups.values()].find(
      (g) =>
        g[0].tool_name === 'audio.stop' &&
        g[0].time_at_ms === i.stop_command_at_ms &&
        g[1].results?.stopped_at_ms === i.stop_at_ms,
    );
    check(stop, '打断缺少匹配的 audio.stop 请求与返回');
    check(
      stop![1].time_at_ms - stop![0].time_at_ms >= 400,
      'audio.stop 控制窗口至少 400 ms',
    );
  }
  const declaredOverlap = new Set<string>();
  for (const i of t.interruptions ?? [])
    declaredOverlap.add(`${i.user_id}/${i.assistant_id}`);
  for (const b of t.backchannels ?? []) {
    const u = utterances.get(b.over_user_id),
      r = utterances.get(b.assistant_id);
    check(
      u && r && u.speaker !== 'assistant' && r.speaker === 'assistant',
      '附和引用的语音无效',
    );
    // What makes it a backchannel and not a barge-in: the assistant speaks
    // inside the user's turn and the user talks on past it.
    check(
      u.start_at_ms < r.start_at_ms && r.end_at_ms < u.end_at_ms,
      `${r.id} 附和必须完全落在用户人声内部`,
    );
    check(
      !(t.interruptions ?? []).some((i: any) => i.assistant_id === r.id),
      `${r.id} 不能既是附和又是打断`,
    );
    check(
      !(t.response_links ?? []).some((l: any) => l.assistant_id === r.id),
      `${r.id} 是附和而不是回应，不应登记 response_links`,
    );
    declaredOverlap.add(`${u.id}/${r.id}`);
  }
  // Every overlap of real voices is either a barge-in or a backchannel. Leaving
  // one undeclared is what lets the two be confused, so it is rejected here.
  for (const u of d.utterances)
    if (u.speaker !== 'assistant')
      for (const r of d.utterances)
        if (
          r.speaker === 'assistant' &&
          u.start_at_ms < r.end_at_ms &&
          r.start_at_ms < u.end_at_ms
        )
          check(
            declaredOverlap.has(`${u.id}/${r.id}`),
            `${u.id} 与 ${r.id} 人声重叠但未声明为打断或附和`,
          );
  // E. Checkpoints let a case mark what to look at when nothing was interrupted.
  for (const c of t.checkpoints ?? []) {
    check(
      ['name', 'title', 'note'].every(
        (k) => typeof c[k] === 'string' && c[k].trim(),
      ),
      '检查点缺少名称、标题或说明',
    );
    interval(c.start_at_ms, c.end_at_ms, duration, c.name);
  }
  for (const x of d.fdx_annotation) {
    check(x.fdx_type !== '打断', '打断不属于 Annotation');
    check(
      d.utterances.some(
        (u: any) =>
          u.speaker === x.role &&
          u.start_at_ms <= x.start_at_ms &&
          u.end_at_ms >= x.end_at_ms,
      ),
      '表达标注超出语音区间',
    );
    check(
      t.tracks
        .find((tr: any) => tr.id === 'expression')
        .clips.some(
          (c: any) =>
            c.start_at_ms === x.start_at_ms && c.end_at_ms === x.end_at_ms,
        ),
      '表达标注未映射轨道',
    );
  }
  for (const [id, g] of groups)
    if (g[0].tool_name === 'audio.play') {
      const stop = [...groups.values()].find(
        (s) =>
          s[0].tool_name === 'audio.stop' &&
          JSON.parse(s[0].query).playback_event_id === id,
      );
      check(stop, 'audio.play 缺少 audio.stop');
      const start = g[0].time_at_ms,
        end = stop![0].time_at_ms;
      check(
        d.utterances
          .filter((u: any) => u.speaker === 'assistant')
          .every(
            (u: any) =>
              end <= u.start_at_ms - 400 || start >= u.end_at_ms + 400,
          ),
        'Loading 与助手需错开 400 ms',
      );
    }
  return p;
}
export function buildRuntime(input: unknown): RuntimeCase {
  const p = validatePackage(input),
    cache = new Map<string, Float32Array>(),
    audio: Record<string, AudioClip> = {};
  for (const c of p.alignment.clips) {
    if (!cache.has(c.source))
      cache.set(c.source, decodeWav(unbase64(p.sources[c.source])).samples);
    const data = cache
      .get(c.source)!
      .slice(c.source_start_ms * 48, c.source_end_ms * 48);
    audio[c.utterance_id] = {
      src: 'data:audio/wav;base64,' + base64(wav([data])),
      start: 0,
      duration: data.length / 48000,
      peaks: peaks(data),
      sourceStart: c.source_start_ms / 1000,
      sourceEnd: c.source_end_ms / 1000,
      source: c.source,
    };
  }
  return { manifest: p.manifest, case: p.case, timeline: p.timeline, audio };
}
export function renderStereo(runtime: RuntimeCase) {
  const frames = runtime.case.meta_data.media.audio.duration_ms * 48,
    channels = [new Float32Array(frames), new Float32Array(frames)];
  for (const u of runtime.case.utterances) {
    const clip = runtime.audio[u.id];
    if (!clip) continue;
    const samples = decodeWav(unbase64(clip.src.split(',')[1])).samples,
      out = channels[u.speaker === 'assistant' ? 1 : 0],
      i = runtime.timeline.interruptions?.find(
        (x: any) => x.assistant_id === u.id,
      ),
      fade = i ? i.stop_at_ms - i.fade_start_at_ms : 0;
    for (let j = 0; j < samples.length; j++) {
      const time = u.start_at_ms + j / 48,
        gain = fade ? Math.max(0, Math.min(1, (u.end_at_ms - time) / fade)) : 1;
      out[u.start_at_ms * 48 + j] += samples[j] * gain;
    }
  }
  let max = 1;
  for (const ch of channels)
    for (const x of ch) max = Math.max(max, Math.abs(x));
  if (max > 1)
    for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] /= max;
  return { wav: wav(channels), peaks: channels.map((ch) => peaks(ch, 2000)) };
}
