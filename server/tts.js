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
import { ttsPlan, synthesizeSpeech, volcCreate, volcPersona, buildVolcPrompt, estimateVolcSeconds, chunkVolcLines, TTS_VOICES, DEFAULT_TTS_MODEL, OPENAI_BASE_URL, PROVIDERS, DEFAULT_PROVIDER } from '../shared/tts.js';
import { audioDir, loadManifest, saveManifest } from './cases.js';
import { parseWav, writeWav, toMono, resampleMono, silenceRegions, alignRegions, slicePcm } from './audio.js';

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

export const speechChars = (t) => String(t || '').replace(/[\s，。！？、：；“”…—「」·,.!?:;"'()（）]/g, '').length;

/* 环境音响度归一:seed-audio 生成的环境音响度差很多(-54 ~ -32 dBFS),统一到 targetDb(RMS),峰值不超过 0.95;需要 ffmpeg */
export async function normalizeAmbience(file, { targetDb = -24 } = {}) {
  const ff = ffmpegPath(); if (!ff) throw new Error('没有 ffmpeg');
  const { pcm } = await decodeAudio(await fs.readFile(file), { sampleRate: 16000 });
  let acc = 0, peak = 0; for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; acc += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  const rms = Math.sqrt(acc / Math.max(1, pcm.length)); if (!rms) return { gainDb: 0 };
  let gainDb = targetDb - 20 * Math.log10(rms);
  const maxDb = 20 * Math.log10(0.95 / Math.max(peak, 1e-6)); if (gainDb > maxDb) gainDb = maxDb;
  if (Math.abs(gainDb) < 1) return { gainDb: 0 };
  const tmp = file + '.norm.mp3';
  const r = spawnSync(ff, ['-y', '-loglevel', 'error', '-i', file, '-af', `volume=${gainDb.toFixed(2)}dB`, '-codec:a', 'libmp3lame', '-b:a', '96k', tmp]);
  if (r.status !== 0) throw new Error('ffmpeg: ' + String(r.stderr || '').slice(0, 160));
  await fs.rename(tmp, file);
  return { gainDb };
}

/* 切段:先按字数对齐(动态规划选静音间隙),对不齐再退回参考包的纯静音计数 */
export function splitMaster(pcm, sampleRate, items) {
  const n = items.length;
  const al = alignRegions(pcm, sampleRate, items.map(it => speechChars(it.text)));
  if (al.regs.length === n) return { regs: al.regs, quality: al.quality, how: `对齐(语速 ${(1 / al.rate).toFixed(1)} 字/s)` };
  for (const mergeGap of [1.0, 0.8, 1.3, 0.6, 1.6]) {
    const regs = silenceRegions(pcm, sampleRate, { mergeGap });
    if (regs.length === n) return { regs, quality: 1, how: `静音计数 merge_gap ${mergeGap}` };
  }
  return { regs: al.regs.length ? al.regs : silenceRegions(pcm, sampleRate), quality: Infinity, how: '失败' };
}

/* 用已存的母带重新切段(不再调 API):master_<speaker>[_<首句id>].mp3 → 每句 wav。改了切段算法或想微调时用 */
export async function recutCase(id, rawScript, { onProgress = () => {} } = {}) {
  const s = normalizeScript(rawScript);
  const dir = audioDir(id);
  const manifest = await loadManifest(id); manifest.clips = manifest.clips || {};
  const plan = ttsPlan(s, { provider: 'volc' });
  const files = (await fs.readdir(dir)).filter(f => /^master_.+\.mp3$/.test(f));
  const align = await fs.readFile(path.join(dir, 'master_align.json'), 'utf8').then(JSON.parse).catch(() => null);   // tools/align_clips.py 的识别对齐结果,优先
  const result = { cut: [], failed: [], chunks: 0, aligned: 0 };
  const speakers = [...new Set(plan.map(it => it.speaker))];
  for (const sp of speakers) {
    const items = plan.filter(it => it.speaker === sp);
    const masters = files.filter(f => f === `master_${sp}.mp3` || f.startsWith(`master_${sp}_`)).map(f => { const m = f.match(/_(u\d+)\.mp3$/); return { f, idx: m ? items.findIndex(it => it.id === m[1]) : 0 }; }).filter(m => m.idx >= 0).sort((a, b) => a.idx - b.idx);
    for (let k = 0; k < masters.length; k++) {
      const chunk = items.slice(masters[k].idx, k + 1 < masters.length ? masters[k + 1].idx : items.length);
      if (!chunk.length) continue;
      result.chunks++;
      const { pcm, sampleRate } = await decodeAudio(await fs.readFile(path.join(dir, masters[k].f)));
      let { regs, quality, how } = splitMaster(pcm, sampleRate, chunk);
      const al = align?.[masters[k].f];
      if (al && al.ids.length === chunk.length && al.ids.every((x, i) => x === chunk[i].id)) { regs = al.regs; quality = 1 - Math.min(...al.sim); how = `识别对齐(最低匹配率 ${Math.min(...al.sim).toFixed(2)})`; result.aligned += chunk.length; }
      if (regs.length !== chunk.length) { for (const it of chunk) result.failed.push({ id: it.id, error: `${masters[k].f} 切不出 ${chunk.length} 段` }); continue; }
      onProgress({ phase: 'start', clip: sp, id: sp, index: 0, total: plan.length, status: 'generating', message: `${masters[k].f}: ${chunk.length} 句,${how},最差偏差 ${(quality * 100).toFixed(0)}%` });
      for (let i = 0; i < chunk.length; i++) {
        const it = chunk[i]; const [a, b] = regs[i];
        const wav = writeWav({ sampleRate: 24000, channels: 1, samples: resampleMono(slicePcm(pcm, sampleRate, a, b), sampleRate, 24000) });
        const saved = await saveClip(id, it.clip, wav, { hash: it.hash, source: `volc:seed-audio-1.0:${it.speaker}`, text: it.text });
        manifest.clips[it.clip] = saved; result.cut.push(it.id);
        onProgress({ phase: 'done', clip: it.clip, id: it.id, index: 0, total: plan.length, status: 'ok', message: `${(saved.duration_ms / 1000).toFixed(1)}s`, duration_ms: saved.duration_ms });
      }
    }
  }
  return result;
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
  const result = { generated: [], skipped: [], failed: [], total: plan.length, masters: [], ambience: [] };
  let index = 0;
  const ambOnly = only && only.length === 1 && only[0] === 'ambience';
  for (const [speaker, items] of groups) {
    if (ambOnly) { result.skipped.push(...items.map(i => i.id)); index += items.length; continue; }
    if (only && only.length && !items.some(it => only.includes(it.id) || only.includes(it.clip) || only.includes(speaker))) { result.skipped.push(...items.map(i => i.id)); index += items.length; continue; }
    const current = items.every(it => manifest.clips[it.clip]?.hash === it.hash && manifest.clips[it.clip]?.file === it.clip + '.wav');
    if (!force && current) { result.skipped.push(...items.map(i => i.id)); index += items.length; onProgress({ phase: 'skip', clip: speaker, id: speaker, index, total: plan.length, status: 'cached', message: `${items[0].speaker_name} ${items.length} 句未变化,沿用` }); continue; }
    const persona = volcPersona(s, speaker);
    onProgress({ phase: 'start', clip: speaker, id: speaker, index, total: plan.length, status: 'generating', message: `${items[0].speaker_name} · 整段生成 ${items.length} 句(30~120s)` });
    try {
      await synthesizeGroup(id, dir, manifest, cfg, persona, items, { onProgress, signal, fetchImpl, result, depth: 0, maxSec: +(process.env.VOLC_MAX_SECONDS || 100) });
    } catch (e) {
      for (const it of items) result.failed.push({ id: it.id, error: e.message });
      onProgress({ phase: 'error', clip: speaker, id: speaker, index, total: plan.length, status: 'error', message: e.message });
      if (e.status === 401 || e.status === 403 || e.name === 'AbortError') break;
    }
    index += items.length;
  }
  /* 场景环境音:剧本里 @ambience file=… prompt="纯环境音效,没有旁白和音乐:…" 的,缺文件(或 --force / --only ambience)时用 seed-audio 生成 */
  const ambSteps = s.timeline.filter(st => st.type === 'ambience' && st.file && st.prompt);
  if (s.scene?.ambience && s.scene.ambience_prompt) ambSteps.unshift({ file: s.scene.ambience, prompt: s.scene.ambience_prompt });
  const seen = new Set();
  for (const st of ambSteps) {
    const file = String(st.file).replace(/\.[^.]+$/, '') + '.mp3';
    if (seen.has(file)) continue; seen.add(file);
    const exists = await fs.stat(path.join(dir, file)).then(() => true).catch(() => false);
    if (exists && !(force || ambOnly)) continue;
    if (only && only.length && !ambOnly && !only.includes(file.replace(/\.mp3$/, ''))) continue;
    onProgress({ phase: 'start', clip: file, id: file, index, total: plan.length, status: 'generating', message: `环境音 ${file} · ${String(st.prompt).slice(0, 30)}…` });
    try {
      const audio = Buffer.from(await volcCreate(String(st.prompt), { apiKey: cfg.apiKey === 'app-token' ? '' : cfg.apiKey, appId: cfg.appId, accessToken: cfg.accessToken, resourceId: cfg.resourceId, baseUrl: cfg.baseUrl, model: cfg.model, signal, ...(fetchImpl ? { fetchImpl } : {}) }));
      await fs.writeFile(path.join(dir, file), audio);
      await normalizeAmbience(path.join(dir, file)).catch(e => onProgress({ phase: 'start', clip: file, id: file, index, total: plan.length, status: 'generating', message: `响度归一失败,按原样保留:${e.message}` }));
      delete manifest.clips[file.replace(/\.mp3$/, '')];                         // 让 refreshManifest 重新算时长
      await saveManifest(id, manifest);
      result.ambience.push(file);
      onProgress({ phase: 'done', clip: file, id: file, index, total: plan.length, status: 'ok', message: `${(audio.length / 1024).toFixed(0)}KB` });
    } catch (e) {
      result.failed.push({ id: file, error: e.message });
      onProgress({ phase: 'error', clip: file, id: file, index, total: plan.length, status: 'error', message: e.message });
    }
  }
  return result;
}

/* seed-audio 一次能生成的音频有时长上限(参考包最长一次 55s 通过;超过报 DurationOutOfRange)。
 * 先按估算时长切成 ≤ maxSec 的连续几段(段数越少音色越连贯);被拒再把上限减半重切 */
async function synthesizeGroup(id, dir, manifest, cfg, persona, items, ctx) {
  const n = items.length;
  const est = estimateVolcSeconds(items);
  if (n > 1 && est > ctx.maxSec) {
    const chunks = chunkVolcLines(items, ctx.maxSec);
    ctx.onProgress({ phase: 'start', clip: items[0].speaker, id: items[0].speaker, index: 0, total: 0, status: 'generating', message: `${items[0].speaker_name} 估算 ${est.toFixed(0)}s,超过单次上限 ${ctx.maxSec}s,分 ${chunks.length} 段整段生成` });
    for (const c of chunks) await synthesizeGroup(id, dir, manifest, cfg, persona, c, { ...ctx, depth: ctx.depth + 1 });
    return;
  }
  const lines = items.map(it => ({ text: it.text, mood: it.mood }));
  const prompt = buildVolcPrompt({ persona, lines });
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let audio;
    try {
      audio = Buffer.from(await volcCreate(prompt, { apiKey: cfg.apiKey === 'app-token' ? '' : cfg.apiKey, appId: cfg.appId, accessToken: cfg.accessToken, resourceId: cfg.resourceId, baseUrl: cfg.baseUrl, model: cfg.model, signal: ctx.signal, ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}) }));
    } catch (e) {
      /* 太长 / 参数被拒:把单次上限降到这段估算的一半,重新切开各自生成(音色会重抽,但至少能出) */
      if (e.status && e.status < 500 && e.status !== 429 && e.status !== 401 && e.status !== 403 && n >= 2 && ctx.depth < 6) {
        const maxSec = Math.max(20, Math.min(ctx.maxSec, est) * 0.5);
        ctx.onProgress({ phase: 'start', clip: items[0].speaker, id: items[0].speaker, index: 0, total: 0, status: 'generating', message: `火山拒绝了这段(${e.message.slice(0, 80)}),单次上限降到 ${maxSec.toFixed(0)}s 重切` });
        for (const c of chunkVolcLines(items, maxSec)) await synthesizeGroup(id, dir, manifest, cfg, persona, c, { ...ctx, depth: ctx.depth + 1, maxSec });
        return;
      }
      throw e;
    }
    const { pcm, sampleRate } = await decodeAudio(audio);
    const { regs, quality, how } = splitMaster(pcm, sampleRate, items);
    if (regs.length !== n || quality > 1.5) {
      last = new Error(regs.length !== n ? `母带切出 ${regs.length} 段,期望 ${n} 段(第 ${attempt} 次)` : `切段对不准(最差偏差 ${(quality * 100).toFixed(0)}%,第 ${attempt} 次)`);
      ctx.onProgress({ phase: 'start', clip: items[0].speaker, id: items[0].speaker, index: 0, total: 0, status: 'generating', message: last.message + (attempt < 3 ? ',重新生成' : '') });
      continue;
    }
    ctx.onProgress({ phase: 'start', clip: items[0].speaker, id: items[0].speaker, index: 0, total: 0, status: 'generating', message: `${items[0].speaker_name} ${n} 句:${how},最差偏差 ${(quality * 100).toFixed(0)}%` });
    const masterName = `master_${items[0].speaker}${ctx.depth ? '_' + items[0].id : ''}.mp3`;
    if (!ctx.depth) for (const f of await fs.readdir(dir)) if (f.startsWith(`master_${items[0].speaker}_`)) await fs.rm(path.join(dir, f), { force: true });
    await fs.writeFile(path.join(dir, masterName), audio);
    ctx.result.masters.push(masterName);
    for (let i = 0; i < n; i++) {
      const it = items[i]; const [a, b] = regs[i];
      const seg = resampleMono(slicePcm(pcm, sampleRate, a, b), sampleRate, 24000);
      const wav = writeWav({ sampleRate: 24000, channels: 1, samples: seg });
      const saved = await saveClip(id, it.clip, wav, { hash: it.hash, source: `${cfg.provider}:${cfg.model}:${it.speaker}`, text: it.text });
      manifest.clips[it.clip] = saved;
      ctx.result.generated.push(it.id);
      ctx.onProgress({ phase: 'done', clip: it.clip, id: it.id, index: 0, total: 0, status: 'ok', message: `${(saved.duration_ms / 1000).toFixed(1)}s(母带 ${a.toFixed(1)}‒${b.toFixed(1)}s)`, duration_ms: saved.duration_ms });
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
