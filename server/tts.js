/*
 * server/tts.js — 服务端语音生成与片段落盘(OpenAI / 千问 DashScope 二选一,见 ttsConfig)。
 *
 *  - 请求/重试/缓存键逻辑在 shared/tts.js(浏览器直连也用同一套);这里只负责 .env 配置、文件与 manifest。
 *  - 输出 wav(24kHz 16-bit mono):浏览器直接播,服务端可解析时长、混成双声道母带。
 *  - 缓存:manifest.clips[clip].hash = clipHash(model|voice|speed|instructions|text);文本或音色没变就不重生成。
 *  - 代理:Node 自带 fetch 不读 HTTPS_PROXY;需要时用 NODE_USE_ENV_PROXY=1 启动(Node ≥ 22.21)。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeScript } from '../shared/script.js';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ttsPlan, synthesizeSpeech, volcCreate, volcPersona, buildVolcPrompt, TTS_VOICES, DEFAULT_TTS_MODEL, OPENAI_BASE_URL, PROVIDERS, DEFAULT_PROVIDER } from '../shared/tts.js';
import { audioDir, loadManifest, saveManifest } from './cases.js';
import { parseWav, writeWav, toMono, resampleMono, silenceRegions, slicePcm } from './audio.js';

export { TTS_VOICES };

/* 服务端配置。provider 优先级:参数 > TTS_PROVIDER > 哪家配了 key 用哪家(都配了用 OpenAI) */
export function ttsConfig(env = process.env, provider) {
  const want = provider || env.TTS_PROVIDER || (env.OPENAI_API_KEY ? 'openai' : env.DASHSCOPE_API_KEY ? 'qwen' : DEFAULT_PROVIDER);
  const prov = PROVIDERS[want] ? want : DEFAULT_PROVIDER;
  const proxyHint = !!(env.HTTPS_PROXY || env.https_proxy) && !env.NODE_USE_ENV_PROXY;
  if (prov === 'volc') return {
    provider: 'volc', name: PROVIDERS.volc.name, envKey: 'VOLC_TTS_API_KEY',
    apiKey: env.VOLC_TTS_API_KEY || ((env.VOLC_APP_ID && env.VOLC_ACCESS_TOKEN) ? 'app-token' : ''),   // 占位:没有 API key 但有 APP ID + Token 也算配置了
    appId: env.VOLC_APP_ID || '', accessToken: env.VOLC_ACCESS_TOKEN || '', resourceId: env.VOLC_RESOURCE_ID || '',
    model: env.VOLC_TTS_MODEL || PROVIDERS.volc.defaultModel,
    baseUrl: (env.VOLC_BASE_URL || PROVIDERS.volc.baseUrl).replace(/\/$/, ''),
    proxyHint,
  };
  if (prov === 'qwen') return {
    provider: 'qwen', name: PROVIDERS.qwen.name, envKey: 'DASHSCOPE_API_KEY',
    apiKey: env.DASHSCOPE_API_KEY || '',
    model: env.QWEN_TTS_MODEL || PROVIDERS.qwen.defaultModel,
    baseUrl: (env.DASHSCOPE_BASE_URL || PROVIDERS.qwen.baseUrl).replace(/\/$/, ''),
    proxyHint,
  };
  return {
    provider: 'openai', name: PROVIDERS.openai.name, envKey: 'OPENAI_API_KEY',
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_TTS_MODEL || DEFAULT_TTS_MODEL,
    baseUrl: (env.OPENAI_BASE_URL || OPENAI_BASE_URL).replace(/\/$/, ''),
    proxyHint,
  };
}

/* 哪些 provider 在 .env 里配了 key(状态接口用) */
export function configuredProviders(env = process.env) {
  return Object.keys(PROVIDERS).filter(p => env[PROVIDERS[p].envKey]);
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
export async function generateCaseAudio(id, rawScript, { force = false, only = null, onProgress = () => {}, signal, provider, model, fetchImpl } = {}) {
  const cfg = ttsConfig(process.env, provider);
  if (model) cfg.model = model;
  if (!cfg.apiKey) throw new Error(`缺少 ${cfg.envKey}(在 .env 里配置后重启服务)`);
  const s = normalizeScript(rawScript);
  if (PROVIDERS[cfg.provider]?.batch) return generateCaseAudioBatch(id, s, cfg, { force, only, onProgress, signal, fetchImpl });
  const dir = audioDir(id);
  await fs.mkdir(dir, { recursive: true });
  const manifest = await loadManifest(id);
  manifest.clips = manifest.clips || {};
  const plan = ttsPlan(s, { provider: cfg.provider, model: cfg.model });
  const targets = only && only.length ? plan.filter(x => only.includes(x.id) || only.includes(x.clip)) : plan;
  const result = { generated: [], skipped: [], failed: [], total: targets.length };
  let index = 0;
  for (const it of targets) {
    index++;
    const entry = manifest.clips[it.clip];
    const file = it.clip + '.wav';
    const exists = entry?.file === file && await fs.stat(path.join(dir, file)).then(() => true).catch(() => false);
    const localCurrent = /^local:/.test(entry?.source || '') && entry.text === it.text;   // 离线引擎生成且文本没变:不用 OpenAI 重做,--force 才替换
    if (!force && exists && (entry.hash === it.hash || localCurrent)) {
      result.skipped.push(it.id);
      onProgress({ phase: 'skip', clip: it.clip, id: it.id, index, total: targets.length, status: 'cached', message: '未变化,沿用缓存' });
      continue;
    }
    onProgress({ phase: 'start', clip: it.clip, id: it.id, index, total: targets.length, status: 'generating', message: `${it.speaker_name} · ${it.voice} · ${it.text.slice(0, 24)}` });
    try {
      const ab = await synthesizeSpeech(it, { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, signal, ...(fetchImpl ? { fetchImpl } : {}) });
      const saved = await saveClip(id, it.clip, Buffer.from(ab), { hash: it.hash, source: `${cfg.provider}:${cfg.model}:${it.voice}`, text: it.text });
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

/* ---------- 火山 seed-audio:整段生成 + 静音切分(对标 Step 参考包 step-voice 流程) ---------- */

export function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  for (const cand of ['ffmpeg']) { const r = spawnSync(cand, ['-version'], { stdio: 'ignore' }); if (!r.error && r.status === 0) return cand; }
  const py = spawnSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (!py.error && py.status === 0 && py.stdout.trim()) return py.stdout.trim();
  return null;
}

/* 任意音频(mp3 / wav …)→ 单声道 PCM。wav 直接读;其它交给 ffmpeg */
export async function decodeAudio(buf, { sampleRate = 48000 } = {}) {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF') { const w = parseWav(buf); return { pcm: toMono(w.pcm, w.channels), sampleRate: w.sampleRate }; }
  const ff = ffmpegPath();
  if (!ff) throw new Error('解码 mp3 需要 ffmpeg(装 ffmpeg,或 pip install imageio-ffmpeg)');
  const tmp = path.join(os.tmpdir(), `duplex-master-${process.pid}-${Date.now()}.bin`);
  await fs.writeFile(tmp, buf);
  try {
    const r = spawnSync(ff, ['-loglevel', 'error', '-i', tmp, '-f', 'wav', '-ac', '1', '-ar', String(sampleRate), 'pipe:1'], { maxBuffer: 1 << 30 });
    if (r.status !== 0) throw new Error('ffmpeg 解码失败: ' + String(r.stderr || '').slice(0, 200));
    const w = parseWav(r.stdout);
    return { pcm: w.pcm, sampleRate: w.sampleRate };
  } finally { await fs.rm(tmp, { force: true }); }
}

/* 切段:先按默认参数,段数不对再试几档 merge_gap */
function splitMaster(pcm, sampleRate, n) {
  for (const mergeGap of [1.0, 0.8, 1.3, 0.6, 1.6]) {
    const regs = silenceRegions(pcm, sampleRate, { mergeGap });
    if (regs.length === n) return { regs, mergeGap };
  }
  return { regs: silenceRegions(pcm, sampleRate), mergeGap: 1.0 };
}

/**
 * 整段生成:同一说话人的全部台词一次交给 seed-audio(人物描述 + 依次说了 N 句),拿回母带按静音切成每句。
 * 段数对不上就重新生成(最多 3 次),再不行按行数对半拆成两次生成。--only 按说话人过滤。
 */
export async function generateCaseAudioBatch(id, s, cfg, { force = false, only = null, onProgress = () => {}, signal, fetchImpl } = {}) {
  const dir = audioDir(id);
  await fs.mkdir(dir, { recursive: true });
  const manifest = await loadManifest(id);
  manifest.clips = manifest.clips || {};
  const plan = ttsPlan(s, { provider: cfg.provider, model: cfg.model });
  const groups = new Map();
  for (const it of plan) { if (!groups.has(it.speaker)) groups.set(it.speaker, []); groups.get(it.speaker).push(it); }
  const result = { generated: [], skipped: [], failed: [], total: plan.length, masters: [] };
  let index = 0;
  for (const [speaker, items] of groups) {
    if (only && only.length && !items.some(it => only.includes(it.id) || only.includes(it.clip) || only.includes(speaker))) { result.skipped.push(...items.map(i => i.id)); index += items.length; continue; }
    const current = items.every(it => manifest.clips[it.clip]?.hash === it.hash && manifest.clips[it.clip]?.file === it.clip + '.wav');
    if (!force && current) { result.skipped.push(...items.map(i => i.id)); index += items.length; onProgress({ phase: 'skip', clip: speaker, id: speaker, index, total: plan.length, status: 'cached', message: `${items[0].speaker_name} ${items.length} 句未变化,沿用` }); continue; }
    const persona = volcPersona(s, speaker);
    onProgress({ phase: 'start', clip: speaker, id: speaker, index, total: plan.length, status: 'generating', message: `${items[0].speaker_name} · 整段生成 ${items.length} 句(30~120s)` });
    try {
      await synthesizeGroup(id, dir, manifest, cfg, persona, items, { onProgress, signal, fetchImpl, result, depth: 0 });
    } catch (e) {
      for (const it of items) result.failed.push({ id: it.id, error: e.message });
      onProgress({ phase: 'error', clip: speaker, id: speaker, index, total: plan.length, status: 'error', message: e.message });
      if (e.status === 401 || e.status === 403 || e.name === 'AbortError') break;
    }
    index += items.length;
  }
  return result;
}

async function synthesizeGroup(id, dir, manifest, cfg, persona, items, ctx) {
  const n = items.length;
  const lines = items.map(it => ({ text: it.text, mood: it.mood }));
  const prompt = buildVolcPrompt({ persona, lines });
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let audio;
    try {
      audio = Buffer.from(await volcCreate(prompt, { apiKey: cfg.apiKey === 'app-token' ? '' : cfg.apiKey, appId: cfg.appId, accessToken: cfg.accessToken, resourceId: cfg.resourceId, baseUrl: cfg.baseUrl, model: cfg.model, signal: ctx.signal, ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}) }));
    } catch (e) {
      /* 文本太长之类的 4xx:对半拆开各自整段生成(音色会重抽一次,但至少能出) */
      if (e.status && e.status < 500 && e.status !== 429 && e.status !== 401 && e.status !== 403 && n >= 4 && ctx.depth < 3) {
        ctx.onProgress({ phase: 'start', clip: items[0].speaker, id: items[0].speaker, index: 0, total: 0, status: 'generating', message: `火山拒绝了整段(${e.status}),拆成两段各自生成` });
        const mid = Math.ceil(n / 2);
        await synthesizeGroup(id, dir, manifest, cfg, persona, items.slice(0, mid), { ...ctx, depth: ctx.depth + 1 });
        await synthesizeGroup(id, dir, manifest, cfg, persona, items.slice(mid), { ...ctx, depth: ctx.depth + 1 });
        return;
      }
      throw e;
    }
    const { pcm, sampleRate } = await decodeAudio(audio);
    const { regs, mergeGap } = splitMaster(pcm, sampleRate, n);
    if (regs.length !== n) {
      last = new Error(`母带切出 ${regs.length} 段,期望 ${n} 段(第 ${attempt} 次)`);
      ctx.onProgress({ phase: 'start', clip: items[0].speaker, id: items[0].speaker, index: 0, total: 0, status: 'generating', message: last.message + (attempt < 3 ? ',重新生成' : '') });
      continue;
    }
    const masterName = `master_${items[0].speaker}${ctx.depth ? '_' + items[0].id : ''}.mp3`;
    await fs.writeFile(path.join(dir, masterName), audio);
    ctx.result.masters.push(masterName);
    for (let i = 0; i < n; i++) {
      const it = items[i]; const [a, b] = regs[i];
      const seg = resampleMono(slicePcm(pcm, sampleRate, a, b), sampleRate, 24000);
      const wav = writeWav({ sampleRate: 24000, channels: 1, samples: seg });
      const saved = await saveClip(id, it.clip, wav, { hash: it.hash, source: `${cfg.provider}:${cfg.model}:${it.speaker}`, text: it.text });
      manifest.clips[it.clip] = saved;
      ctx.result.generated.push(it.id);
      ctx.onProgress({ phase: 'done', clip: it.clip, id: it.id, index: 0, total: 0, status: 'ok', message: `${(saved.duration_ms / 1000).toFixed(1)}s(母带 ${a.toFixed(1)}‒${b.toFixed(1)}s,merge_gap ${mergeGap})`, duration_ms: saved.duration_ms });
    }
    return;
  }
  /* 三次都切不准:句子多的话对半拆开各自整段生成(音色可能有变化,但至少能出) */
  if (n >= 8 && ctx.depth < 3) {
    ctx.onProgress({ phase: 'start', clip: items[0].speaker, id: items[0].speaker, index: 0, total: 0, status: 'generating', message: `${last?.message || '切段失败'},拆成两段各自生成` });
    const mid = Math.ceil(n / 2);
    await synthesizeGroup(id, dir, manifest, cfg, persona, items.slice(0, mid), { ...ctx, depth: ctx.depth + 1 });
    await synthesizeGroup(id, dir, manifest, cfg, persona, items.slice(mid), { ...ctx, depth: ctx.depth + 1 });
    return;
  }
  throw last || new Error('整段生成失败');
}
