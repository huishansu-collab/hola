/*
 * server/tts.js — 服务端语音生成与片段落盘。
 *
 *  - 请求/重试/缓存键逻辑在 shared/tts.js(浏览器直连也用同一套);这里只负责 .env 配置、文件与 manifest。
 *  - 输出 wav(24kHz 16-bit mono):浏览器直接播,服务端可解析时长、混成双声道母带。
 *  - 缓存:manifest.clips[clip].hash = clipHash(model|voice|speed|instructions|text);文本或音色没变就不重生成。
 *  - 代理:Node 自带 fetch 不读 HTTPS_PROXY;需要时用 NODE_USE_ENV_PROXY=1 启动(Node ≥ 22.21)。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeScript } from '../shared/script.js';
import { ttsPlan, synthesizeSpeech, TTS_VOICES, DEFAULT_TTS_MODEL, OPENAI_BASE_URL } from '../shared/tts.js';
import { audioDir, loadManifest, saveManifest } from './cases.js';
import { parseWav } from './audio.js';

export { TTS_VOICES };

export function ttsConfig(env = process.env) {
  return {
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_TTS_MODEL || DEFAULT_TTS_MODEL,
    baseUrl: (env.OPENAI_BASE_URL || OPENAI_BASE_URL).replace(/\/$/, ''),
    proxyHint: !!(env.HTTPS_PROXY || env.https_proxy) && !env.NODE_USE_ENV_PROXY,
  };
}

/* 把一段 wav 写进 case 的 audio/,更新 manifest;服务端生成与浏览器写回共用 */
export async function saveClip(id, clip, wav, { hash = null, source = 'browser', text } = {}) {
  const dir = audioDir(id);
  await fs.mkdir(dir, { recursive: true });
  const info = parseWav(wav);                                   // 非法 wav 直接抛
  const file = clip + '.wav';
  await fs.writeFile(path.join(dir, file), wav);
  for (const ext of ['.m4a', '.mp3', '.ogg', '.opus', '.aac', '.flac']) await fs.rm(path.join(dir, clip + ext), { force: true });
  const stat = await fs.stat(path.join(dir, file));
  const manifest = await loadManifest(id);
  manifest.clips = manifest.clips || {};
  const entry = { file, size: stat.size, mtime: stat.mtimeMs, duration_ms: info.duration_ms, format: 'wav', sample_rate: info.sampleRate, hash, source, generated_at: new Date().toISOString() };
  if (text !== undefined) entry.text = text;
  manifest.clips[clip] = entry;
  await saveManifest(id, manifest);
  return entry;
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
  const plan = ttsPlan(s, { model: cfg.model });
  const targets = only && only.length ? plan.filter(x => only.includes(x.id) || only.includes(x.clip)) : plan;
  const result = { generated: [], skipped: [], failed: [], total: targets.length };
  let index = 0;
  for (const it of targets) {
    index++;
    const entry = manifest.clips[it.clip];
    const file = it.clip + '.wav';
    const exists = entry?.file === file && await fs.stat(path.join(dir, file)).then(() => true).catch(() => false);
    if (!force && exists && entry.hash === it.hash) {
      result.skipped.push(it.id);
      onProgress({ phase: 'skip', clip: it.clip, id: it.id, index, total: targets.length, status: 'cached', message: '未变化,沿用缓存' });
      continue;
    }
    onProgress({ phase: 'start', clip: it.clip, id: it.id, index, total: targets.length, status: 'generating', message: `${it.speaker_name} · ${it.voice} · ${it.text.slice(0, 24)}` });
    try {
      const ab = await synthesizeSpeech(it, { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, signal });
      const saved = await saveClip(id, it.clip, Buffer.from(ab), { hash: it.hash, source: `openai:${cfg.model}:${it.voice}`, text: it.text });
      result.generated.push(it.id);
      onProgress({ phase: 'done', clip: it.clip, id: it.id, index, total: targets.length, status: 'ok', message: `${(saved.duration_ms / 1000).toFixed(1)}s`, duration_ms: saved.duration_ms });
    } catch (e) {
      result.failed.push({ id: it.id, error: e.message });
      onProgress({ phase: 'error', clip: it.clip, id: it.id, index, total: targets.length, status: 'error', message: e.message });
      if (e.status === 401 || e.status === 403 || e.name === 'AbortError') break;
    }
  }
  return result;
}
