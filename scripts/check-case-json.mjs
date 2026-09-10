// Case JSON 体检：把「契约里写了、但 case:validate 没查」的那部分补上。
//
//   node scripts/check-case-json.mjs            # 全部 Case
//   node scripts/check-case-json.mjs explicit-a1
//
// 依据是 docs/case-package-v1.md 与 skills/interaction-case-pipeline/references/
// 里的 data.md、validation.md。case:validate 管的是结构能不能用（引用、配对、
// 音频切点、打断边界）；这里管的是「合不合规矩」：字段该有哪些、轨道顺序、
// 标注归谁、等待有没有承接、旧格式有没有迁移。
//
// 输出分两档：错(FAIL) 是契约明写的硬规矩，提醒(WARN) 是该看一眼的地方。
// 只有错会让退出码非零。
import fs from 'node:fs';
import path from 'node:path';

const ROOT_KEYS = ['meta_data', 'static_context', 'dynamic_context', 'utterances',
  'events', 'fdx_annotation', 'emotion_annotation', 'paralinguistic_annotation',
  'custom_annotation'];
const TRACKS = ['user', 'control', 'assistant', 'expression', 'world', 'reasoning', 'tools'];
const FDX = ['垫句', '慢说', '附和词', '附和句'];
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WAIT = 2000;          // validation.md：整体等待约 2 秒以上就该有垫句
const STEP = 400;

const only = process.argv.slice(2);
const report = [];
const add = (id, level, rule, message) => report.push({ id, level, rule, message });
const int = (n) => Number.isSafeInteger(n);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function packageCase(dir) {
  const id = path.basename(dir);
  const read = (p) => JSON.parse(fs.readFileSync(path.join(dir, p)));
  const manifest = read('manifest.json'), d = read(manifest.files.case),
    t = read(manifest.files.timeline);
  const fail = (rule, msg) => add(id, 'FAIL', rule, msg);
  const warn = (rule, msg) => add(id, 'WARN', rule, msg);
  const duration = d.meta_data?.media?.audio?.duration_ms ?? 0;
  const assistant = d.utterances.filter((u) => u.speaker === 'assistant');
  const users = d.utterances.filter((u) => u.speaker !== 'assistant');
  const planned = d.static_context?.constraints?.timing_status === 'planned';

  // P1 根字段就是这九个，多一个少一个都算跑偏
  const extra = Object.keys(d).filter((k) => !ROOT_KEYS.includes(k));
  const missing = ROOT_KEYS.filter((k) => !has(d, k));
  if (extra.length) fail('P1 根字段', `case.json 多了 ${extra.join('、')}`);
  if (missing.length) fail('P1 根字段', `case.json 缺 ${missing.join('、')}`);

  // P2 七轨固定顺序（校验器只查了各出现一次，没查顺序）
  const ids = t.tracks.map((x) => x.id);
  if (ids.join(',') !== TRACKS.join(','))
    fail('P2 轨道顺序', `应为 ${TRACKS.join('→')}，实际 ${ids.join('→')}`);

  // P3 语音/工具片段的名字和时间只存在 Utterances 与 Events 里，轨道上不许再抄一份
  for (const tr of t.tracks)
    for (const c of tr.clips ?? []) {
      const copied = ['label', 'start_at_ms', 'end_at_ms'].filter((k) => has(c, k));
      if ((c.kind === 'speech' || c.kind === 'tool') && copied.length)
        fail('P3 重复时间', `${tr.id} 的 ${c.kind} 片段又写了 ${copied.join('、')}`);
      if (['state', 'action', 'world', 'expression'].includes(c.kind) &&
        (typeof c.label !== 'string' || !int(c.start_at_ms) || !int(c.end_at_ms)))
        fail('P3 片段字段', `${tr.id} 的 ${c.kind} 片段缺 label 或起止时间`);
    }

  // P4 总时长要盖住最后一件事，也别空出一大截
  const ends = [...d.utterances.map((u) => u.end_at_ms),
  ...t.tracks.flatMap((tr) => (tr.clips ?? []).map((c) => c.end_at_ms ?? 0)),
  ...d.events.map((e) => e.time_at_ms)];
  const last = Math.max(0, ...ends);
  if (last > duration) fail('P4 总时长', `时长 ${duration} 没盖住最后一件事 ${last}`);
  else if (duration - last > 2000)
    warn('P4 总时长', `末尾空了 ${duration - last} ms，没有内容`);

  // P5 表达控制与 fdx 只跟助手有关；打断不进 fdx
  const inside = (a, z, list) => list.some((u) => u.start_at_ms < z && a < u.end_at_ms);
  for (const a of d.fdx_annotation ?? []) {
    if (String(a.fdx_type).includes('打断'))
      fail('P5 标注归属', 'fdx_annotation 里出现了「打断」，打断不属于表达标注');
    if (!FDX.includes(a.fdx_type)) warn('P5 标注类型', `fdx 类型「${a.fdx_type}」不在常用集合里`);
    if (a.role && a.role !== 'assistant') fail('P5 标注归属', 'fdx_annotation 只关联助手');
    if (!inside(a.start_at_ms, a.end_at_ms, assistant))
      fail('P5 标注归属', `fdx ${a.start_at_ms}–${a.end_at_ms} 没有压在任何助手语音上`);
  }
  for (const c of t.tracks.find((x) => x.id === 'expression')?.clips ?? [])
    if (!planned && !inside(c.start_at_ms, c.end_at_ms, assistant) &&
      inside(c.start_at_ms, c.end_at_ms, users))
      fail('P5 标注归属', `表达控制「${c.label}」压在用户语音上，没有对应助手片段`);

  // P6 毫秒是整数，不留旧字段
  for (const u of d.utterances) {
    if (!int(u.start_at_ms) || !int(u.end_at_ms))
      fail('P6 时间格式', `${u.id} 的毫秒不是整数`);
    if (has(u, 'sample_seg_id')) fail('P6 时间格式', `${u.id} 还带着 sample_seg_id`);
  }

  // P7 依赖间隔。契约写的是「每条跨轨道依赖至少间隔 400 ms」，工具→工具是同一条
  // 轨道上的接力（前一个返回、后一个立刻发起），算不算跨轨要看这中间有没有判断片段。
  // 所以这里只提醒，不判错——真正的顺序错乱（返回晚于依赖方发起）校验器已经拦了。
  const group = new Map();
  for (const e of d.events) group.set(e.event_id, [...(group.get(e.event_id) ?? []), e]);
  const reasoning = t.tracks.find((x) => x.id === 'reasoning')?.clips ?? [];
  for (const dep of t.tool_dependencies ?? [])
    for (const parent of dep.depends_on ?? []) {
      const before = group.get(parent), after = group.get(dep.event_id);
      if (!before || !after) continue;
      const done = before[before.length - 1].time_at_ms, start = after[0].time_at_ms;
      const judged = reasoning.some((c) => c.start_at_ms >= done && c.end_at_ms <= start);
      if (start - done < STEP)
        add(id, judged ? 'FAIL' : 'WARN', 'P7 依赖间隔',
          `${dep.event_id} 距 ${parent} 只隔 ${start - done} ms` +
          (judged ? '（中间有判断片段，属跨轨依赖，要求 ≥400）' : '（同轨接力，确认是否该留一个微轮次）'));
    }

  // P8 非人工的起点都落在 400 ms 刻度上（工具事件也算）
  for (const e of d.events)
    if (e.time_at_ms % STEP)
      fail('P8 微轮次', `事件 ${e.event_id} 的 ${e.time_at_ms} ms 没对齐 400`);

  // P9 身份：新 Case 用 npm run case:id 生成 UUID v7
  if (!UUID_V7.test(String(manifest.case_id)))
    warn('P9 身份', `case_id「${manifest.case_id}」不是 UUID v7`);
  if (manifest.case_id !== d.meta_data?.sample?.case_id)
    fail('P9 身份', 'manifest 与 case.json 的 case_id 不一致');

  // P10 打断要留下丢弃的话和真实起声
  for (const i of t.interruptions ?? []) {
    if (!i.discarded_text) warn('P10 打断', `${i.assistant_id} 的打断没写 discarded_text`);
    if (!int(i.user_voice_onset_at_ms))
      warn('P10 打断', `${i.assistant_id} 的打断没写 user_voice_onset_at_ms`);
  }

  // P11 每个 audio.stop 都要能追到更早的 audio.play
  const stops = d.events.filter((e) => e.tool_name === 'audio.stop' && has(e, 'query'));
  const plays = d.events.filter((e) => e.tool_name === 'audio.play' && has(e, 'query'));
  for (const s of stops)
    if (!plays.some((p) => p.time_at_ms <= s.time_at_ms))
      warn('P11 播放闭环', `${s.time_at_ms} ms 的 audio.stop 找不到更早的 audio.play`);

  // P12 用户说完到助手实质回答超过 2 秒，中间得有垫句
  const sorted = [...d.utterances].sort((a, b) => a.start_at_ms - b.start_at_ms);
  for (const u of users) {
    const next = sorted.find((x) => x.speaker === 'assistant' && x.start_at_ms >= u.end_at_ms);
    if (!next) continue;
    const gap = next.start_at_ms - u.end_at_ms;
    const filler = (d.fdx_annotation ?? []).some((a) =>
      a.start_at_ms >= u.end_at_ms && a.start_at_ms <= next.start_at_ms);
    if (gap > WAIT && !filler)
      warn('P12 等待承接', `${u.id} 说完等了 ${gap} ms 才有回应，中间没有垫句`);
  }

  // P13/P14 关联与回应
  if (!planned && assistant.length && users.length && !(t.response_links ?? []).length)
    warn('P13 回应关联',
      '有问有答但 response_links 是空的——注意校验器要求 link 的助手句 ≥ 用户结束 + 400 ms，' +
      '而文档写的接话延迟是「≤400 ms」，两条规矩对不上时先别硬填');
  const tools = new Set((d.static_context?.tools ?? []).map((x) => x.function?.name));
  for (const e of d.events)
    if (e.tool_name && !tools.has(e.tool_name))
      fail('P14 工具定义', `事件用了未定义的工具 ${e.tool_name}`);
}

// 旧目录里的 Case 还是迁移前的形状：八轨（含 playback）、tool_runs、trigger_links。
// 当前契约是七轨、播报并入工具调用轨，这些迟早要迁移，先在这里点名。
function legacyCase(dir) {
  const id = 'components/cases/' + path.basename(dir);
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json')));
  const ids = (t.tracks ?? []).map((x) => x.id);
  if (ids.join(',') !== TRACKS.join(','))
    add(id, 'WARN', 'L1 旧格式', `轨道是 ${ids.join('→')}，还没迁到七轨契约`);
  for (const key of ['tool_runs', 'trigger_links'])
    if (has(t, key)) add(id, 'WARN', 'L1 旧格式', `还在用 ${key}，当前契约是 tool_dependencies`);
  if (!fs.existsSync(path.join(dir, 'manifest.json')))
    add(id, 'WARN', 'L1 旧格式', '没有 manifest，进不了 case:validate 与 ZIP 交付');
}

for (const entry of fs.readdirSync('case-packages', { withFileTypes: true }))
  if (entry.isDirectory() && (!only.length || only.includes(entry.name)))
    packageCase(path.join('case-packages', entry.name));
if (!only.length)
  for (const entry of fs.readdirSync('components/cases', { withFileTypes: true }))
    if (entry.isDirectory()) legacyCase(path.join('components/cases', entry.name));

const fails = report.filter((r) => r.level === 'FAIL');
const warns = report.filter((r) => r.level === 'WARN');
for (const id of [...new Set(report.map((r) => r.id))]) {
  console.log(`— ${id}`);
  for (const r of report.filter((x) => x.id === id))
    console.log(`  ${r.level === 'FAIL' ? '错' : '提醒'} ${r.rule}：${r.message}`);
}
const checked = fs.readdirSync('case-packages', { withFileTypes: true })
  .filter((e) => e.isDirectory() && (!only.length || only.includes(e.name))).length;
console.log(`\n${checked} 个 Case 包 · ${fails.length} 处错 · ${warns.length} 处提醒`);
if (fails.length) process.exit(1);
