/*
 * server/tts.js — OpenAI TTS 语音生成(逐句)。
 *
 *  - 模型默认 gpt-4o-mini-tts:支持 instructions(音色/情绪/语速的自然语言描述),对应 step-voice 里的"定妆音色"。
 *  - 输出 wav(24kHz 16-bit mono),既能直接在浏览器播放,也能在服务端解析时长、混成双声道母带。
 *  - 缓存:manifest.clips[clip].hash = sha1(model|voice|speed|instructions|text)。文本或音色没变就不重新生成。
 *  - 代理:Node 自带 fetch 不读 HTTPS_PROXY;需要时用 NODE_USE_ENV_PROXY=1 启动(Node ≥ 22.21)。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeScript } from '../shared/script.js';
import { audioDir, loadManifest, saveManifest } from './cases.js';
import { parseWav } from './audio.js';

export const TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];

export function ttsConfig(env = process.env) {
  return {
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    proxyHint: !!(env.HTTPS_PROXY || env.https_proxy) && !env.NODE_USE_ENV_PROXY,
  };
}

export function clipHash({ model, voice, speed, instructions, text }) {
  return crypto.createHash('sha1').update([model, voice, speed ?? 1, instructions || '', text].join('')).digest('hex');
}

/* 一次 TTS 调用 → wav Buffer */
export async function synthesize({ text, voice = 'coral', instructions, speed = 1.0, model, apiKey, baseUrl, format = 'wav', signal }) {
  const cfg = ttsConfig();
  model = model || cfg.model; apiKey = apiKey || cfg.apiKey; baseUrl = baseUrl || cfg.baseUrl;
  if (!apiKey) throw new Error('缺少 OPENAI_API_KEY(在 .env 里配置)');
  const body = { model, voice, input: text, response_format: format, speed };
  if (instructions && /gpt-4o/.test(model)) body.instructions = instructions;   // tts-1 系列不支持 instructions
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${baseUrl}/audio/speech`, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      const txt = await r.text();
      const err = new Error(`OpenAI TTS ${r.status}: ${txt.slice(0, 300)}`);
      err.status = r.status;
      if (r.status === 429 || r.status >= 500) { lastErr = err; await sleep(1500 * (attempt + 1)); continue; }
      throw err;
    } catch (e) {
      if (e.name === 'AbortError' || (e.status && e.status < 500 && e.status !== 429)) throw e;
      lastErr = e; await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr || new Error('TTS 失败');
}

/**
 * 为一个 case 生成全部(或指定)台词的语音。
 * onProgress({ phase, clip, id, index, total, status, message })
 */
export async function generateCaseAudio(id, rawScript, { force = false, only = null, onProgress = () => {}, signal } = {}) {
  const cfg = ttsConfig();
  if (!cfg.apiKey) throw new Error('缺少 OPENAI_API_KEY(在 .env 里配置后重启服务)');
  const s = normalizeScript(rawScript);
  const dir = audioDir(id);
  await fs.mkdir(dir, { recursive: true });
  const manifest = await loadManifest(id);
  manifest.clips = manifest.clips || {};
  const says = s.timeline.filter(x => x.type === 'say' && x.clip && !x.typed && x.text.trim());
  const targets = only && only.length ? says.filter(x => only.includes(x.id) || only.includes(x.clip)) : says;
  const result = { generated: [], skipped: [], failed: [], total: targets.length };
  let index = 0;
  for (const st of targets) {
    index++;
    const sp = s.speakers[st.speaker] || {};
    const tts = { ...(sp.tts || {}), ...(st.tts || {}) };
    const voice = tts.voice || 'coral';
    const instructions = [tts.instructions, st.direction && /语气|急促|轻缓|低语|压低|放松|明快|沉稳/.test(st.direction) ? `这一句的语气:${st.direction}` : null, st.whisper ? '这一句压低声音、贴近麦克风的低语。' : null, st.tone ? `语气:${st.tone}` : null].filter(Boolean).join('\n');
    const speed = tts.speed ?? 1.0;
    const hash = clipHash({ model: cfg.model, voice, speed, instructions, text: st.text });
    const entry = manifest.clips[st.clip];
    const file = st.clip + '.wav';
    const exists = entry?.file === file && await fs.stat(path.join(dir, file)).then(() => true).catch(() => false);
    if (!force && exists && entry.hash === hash) {
      result.skipped.push(st.id);
      onProgress({ phase: 'skip', clip: st.clip, id: st.id, index, total: targets.length, status: 'cached', message: '未变化,沿用缓存' });
      continue;
    }
    onProgress({ phase: 'start', clip: st.clip, id: st.id, index, total: targets.length, status: 'generating', message: `${sp.name || st.speaker} · ${voice} · ${st.text.slice(0, 24)}` });
    try {
      const wav = await synthesize({ text: st.text, voice, instructions, speed, signal });
      const info = parseWav(wav);
      await fs.writeFile(path.join(dir, file), wav);
      /* 删除同名的其它格式,避免歧义 */
      for (const ext of ['.m4a', '.mp3', '.ogg', '.opus', '.aac', '.flac']) await fs.rm(path.join(dir, st.clip + ext), { force: true });
      const stat = await fs.stat(path.join(dir, file));
      manifest.clips[st.clip] = {
        file, size: stat.size, mtime: stat.mtimeMs, duration_ms: info.duration_ms, format: 'wav', sample_rate: info.sampleRate,
        hash, source: `openai:${cfg.model}:${voice}`, generated_at: new Date().toISOString(), text: st.text,
      };
      await saveManifest(id, manifest);
      result.generated.push(st.id);
      onProgress({ phase: 'done', clip: st.clip, id: st.id, index, total: targets.length, status: 'ok', message: `${(info.duration_ms / 1000).toFixed(1)}s`, duration_ms: info.duration_ms });
    } catch (e) {
      result.failed.push({ id: st.id, error: e.message });
      onProgress({ phase: 'error', clip: st.clip, id: st.id, index, total: targets.length, status: 'error', message: e.message });
      if (e.status === 401 || e.status === 403 || e.name === 'AbortError') break;
    }
  }
  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
