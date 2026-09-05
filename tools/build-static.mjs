#!/usr/bin/env node
/*
 * tools/build-static.mjs — 把工作台打成单文件静态页(在线演示用):
 *   dist/duplex-demo.html           完整可双击打开的页面
 *   dist/duplex-demo.artifact.html  不含 <html>/<head>/<body> 的片段(发布到 Artifact 用)
 *
 * 做法:shared/* + engine.js + app.js 按依赖顺序打成一个脚本;音频 / 图标 / 字体 / 背景内联为 data URI;
 * 页面内用 fetch 拦截层实现 api、case 音频与音效路由,所以三个页签都能用。
 * 保存 / 语音生成 / 服务端混音这些需要后端的功能在静态页里隐藏并返回明确提示。
 *
 * 用法:node tools/build-static.mjs [--cases commute,morning] [--no-ambience]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultTemplate } from '../server/cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
const onlyCases = flag('cases') ? String(flag('cases')).split(',') : null;
const noAmbience = !!flag('no-ambience');

const MIME = { '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const read = (p) => fs.readFile(path.join(ROOT, p), 'utf8');
const dataUri = async (p) => { const buf = await fs.readFile(path.join(ROOT, p)); return `data:${MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'};base64,${buf.toString('base64')}`; };

/* ---------- 模块打包:ESM → 同一作用域下的 IIFE 表 ---------- */
const modName = (spec) => path.basename(spec).replace(/\.js$/, '');
function transformModule(src, name) {
  const exportsList = [];
  src = src.replace(/^import\s+([^;]+?)\s+from\s+'([^']+)';?\s*$/gm, (m, what, from) => {
    const names = what.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\s+as\s+/, ': '));
    return `const { ${names.join(', ')} } = __mods.${modName(from)};`;
  });
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kw, nm) => { exportsList.push(nm); return `${kw} ${nm}`; });
  src = src.replace(/^export\s*\{([^}]+)\};?\s*$/gm, (m, list) => { list.split(',').map(s => s.trim()).filter(Boolean).forEach(n => exportsList.push(n)); return ''; });
  return `__mods.${name} = (() => {\n${src}\nreturn { ${[...new Set(exportsList)].join(', ')} };\n})();`;
}

async function main() {
  const casesDir = path.join(ROOT, 'cases');
  const ids = (await fs.readdir(casesDir, { withFileTypes: true })).filter(d => d.isDirectory() && !d.name.startsWith('zz-')).map(d => d.name).filter(id => !onlyCases || onlyCases.includes(id));
  const cases = {};
  let audioBytes = 0;
  for (const id of ids) {
    const dir = path.join(casesDir, id);
    let script; try { script = JSON.parse(await fs.readFile(path.join(dir, 'script.json'), 'utf8')); } catch { continue; }
    const dsl = await fs.readFile(path.join(dir, 'script.dsl'), 'utf8').catch(() => null);
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'audio', 'manifest.json'), 'utf8').catch(() => '{"clips":{}}'));
    const audio = {};
    for (const [clip, entry] of Object.entries(manifest.clips || {})) {
      if (!entry.file) continue;
      if (noAmbience && /^scene_/.test(clip)) { delete manifest.clips[clip]; continue; }
      const buf = await fs.readFile(path.join(dir, 'audio', entry.file)).catch(() => null);
      if (!buf) { delete manifest.clips[clip]; continue; }
      audio[entry.file] = { mime: MIME[path.extname(entry.file).toLowerCase()] || 'application/octet-stream', b64: buf.toString('base64') };
      audioBytes += buf.length;
    }
    cases[id] = { id, script, dsl, manifest, audio };
    console.log(`case ${id.padEnd(10)} ${Object.keys(audio).length} clips`);
  }
  const fx = {};
  for (const n of ['ding', 'ring', 'buzz', 'amb_loop']) { const buf = await fs.readFile(path.join(ROOT, 'public/assets/fx', n + '.wav')); fx[n + '.wav'] = { mime: 'audio/wav', b64: buf.toString('base64') }; }
  const icons = {};
  for (const f of await fs.readdir(path.join(ROOT, 'public/assets/icons'))) if (f.endsWith('.png')) icons[f.replace(/\.png$/, '')] = await dataUri('public/assets/icons/' + f);
  const font = await dataUri('public/assets/fonts/SFRailTime-Black.ttf');
  const gradient = await dataUri('public/assets/img/gradient.jpg');

  /* CSS / HTML:资源路径 → data URI */
  let css = await read('public/css/platform.css');
  css = css.replace("url('/assets/fonts/SFRailTime-Black.ttf')", `url('${font}')`).replace("url('/assets/img/gradient.jpg')", `url('${gradient}')`);
  let html = await read('public/index.html');
  html = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  html = html.replace(/<script[^>]*src="\/js\/app\.js"[^>]*><\/script>/, '');
  html = html.replace(/src="\/assets\/icons\/([\w-]+)\.png"/g, (m, n) => `src="${icons[n] || m}"`);
  html = html.replace('<div class="tagline editorial">', '<div class="tagline editorial static-note" style="color:rgb(232,178,132)">在线演示版 · 可播放全部 case、改剧本解析预览、查看规范化 JSON、在「脚本 · 语音」页用自己的 OpenAI key 直接生成语音(Artifact 版除外);保存与母带混音需本地运行仓库</div><div class="tagline editorial">');

  /* 脚本 */
  const order = [['shared/script.js', 'script'], ['shared/tts.js', 'tts'], ['shared/tracks.js', 'tracks'], ['shared/schedule.js', 'schedule'], ['shared/normalize.js', 'normalize'], ['shared/dsl.js', 'dsl'], ['public/js/engine.js', 'engine'], ['public/js/app.js', 'app']];
  const bundle = ['const __mods = {};'];
  for (const [file, name] of order) bundle.push(transformModule(await read(file), name));

  const shim = `
/* ---------- 静态页的 fetch 拦截层:用内嵌数据实现服务端路由 ---------- */
window.__ASSETS__ = { icons: __ASSET_ICONS };
document.body.classList.add('static');
const __realFetch = window.fetch.bind(window);
const __json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const __bytes = (entry) => { const bin = atob(entry.b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Response(u8, { headers: { 'Content-Type': entry.mime } }); };
const __durations = (m) => { const o = {}; for (const [k, v] of Object.entries(m.clips || {})) if (v.duration_ms) o[k] = v.duration_ms; return o; };
const __STATIC_MSG = '在线演示是静态页面,不能保存 / 生成语音;克隆仓库本地 npm start 即可';
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  const method = (init.method || 'GET').toUpperCase();
  const u = new URL(url, location.href);
  const p = u.pathname;
  const { validateScript, normalizeScript } = __mods.script;
  const { schedule } = __mods.schedule;
  const { buildNormalized } = __mods.normalize;
  const { parseDSL, scriptToDSL } = __mods.dsl;
  let m;
  if (p === '/api/status') return __json({ ok: true, openai: false, model: 'gpt-4o-mini-tts', base_url: '', proxy_hint: false, voices: [], static: true, browser_tts: true });
  if (p === '/api/cases' && method === 'GET') {
    const list = Object.values(__DATA.cases).map(c => { const s = normalizeScript(c.script); const clips = s.timeline.filter(x => x.type === 'say' && x.clip).map(x => x.clip); return { id: c.id, name: s.name, case_id: s.case_id, group: s.group || null, order: s.order ?? 999, summary: s.summary || '', has_dsl: !!c.dsl, utterances: clips.length, audio_ready: clips.filter(k => c.manifest.clips?.[k]?.file).length, scene: s.scene?.title || null }; });
    list.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
    return __json(list);
  }
  if (p === '/api/cases' && method === 'POST') return __json({ error: __STATIC_MSG }, 405);
  if (p === '/api/parse') { const r = parseDSL(JSON.parse(init.body || '{}').dsl || ''); const v = validateScript(r.script); return __json({ script: r.script, normalized_script: v.script, warnings: [...r.warnings, ...v.warnings], errors: v.errors }); }
  if (p === '/api/validate') { const v = validateScript(JSON.parse(init.body || '{}').script || {}); return __json({ errors: v.errors, warnings: v.warnings }); }
  if (p === '/api/template') return new Response(__TEMPLATE, { headers: { 'Content-Type': 'text/plain' } });
  if ((m = p.match(/^\\/api\\/cases\\/([\\w-]+)(?:\\/(.*))?$/))) {
    const c = __DATA.cases[m[1]]; if (!c) return __json({ error: 'case 不存在' }, 404);
    const sub = m[2] || '';
    if (!sub && method === 'GET') { const v = validateScript(c.script); return __json({ id: c.id, script: c.script, dsl: c.dsl, manifest: c.manifest, durations: __durations(c.manifest), normalized_script: v.script, validation: { errors: v.errors, warnings: v.warnings }, dsl_view: c.dsl || scriptToDSL(c.script) }); }
    if (!sub) return __json({ error: __STATIC_MSG }, 405);
    if (sub.startsWith('clips/')) return __json({ error: '静态页不写回文件;片段已缓存在本机' }, 405);
    if (sub === 'normalized.json') return __json(buildNormalized(c.script, __durations(c.manifest)).json);
    if (sub === 'schedule') return __json(schedule(normalizeScript(c.script), __durations(c.manifest)));
    if (sub === 'tts') return new Response('event: fatal\\ndata: ' + JSON.stringify({ error: __STATIC_MSG }) + '\\n\\n', { headers: { 'Content-Type': 'text/event-stream' } });
    if (sub === 'mix.wav') return __json({ error: __STATIC_MSG }, 405);
  }
  if ((m = p.match(/^\\/cases\\/([\\w-]+)\\/audio\\/(.+)$/))) { const e = __DATA.cases[m[1]]?.audio?.[decodeURIComponent(m[2])]; return e ? __bytes(e) : new Response('', { status: 404 }); }
  if ((m = p.match(/^\\/assets\\/fx\\/(.+)$/))) { const e = __DATA.fx[m[1]]; return e ? __bytes(e) : new Response('', { status: 404 }); }
  return __realFetch(input, init);
};
`;
  const safe = (s) => s.replace(/<\//g, '<\\/');
  const scripts = `<script>\nconst __DATA = ${safe(JSON.stringify({ cases, fx }))};\nconst __ASSET_ICONS = ${safe(JSON.stringify(icons))};\nconst __TEMPLATE = ${safe(JSON.stringify(defaultTemplate('my-case', '我的 case')))};\n</script>\n<script>\n${safe(bundle.slice(0, 1).join('\n'))}\n${shim}\n${safe(bundle.slice(1).join('\n'))}\n</script>`;

  const title = 'Duplex Studio';
  const fragment = `<title>${title}</title>\n<style>\n${css}\n</style>\n${html}\n${scripts}\n`;
  const full = `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<link rel="icon" href="data:,">\n${fragment.replace(/\n(<div class="page">[\s\S]*)$/, '\n</head>\n<body>\n$1')}\n</body>\n</html>\n`;
  await fs.mkdir(path.join(ROOT, 'dist'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'dist/duplex-demo.html'), full);
  await fs.writeFile(path.join(ROOT, 'dist/duplex-demo.artifact.html'), fragment);
  console.log(`→ dist/duplex-demo.html (${(full.length / 1048576).toFixed(2)} MB, 音频原始 ${(audioBytes / 1048576).toFixed(2)} MB, ${ids.length} cases)`);
  console.log('→ dist/duplex-demo.artifact.html');
}
main().catch(e => { console.error(e); process.exit(1); });
