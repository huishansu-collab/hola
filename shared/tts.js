/*
 * shared/tts.js — OpenAI TTS 的纯逻辑,Node(server/tts.js、CLI)与浏览器(工作台"浏览器直连")共用:
 *   ttsPlan(script)            逐句生成计划:说话人音色、instructions、缓存键
 *   buildSpeechRequest(item)   /v1/audio/speech 请求体(gpt-4o-mini-tts 才带 instructions)
 *   synthesizeSpeech(item, …)  带 429/5xx 重试的调用,返回 wav ArrayBuffer
 *   wavDurationMs(buf)         只读 wav 头算时长(浏览器端不解码也能拿到)
 */
import { normalizeScript } from './script.js';

export const TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
export const TTS_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'];
export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

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
  return fnv1a64([model, voice, speed ?? 1, instructions || '', text].join(''));
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

/* 逐句计划(跳过打字 / 无 clip / 空文本) */
export function ttsPlan(input, { model = DEFAULT_TTS_MODEL } = {}) {
  const s = input?.timeline?.[0]?.i != null ? input : normalizeScript(input);
  const items = [];
  for (const st of s.timeline) {
    if (st.type !== 'say' || !st.clip || st.typed || !String(st.text || '').trim()) continue;
    const sp = s.speakers[st.speaker] || {};
    const tts = { ...(sp.tts || {}), ...(st.tts || {}) };
    const voice = tts.voice || (sp.role === 'assistant' ? 'coral' : 'ash');
    const speed = tts.speed ?? 1.0;
    const instructions = instructionsFor(s, st);
    items.push({
      id: st.id, clip: st.clip, speaker: st.speaker, speaker_name: sp.name || st.speaker, text: st.text,
      voice, speed, instructions, model, hash: clipHash({ model, voice, speed, instructions, text: st.text }),
    });
  }
  return items;
}

export function buildSpeechRequest(item, { format = 'wav' } = {}) {
  const body = { model: item.model || DEFAULT_TTS_MODEL, voice: item.voice, input: item.text, response_format: format, speed: item.speed ?? 1 };
  if (item.instructions && /gpt-4o/.test(body.model)) body.instructions = item.instructions;   // tts-1 系列不支持 instructions
  return body;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 调 OpenAI /v1/audio/speech,返回 wav 的 ArrayBuffer。
 * 429 / 5xx / 网络错误按 1.5s·n 退避重试;401/403/4xx 直接抛。
 */
export async function synthesizeSpeech(item, { apiKey, baseUrl = OPENAI_BASE_URL, model, fetchImpl = globalThis.fetch, signal, retries = 3, sleepMs = 1500 } = {}) {
  if (!apiKey) throw new Error('缺少 OpenAI API key');
  const body = buildSpeechRequest(model ? { ...item, model } : item);
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/audio/speech`, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) return await r.arrayBuffer();
      const txt = await r.text().catch(() => '');
      const err = new Error(`OpenAI TTS ${r.status}: ${txt.slice(0, 300)}`);
      err.status = r.status;
      if (r.status === 429 || r.status >= 500) { lastErr = err; if (attempt < retries) await sleep(sleepMs * (attempt + 1)); continue; }
      throw err;
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
