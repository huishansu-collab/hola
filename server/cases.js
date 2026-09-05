/*
 * server/cases.js — case 存储:cases/<id>/{script.json, script.dsl, audio/*, audio/manifest.json}
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';
import { parseDSL } from '../shared/dsl.js';
import { normalizeScript } from '../shared/script.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CASES_DIR = path.join(ROOT, 'cases');
export const AUDIO_EXTS = ['.wav', '.m4a', '.mp3', '.ogg', '.opus', '.aac', '.flac'];

export function caseDir(id) {
  if (!/^[\w-]{1,64}$/.test(id)) throw new Error('非法的 case id:' + id);
  return path.join(CASES_DIR, id);
}
export function audioDir(id) { return path.join(caseDir(id), 'audio'); }

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function readText(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return null; }
}

export async function listCases() {
  await fs.mkdir(CASES_DIR, { recursive: true });
  const ids = (await fs.readdir(CASES_DIR, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
  const out = [];
  for (const id of ids) {
    const script = await readJson(path.join(caseDir(id), 'script.json'));
    if (!script) continue;
    let manifest;
    try { manifest = await refreshManifest(id, script); } catch { manifest = await readJson(path.join(audioDir(id), 'manifest.json'), { clips: {} }); }
    const s = normalizeScript(script);
    const clips = s.timeline.filter(x => x.type === 'say' && x.clip).map(x => x.clip);
    const ready = clips.filter(c => manifest.clips?.[c]?.file).length;
    out.push({
      id, name: s.name, case_id: s.case_id, group: s.group || null, order: s.order ?? 999, summary: s.summary || '',
      has_dsl: existsSync(path.join(caseDir(id), 'script.dsl')),
      utterances: clips.length, audio_ready: ready, scene: s.scene?.title || null,
    });
  }
  out.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  return out;
}

export async function loadCase(id) {
  const dir = caseDir(id);
  const script = await readJson(path.join(dir, 'script.json'));
  if (!script) throw Object.assign(new Error('case 不存在:' + id), { status: 404 });
  const dsl = await readText(path.join(dir, 'script.dsl'));
  const manifest = await refreshManifest(id, script);
  return { id, script, dsl, manifest, durations: clipDurations(manifest) };
}

/* 保存:给 dsl 则编译并同时写 script.json;给 script 则只写 json(并删掉过期的 dsl?) — 保留 dsl 由调用方决定 */
export async function saveCase(id, { script, dsl } = {}) {
  const dir = caseDir(id);
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
  let warnings = [];
  if (dsl != null) {
    const r = parseDSL(dsl);
    warnings = r.warnings;
    script = script || r.script;
    if (!script.id) script.id = id;
    await fs.writeFile(path.join(dir, 'script.dsl'), dsl, 'utf8');
  }
  if (!script) throw new Error('需要 script 或 dsl');
  script.id = id;
  await fs.writeFile(path.join(dir, 'script.json'), JSON.stringify(script, null, 2) + '\n', 'utf8');
  return { script, warnings };
}

export async function createCase(id, { name, template } = {}) {
  const dir = caseDir(id);
  if (existsSync(path.join(dir, 'script.json'))) throw Object.assign(new Error('case 已存在:' + id), { status: 409 });
  await fs.mkdir(path.join(dir, 'audio'), { recursive: true });
  const dsl = template || defaultTemplate(id, name);
  return saveCase(id, { dsl });
}

export function defaultTemplate(id, name) {
  return `# ${name || id}
id: ${id}
case_id: ${id}
group: 新建
summary: 一句话概括这个 case 的看点
scene: 场景描述｜什么地方、什么时候、用户在干什么
clock: 09:41:00

## 段1｜09:41:00‒09:41:30｜开场
剧情：用户摸一下 living edge，问一个问题。
@edge touch
[09:41:00.0] 助手: 我在，你说。
[09:41:02.0‒09:41:05.0] 用户: 今天出门要带伞么？
  【语音·用户】对谁说的｜对助手说；话语类型｜指令；情绪｜平静；这句之后的停顿｜点名要你答
[09:41:05.4] 助手: 嗯——稍等哈，我帮你看一眼今天的天气。
  【语音·助手】助手句性质｜回执（承接·简短）
  【任务】任务类型｜查天气（查一下再答（快））：weather.query(本地,当日)→结果 下午有阵雨·26°（耗时 2.4s）
  【决策点】该不该开口｜开口；开多大｜一句话；多快回｜马上；依据｜被叫到了
[09:41:09.0] 助手: 今天下午两点之后有阵雨，出门建议带把伞。现在气温二十六度，湿度有点高——
  【语音·助手】助手句性质｜应答（讲解）；是否重叠｜竞争打断（被用户叠上）·完成度｜中途被断
★ [09:41:14.0] 用户（抢话，与AI语音重叠）: 还是打个车吧。
  【语音·用户】对谁说的｜对助手说；话语类型｜指令（新任务）；是否重叠｜竞争打断（叠在助手上）
  【决策点】该不该开口｜闭嘴（≤200ms收口）；打断语义｜改参数；依据｜用户在纠正；禁止｜接着说旧答案
[09:41:16.5] 助手: 好的，是去公司吧，我来帮你挑辆车。
@agent think="去公司对吧——先看看哪家车最快。" steps=[{"icon":"loc","doing":"正在确认你的位置…","done":"你在家，从这儿出发","ms":3200},{"icon":"price","doing":"正在帮你比价…","done":"比了 3 家，这辆最快——3 分钟就到，¥18","ms":6800,"tool":"ride.compare","result":"白色轿车 · 3min · ¥18"}]
[09:41:40.0] 助手: 车帮你选好了，白色轿车，三分钟能到，十八块钱，点一下打车就可以了。
@card icon=car title="Ride Ready" sub="White sedan · Plate ·· 8291" eta="3 min" meta="Home → Office|¥18" button="Book Ride"
@overlay collapse
@pill icon=car name="White Sedan" now="3 min" stops="Driver|Home|Office" progress=true
`;
}

/* ---------- 音频清单 ---------- */
export async function loadManifest(id) {
  return (await readJson(path.join(audioDir(id), 'manifest.json'), null)) || { clips: {} };
}
export async function saveManifest(id, manifest) {
  await fs.mkdir(audioDir(id), { recursive: true });
  await fs.writeFile(path.join(audioDir(id), 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

/* 扫描 audio 目录,为脚本里引用的每个 clip 找文件并算时长(按 size+mtime 缓存) */
export async function refreshManifest(id, script) {
  const dir = audioDir(id);
  await fs.mkdir(dir, { recursive: true });
  const manifest = await loadManifest(id);
  manifest.clips = manifest.clips || {};
  const s = normalizeScript(script);
  const wanted = new Set(s.timeline.filter(x => x.type === 'say' && x.clip).map(x => x.clip));
  if (s.scene?.ambience) wanted.add(s.scene.ambience.replace(/\.[^.]+$/, ''));
  const files = await fs.readdir(dir);
  const byStem = new Map();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!AUDIO_EXTS.includes(ext)) continue;
    const stem = f.slice(0, -ext.length);
    const prev = byStem.get(stem);
    if (!prev || AUDIO_EXTS.indexOf(ext) < AUDIO_EXTS.indexOf(path.extname(prev).toLowerCase())) byStem.set(stem, f);
  }
  let changed = false;
  for (const stem of wanted) {
    const file = byStem.get(stem);
    const entry = manifest.clips[stem] || {};
    if (!file) {
      if (entry.file) { delete manifest.clips[stem]; changed = true; }
      continue;
    }
    const st = await fs.stat(path.join(dir, file));
    if (entry.file === file && entry.size === st.size && entry.mtime === st.mtimeMs && entry.duration_ms) continue;
    let duration_ms = null, format = null, sample_rate = null;
    try {
      const meta = await parseFile(path.join(dir, file));
      duration_ms = Math.round((meta.format.duration || 0) * 1000);
      format = meta.format.codec || meta.format.container || path.extname(file).slice(1);
      sample_rate = meta.format.sampleRate || null;
    } catch (e) {
      duration_ms = entry.duration_ms || null;
    }
    manifest.clips[stem] = { ...entry, file, size: st.size, mtime: st.mtimeMs, duration_ms, format, sample_rate, source: entry.source || 'import' };
    changed = true;
  }
  /* 清掉脚本里已经不存在的 clip 记录 */
  for (const stem of Object.keys(manifest.clips)) if (!wanted.has(stem) && !byStem.has(stem)) { delete manifest.clips[stem]; changed = true; }
  if (changed) await saveManifest(id, manifest);
  return manifest;
}

export function clipDurations(manifest) {
  const out = {};
  for (const [k, v] of Object.entries(manifest?.clips || {})) if (v.duration_ms) out[k] = v.duration_ms;
  return out;
}
