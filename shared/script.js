/*
 * shared/script.js — 脚本(script.json)的常量、默认值、规范化与校验。
 * 同时在 Node(服务端/CLI)与浏览器(演示引擎/编辑器)中使用，保持零依赖。
 */

export const VERSION = 1;

/* 八轨标注体系(Golden Case 文档 §2) */
export const TRACKS = ['语音', '世界信息', '任务', '决策点', '硬件交互', '对话互动', '记忆', '自定义'];
export const TRACK_ALIASES = {
  '语音·用户': '语音', '语音·助手': '语音', '语音-用户': '语音', '语音-助手': '语音', '语音轨': '语音',
  '世界信息理解': '世界信息', '世界信息理解轨': '世界信息', '世界信号': '世界信息', '世界信息轨': '世界信息',
  '任务轨': '任务', '决策': '决策点', '决策点轨': '决策点', '硬件': '硬件交互', '硬件交互轨': '硬件交互',
  '对话': '对话互动', '互动': '对话互动', '对话互动轨': '对话互动', 'Memory': '记忆', 'memory': '记忆', '记忆轨': '记忆',
  '自定义轨': '自定义', '屏幕': '自定义', '系统': '自定义',
};

/* 全双工行为标注类型(Schema Draft v5 · fdx_annotation) */
export const FDX_TYPES = ['战术性垫句', '打断', '附和', '非结束性停顿', '主动开口', '无关话题语言', '用户和他人对话', '他人多人聊天', '补话'];

/* 时序常量(与 duplex-preview 的手工时序对齐,引擎与离线调度共用) */
export const T = {
  firstPacket: 400,      // 模型首包延迟:换说话人后的默认间隔
  sameSpeakerGap: 300,   // 同一说话人连续两句的默认间隔
  edgeTouch: 1700,       // 摸一下 living edge:嘚嘚 1s + overlay 落下 0.7s
  edgeDouble: 1400,      // 连摸两下(悄悄话模式)
  edgeFlash: 560,
  agentTypeMs: 22,       // agent step 逐字打出的速度
  thinkTypeMs: 24,
  agentSettle: 180,      // step 完成后的停顿
  cutHold: 700,          // 打断:全音量重叠
  cutFade: 1750,         // 打断:完全让位
  typedMsPerChar: 145,   // 无音频/打字时的上屏速度
  typedMin: 1500,
  skipHold: 800,         // 画面跳过/系统行的停留
  overlayCollapse: 1550, // overlay 收起 → 任务卡出现
  overlayDrop: 500,
  bannerHold: 600,
  callRing: 4500,        // 来电铃声默认等待
  cardWait: 6000,        // 带按钮的卡片:无人点按时自动确认
  ambThreshold: 3000,    // 执行超过此时长才铺等待音
};

/* 定妆音色(OpenAI TTS · gpt-4o-mini-tts 支持 instructions 描述) */
export const DEFAULT_VOICES = {
  user: {
    voice: 'ash', speed: 1.0,
    instructions: '三十岁上下的中国男性，声音温和放松，带一点刚起床的松弛惬意，舒服自在，说话自然随意，普通话标准，正常语速。安静的室内，没有背景音乐，没有旁白。',
  },
  assistant: {
    voice: 'coral', speed: 1.0,
    instructions: '二十七八岁的中国女性，声音温暖松弛、真人感强，像贴心的朋友在身边说话，语气 chill、自然口语化，普通话标准，正常语速。安静的室内，没有背景音乐，没有旁白。',
  },
  third: ['onyx', 'fable', 'verse', 'sage', 'echo', 'ballad'],
};

export const STEP_TYPES = [
  'section', 'edge', 'say', 'tool', 'agent', 'memory', 'backend', 'world', 'card', 'pill', 'call',
  'hardware', 'overlay', 'rec', 'banner', 'transcript', 'article', 'wait', 'skip', 'system', 'join',
  'fx', 'log', 'end',
];

export function isCJK(ch) { return /[㐀-鿿豈-﫿　-〿＀-￯]/.test(ch); }

/* 无音频时按语速估算时长(毫秒) */
export function estimateDurationMs(text = '') {
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) || []).length;
  const latinWords = (text.replace(/[㐀-鿿豈-﫿]/g, ' ').match(/[A-Za-z0-9'’]+/g) || []).length;
  const punct = (text.match(/[，。！？；：…—,.!?;:]/g) || []).length;
  return Math.max(700, Math.round(cjk * 230 + latinWords * 380 + punct * 160));
}

/* 打字上屏时长 */
export function typedDurationMs(text = '') {
  return Math.max(T.typedMin, text.length * T.typedMsPerChar);
}

export function normTrack(name = '') {
  const n = String(name).trim();
  if (TRACKS.includes(n)) return n;
  if (TRACK_ALIASES[n]) return TRACK_ALIASES[n];
  for (const t of TRACKS) if (n.startsWith(t)) return t;
  return n || '自定义';
}

/* "【世界信息】a｜b；c｜d" → { track, raw_track, sub, text, fields } */
export function parseLogLine(line) {
  if (line && typeof line === 'object') {
    const obj = { ...line };
    obj.track = normTrack(obj.track || obj.raw_track || '自定义');
    if (!obj.fields) obj.fields = parseFields(obj.text || '');
    return obj;
  }
  const str = String(line ?? '').trim();
  const m = str.match(/^[【\[]([^】\]]+)[】\]]\s*(.*)$/s);
  if (!m) return { track: '自定义', raw_track: null, sub: null, text: str, fields: parseFields(str) };
  const rawTrack = m[1].trim();
  const body = m[2].trim();
  const sub = rawTrack.includes('·') ? rawTrack.split('·').slice(1).join('·') : null;
  return { track: normTrack(rawTrack), raw_track: rawTrack, sub, text: body, fields: parseFields(body) };
}

/* "k｜v；k｜v" → { k: v } ,无键的片段收进 _ */
export function parseFields(body = '') {
  const out = {};
  for (const seg of String(body).split(/[；;]\s*/)) {
    const s = seg.trim();
    if (!s) continue;
    const i = s.search(/[｜|]/);
    if (i > 0) {
      const k = s.slice(0, i).trim();
      const v = s.slice(i + 1).trim();
      out[k] = out[k] ? out[k] + '；' + v : v;
    } else {
      out._ = out._ ? out._ + '；' + s : s;
    }
  }
  return out;
}

/* 说话人 key → 角色 */
export function roleOf(script, speaker) {
  const sp = script?.speakers?.[speaker];
  if (sp?.role) return sp.role;
  if (speaker === 'user') return 'user';
  if (speaker === 'assistant') return 'assistant';
  if (speaker === 'system') return 'system';
  return 'third_party';
}

/* 通道:助手一路,其余(用户 / 第三方)一路 — 对应 Channel 2 / Channel 1 */
export function channelOf(role) { return role === 'assistant' ? 'assistant' : 'user'; }

function pad3(n) { return String(n).padStart(3, '0'); }

/*
 * 规范化:补默认值、分配 utterance id / clip / role / speaker_id、解析日志行。
 * 返回新对象,不修改入参。
 */
export function normalizeScript(raw) {
  const s = JSON.parse(JSON.stringify(raw || {}));
  s.version = s.version || VERSION;
  s.id = s.id || 'case';
  s.name = s.name || s.id;
  s.case_id = s.case_id != null ? String(s.case_id) : s.id;
  s.sample_id = s.sample_id || 's01';
  s.sample_name = s.sample_name || s.name;
  s.scene = s.scene || {};
  s.context = s.context || {};
  s.timeline = Array.isArray(s.timeline) ? s.timeline : [];
  s.beats = Array.isArray(s.beats) ? s.beats : [];

  /* speakers */
  const speakers = s.speakers || {};
  speakers.user = { name: '你', role: 'user', speaker_id: 'user_1', ...(speakers.user || {}) };
  speakers.user.tts = { ...DEFAULT_VOICES.user, ...(speakers.user.tts || {}) };
  speakers.assistant = { name: 'Step', role: 'assistant', speaker_id: 'assistant', ...(speakers.assistant || {}) };
  speakers.assistant.tts = { ...DEFAULT_VOICES.assistant, ...(speakers.assistant.tts || {}) };
  speakers.system = { name: '系统', role: 'system', ...(speakers.system || {}) };
  s.speakers = speakers;

  let thirdIdx = 0;
  const thirdVoice = () => DEFAULT_VOICES.third[thirdIdx++ % DEFAULT_VOICES.third.length];
  let userN = 1;
  const ensureSpeaker = (key) => {
    if (!speakers[key]) speakers[key] = { name: key, role: 'third_party' };
    const sp = speakers[key];
    sp.role = sp.role || (key === 'user' ? 'user' : key === 'assistant' ? 'assistant' : 'third_party');
    sp.name = sp.name || key;
    if (sp.role !== 'system') sp.tts = { ...(sp.role === 'assistant' ? DEFAULT_VOICES.assistant : DEFAULT_VOICES.user), ...(sp.tts || {}) };
    if (sp.role === 'third_party' && !sp.tts.voice_explicit && !(raw?.speakers?.[key]?.tts?.voice)) sp.tts.voice = sp.tts.voice_auto || (sp.tts.voice_auto = thirdVoice());
    return sp;
  };
  for (const key of Object.keys(speakers)) ensureSpeaker(key);

  /* speaker_id:主用户 user_1,其他真人按出现顺序 user_2… */
  const assignIds = () => {
    for (const key of Object.keys(speakers)) {
      const sp = speakers[key];
      if (sp.speaker_id) continue;
      if (sp.role === 'user') sp.speaker_id = 'user_' + (userN++);
      else if (sp.role === 'assistant') sp.speaker_id = 'assistant';
      else if (sp.role === 'system') sp.speaker_id = 'system';
    }
    let n = 2;
    const used = new Set(Object.values(speakers).map(x => x.speaker_id).filter(Boolean));
    for (const key of Object.keys(speakers)) {
      const sp = speakers[key];
      if (sp.speaker_id) continue;
      while (used.has('user_' + n)) n++;
      sp.speaker_id = 'user_' + n; used.add(sp.speaker_id);
    }
  };

  /* timeline */
  let sayN = 0;
  s.timeline.forEach((st, i) => {
    st.i = i;
    st.type = st.type || (st.text != null ? 'say' : 'log');
    if (st.log != null && !Array.isArray(st.log)) st.log = [st.log];
    st.log = (st.log || []).map(parseLogLine);
    if (st.type === 'say') {
      sayN++;
      st.speaker = st.speaker || 'user';
      ensureSpeaker(st.speaker);
      st.id = st.id || 'u' + pad3(sayN);
      st.text = String(st.text ?? '');
      if (!st.typed && !st.clip && st.clip !== false) st.clip = st.id;
      if (st.typed) st.clip = null;
      st.role = roleOf(s, st.speaker);
      if (st.fdx && !Array.isArray(st.fdx)) st.fdx = [st.fdx];
    }
    if (st.type === 'agent') {
      st.steps = (st.steps || []).map((x, j) => ({ ms: 2400, ...x, j }));
    }
    if (st.type === 'tool') {
      st.ui = st.ui === false ? false : { ...(st.ui || {}) };
    }
  });
  assignIds();
  return s;
}

/* 校验:返回 { errors, warnings } */
export function validateScript(input) {
  const errors = [], warnings = [];
  let s;
  try { s = normalizeScript(input); } catch (e) { return { errors: ['脚本不是合法对象:' + e.message], warnings }; }
  if (!s.timeline.length) errors.push('timeline 为空');
  let lastOther = null; // 最近一条 say(用于打断目标检查)
  const says = [];
  s.timeline.forEach((st) => {
    const at = `#${st.i} ${st.type}`;
    if (!STEP_TYPES.includes(st.type)) errors.push(`${at}:未知的 step 类型`);
    if (st.type === 'say') {
      if (!st.text.trim()) errors.push(`${at}:text 为空`);
      if (st.barge_in) {
        const target = [...says].reverse().find(x => x.speaker !== st.speaker && !x.typed);
        if (!target) errors.push(`${at}(${st.id}):barge_in 之前没有可打断的另一说话人的 say`);
      }
      if (st.at_ms != null && !st.barge_in) warnings.push(`${at}(${st.id}):at_ms 只对 barge_in 生效`);
      says.push(st);
    }
    if (st.type === 'card' && st.button && typeof st.button === 'string') st.button = { label: st.button };
    if (st.type === 'agent' && !(st.steps || []).length && !st.think) warnings.push(`${at}:agent 没有 steps`);
    if (st.type === 'tool' && !st.name) errors.push(`${at}:tool 缺少 name`);
    if (st.type === 'call' && !['ring', 'connect', 'end'].includes(st.action || 'ring')) errors.push(`${at}:call.action 应为 ring/connect/end`);
    if (st.type === 'pill' && st.action !== 'hide' && !st.name) warnings.push(`${at}:pill 没有 name`);
    lastOther = st;
  });
  void lastOther;
  return { errors, warnings, script: s };
}

/* 时间串解析:"08:03:00.0" / "08:03" / "1:02:03.456" → 当天毫秒 */
export function clockToMs(str) {
  if (str == null || str === '') return null;
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?$/);
  if (!m) return null;
  const h = +m[1], mi = +m[2], se = +(m[3] || 0);
  const frac = m[4] ? +(m[4].padEnd(3, '0')) : 0;
  return ((h * 60 + mi) * 60 + se) * 1000 + frac;
}
export function msToClock(ms, withTenths = true) {
  if (ms == null || isNaN(ms)) return '';
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000) % 24, mi = Math.floor(total / 60000) % 60, se = Math.floor(total / 1000) % 60;
  const t = Math.floor((total % 1000) / 100);
  const base = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(se).padStart(2, '0')}`;
  return withTenths ? `${base}.${t}` : base;
}

/* 给 UI 用的一行描述 */
export function stepLabel(st, script) {
  switch (st.type) {
    case 'section': return `§ ${st.title || ''}`;
    case 'say': return `${script?.speakers?.[st.speaker]?.name || st.speaker}:${st.text.slice(0, 40)}${st.barge_in ? ' ⟵打断' : ''}${st.typed ? ' (打字)' : ''}`;
    case 'tool': return `tool ${st.name}(${typeof st.args === 'string' ? st.args : ''})`;
    case 'agent': return `agent ×${(st.steps || []).length}`;
    case 'memory': return `memory ${st.query || st.ref?.key || ''}`;
    case 'backend': return `backend ${st.query || ''}`;
    case 'world': return `world ${st.scene_state || st.text || ''}`;
    case 'card': return `card ${st.title || st.style || ''}`;
    case 'pill': return `pill ${st.action || st.name || ''}`;
    case 'call': return `call ${st.action || 'ring'} ${st.name || ''}`;
    case 'hardware': return `hardware ${st.feedback || ''}`;
    case 'system': return `系统:${(st.text || '').slice(0, 40)}`;
    case 'skip': return `skip → ${st.to || ''}`;
    case 'wait': return `wait ${st.ms}ms`;
    default: return `${st.type} ${st.action || st.label || st.title || ''}`;
  }
}
