/*
 * shared/dsl.js — 文本剧本(脚本 + 八轨日志)→ script.json 编译器。
 *
 * 剧本格式尽量贴近 Golden Case 文档的"完整对话脚本"表:
 *
 *   # 工作日早上 · 起晚出门                     ← 案例名
 *   id: morning                                  ← 元信息(id / case_id / group / summary / clock / ambience / sample_id)
 *   scene: 工作日早晨高压场景｜08:03 起晚…       ← 场景描述
 *   speaker 司机: voice=onyx role=third_party    ← 额外说话人
 *   ```context                                   ← 静态上下文(JSON:memory / tools / device_state / system_prompts)
 *   { "memory": {...}, "tools": [...] }
 *   ```
 *   ## 段1｜08:03:00‒08:03:30｜卫生间·快问快答   ← 段落(story clock 从时间段取)
 *   剧情：…                                      ← 段落说明(考点：/ 助手：同)
 *   @edge touch                                  ← UI 指令(见 DIRECTIVES)
 *   ★ [08:03:00.0‒08:03:03.5] 用户: 几点了？…    ← 台词(时间可省略;★=特写;括号=舞台提示)
 *     (动作) 抓起手机触碰 LIVING EDGE
 *     【世界信息】场景/状态｜…；信号来源｜…       ← 八轨日志,挂到上一条台词/指令
 *     【任务】任务类型｜查天气（查一下再答（快））：weather.today(本地,当日)→结果 16‒24℃·晴（耗时 0.6s）
 *     屏幕: LIVING EDGE 亮起，助手对话框展开。    ← 屏幕说明
 *   [08:03:29.8‒08:04:20.0] 系统: 洗漱继续，无对话。 ← 系统行 = 画面跳过 + 日志
 *
 * 日志里可识别的内容会自动变成时间轴 step:
 *   【任务】的 tool(args)→结果…（耗时…）  → tool(并行于该句,带 agent 卡片)
 *   【记忆】                              → memory 事件
 *   【世界信息】                          → world_signal
 *   【硬件交互】震动/闪光/唤醒/生卡片        → hardware / edge / card
 *   【语音·用户】情绪/对谁说/停顿/重叠       → say 的标注字段(→ fdx / emotion / paralinguistic)
 */

import { parseLogLine, clockToMs, msToClock, TRACKS, normTrack } from './script.js';
import { parseTaskLine, parseMemoryLine, parseWorldLine, parseHardwareLine, parseSpeechLine, guessIcon } from './tracks.js';

const META_KEYS = new Set(['id', 'case_id', 'group', 'summary', 'sample_id', 'sample_name', 'title', 'name', 'scene', 'clock', 'ambience', 'scene_audio', 'ambience_prompt', 'scene_prompt', 'scene_title', 'order', 'thesis', 'tags']);

const SPEAKER_MAP = [
  [/^(用户|user|你|主用户|A)$/i, 'user'],
  [/^(助手|AI助手|AI\s*助手|assistant|step|Step|模型|AI)$/i, 'assistant'],
  [/^(系统|system|旁白)$/i, 'system'],
];

const TIME = '(\\d{1,2}:\\d{2}(?::\\d{2}(?:[.,]\\d{1,3})?)?)';
const SAY_RE = new RegExp(`^(★)?\\s*(?:\\[\\s*${TIME}\\s*(?:[‒–—\\-~～]\\s*${TIME})?\\s*\\])?\\s*(★)?\\s*([^:：（(\\[\\]【】]+?)\\s*(?:[（(]([^)）]*)[)）])?\\s*[:：]\\s*(.*)$`);
const SECTION_RE = /^##\s*(.*)$/;
const META_RE = /^([A-Za-z_][\w-]*)\s*[:：]\s*(.*)$/;
const SPEAKER_DEF_RE = /^speaker\s+([^\s:：]+)\s*[:：]?\s*(.*)$/i;
const DIRECTIVE_RE = /^@([a-z_]+)\s*(.*)$/i;
const NOTE_RE = /^(剧情|考点|考什么|助手|提示|说明|备注)\s*[:：]\s*(.*)$/;
const SCREEN_RE = /^(屏幕|屏幕上看到什么|画面)\s*[:：｜|]\s*(.*)$/;
const STAGE_RE = /^[（(]([^)）]*)[)）]\s*(.*)$/;

/* key=value 参数解析,支持引号与 JSON 值;无键的片段进 _ */
export function parseArgs(str = '') {
  const s = str.trim();
  if (!s) return {};
  if (s.startsWith('{')) { try { return JSON.parse(s); } catch { /* fallthrough */ } }
  const out = {}; const rest = [];
  const re = /([A-Za-z_][\w.]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|\{[^}]*\}|[^\s]+)|("(?:[^"\\]|\\.)*"|[^\s]+)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) out[m[1]] = coerce(m[2]);
    else rest.push(coerce(m[3]));
  }
  if (rest.length) out._ = rest.length === 1 ? rest[0] : rest;
  return out;
}
function coerce(v) {
  if (v == null) return v;
  if (/^"(?:[^"\\]|\\.)*"$/.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  if (/^'(?:[^'\\]|\\.)*'$/.test(v)) return v.slice(1, -1).replace(/\\'/g, "'");
  if (/^(\[|\{)/.test(v)) { try { return JSON.parse(v); } catch { return v; } }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return +v;
  return v;
}

function mapSpeaker(raw) {
  const name = raw.trim().replace(/\s+/g, ' ');
  for (const [re, key] of SPEAKER_MAP) if (re.test(name)) return { key, name };
  const key = name.replace(/[^\w㐀-鿿]/g, '') || 'third';
  return { key, name };
}

/* 把指令行变成 step */
function directiveStep(name, argStr) {
  const a = parseArgs(argStr);
  const pos = Array.isArray(a._) ? a._ : (a._ != null ? [a._] : []);
  const n = name.toLowerCase();
  switch (n) {
    case 'edge': return { type: 'edge', action: a.action || pos[0] || 'touch', ...strip(a) };
    case 'open': return { type: 'edge', action: 'touch' };
    case 'quiet': return { type: 'edge', action: 'double' };
    case 'card': {
      const st = { type: 'card', ...strip(a) };
      if (pos.length) { st.icon = st.icon || pos[0]; st.title = st.title || pos[1]; st.sub = st.sub || pos[2]; }
      if (typeof st.meta === 'string') st.meta = st.meta.split('|').map(x => x.trim());
      if (typeof st.button === 'string') st.button = { label: st.button };
      if (st.eta && typeof st.eta === 'string') { const em = st.eta.match(/^(\S+)\s*(.*)$/); st.eta = em ? { n: em[1], unit: em[2] } : { n: st.eta }; }
      return st;
    }
    case 'pill': {
      const st = { type: 'pill', ...strip(a) };
      if (pos[0] === 'hide') st.action = 'hide';
      if (typeof st.stops === 'string') st.stops = st.stops.split('|').map(x => x.trim());
      return st;
    }
    case 'call': return { type: 'call', action: a.action || pos[0] || 'ring', name: a.name || pos[1], ...strip(a) };
    case 'vibrate': return { type: 'hardware', feedback: 'vibrate', ...strip(a) };
    case 'flash': return { type: 'hardware', feedback: 'flash', ...strip(a) };
    case 'hardware': return { type: 'hardware', feedback: a.feedback || pos[0] || 'none', ...strip(a) };
    case 'overlay': return { type: 'overlay', action: a.action || pos[0] || 'drop', ...strip(a) };
    case 'rec': return { type: 'rec', action: a.action || pos[0] || 'start', ...strip(a) };
    case 'banner': return { type: 'banner', icon: a.icon || 'ear', title: a.title || pos[0], sub: a.sub || pos[1], ...strip(a) };
    case 'article': return { type: 'article', action: a.action || pos[0] || 'show', ...strip(a) };
    case 'wait': return { type: 'wait', ms: a.ms ?? (+pos[0] || 800), label: a.label, ...strip(a) };
    case 'skip': return { type: 'skip', to: a.to || pos[0], label: a.label || pos[1], ...strip(a) };
    case 'join': return { type: 'join' };
    case 'fx': return { type: 'fx', name: a.name || pos[0] || 'ding', vol: a.vol, ...strip(a) };
    case 'agent': {
      const st = { type: 'agent', ...strip(a), steps: [] };
      if (pos.length >= 2) st.steps.push({ icon: pos[0], doing: pos[1], done: pos[2] || pos[1], ms: +pos[3] || 2400 });
      if (Array.isArray(a.steps)) st.steps = a.steps;
      return st;
    }
    case 'step': return { type: 'agent', inline: true, steps: [{ icon: a.icon || pos[0] || 'sparkles', doing: a.doing || pos[1] || '', done: a.done || pos[2] || pos[1] || '', ms: a.ms ?? (+pos[3] || 2400), tool: a.tool, result: a.result }], parallel: a.parallel };
    case 'tool': {
      const st = { type: 'tool', ...strip(a) };
      if (pos[0]) { const cm = String(pos[0]).match(/^([\w.]+)(?:\((.*)\))?$/); if (cm) { st.name = st.name || cm[1]; st.args = st.args ?? cm[2]; } }
      if (a.doing || a.done || a.icon) st.ui = { icon: a.icon, doing: a.doing, done: a.done, ms: a.ui_ms };
      return st;
    }
    case 'memory': return { type: 'memory', kind: a.kind || 'memory_call_fast', query: a.query || pos[0], result: a.result || pos[1], ...strip(a) };
    case 'backend': return { type: 'backend', query: a.query || pos[0], result: a.result || pos[1], ...strip(a) };
    case 'world': return { type: 'world', scene_state: a.scene_state || pos[0], ...strip(a) };
    case 'transcript': return { type: 'transcript', action: a.action || pos[0] || 'open', text: a.text || pos[1], ...strip(a) };
    case 'split': return { type: 'transcript', action: 'split', text: a.text || pos.join(' ') };
    case 'log': return { type: 'log', label: a.label || pos[0], detail: a.detail || pos[1], cut: !!a.cut };
    case 'end': return { type: 'end', label: a.label || pos[0] };
    case 'system': return { type: 'system', text: a.text || pos.join(' '), ...strip(a) };
    default: return { type: n, ...strip(a), _pos: pos };
  }
}
function strip(a) { const o = { ...a }; delete o._; return o; }

/* 舞台提示 → say 标志 */
function applyStageDirection(st, dir) {
  if (!dir) return;
  st.direction = st.direction ? st.direction + '；' + dir : dir;
  if (/抢话|打断|插话·硬|硬插|截停|预授权插话|抢答/.test(dir)) st.barge_in = true;
  else if (/借换气间隙|软插话|软插|插话·软/.test(dir)) { st.barge_in = true; st.soft = true; }
  else if (/与.{0,12}重叠|叠上|伴听|附和/.test(dir)) st.backchannel = true;
  if (/低语|压低|低声|凑近/.test(dir)) { st.whisper = true; }
  if (/轻声|语气轻缓|放轻/.test(dir)) { st.volume = st.volume ?? 0.75; }
  if (/打字|文字|不出声/.test(dir)) st.typed = true;
  if (/嘟囔|自言自语|念叨|自语|朗读/.test(dir)) st.no_bubble = true;
  if (/并行/.test(dir)) st.parallel = true;
}

/* 用剧本里的时钟推导时序:打断/附和的插入点、句间间隔 */
function deriveTiming(tl) {
  const says = tl.map((st, i) => ({ st, i })).filter(x => x.st.type === 'say');
  for (let k = 0; k < says.length; k++) {
    const { st } = says[k];
    const t = clockToMs(st.clock);
    if (t == null) continue;
    if (st.barge_in || st.backchannel) {
      if (st.at_ms != null || st.at_ratio != null) continue;
      let target = null;
      for (let j = k - 1; j >= 0; j--) if (says[j].st.speaker !== st.speaker) { target = says[j].st; break; }
      const t0 = target ? clockToMs(target.clock) : null;
      if (t0 == null) continue;
      const diff = t - t0;
      const end = clockToMs(target.clock_end);
      if (end != null && end > t0) st.at_ratio = Math.min(0.95, Math.max(0.05, +(diff / (end - t0)).toFixed(3)));
      else if (diff > 0) st.at_ms = diff;
    } else if (k > 0 && st.gap_ms == null && !st.parallel) {
      const prev = says[k - 1];
      const pe = clockToMs(prev.st.clock_end);
      const between = tl.slice(prev.i + 1, says[k].i).some(x => x.type === 'system' || x.type === 'skip' || x.type === 'edge');
      if (pe != null && !between) { const d = t - pe; if (d >= 0 && d <= 2500) st.gap_ms = d; }
    }
  }
}

/**
 * parseDSL(text) → { script, warnings }
 */
export function parseDSL(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const script = { version: 1, id: '', name: '', case_id: '', scene: {}, speakers: {}, context: {}, beats: [], timeline: [] };
  const warnings = [];
  const tl = script.timeline;
  let last = null;          // 最近一条可挂日志的 step
  let lastSay = null;
  let section = null;
  let sayCount = 0;
  let sysCount = 0;
  let fence = null;         // ```context 围栏

  const push = (st) => { tl.push(st); last = st; return st; };

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const line = raw.trim();
    if (fence) {
      if (/^```/.test(line)) {
        try {
          const obj = JSON.parse(fence.buf.join('\n') || '{}');
          if (fence.kind === 'context') Object.assign(script.context, obj);
          else if (fence.kind === 'speakers') Object.assign(script.speakers, obj);
          else if (fence.kind === 'scene') Object.assign(script.scene, obj);
          else if (fence.kind === 'step' || fence.kind === 'json') { const st = Array.isArray(obj) ? obj : [obj]; st.forEach(x => push(x)); }
          else script[fence.kind] = obj;
        } catch (e) { warnings.push(`第 ${fence.line} 行起的 \`\`\`${fence.kind} 块不是合法 JSON:${e.message}`); }
        fence = null;
      } else fence.buf.push(raw);
      continue;
    }
    if (!line || line.startsWith('//') || line.startsWith('%%')) continue;
    let m;
    if ((m = line.match(/^```\s*([\w-]+)?/))) { fence = { kind: (m[1] || 'context').toLowerCase(), buf: [], line: li + 1 }; continue; }
    if (line.startsWith('# ') || /^#[^#]/.test(line)) { script.name = line.replace(/^#\s*/, '').trim(); continue; }
    if ((m = line.match(SECTION_RE))) {
      const title = m[1].trim();
      const seg = title.split(/[｜|]/).map(x => x.trim());
      const st = { type: 'section', title, i: null };
      const tm = title.match(new RegExp(`${TIME}\\s*[‒–—\\-~～]\\s*${TIME}`));
      if (tm) { st.clock = tm[1]; st.clock_end = tm[2]; }
      else { const one = title.match(new RegExp(TIME)); if (one) st.clock = one[1]; }
      st.short = seg.length >= 3 ? seg[2] : seg[seg.length - 1];
      section = push(st);
      script.beats.push({ no: script.beats.length + 1, who: seg[0], text: st.short });
      continue;
    }
    if ((m = line.match(SPEAKER_DEF_RE))) {
      const { key } = mapSpeaker(m[1]); const a = parseArgs(m[2]);
      const sp = script.speakers[key] || (script.speakers[key] = {});
      if (a.name) sp.name = a.name; if (a.role) sp.role = a.role; if (a.id) sp.speaker_id = a.id;
      const tts = {}; if (a.voice) tts.voice = a.voice; if (a.instructions) tts.instructions = a.instructions; if (a.speed) tts.speed = a.speed; if (a.local_voice) tts.local_voice = a.local_voice; if (a.qwen_voice) tts.qwen_voice = a.qwen_voice; if (a.volc_persona) tts.volc_persona = a.volc_persona;
      if (Object.keys(tts).length) sp.tts = { ...(sp.tts || {}), ...tts };
      continue;
    }
    if ((m = line.match(DIRECTIVE_RE))) {
      if (/^(id|clip)$/i.test(m[1])) {           /* @id q1:给上一条台词指定 utterance id / 音频片段名 */
        const a = parseArgs(m[2]); const v = a.id || a.clip || a._;
        if (lastSay && v) { lastSay.id = String(v); lastSay.clip = String(a.clip || v); } else warnings.push(`第 ${li + 1} 行 @id 前面没有台词`);
        continue;
      }
      push(directiveStep(m[1], m[2])); continue;
    }
    if ((m = line.match(NOTE_RE))) {
      const target = section || script.scene;
      const k = m[1] === '剧情' ? 'desc' : 'notes';
      if (k === 'desc') target.desc = (target.desc ? target.desc + '\n' : '') + m[2].trim();
      else (target.notes = target.notes || []).push(`${m[1]}：${m[2].trim()}`);
      continue;
    }
    if ((m = line.match(SCREEN_RE))) { if (last) last.screen = (last.screen ? last.screen + ' ' : '') + m[2].trim(); continue; }
    const isLog = /^【[^】]+】/.test(line) || (/^\[[^\]]+\]/.test(line) && TRACKS.includes(normTrack(line.slice(1, line.indexOf(']')))));
    if (isLog) {
      const lg = parseLogLine(line);
      const target = last || section;
      if (!target) { warnings.push(`第 ${li + 1} 行的日志前面没有台词/指令,已忽略`); continue; }
      (target.log = target.log || []).push(lg);
      absorbLog(target, lg, tl, warnings, li + 1);
      continue;
    }
    const metaM = line.match(META_RE);
    if (metaM && META_KEYS.has(metaM[1].toLowerCase())) {
      const k = metaM[1].toLowerCase(), v = metaM[2].trim();
      if (['id', 'case_id', 'group', 'summary', 'sample_id', 'sample_name', 'thesis'].includes(k)) script[k] = v;
      else if (k === 'title' || k === 'name') script.name = v;
      else if (k === 'scene') { script.scene.desc = v; if (!script.scene.title) script.scene.title = v.split(/[｜|·]/)[0].trim(); }
      else if (k === 'clock') script.scene.clock = v;
      else if (k === 'ambience' || k === 'scene_audio') script.scene.ambience = v;
      else if (k === 'ambience_prompt' || k === 'scene_prompt') script.scene.ambience_prompt = v;
      else if (k === 'scene_title') script.scene.title = v;
      else script[k] = coerce(v);
      continue;
    }
    if ((m = line.match(SAY_RE))) {
      const [, star1, t1, t2, star2, spkRaw, dir, textRaw] = m;
      const { key, name } = mapSpeaker(spkRaw);
      let textStr = textRaw.trim();
      const st = { type: key === 'system' ? 'system' : 'say', text: textStr };
      if (t1) st.clock = t1; if (t2) st.clock_end = t2;
      if (star1 || star2) st.star = true;
      if (key === 'system') { sysCount++; st.id = 's' + String(sysCount).padStart(3, '0'); if (dir && /并行/.test(dir)) st.parallel = true; if (star1 || star2) st.star = true; push(st); continue; }
      st.speaker = key;
      if (!script.speakers[key]) script.speakers[key] = { name };
      let sm;
      while ((sm = textStr.match(STAGE_RE))) { applyStageDirection(st, sm[1]); textStr = sm[2].trim(); }
      st.text = textStr;
      applyStageDirection(st, dir);
      /* 台词末尾的破折号 = 被打断/在想词儿:仅作提示 */
      sayCount++;
      st.id = 'u' + String(sayCount).padStart(3, '0');
      push(st); lastSay = st;
      continue;
    }
    /* 缩进的续行:接到上一条台词文本 */
    if (/^\s/.test(raw) && last && (last.type === 'say' || last.type === 'system')) { last.text += line; continue; }
    warnings.push(`第 ${li + 1} 行无法识别:${line.slice(0, 40)}`);
  }
  if (!script.id) script.id = (script.name || 'case').toLowerCase().replace(/[^\w㐀-鿿]+/g, '-').replace(/^-|-$/g, '') || 'case';
  if (!script.case_id) script.case_id = script.id;
  if (!script.scene.clock) { const first = tl.find(x => x.clock); if (first) script.scene.clock = first.clock; }
  if (!script.scene.title && script.name) script.scene.title = script.name;
  deriveTiming(tl);
  void lastSay;
  return { script, warnings };
}

/* 日志 → 自动 step / say 标注 */
function absorbLog(target, lg, tl, warnings, lineNo) {
  const track = lg.track;
  const isSay = target.type === 'say';
  if (track === '语音') {
    if (isSay) {
      const f = parseSpeechLine(lg.fields, lg.sub);
      for (const [k, v] of Object.entries(f)) if (target[k] == null) target[k] = v;
      const ov = f.overlap || '';
      const isTarget = /被.{0,8}叠上|被用户|被助手|被打断/.test(ov.split(/[·]/)[0] || '');
      if (!isTarget && /竞争打断/.test(ov) && /叠在|叠/.test(ov)) target.barge_in = true;
      else if (!isTarget && !target.barge_in && /(附和|合作)重叠/.test(ov) && !/被/.test(ov)) target.backchannel = true;
      if (/自言自语|自语|朗读演练/.test(f.to || '')) target.no_bubble = true;
      if (/对别人说|对主用户|对司机|对同事/.test(f.to || '') && target.speaker !== 'user' && target.speaker !== 'assistant') target.no_bubble = true;
      if (/低语/.test(f.voicing || '')) target.whisper = true;
    }
    return;
  }
  if (track === '任务') {
    const calls = parseTaskLine(lg.fields);
    for (const c of calls) {
      if (!c.name) continue;
      const st = { type: 'tool', name: c.name, args: c.args, result: c.result, elapsed_ms: c.elapsed_ms, task_type: c.task_type, speed: c.speed, status: c.status, from_log: true };
      for (const k of ['priority', 'delivery', 'shelf_life', 'request', 'note']) if (c[k]) st[k] = c[k];
      st.parallel = true;                       // 与该句并行(垫场时后台跑)
      st.anchor = 'prev_start';                 // 从这句话开口的时刻起算
      st.delay_ms = isSay ? 600 : 0;
      const doing = `正在${(c.task_type || '处理').replace(/·.*$/, '')}…`;
      const done = c.result ? String(c.result).slice(0, 34) : (c.status === 'pending' ? '进行中…' : '完成');
      st.ui = { icon: guessIcon(c.name, c.task_type), doing, done, ms: Math.min(Math.max(c.elapsed_ms ?? 1600, 900), 9000) };
      if (c.elapsed_ms != null && c.elapsed_ms > 9000) st.ui.ms = 9000;   // 分钟级长任务:界面只演 9s
      if (target.type === 'system') {
        /* 系统行里的工具 = 结果通知:界面只闪一下,事件按耗时回溯发起时刻 */
        st.ui.ms = Math.min(st.ui.ms, 1500);
        if ((c.elapsed_ms ?? 0) > 5000) st.backdate = true;
        if (c.elapsed_ms == null || c.elapsed_ms === 0) st.ui = false;
      }
      tl.push(st);
    }
    return;
  }
  if (track === '记忆') {
    const mem = parseMemoryLine(lg.fields);
    if (mem && (mem.ref || mem.recall_type)) {
      tl.push({ type: 'memory', kind: mem.kind, query: mem.query, result: mem.result, recall_type: mem.recall_type, consume: mem.consume, update: mem.update, parallel: true, anchor: 'prev_start', delay_ms: -300, silent: true, elapsed_ms: mem.kind === 'memory_call' ? 1200 : 400, from_log: true });
    }
    return;
  }
  if (track === '世界信息') {
    const w = parseWorldLine(lg.fields);
    if (w) tl.push({ type: 'world', ...w, anchor: 'prev_start', from_log: true });
    return;
  }
  if (track === '硬件交互') {
    const h = parseHardwareLine(lg.fields);
    for (const a of h.actions) {
      if (a.type === 'edge' && a.action === 'on') {
        const opened = tl.some(x => x.type === 'edge' && (x.action === 'touch' || x.action === 'double' || x.action === 'on'));
        if (!opened) { const idx = tl.indexOf(target); tl.splice(Math.max(0, idx), 0, { type: 'edge', action: 'touch', from_log: true }); }
        continue;
      }
      if (a.type === 'hardware' && a.feedback === 'none') continue;
      if (a.type === 'hardware' && a.feedback === 'card') {
        if (target.screen || h.note) tl.push({ type: 'card', style: 'note', icon: 'doc', title: target.screen || h.note, anchor: 'prev_start', delay_ms: 400, from_log: true });
        continue;
      }
      if (a.type === 'hardware' && a.feedback === 'volume_low') { if (isSay) target.volume = 0.7; continue; }
      tl.push({ ...a, latency: h.latency, anchor: 'prev_start', from_log: true });
    }
  }
}

/* script.json → 剧本文本(用于把 JSON case 展示成可读剧本;不保证 100% 可逆) */
export function scriptToDSL(script) {
  const out = [];
  out.push(`# ${script.name || script.id}`);
  for (const k of ['id', 'case_id', 'group', 'summary', 'sample_id']) if (script[k]) out.push(`${k}: ${script[k]}`);
  if (script.scene?.desc) out.push(`scene: ${script.scene.desc}`);
  if (script.scene?.clock) out.push(`clock: ${script.scene.clock}`);
  if (script.scene?.ambience) out.push(`ambience: ${script.scene.ambience}`);
  for (const [k, sp] of Object.entries(script.speakers || {})) {
    if (['user', 'assistant', 'system'].includes(k) && !sp.tts?.voice && !sp.tts?.local_voice && !sp.tts?.qwen_voice && !sp.tts?.volc_persona) continue;
    const parts = [];
    if (sp.name) parts.push(`name="${sp.name}"`); if (sp.role) parts.push(`role=${sp.role}`); if (sp.speaker_id) parts.push(`id=${sp.speaker_id}`);
    if (sp.tts?.voice) parts.push(`voice=${sp.tts.voice}`);
    if (sp.tts?.qwen_voice) parts.push(`qwen_voice=${sp.tts.qwen_voice}`);
    if (sp.tts?.volc_persona) parts.push(`volc_persona="${sp.tts.volc_persona}"`);
    if (sp.tts?.local_voice) parts.push(`local_voice=${sp.tts.local_voice}`);
    out.push(`speaker ${k}: ${parts.join(' ')}`);
  }
  if (script.context && Object.keys(script.context).length) { out.push('```context'); out.push(JSON.stringify(script.context, null, 2)); out.push('```'); }
  out.push('');
  for (const st of script.timeline || []) {
    if (st.from_log) continue;
    if (st.type === 'section') { out.push(`## ${st.title || ''}`); if (st.desc) out.push(`剧情：${st.desc}`); }
    else if (st.type === 'say') {
      const time = st.clock ? `[${st.clock}${st.clock_end ? '‒' + st.clock_end : ''}] ` : '';
      const name = script.speakers?.[st.speaker]?.name || st.speaker;
      const dir = st.direction ? `（${st.direction}）` : (st.barge_in ? '（抢话，与对方语音重叠）' : st.backchannel ? '（与对方重叠，附和）' : st.typed ? '（打字）' : st.whisper ? '（低语）' : '');
      out.push(`${st.star ? '★ ' : ''}${time}${name}${dir}: ${st.text}`);
      if (st.id && !/^u\d{3}$/.test(st.id)) out.push(`  @id ${st.id}${st.clip && st.clip !== st.id ? ' clip=' + st.clip : ''}`);
    } else if (st.type === 'system') {
      const time = st.clock ? `[${st.clock}${st.clock_end ? '‒' + st.clock_end : ''}] ` : '';
      out.push(`${time}系统: ${st.text || ''}`);
    } else {
      const { type, i, log, screen, ...rest } = st;
      out.push(`@${type} ${JSON.stringify(rest)}`);
    }
    for (const lg of st.log || []) out.push(`  【${lg.raw_track || lg.track}】${lg.text}`);
    if (st.screen) out.push(`  屏幕: ${st.screen}`);
  }
  return out.join('\n');
}

export { clockToMs, msToClock };
