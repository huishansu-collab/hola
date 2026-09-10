import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { safePath, buildRuntime, type CasePackage } from './index.ts';
import { base64, unbase64, decodeWav } from './audio.ts';
import type { Scenario } from '../../app/page';

export type ArchiveAudio = {
  src: string;
  start: number;
  duration: number;
  peaks: number[];
  sourceStart?: number;
  sourceEnd?: number;
  source?: string;
};
export type CaseSnapshot = {
  format: 'interaction-case-snapshot/1';
  id: string;
  title: string;
  scenario: Scenario;
  audio: Record<string, ArchiveAudio>;
};
const MAX = 256 * 1024 * 1024;
export function readZip(bytes: Uint8Array) {
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter(entry) {
      if (
        ++count > 1000 ||
        !safePath(entry.name.replace(/\/$/, '')) ||
        (total += entry.originalSize) > MAX
      )
        throw Error('ZIP 路径或解压大小不符合要求');
      return !entry.name.endsWith('/');
    },
  });
  if (Object.values(files).reduce((n, b) => n + b.length, 0) > MAX)
    throw Error('ZIP 解压后不能超过 256 MB');
  return files;
}
export function writeZip(files: Record<string, Uint8Array>) {
  return zipSync(files, { level: 1 });
}
export const jsonBytes = (value: unknown) =>
  strToU8(JSON.stringify(value, null, 2) + '\n');
export function readJson(files: Record<string, Uint8Array>, name: string) {
  if (!safePath(name) || !files[name]) throw Error(`Case 包缺少 ${name}`);
  try {
    return JSON.parse(strFromU8(files[name]));
  } catch {
    throw Error(`${name} 不是有效的 JSON`);
  }
}
export function sourceFiles(pack: CasePackage, prefix = 'source/') {
  const out: Record<string, Uint8Array> = {};
  out[prefix + 'manifest.json'] = jsonBytes(pack.manifest);
  for (const [key, value] of Object.entries({
    case: pack.case,
    timeline: pack.timeline,
    alignment: pack.alignment,
  })) {
    const p = pack.manifest.files[key];
    if (!safePath(p)) throw Error('非法源文件路径');
    out[prefix + p] = jsonBytes(value);
  }
  for (const [p, value] of Object.entries({
    ...pack.attachments,
    ...pack.sources,
  })) {
    if (!safePath(p)) throw Error('非法源文件路径');
    out[prefix + p] = unbase64(value);
  }
  return out;
}
export function sourcePackage(
  files: Record<string, Uint8Array>,
  prefix = '',
): CasePackage {
  const manifest = readJson(files, prefix + 'manifest.json');
  const get = (key: string) => readJson(files, prefix + manifest.files[key]);
  const alignment = get('alignment');
  const sources: Record<string, string> = {},
    attachments: Record<string, string> = {};
  for (const c of alignment.clips) {
    if (!safePath(c.source) || !files[prefix + c.source])
      throw Error('源音频缺失');
    sources[c.source] = base64(files[prefix + c.source]);
  }
  const core = new Set([
    'manifest.json',
    manifest.files.case,
    manifest.files.timeline,
    manifest.files.alignment,
    ...Object.keys(sources),
  ]);
  for (const [p, b] of Object.entries(files))
    if (p.startsWith(prefix) && !core.has(p.slice(prefix.length)))
      attachments[p.slice(prefix.length)] = base64(b);
  const pack = {
    format: 'interaction-case/1' as const,
    manifest,
    case: get('case'),
    timeline: get('timeline'),
    alignment,
    sources,
    attachments,
  };
  buildRuntime(pack);
  return pack;
}
export function validateSnapshot(value: CaseSnapshot) {
  const fail = (message: string): never => {
    throw Error('Case ZIP 无效：' + message);
  };
  if (
    value?.format !== 'interaction-case-snapshot/1' ||
    !/^[-a-z0-9]+$/.test(value.id) ||
    typeof value.title !== 'string' ||
    !value.title.trim()
  )
    fail('名称或版本错误');
  const s = value.scenario;
  if (!s || !Number.isFinite(s.END) || s.END <= 0 || !Number.isSafeInteger(s.END))
    fail('时长错误');
  for (const key of [
    'tracks',
    'events',
    'expressions',
    'utterances',
    'inputEvents',
    'playableClips',
  ] as const)
    if (!Array.isArray(s[key])) fail(key + ' 缺失');
  const expected = [
    '用户',
    '用户控制',
    '助手',
    '表达控制',
    '世界',
    '后台判断',
    '工具调用',
  ];
  if (
    s.tracks.length !== 7 ||
    s.tracks.some(
      (t, i) =>
        t.name !== expected[i] ||
        !Array.isArray(t.clips) ||
        typeof t.color !== 'string',
    )
  )
    fail('轨道结构错误');
  const range = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a && b <= s.END;
  for (const t of s.tracks)
    for (const c of t.clips)
      if (
        !range(c.a, c.b) ||
        typeof c.label !== 'string' ||
        (c.lane !== undefined &&
          (!Number.isInteger(c.lane) || c.lane < 0 || c.lane > 30))
      )
        fail('片段时间或内容错误');
  for (const t of s.tracks) for (const c of t.clips) {
    if (c.outputMode === 'text' && (t.name !== '助手' || c.audioKey || c.wave || !c.messageId)) fail('文字片段不能带音频或波形，且必须关联消息');
  }
  const ids = new Set<string>();
  for (const u of s.utterances) {
    if (
      typeof u.id !== 'string' ||
      ids.has(u.id) ||
      !['user', 'assistant', 'third_party'].includes(u.speaker) ||
      typeof u.text !== 'string' ||
      !range(u.start_at_ms, u.end_at_ms)
    )
      fail('对白错误');
    ids.add(u.id);
  }
  for (const e of s.inputEvents)
    if (
      typeof e.event_id !== 'string' ||
      typeof e.event_type !== 'string' ||
      !Number.isFinite(e.time_at_ms) ||
      e.time_at_ms < 0 ||
      e.time_at_ms > s.END
    )
      fail('事件错误');
  for (const key of [
    'fdx_annotation',
    'emotion_annotation',
    'paralinguistic_annotation',
    'custom_annotation',
  ] as const)
    if (!Array.isArray(s.controlAnnotations?.[key])) fail('标注缺失');
  if (!value.audio || typeof value.audio !== 'object') fail('音频缺失');
  for (const [key, a] of Object.entries(value.audio)) {
    if (
      !key ||
      typeof a.src !== 'string' ||
      !a.src.startsWith('data:audio/wav;base64,') ||
      !Number.isFinite(a.start) ||
      a.start < 0 ||
      !Number.isFinite(a.duration) ||
      a.duration <= 0 ||
      !Array.isArray(a.peaks) ||
      a.peaks.some((p) => !Number.isFinite(p))
    )
      fail('音频格式错误');
    const wav = decodeWav(unbase64(a.src.slice(a.src.indexOf(',') + 1)), true);
    if (a.start + a.duration > wav.samples.length / wav.rate + 0.002)
      fail('音频截取超出源文件');
  }
  for (const c of [
    ...s.playableClips,
    ...s.tracks.flatMap((t) => t.clips).filter((c) => c.audioKey),
  ]) {
    if (
      !range(c.a, c.b) ||
      !c.audioKey ||
      !Object.hasOwn(value.audio, c.audioKey)
    )
      fail('播放音频引用缺失');
    if (
      c.fadeMs !== undefined &&
      (!Number.isFinite(c.fadeMs) || c.fadeMs < 0 || c.fadeMs > c.b - c.a)
    )
      fail('淡出时间错误');
    if (
      c.gainPoints &&
      (!Array.isArray(c.gainPoints) ||
        c.gainPoints.some(
          (p) =>
            !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite),
        ))
    )
      fail('音量控制错误');
  }
  for(const c of s.playableClips)if(c.audioEnd!==undefined&&(!Number.isFinite(c.audioEnd)||c.audioEnd<=c.a||c.audioEnd>c.b))fail('实际音频结束时间错误');
  return value;
}
export function snapshotFiles(snapshot: CaseSnapshot) {
  validateSnapshot(snapshot);
  const out: Record<string, Uint8Array> = {};
  const audio: Record<string, unknown> = {};
  Object.entries(snapshot.audio).forEach(([key, a], i) => {
    const path = `audio/clips/${String(i + 1).padStart(3, '0')}.wav`;
    out[path] = unbase64(a.src.split(',')[1]);
    const { src, ...meta } = a;
    audio[key] = { ...meta, file: path };
  });
  out['timeline.json'] = jsonBytes(snapshot.scenario);
  out['audio/index.json'] = jsonBytes(audio);
  out['manifest.json'] = jsonBytes({
    format: snapshot.format,
    case_id: snapshot.id,
    title: snapshot.title,
    files: {
      case: 'case.json',
      timeline: 'timeline.json',
      audio: 'audio/index.json',
      brief: 'README.md',
      script: 'script.md',
    },
  });
  return out;
}
export function snapshotFromFiles(
  files: Record<string, Uint8Array>,
): CaseSnapshot {
  const m = readJson(files, 'manifest.json');
  if (m.format !== 'interaction-case-snapshot/1')
    throw Error('不支持的 Case ZIP 版本');
  const audio = readJson(files, m.files.audio);
  for (const a of Object.values(audio) as any[]) {
    if (!safePath(a.file) || !files[a.file]) throw Error('音频文件缺失');
    a.src = 'data:audio/wav;base64,' + base64(files[a.file]);
    delete a.file;
  }
  return validateSnapshot({
    format: m.format,
    id: m.case_id,
    title: m.title,
    scenario: readJson(files, m.files.timeline),
    audio,
  });
}
