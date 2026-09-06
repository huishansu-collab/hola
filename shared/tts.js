/*
 * shared/tts.js — 语音合成的纯逻辑,Node(server/tts.js、CLI)与浏览器(工作台"浏览器直连")共用:
 *   PROVIDERS                  两家云端 TTS:openai(gpt-4o-mini-tts)与 qwen(阿里云百炼 DashScope 的千问 TTS)
 *   ttsPlan(script, {provider, model})   逐句生成计划:说话人音色、instructions、缓存键
 *   buildSpeechRequest(item)   OpenAI /v1/audio/speech 请求体(gpt-4o-mini-tts 才带 instructions)
 *   buildQwenRequest(item)     DashScope multimodal-generation 请求体
 *   synthesizeSpeech(item, …)  带 429/5xx 重试的调用,返回 wav ArrayBuffer(按 item.provider 分发)
 *   wavDurationMs(buf)         只读 wav 头算时长(浏览器端不解码也能拿到)
 */
import { normalizeScript } from './script.js';

export const TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
export const TTS_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'];
export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com';

/* 千问 TTS 音色(qwen3-tts-flash;qwen-tts 只支持前几个通用音色 + Dylan/Jada/Sunny 方言) */
export const QWEN_VOICES = [
  'Cherry', 'Ethan', 'Nofish', 'Jennifer', 'Ryan', 'Katerina', 'Elias',          // 通用:芊悦 晨煦 不吃鱼 詹妮弗 甜茶 卡捷琳娜 墨讲师
  'Dylan', 'Jada', 'Sunny', 'Li', 'Marcus', 'Roy', 'Peter', 'Rocky', 'Kiki', 'Eric', // 方言:北京 上海 四川 南京 陕西 闽南 天津 粤语 粤语 四川
  'Serena', 'Chelsea',                                                          // qwen-tts(旧版)
];

export const PROVIDERS = {
  openai: {
    name: 'OpenAI', models: TTS_MODELS, defaultModel: DEFAULT_TTS_MODEL, baseUrl: OPENAI_BASE_URL, voices: TTS_VOICES,
    voiceKey: 'voice', envKey: 'OPENAI_API_KEY', keyHint: 'sk-…  OpenAI API key(只留在本机)',
    defaults: { assistant: 'coral', user: 'ash', third: ['ash'] },
  },
  qwen: {
    name: '千问 · DashScope', models: ['qwen3-tts-flash', 'qwen-tts', 'qwen-tts-latest'], defaultModel: 'qwen3-tts-flash', baseUrl: DASHSCOPE_BASE_URL, voices: QWEN_VOICES,
    voiceKey: 'qwen_voice', envKey: 'DASHSCOPE_API_KEY', keyHint: 'sk-…  阿里云百炼 DashScope API key(只留在本机)',
    defaults: { assistant: 'Cherry', user: 'Ethan', third: ['Dylan', 'Ryan', 'Jennifer'] },   // 第三方默认北京话晓东,和用户拉开
  },
};
export const DEFAULT_PROVIDER = 'openai';
export const providerOf = (p) => PROVIDERS[p] || PROVIDERS[DEFAULT_PROVIDER];

/* 64 位 FNV-1a(两路 32 位不同种子),同步、零依赖;只作缓存键 */
export function fnv1a64(str) {
  let a = 0x811c9dc5, b = 0x2f0ec6a5;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function clipHash({ model, voice, speed, instructions, text }) {
  return fnv1a64([model, voice, speed ?? 1, instructions || '', text].join('\x01'));   // 分隔符 \x01,与已有 manifest 的哈希保持一致
}

/* 说话人定妆描述 + 这一句的舞台提示(急促 / 轻缓 / 低语…) */
export function instructionsFor(script, st) {
  const sp = script.speakers?.[st.speaker] || {};
  const tts = { ...(sp.tts || {}), ...(st.tts || {}) };
  return [
    tts.instructions,
    st.direction && /语气|急促|轻缓|低语|压低|放松|明快|沉稳|笑|叹气|抢话|打断/.test(st.direction) ? `这一句的语气:${st.direction}` : null,
    st.whisper ? '这一句压低声音、贴近麦克风的低语。' : null,
    st.tone ? `语气:${st.tone}` : null,
  ].filter(Boolean).join('\n');
}

/* 逐句计划(跳过打字 / 无 clip / 空文本)。openai 的缓存键与旧版完全一致;qwen 的键带 provider 前缀 */
export function ttsPlan(input, { provider = DEFAULT_PROVIDER, model } = {}) {
  const P = providerOf(provider); const prov = PROVIDERS[provider] ? provider : DEFAULT_PROVIDER;
  model = model || P.defaultModel;
  const s = input?.timeline?.[0]?.i != null ? input : normalizeScript(input);
  const items = []; const thirdVoice = new Map(); let thirdN = 0;
  for (const st of s.timeline) {
    if (st.type !== 'say' || !st.clip || st.typed || !String(st.text || '').trim()) continue;
    const sp = s.speakers[st.speaker] || {};
    const tts = { ...(sp.tts || {}), ...(st.tts || {}) };
    let voice = tts[P.voiceKey];
    if (!voice) {
      if (sp.role === 'assistant') voice = P.defaults.assistant;
      else if (sp.role === 'third_party' && P.defaults.third.length > 1) {
        if (!thirdVoice.has(st.speaker)) thirdVoice.set(st.speaker, P.defaults.third[thirdN++ % P.defaults.third.length]);
        voice = thirdVoice.get(st.speaker);
      } else voice = P.defaults.user;
    }
    const speed = prov === 'openai' ? (tts.speed ?? 1.0) : 1;
    const instructions = prov === 'openai' ? instructionsFor(s, st) : '';
    const hashModel = prov === 'openai' ? model : `${prov}:${model}`;
    items.push({
      id: st.id, clip: st.clip, speaker: st.speaker, speaker_name: sp.name || st.speaker, text: st.text,
      provider: prov, voice, speed, instructions, model, hash: clipHash({ model: hashModel, voice, speed, instructions, text: st.text }),
    });
  }
  return items;
}

export function buildSpeechRequest(item, { format = 'wav' } = {}) {
  const body = { model: item.model || DEFAULT_TTS_MODEL, voice: item.voice, input: item.text, response_format: format, speed: item.speed ?? 1 };
  if (item.instructions && /gpt-4o/.test(body.model)) body.instructions = item.instructions;   // tts-1 系列不支持 instructions
  return body;
}

/* DashScope 千问 TTS:非流式返回 output.audio.url(24kHz wav,链接 24h 有效) */
export function buildQwenRequest(item) {
  return { model: item.model || PROVIDERS.qwen.defaultModel, input: { text: item.text, voice: item.voice || PROVIDERS.qwen.defaults.assistant } };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function b64ToBuffer(s) {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer;
}
const isRiff = (ab) => ab && ab.byteLength > 12 && String.fromCharCode(...new Uint8Array(ab, 0, 4)) === 'RIFF';

/* 一次 OpenAI 调用:ok → ArrayBuffer;否则抛带 status 的错误 */
async function openaiOnce(item, { apiKey, baseUrl, fetchImpl, signal }) {
  const r = await fetchImpl(`${baseUrl}/audio/speech`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildSpeechRequest(item)),
  });
  if (r.ok) return await r.arrayBuffer();
  const txt = await r.text().catch(() => '');
  const err = new Error(`OpenAI TTS ${r.status}: ${txt.slice(0, 300)}`); err.status = r.status; throw err;
}

/* 一次千问调用:POST 拿 JSON → 取 audio.data(base64)或再 GET audio.url → 校验 RIFF */
async function qwenOnce(item, { apiKey, baseUrl, fetchImpl, signal }) {
  const r = await fetchImpl(`${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildQwenRequest(item)),
  });
  const txt = await r.text().catch(() => '');
  if (!r.ok) { const err = new Error(`千问 TTS ${r.status}: ${txt.slice(0, 300)}`); err.status = r.status; throw err; }
  let j; try { j = JSON.parse(txt); } catch { throw new Error('千问 TTS 返回不是 JSON: ' + txt.slice(0, 200)); }
  if (j.code) { const err = new Error(`千问 TTS ${j.code}: ${j.message || ''}`.slice(0, 300)); err.status = 400; throw err; }
  const audio = j.output?.audio || {};
  let ab = null;
  if (audio.data) ab = b64ToBuffer(audio.data);
  else if (audio.url) {
    const g = await fetchImpl(audio.url, { signal });
    if (!g.ok) { const err = new Error(`千问音频下载 ${g.status}`); err.status = g.status >= 500 ? g.status : 502; throw err; }
    ab = await g.arrayBuffer();
  } else throw new Error('千问 TTS 返回里没有音频: ' + txt.slice(0, 200));
  if (!isRiff(ab)) { const head = String.fromCharCode(...new Uint8Array(ab, 0, Math.min(4, ab.byteLength))); throw new Error(`千问返回的不是 wav(开头 "${head}",${ab.byteLength} 字节)`); }
  return ab;
}

/**
 * 合成一句,返回 wav 的 ArrayBuffer。按 item.provider(或 opts.provider)分发到 OpenAI / 千问。
 * 429 / 5xx / 网络错误按 1.5s·n 退避重试;401/403/4xx 直接抛。
 */
export async function synthesizeSpeech(item, { apiKey, provider, baseUrl, model, fetchImpl = globalThis.fetch, signal, retries = 3, sleepMs = 1500 } = {}) {
  const prov = PROVIDERS[provider || item.provider] ? (provider || item.provider) : DEFAULT_PROVIDER;
  const P = PROVIDERS[prov];
  if (!apiKey) throw new Error(`缺少 ${P.name} API key`);
  const it = { ...item, provider: prov, model: model || item.model || P.defaultModel };
  const base = String(baseUrl || P.baseUrl).replace(/\/$/, '');
  const once = prov === 'qwen' ? qwenOnce : openaiOnce;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once(it, { apiKey, baseUrl: base, fetchImpl, signal });
    } catch (e) {
      if (e.name === 'AbortError' || (e.status && e.status < 500 && e.status !== 429)) throw e;
      if (!e.status) e.network = true;
      lastErr = e;
      if (attempt < retries) await sleep(sleepMs * (attempt + 1));
    }
  }
  throw lastErr || new Error('TTS 失败');
}

/* 只读 RIFF 头:返回时长毫秒(非 PCM 或损坏返回 null) */
export function wavDurationMs(buf) {
  const ab = buf instanceof ArrayBuffer ? buf : (buf?.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null);
  if (!ab || ab.byteLength < 44) return null;
  const v = new DataView(ab);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let off = 12, sampleRate = 0, channels = 1, bits = 16, dataLen = null;
  while (off + 8 <= ab.byteLength) {
    const id = tag(off); let size = v.getUint32(off + 4, true);
    if (id === 'fmt ') { channels = v.getUint16(off + 10, true); sampleRate = v.getUint32(off + 12, true); bits = v.getUint16(off + 22, true); }
    if (id === 'data') { if (size === 0xffffffff || off + 8 + size > ab.byteLength) size = ab.byteLength - off - 8; dataLen = size; break; }
    off += 8 + size + (size % 2);
  }
  if (!sampleRate || dataLen == null) return null;
  return Math.round(dataLen / (channels * (bits / 8)) / sampleRate * 1000);
}
