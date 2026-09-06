/*
 * server/audio.js — WAV 读写、重采样、按调度混成"用户轨 / 助手轨"双声道母带。
 * 只处理 PCM WAV(OpenAI TTS 输出格式);m4a / mp3 等导入片段在浏览器端用 OfflineAudioContext 混音。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { T } from '../shared/script.js';

export function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('不是 WAV 文件');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (size === 0xffffffff || body + size > buf.length) size = buf.length - body;   // 流式写出的 wav 可能没填 size
      data = buf.subarray(body, body + size);
    }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV 缺少 fmt/data 块');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`只支持 16-bit PCM WAV(当前 format=${fmt.format}, bits=${fmt.bits})`);
  const frames = Math.floor(data.length / (2 * fmt.channels));
  const pcm = new Int16Array(frames * fmt.channels);
  for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2);
  return { ...fmt, frames, pcm, duration_ms: Math.round(frames / fmt.sampleRate * 1000) };
}

export function wavDurationMs(buf) { return parseWav(buf).duration_ms; }

export function writeWav({ sampleRate, channels, samples }) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * channels * 2, 28); buf.writeUInt16LE(channels * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
  return buf;
}

/* 多声道 → 单声道 */
export function toMono(pcm, channels) {
  if (channels === 1) return pcm;
  const frames = Math.floor(pcm.length / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < channels; c++) s += pcm[i * channels + c]; out[i] = Math.round(s / channels); }
  return out;
}

/* 按静音切段(移植自 Step 参考包 gen_dialogue.py):20ms 帧 RMS,阈值 = 峰值 × threshRatio,
 * 静音 ≥ minSil 秒断开,段间隔 < mergeGap 秒合并(长句换气误切),头尾各留 pad 秒。返回 [[起,止] 秒] */
export function silenceRegions(pcm, sampleRate, { minSil = 0.55, threshRatio = 0.06, pad = 0.18, mergeGap = 1.0 } = {}) {
  const frame = Math.round(sampleRate * 0.02);
  const total = Math.floor(pcm.length / frame);
  const rms = new Float64Array(total);
  let peak = 0;
  for (let i = 0; i < total; i++) {
    let acc = 0; const o = i * frame;
    for (let j = 0; j < frame; j++) { const v = pcm[o + j]; acc += v * v; }
    rms[i] = Math.sqrt(acc / frame); if (rms[i] > peak) peak = rms[i];
  }
  const th = peak * threshRatio;
  const regs = []; let start = null, sil = 0;
  for (let i = 0; i < total; i++) {
    if (rms[i] > th) { if (start === null) start = i; sil = 0; }
    else if (start !== null) { sil++; if (sil * 0.02 >= minSil) { regs.push([start * 0.02, (i - sil + 1) * 0.02]); start = null; sil = 0; } }
  }
  if (start !== null) regs.push([start * 0.02, total * 0.02]);
  const merged = [];
  for (const r of regs) { if (merged.length && r[0] - merged[merged.length - 1][1] < mergeGap) merged[merged.length - 1][1] = r[1]; else merged.push(r); }
  const dur = pcm.length / sampleRate;
  return merged.map(([a, b]) => [Math.max(0, a - pad), Math.min(dur, b + pad)]);
}

/* 按台词长度对齐切段:先找出所有语音片段(被 ≥ minGap 的静音隔开),再用动态规划选 N-1 个间隙做边界,
 * 让每段时长最接近"按字数估算的时长"(语速用整条母带自校准)。比单纯数静音段稳:句内换气、句间没停顿都能兜住。
 * 返回 { regs: [[起,止]], quality: 最差一段的相对误差, rate: 秒/字 } */
export function alignRegions(pcm, sampleRate, expectedChars, { minGap = 0.22, threshRatio = 0.06, pad = 0.18 } = {}) {
  const n = expectedChars.length;
  const frame = Math.round(sampleRate * 0.02);
  const total = Math.floor(pcm.length / frame);
  const rms = new Float64Array(total); let peak = 0;
  for (let i = 0; i < total; i++) { let acc = 0; const o = i * frame; for (let j = 0; j < frame; j++) { const v = pcm[o + j]; acc += v * v; } rms[i] = Math.sqrt(acc / frame); if (rms[i] > peak) peak = rms[i]; }
  const th = peak * threshRatio; const minGapF = Math.round(minGap / 0.02);
  /* 语音片段:短于 minGap 的静音并入片段 */
  const spans = []; let start = null, sil = 0;
  for (let i = 0; i < total; i++) {
    if (rms[i] > th) { if (start === null) start = i; sil = 0; }
    else if (start !== null) { sil++; if (sil >= minGapF) { spans.push([start * 0.02, (i - sil + 1) * 0.02]); start = null; sil = 0; } }
  }
  if (start !== null) spans.push([start * 0.02, total * 0.02]);
  const S = spans.length;
  if (!S || n === 0) return { regs: [], quality: Infinity, rate: 0, spans: S };
  if (n === 1) return { regs: [[Math.max(0, spans[0][0] - pad), Math.min(pcm.length / sampleRate, spans[S - 1][1] + pad)]], quality: 0, rate: 0, spans: S };
  if (S < n) return { regs: [], quality: Infinity, rate: 0, spans: S };
  const speech = spans.reduce((a, [x, y]) => a + (y - x), 0);
  const chars = expectedChars.reduce((a, c) => a + Math.max(1, c), 0);
  const rate = speech / chars;                                   // 秒/字,整条母带自校准
  const exp = expectedChars.map(c => Math.max(1, c) * rate);
  const cost = (i, a, b) => { const d = spans[b][1] - spans[a][0]; const e = exp[i]; return (d - e) * (d - e) / (e + 0.5); };
  /* dp[i][b]:前 i+1 句用掉片段 0..b 的最小代价 */
  const INF = 1e18; const dp = Array.from({ length: n }, () => new Float64Array(S).fill(INF)); const from = Array.from({ length: n }, () => new Int32Array(S).fill(-1));
  for (let b = 0; b < S; b++) dp[0][b] = cost(0, 0, b);
  for (let i = 1; i < n; i++) for (let b = i; b < S; b++) { let best = INF, arg = -1; for (let a = i; a <= b; a++) { const v = dp[i - 1][a - 1] + cost(i, a, b); if (v < best) { best = v; arg = a; } } dp[i][b] = best; from[i][b] = arg; }
  const regs = new Array(n); let b = S - 1, quality = 0;
  for (let i = n - 1; i >= 0; i--) {
    const a = i === 0 ? 0 : from[i][b];
    const d = spans[b][1] - spans[a][0]; quality = Math.max(quality, Math.abs(d - exp[i]) / (exp[i] + 0.5));
    regs[i] = [Math.max(0, spans[a][0] - pad), Math.min(pcm.length / sampleRate, spans[b][1] + pad)];
    b = a - 1;
  }
  return { regs, quality, rate, spans: S };
}

export function slicePcm(pcm, sampleRate, fromSec, toSec) {
  return pcm.subarray(Math.max(0, Math.round(fromSec * sampleRate)), Math.min(pcm.length, Math.round(toSec * sampleRate)));
}

/* 线性重采样 */
export function resampleMono(pcm, from, to) {
  if (from === to) return pcm;
  const n = Math.round(pcm.length * to / from);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * from / to; const j = Math.floor(x); const f = x - j;
    const a = pcm[Math.min(j, pcm.length - 1)], b = pcm[Math.min(j + 1, pcm.length - 1)];
    out[i] = Math.round(a + (b - a) * f);
  }
  return out;
}

/* 打断让位包络:0‒700ms 全音量,→1250ms 降到 0.12,→1750ms 归零 */
export function duckGain(msSinceCut) {
  if (msSinceCut < T.cutHold) return 1;
  if (msSinceCut < 1250) return 1 - (msSinceCut - T.cutHold) / (1250 - T.cutHold) * 0.88;
  if (msSinceCut < T.cutFade) return 0.12 * (1 - (msSinceCut - 1250) / (T.cutFade - 1250));
  return 0;
}

/**
 * 混音:Channel 1 = 用户 + 第三方,Channel 2 = 助手。
 * schedule 来自 shared/schedule.js;clips 只接受 wav。
 */
export async function mixSchedule(schedule, audioDir, manifest, { sampleRate = 24000, includeAmbience = false } = {}) {
  const totalFrames = Math.ceil(schedule.total_ms / 1000 * sampleRate) + sampleRate;
  const left = new Float32Array(totalFrames), right = new Float32Array(totalFrames);
  const skipped = [], placed = [];
  for (const u of schedule.utterances) {
    if (u.typed || !u.clip) continue;
    const entry = manifest?.clips?.[u.clip];
    if (!entry || !/\.wav$/i.test(entry.file)) { skipped.push({ id: u.id, clip: u.clip, reason: entry ? '非 WAV 片段(请在浏览器端导出混音)' : '缺少音频' }); continue; }
    let wav;
    try { wav = parseWav(await fs.readFile(path.join(audioDir, entry.file))); } catch (e) { skipped.push({ id: u.id, clip: u.clip, reason: e.message }); continue; }
    const mono = resampleMono(toMono(wav.pcm, wav.channels), wav.sampleRate, sampleRate);
    const target = u.role === 'assistant' ? right : left;
    const startF = Math.round(u.start / 1000 * sampleRate);
    const cutF = u.cut ? Math.round((u.cut_at_ms - u.start) / 1000 * sampleRate) : Infinity;
    for (let i = 0; i < mono.length && startF + i < totalFrames; i++) {
      let g = 1;
      if (i >= cutF) { g = duckGain((i - cutF) / sampleRate * 1000); if (g <= 0) break; }
      target[startF + i] += mono[i] / 32768 * g;
    }
    placed.push(u.id);
  }
  const samples = new Int16Array(totalFrames * 2);
  for (let i = 0; i < totalFrames; i++) {
    samples[i * 2] = Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767)));
    samples[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767)));
  }
  return { wav: writeWav({ sampleRate, channels: 2, samples }), placed, skipped, duration_ms: Math.round(totalFrames / sampleRate * 1000) };
}
