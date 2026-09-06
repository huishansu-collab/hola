/*
 * server/index.js — 全双工 demo 平台服务端(Express)。
 *   静态:/ → public,/shared → shared(浏览器直接 import),/cases/<id>/audio/* → 音频
 *   API :见下方路由
 */
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, CASES_DIR, listCases, loadCase, saveCase, createCase, audioDir, refreshManifest, clipDurations, defaultTemplate } from './cases.js';
import { generateCaseAudio, ttsConfig, configuredProviders, TTS_VOICES, saveClip } from './tts.js';
import { mixSchedule } from './audio.js';
import { parseDSL, scriptToDSL } from '../shared/dsl.js';
import { validateScript, normalizeScript } from '../shared/script.js';
import { schedule } from '../shared/schedule.js';
import { buildNormalized, checkNormalized } from '../shared/normalize.js';

/* .env(不依赖 dotenv) */
try { if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* Node < 20.12 */ }

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/cases', express.static(CASES_DIR, { index: false, extensions: [] }));
app.use(express.static(path.join(ROOT, 'public')));

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/status', (req, res) => {
  const cfg = ttsConfig();
  res.json({ ok: true, openai: !!process.env.OPENAI_API_KEY, qwen: !!process.env.DASHSCOPE_API_KEY, providers: configuredProviders(), provider: cfg.provider, model: cfg.model, base_url: cfg.baseUrl, proxy_hint: cfg.proxyHint, voices: TTS_VOICES, node: process.version, browser_tts: true, static: false });
});

/* 浏览器直连 OpenAI 生成的片段写回 case(body = wav) */
app.put('/api/cases/:id/clips/:clip', express.raw({ type: ['audio/wav', 'audio/wave', 'audio/x-wav', 'application/octet-stream'], limit: '60mb' }), wrap(async (req, res) => {
  const { id, clip } = req.params;
  if (!/^[\w-]{1,80}$/.test(clip)) return res.status(400).json({ error: '非法的 clip 名' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: '缺少 wav 数据(Content-Type: audio/wav)' });
  await loadCase(id);
  let entry;
  try {
    entry = await saveClip(id, clip, req.body, { hash: req.get('X-Clip-Hash') || null, source: req.get('X-Clip-Source') || 'browser', text: req.get('X-Clip-Text') ? decodeURIComponent(req.get('X-Clip-Text')) : undefined });
  } catch (e) { return res.status(400).json({ error: e.message }); }
  res.json({ ok: true, clip, entry });
}));

app.get('/api/cases', wrap(async (req, res) => res.json(await listCases())));

app.get('/api/cases/:id', wrap(async (req, res) => {
  const c = await loadCase(req.params.id);
  const v = validateScript(c.script);
  res.json({ ...c, normalized_script: v.script, validation: { errors: v.errors, warnings: v.warnings }, dsl_view: c.dsl || scriptToDSL(c.script) });
}));

app.post('/api/cases', wrap(async (req, res) => {
  const { id, name, template } = req.body || {};
  if (!id) return res.status(400).json({ error: '缺少 id' });
  const r = await createCase(id, { name, template });
  res.json({ id, ...r });
}));

app.put('/api/cases/:id', wrap(async (req, res) => {
  const { script, dsl } = req.body || {};
  if (dsl != null) {
    const r = parseDSL(dsl);
    const v = validateScript(r.script);
    if (v.errors.length) return res.status(422).json({ error: '脚本校验失败', errors: v.errors, warnings: [...r.warnings, ...v.warnings], script: r.script });
    const saved = await saveCase(req.params.id, { dsl, script: r.script });
    return res.json({ ...saved, warnings: [...r.warnings, ...v.warnings], errors: [] });
  }
  if (script) {
    const v = validateScript(script);
    if (v.errors.length) return res.status(422).json({ error: '脚本校验失败', errors: v.errors, warnings: v.warnings });
    const saved = await saveCase(req.params.id, { script });
    return res.json({ ...saved, warnings: v.warnings, errors: [] });
  }
  res.status(400).json({ error: '需要 script 或 dsl' });
}));

app.post('/api/parse', (req, res) => {
  const { dsl } = req.body || {};
  const r = parseDSL(dsl || '');
  const v = validateScript(r.script);
  res.json({ script: r.script, normalized_script: v.script, warnings: [...r.warnings, ...v.warnings], errors: v.errors });
});

app.post('/api/validate', (req, res) => {
  const v = validateScript(req.body?.script || {});
  res.json({ errors: v.errors, warnings: v.warnings });
});

app.get('/api/template', (req, res) => res.type('text/plain').send(defaultTemplate(req.query.id || 'new-case', req.query.name)));

/* 语音生成:SSE 进度流 */
app.post('/api/cases/:id/tts', wrap(async (req, res) => {
  const { force = false, only = null, provider = null, model = null } = req.body || {};
  const c = await loadCase(req.params.id);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  try {
    const r = await generateCaseAudio(req.params.id, c.script, { force, only, provider, model, signal: ac.signal, onProgress: p => send('progress', p) });
    const manifest = await refreshManifest(req.params.id, c.script);
    send('done', { ...r, manifest, durations: clipDurations(manifest) });
  } catch (e) {
    send('fatal', { error: e.message });
  }
  res.end();
}));

app.get('/api/cases/:id/schedule', wrap(async (req, res) => {
  const c = await loadCase(req.params.id);
  res.json(schedule(normalizeScript(c.script), c.durations));
}));

app.get('/api/cases/:id/normalized.json', wrap(async (req, res) => {
  const c = await loadCase(req.params.id);
  const { json } = buildNormalized(c.script, c.durations, { sample_id: req.query.sample_id });
  const issues = checkNormalized(json);
  if (req.query.download) res.attachment(`${json.meta_data.sample.case_id}_${json.meta_data.sample.sample_id}.json`);
  res.set('X-Normalized-Issues', String(issues.length));
  res.json(json);
}));

app.get('/api/cases/:id/mix.wav', wrap(async (req, res) => {
  const c = await loadCase(req.params.id);
  const s = normalizeScript(c.script);
  const sch = schedule(s, c.durations);
  const mix = await mixSchedule(sch, audioDir(req.params.id), c.manifest);
  res.set('X-Mix-Skipped', encodeURIComponent(JSON.stringify(mix.skipped)));
  res.attachment(`${s.case_id}_${s.sample_id}.wav`).type('audio/wav').send(mix.wav);
}));

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message });
});

const PORT = +(process.env.PORT || 5173);
app.listen(PORT, () => {
  const cfg = ttsConfig();
  console.log(`duplex demo platform → http://localhost:${PORT}`);
  const have = configuredProviders();
  console.log(`云端 TTS: ${have.length ? '已配置 ' + have.join(' + ') + ',默认 ' + cfg.name + ' (' + cfg.model + ')' : '未配置 — 在 .env 里设置 OPENAI_API_KEY 或 DASHSCOPE_API_KEY 后可生成语音'}`);
  if (cfg.proxyHint) console.log('提示:检测到 HTTPS_PROXY,Node fetch 需要 NODE_USE_ENV_PROXY=1 才会走代理');
});
