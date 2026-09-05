/*
 * public/js/app.js — 工作台:case 选择、演示、剧本编辑、语音生成、规范化 JSON 导出。
 */
import { DemoEngine } from './engine.js';
import { normalizeScript, msToClock, TRACKS, validateScript } from '/shared/script.js';
import { schedule } from '/shared/schedule.js';
import { buildNormalized, checkNormalized } from '/shared/normalize.js';
import { scriptToDSL } from '/shared/dsl.js';
import { ttsPlan, synthesizeSpeech, wavDurationMs, TTS_MODELS } from '/shared/tts.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = { cases: [], id: null, data: null, mode: 'dsl', filter: null, status: null, ttsAbort: null, btAbort: null, sectionIdx: -1, overrides: new Map() };

const engine = new DemoEngine({
  onLog: renderLog,
  onStep: onStep,
  onHint: (t) => { $('#playHint').textContent = t; },
  onStory: (ms) => { $('#storyClock').textContent = ms == null ? '--:--:--' : msToClock(ms); },
  onState: (s) => { $('#btnPlay').disabled = s === 'playing' || s === 'loading'; },
});
window.engine = engine;

/* ---------------- 日志 ---------------- */
function renderLog(e) {
  const body = $('#logBody');
  if (body.querySelector('.log-empty')) body.innerHTML = '';
  const row = document.createElement('div');
  const track = e.track || '引擎';
  row.className = 'log-row' + (e.cut ? ' cut' : '') + (e.star ? ' star' : '') + (state.filter && !state.filter.has(track) ? ' hide' : '');
  row.dataset.track = track;
  let main = '';
  if (e.fields && Object.keys(e.fields).length && track !== '引擎') {
    main = Object.entries(e.fields).map(([k, v]) => k === '_' ? `<span class="kv">${esc(v)}</span>` : `<span class="kv"><i>${esc(k)}｜</i>${esc(v)}</span>`).join('');
  } else main = esc(e.label ?? e.text ?? '');
  const chip = `<span class="track" data-t="${esc(track)}">${esc(track)}${e.sub ? '·' + esc(e.sub) : ''}</span>`;
  row.innerHTML = `<span class="lt">t+${esc(e.t)}s${e.story != null ? `<small>${esc(msToClock(e.story))}</small>` : ''}</span><div><div class="lb">${chip}${main}</div>${e.detail ? `<div class="ld">${esc(e.detail)}</div>` : ''}</div>`;
  body.appendChild(row);
  body.scrollTop = 1e6;
}
function renderLogTools() {
  const tools = $('#logTools');
  const all = ['全部', ...TRACKS, '引擎'];
  tools.innerHTML = all.map(t => `<button class="chip ${(t === '全部' && !state.filter) || state.filter?.has(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('');
  tools.querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === '全部') state.filter = null;
    else { state.filter = state.filter || new Set(); if (state.filter.has(t)) state.filter.delete(t); else state.filter.add(t); if (!state.filter.size) state.filter = null; }
    renderLogTools();
    $$('#logBody .log-row').forEach(r => r.classList.toggle('hide', !!state.filter && !state.filter.has(r.dataset.track)));
  }));
}

/* ---------------- beats ---------------- */
function renderBeats(script) {
  const sections = script.timeline.filter(s => s.type === 'section');
  let beats = sections.length ? sections.map((s, i) => ({ no: i + 1, who: (s.title || '').split(/[｜|]/)[0], text: s.short || s.title, desc: s.desc })) : (script.beats || []);
  if (!beats.length) beats = script.timeline.filter(s => s.type === 'say').slice(0, 8).map((s, i) => ({ no: i + 1, who: script.speakers[s.speaker]?.name || s.speaker, text: s.text }));
  $('#beats').innerHTML = beats.map(b => `<div class="step-row" data-step="${b.no}"><span class="no">${String(b.no).padStart(2, '0')}</span><div><span class="who">${esc(b.who || '')}</span><span class="t">${esc(b.text || '')}</span>${b.desc ? `<span class="desc">${esc(b.desc)}</span>` : ''}</div></div>`).join('');
  $('#beatCount').textContent = `${beats.length} beats`;
  state.sectionIdx = -1;
}
function onStep(st) {
  if (st.type !== 'section') return;
  state.sectionIdx++;
  $$('#beats .step-row').forEach((r, i) => { r.classList.toggle('active', i === state.sectionIdx); r.classList.toggle('done', i < state.sectionIdx); });
  const row = $$('#beats .step-row')[state.sectionIdx]; row?.scrollIntoView({ block: 'nearest' });
}

/* ---------------- case 列表 ---------------- */
async function loadCases() {
  state.cases = await (await fetch('/api/cases')).json();
  const groups = new Map();
  for (const c of state.cases) { const g = c.group || '未分组'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); }
  $('#caseMenu').innerHTML = [...groups.entries()].map(([g, list]) => `<div class="case-group"><div class="cg-name">${esc(g)}</div>${list.map(c => `<button class="case-item ${c.id === state.id ? 'active' : ''}" data-id="${esc(c.id)}"><span class="no">${esc(c.case_id)}</span><span><span class="title">${esc(c.name)}</span><span class="desc">${esc(c.summary || c.scene || '')}</span></span><span class="audio ${c.audio_ready === c.utterances ? 'ok' : c.audio_ready ? 'partial' : ''}">${c.audio_ready}/${c.utterances} 语音</span></button>`).join('')}</div>`).join('') || '<div class="log-empty">还没有 case,去「脚本」页新建一个。</div>';
  $('#caseMenu').querySelectorAll('.case-item').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); $('#caseChip').classList.remove('open'); selectCase(b.dataset.id); }));
}

async function selectCase(id) {
  if (!id) return;
  engine.reset();
  state.id = id;
  location.hash = id;
  const r = await fetch(`/api/cases/${id}`);
  if (!r.ok) { $('#caseName').textContent = '加载失败'; return; }
  state.data = await r.json();
  state.mode = state.data.dsl ? 'dsl' : 'json';
  const script = state.data.normalized_script || normalizeScript(state.data.script);
  $('#caseName').textContent = `${script.case_id} · ${script.name}`;
  $('#footLeft').textContent = `${script.scene?.title || ''}${script.scene?.desc ? ' · ' + script.scene.desc : ''}`;
  $$('#caseMenu .case-item').forEach(b => b.classList.toggle('active', b.dataset.id === id));
  state.overrides = await loadOverrides(id);
  await engine.load(id, state.data.script, state.data.manifest, state.overrides);
  renderBeats(script);
  $('#logBody').innerHTML = '<div class="log-empty editorial">按下播放,日志从这里开始。</div>';
  renderEditor();
  renderClips();
  renderSpeakers(script);
  renderTimeline(script, mergedDurations());
  renderBrowserTts();
  $('#jsonPreview').textContent = '点「生成规范化 JSON」预览 Draft v5 结构。';
  $('#kpi').innerHTML = ''; $('#uttTable').innerHTML = ''; $('#evTable').innerHTML = '';
  $('#lnkJson').href = `/api/cases/${id}/normalized.json?download=1`;
  $('#lnkWav').href = `/api/cases/${id}/mix.wav`;
  setIssues('未生成', '');
  const v = state.data.validation;
  if (v?.errors?.length) showMsg('#editorMsg', 'err', v.errors.join('\n'));
  else if (v?.warnings?.length) showMsg('#editorMsg', 'warn', v.warnings.join('\n'));
  else showMsg('#editorMsg', '', '');
}

/* ---------------- 编辑器 ---------------- */
function renderEditor() {
  const d = state.data; if (!d) return;
  if (state.mode === 'dsl') $('#editor').value = d.dsl ?? scriptToDSL(d.script);
  else $('#editor').value = JSON.stringify(d.script, null, 2);
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  if (state.mode === 'dsl' && !d.dsl) showMsg('#editorMsg', 'info', '此 case 以 script.json 为源,这里是由 JSON 渲染出的剧本视图;保存会按剧本重新编译成 script.json(台词下的 @id 行保住了音频片段名)。');
}
function showMsg(sel, kind, text) {
  const el = $(sel);
  el.innerHTML = text ? `<div class="msg ${kind}">${esc(text).replace(/\n/g, '<br>')}</div>` : '';
}
async function parsePreview() {
  const text = $('#editor').value;
  try {
    if (state.mode === 'json') {
      const script = JSON.parse(text);
      const v = validateScript(script);
      showMsg('#editorMsg', v.errors.length ? 'err' : 'ok', v.errors.length ? v.errors.join('\n') : `JSON 合法 · ${v.script.timeline.length} steps · ${v.script.timeline.filter(s => s.type === 'say').length} 句台词${v.warnings.length ? '\n' + v.warnings.join('\n') : ''}`);
      return v.script;
    }
    const r = await (await fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dsl: text }) })).json();
    const s = r.normalized_script;
    const kinds = {}; for (const st of s.timeline) kinds[st.type] = (kinds[st.type] || 0) + 1;
    const summary = `解析成功 · ${s.timeline.length} steps(${Object.entries(kinds).map(([k, v]) => k + ' ' + v).join(', ')})`;
    showMsg('#editorMsg', r.errors.length ? 'err' : (r.warnings.length ? 'warn' : 'ok'), [...r.errors, ...r.warnings, summary].join('\n'));
    return s;
  } catch (e) { showMsg('#editorMsg', 'err', '解析失败:' + e.message); return null; }
}
async function saveCase() {
  const text = $('#editor').value;
  const body = state.mode === 'json' ? { script: JSON.parse(text) } : { dsl: text };
  const r = await fetch(`/api/cases/${state.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) { showMsg('#editorMsg', 'err', [j.error, ...(j.errors || []), ...(j.warnings || [])].join('\n')); return; }
  showMsg('#editorMsg', j.warnings?.length ? 'warn' : 'ok', ['已保存 → cases/' + state.id + '/script.json' + (state.mode === 'dsl' ? ' + script.dsl' : ''), ...(j.warnings || [])].join('\n'));
  await loadCases();
  await selectCase(state.id);
}
async function newCase() {
  const id = prompt('新 case 的 id(字母/数字/横线):', 'my-case');
  if (!id) return;
  const name = prompt('case 名称:', id) || id;
  const r = await fetch('/api/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) });
  const j = await r.json();
  if (!r.ok) { alert(j.error); return; }
  await loadCases();
  await selectCase(id);
  switchView('script');
}
async function insertTemplate() {
  const t = await (await fetch(`/api/template?id=${encodeURIComponent(state.id || 'new-case')}`)).text();
  if ($('#editor').value.trim() && !confirm('替换当前编辑器内容为模板?')) return;
  state.mode = 'dsl'; $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === 'dsl'));
  $('#editor').value = t;
}

/* ---------------- 语音 ---------------- */
function renderClips(scriptOverride) {
  const d = state.data; if (!d) return;
  const script = scriptOverride || d.normalized_script || normalizeScript(d.script);
  const clips = d.manifest?.clips || {};
  const says = script.timeline.filter(s => s.type === 'say');
  let ok = 0;
  const rows = says.map(s => {
    const c = s.clip ? clips[s.clip] : null;
    const ov = s.clip ? state.overrides.get(s.clip) : null;
    const has = !!(c && c.file) || !!ov; if (has && !s.typed) ok++;
    const stateCls = s.typed ? '' : has ? 'ok' : 'miss';
    const stateTxt = s.typed ? '打字' : ov ? `wav · ${(ov.duration_ms / 1000).toFixed(1)}s · 本机` : has ? `${(c.format || '').toString().split('/')[0]} · ${(c.duration_ms / 1000).toFixed(1)}s` : '缺失';
    return `<tr class="${stateCls}" data-id="${esc(s.id)}"><td class="mono">${esc(s.id)}</td><td>${esc(script.speakers[s.speaker]?.name || s.speaker)}</td><td>${esc(s.text.slice(0, 26))}${s.text.length > 26 ? '…' : ''}</td><td class="state mono">${esc(stateTxt)}</td></tr>`;
  });
  $('#clipTable').innerHTML = `<thead><tr><th>id</th><th>说话人</th><th>台词</th><th>语音</th></tr></thead><tbody>${rows.join('')}</tbody>`;
  const spoken = says.filter(s => !s.typed).length;
  $('#voiceSummary').textContent = `${ok}/${spoken} 已有音频`;
  $('#btnTtsMissing').disabled = !(state.status?.openai) || ok === spoken;
  $('#btnTtsAll').disabled = !(state.status?.openai);
  $('#ttsMsg').innerHTML = state.status?.openai ? '' : '<div class="msg info">未配置 OPENAI_API_KEY:复制 .env.example 为 .env 填入后重启服务,即可一键生成语音。缺语音的台词演示时按语速上屏。</div>';
  $('#btGenMissing').disabled = ok === spoken;
  $('#btClear').disabled = state.overrides.size === 0;
}

/* ---------------- 浏览器直连 OpenAI TTS(key 只留本机,结果缓存 IndexedDB) ---------------- */
const IDB_NAME = 'duplex-tts', IDB_STORE = 'clips';
function idbOpen() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('no indexedDB'));
    const rq = indexedDB.open(IDB_NAME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(IDB_STORE);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbGetPrefix(prefix) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const out = new Map();
    const rq = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
    rq.onsuccess = () => { const c = rq.result; if (c) { out.set(String(c.key).slice(prefix.length), c.value); c.continue(); } else { db.close(); res(out); } };
    rq.onerror = () => { db.close(); rej(rq.error); };
  });
}
async function idbPut(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(val, key); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => { db.close(); rej(tx.error); }; });
}
async function idbDeletePrefix(prefix) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const st = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
    const rq = st.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
    rq.onsuccess = () => { const c = rq.result; if (c) { c.delete(); c.continue(); } else { db.close(); res(); } };
    rq.onerror = () => { db.close(); rej(rq.error); };
  });
}
async function loadOverrides(caseId) {
  try { return await idbGetPrefix(caseId + '/'); } catch { return new Map(); }
}
function mergedDurations() {
  const d = { ...(state.data?.durations || {}) };
  for (const [k, v] of state.overrides) if (v.duration_ms) d[k] = v.duration_ms;
  Object.assign(d, engine.durations());
  return d;
}
function renderBrowserTts() {
  const sel = $('#btModel');
  if (!sel.options.length) TTS_MODELS.forEach(m => { const o = document.createElement('option'); o.value = o.textContent = m; sel.appendChild(o); });
  try { const k = localStorage.getItem('duplex.openai_key'); if (k && !$('#btKey').value) $('#btKey').value = k; } catch { /* private mode */ }
  const n = state.overrides.size;
  $('#btSummary').textContent = n ? `本机已缓存 ${n} 段` : '';
}
async function uploadClip(caseId, it, wav) {
  const r = await fetch(`/api/cases/${caseId}/clips/${it.clip}`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav', 'X-Clip-Hash': it.hash, 'X-Clip-Source': `browser:${it.model}:${it.voice}`, 'X-Clip-Text': encodeURIComponent(it.text) }, body: wav });
  if (!r.ok) throw new Error('写回失败 ' + r.status);
}
async function browserTts(force) {
  if (state.btAbort || !state.data) return;
  const key = $('#btKey').value.trim();
  if (!key) { showMsg('#btMsg', 'warn', '先填 OpenAI API key。它只保存在这台电脑的浏览器里,不会上传到任何服务器。'); return; }
  try { localStorage.setItem('duplex.openai_key', key); } catch { /* ignore */ }
  const model = $('#btModel').value || TTS_MODELS[0];
  const plan = ttsPlan(state.data.normalized_script, { model });
  const ac = new AbortController(); state.btAbort = ac;
  $('#btStop').hidden = false; $('#ttsProgress').hidden = false; $('#ttsProgress i').style.width = '0%';
  $('#btGenMissing').disabled = true; $('#btGenAll').disabled = true;
  const caseId = state.id;
  let done = 0, skipped = 0, fatal = null; const failed = [];
  for (let i = 0; i < plan.length; i++) {
    const it = plan[i];
    const have = state.overrides.get(it.clip);
    if (!force && have?.hash === it.hash) { skipped++; continue; }
    const tr = $(`#clipTable tr[data-id="${it.id}"]`);
    if (tr) { tr.className = 'gen'; tr.querySelector('.state').textContent = '生成中…'; }
    showMsg('#btMsg', 'info', `[${i + 1}/${plan.length}] ${it.speaker_name} · ${it.voice} · ${it.text.slice(0, 26)}`);
    try {
      const wav = await synthesizeSpeech(it, { apiKey: key, model, signal: ac.signal });
      const duration_ms = wavDurationMs(wav) ?? 0;
      const rec = { wav, hash: it.hash, duration_ms, voice: it.voice, model, text: it.text, at: Date.now() };
      state.overrides.set(it.clip, rec);
      await idbPut(`${caseId}/${it.clip}`, rec).catch(() => {});
      if (!state.status?.static) await uploadClip(caseId, it, wav).catch(e => console.warn(e.message));
      done++;
      if (tr) { tr.className = 'ok'; tr.querySelector('.state').textContent = `wav · ${(duration_ms / 1000).toFixed(1)}s · 本机`; }
    } catch (e) {
      failed.push({ id: it.id, error: e.message });
      if (tr) { tr.className = 'miss'; tr.querySelector('.state').textContent = '失败'; }
      if (e.name === 'AbortError') break;
      if (e.network) { fatal = '浏览器连不到 api.openai.com。claude.ai 上的 Artifact 版受内容安全策略限制不能访问外网;请用本地 npm start、dist/duplex-demo.html 或 GitHub Pages 版打开本页再生成。'; break; }
      if (e.status === 401 || e.status === 403) { fatal = `OpenAI 拒绝了这个 key(${e.status})。请检查 key 是否有效、是否有 audio 权限。`; break; }
    }
    $('#ttsProgress i').style.width = Math.round((i + 1) / plan.length * 100) + '%';
  }
  state.btAbort = null; $('#btStop').hidden = true; $('#ttsProgress').hidden = true; $('#btGenAll').disabled = false;
  if (fatal) showMsg('#btMsg', 'err', fatal);
  else showMsg('#btMsg', failed.length ? 'warn' : 'ok', `生成 ${done} · 沿用缓存 ${skipped} · 失败 ${failed.length}${failed.length ? '\n' + failed.slice(0, 5).map(f => f.id + ':' + f.error).join('\n') : ''}${done ? '\n已缓存在本机' + (state.status?.static ? '' : ',并写回 cases/' + caseId + '/audio/') + ';演示与导出立即生效。' : ''}`);
  await reloadWithOverrides();
}
async function clearBrowserClips() {
  if (!state.id || !confirm('清除本机缓存的这个 case 的浏览器生成语音?')) return;
  await idbDeletePrefix(state.id + '/').catch(() => {});
  state.overrides = new Map();
  showMsg('#btMsg', 'info', '已清除本机缓存(服务端写回的 wav 不受影响)。');
  await reloadWithOverrides();
}
async function reloadWithOverrides() {
  const r = await fetch(`/api/cases/${state.id}`);
  if (r.ok) { state.data = await r.json(); state.mode = state.data.dsl ? state.mode : 'json'; }
  await engine.load(state.id, state.data.script, state.data.manifest, state.overrides);
  renderClips();
  renderBrowserTts();
  renderTimeline(state.data.normalized_script || normalizeScript(state.data.script), mergedDurations());
  await loadCases();
  $$('#caseMenu .case-item').forEach(b => b.classList.toggle('active', b.dataset.id === state.id));
}
function renderSpeakers(script) {
  $('#speakerList').innerHTML = Object.entries(script.speakers).filter(([k]) => k !== 'system').map(([k, sp]) => `<div class="speaker-row"><span class="k">${esc(k)}</span><span class="v"><b>${esc(sp.name)}</b> · ${esc(sp.role)} · ${esc(sp.speaker_id || '')}<br><code>voice=${esc(sp.tts?.voice || '-')}</code> ${sp.tts?.speed && sp.tts.speed !== 1 ? `<code>speed=${sp.tts.speed}</code>` : ''}<br><span style="color:var(--ink-mute)">${esc((sp.tts?.instructions || '').slice(0, 80))}${(sp.tts?.instructions || '').length > 80 ? '…' : ''}</span></span></div>`).join('');
}
async function runTts(force) {
  if (state.ttsAbort) return;
  const ac = new AbortController(); state.ttsAbort = ac;
  $('#btnTtsStop').hidden = false; $('#ttsProgress').hidden = false; $('#ttsProgress i').style.width = '0%';
  $('#btnTtsMissing').disabled = true; $('#btnTtsAll').disabled = true;
  showMsg('#ttsMsg', 'info', force ? '全部重新生成中…' : '生成缺失语音中…');
  try {
    const r = await fetch(`/api/cases/${state.id}/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }), signal: ac.signal });
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const ev = /^event: (.*)$/m.exec(chunk)?.[1]; const data = /^data: (.*)$/m.exec(chunk)?.[1];
        if (!ev || !data) continue;
        const p = JSON.parse(data);
        if (ev === 'progress') {
          $('#ttsProgress i').style.width = Math.round(p.index / p.total * 100) + '%';
          const tr = $(`#clipTable tr[data-id="${p.id}"]`);
          if (tr) { tr.className = p.status === 'error' ? 'miss' : p.status === 'generating' ? 'gen' : 'ok'; tr.querySelector('.state').textContent = p.status === 'generating' ? '生成中…' : p.status === 'cached' ? '缓存' : p.status === 'error' ? '失败' : `wav · ${(p.duration_ms / 1000).toFixed(1)}s`; }
          showMsg('#ttsMsg', p.status === 'error' ? 'err' : 'info', `[${p.index}/${p.total}] ${p.id} · ${p.message || p.status}`);
        } else if (ev === 'done') {
          showMsg('#ttsMsg', p.failed.length ? 'warn' : 'ok', `生成 ${p.generated.length} · 缓存 ${p.skipped.length} · 失败 ${p.failed.length}${p.failed.length ? '\n' + p.failed.map(f => f.id + ':' + f.error).join('\n') : ''}`);
        } else if (ev === 'fatal') {
          showMsg('#ttsMsg', 'err', p.error);
        }
      }
    }
  } catch (e) { if (e.name !== 'AbortError') showMsg('#ttsMsg', 'err', e.message); }
  state.ttsAbort = null; $('#btnTtsStop').hidden = true; $('#ttsProgress').hidden = true;
  await loadCases();
  await selectCase(state.id);
}

/* ---------------- 导出 ---------------- */
function setIssues(text, cls) { const el = $('#exportIssues'); el.className = 'status-pill ' + cls; el.innerHTML = `<i></i>${esc(text)}`; }
async function buildJson() {
  await engine.ensureAudio().catch(() => {});
  const { json } = buildNormalized(state.data.script, mergedDurations());
  const issues = checkNormalized(json);
  $('#jsonPreview').textContent = JSON.stringify(json, null, 2);
  const a = json.annotation;
  $('#kpi').innerHTML = [
    ['utterances', json.utterances.length], ['events', json.events.length], ['fdx', a.fdx_annotation.length], ['emotion', a.emotion_annotation.length],
    ['paralinguistic', a.paralinguistic_annotation.length], ['八轨日志', a.track_annotation.length], ['world', json.dynamic_context.world_signal.length], ['时长', (json.meta_data.media.audio.duration_ms / 1000).toFixed(1) + 's'],
  ].map(([k, v]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
  setIssues(issues.length ? `${issues.length} 处问题` : '结构检查通过', issues.length ? 'warn' : 'ok');
  $('#uttTable').innerHTML = `<thead><tr><th>id</th><th>speaker</th><th class="mono">start</th><th class="mono">end</th><th>text</th></tr></thead><tbody>${json.utterances.map(u => `<tr><td class="mono">${esc(u.id)}</td><td>${esc(u.speaker)}<br><small style="color:var(--ink-mute)">${esc(u.speaker_id)}</small></td><td class="mono">${u.start_at_ms}</td><td class="mono">${u.end_at_ms}${u.cut_at_ms ? `<br><small style="color:var(--rose)">cut ${u.cut_at_ms}</small>` : ''}</td><td>${esc(u.text.slice(0, 30))}${u.modality === 'text' ? ' <small>(打字)</small>' : ''}</td></tr>`).join('')}</tbody>`;
  const evRows = json.events.map(e => `<tr><td class="mono">${esc(e.event_id)}</td><td>${esc(e.event_type)}${e.tool_name ? '<br><small>' + esc(e.tool_name) + '</small>' : ''}</td><td class="mono">${e.time_at_ms}</td><td>${esc(e.query ?? e.arguments ?? e.results ?? e.result ?? '')}</td></tr>`);
  const fdxRows = a.fdx_annotation.map(f => `<tr><td class="mono">fdx</td><td>${esc(f.fdx_type)}<br><small>${esc(f.role)}</small></td><td class="mono">${f.start_at_ms}‒${f.end_at_ms}</td><td>${esc(f.utterance_id || '')}</td></tr>`);
  $('#evTable').innerHTML = `<thead><tr><th>id</th><th>type</th><th class="mono">t(ms)</th><th>内容</th></tr></thead><tbody>${[...evRows, ...fdxRows].join('')}</tbody>`;
  renderTimeline(state.data.normalized_script, mergedDurations());
}
function renderTimeline(script, durations) {
  const sch = schedule(script, durations);
  const total = Math.max(1, sch.total_ms);
  const names = script.speakers;
  $('#timelineStrip').innerHTML = sch.utterances.map(u => {
    const l = (u.start / total * 100).toFixed(2), w = Math.max(.6, ((u.end - u.start) / total * 100)).toFixed(2);
    const cut = u.cut ? `<i class="cut" style="left:${(u.cut_at_ms / total * 100).toFixed(2)}%;width:${Math.max(.4, ((u.end - u.cut_at_ms) / total * 100)).toFixed(2)}%"></i>` : '';
    return `<div class="tl-row"><span>${esc(u.id)} ${esc(names[u.speaker]?.name || u.speaker)}</span><div class="tl-bar"><i class="${esc(u.role)}" style="left:${l}%;width:${w}%"></i>${cut}</div></div>`;
  }).join('') + `<div class="tl-row"><span>总长</span><span class="mono" style="color:var(--ink-dim)">${(total / 1000).toFixed(1)}s</span></div>`;
}
async function mixInBrowser() {
  await engine.ensureAudio();
  const script = state.data.normalized_script;
  const sch = schedule(script, mergedDurations());
  const sr = 24000; const frames = Math.ceil(sch.total_ms / 1000 * sr) + sr;
  const off = new OfflineAudioContext(2, frames, sr);
  const merger = off.createChannelMerger(2); merger.connect(off.destination);
  let placed = 0;
  for (const u of sch.utterances) {
    const buf = u.clip ? engine.buffers[u.clip] : null; if (!buf) continue;
    const src = off.createBufferSource(); src.buffer = buf;
    const g = off.createGain(); const t0 = u.start / 1000;
    if (u.cut) { const tc = u.cut_at_ms / 1000; g.gain.setValueAtTime(1, tc); g.gain.setValueAtTime(1, tc + 0.7); g.gain.linearRampToValueAtTime(0.12, tc + 1.25); g.gain.linearRampToValueAtTime(0, tc + 1.75); }
    src.connect(g); g.connect(merger, 0, u.role === 'assistant' ? 1 : 0);
    src.start(t0); if (u.cut) src.stop(u.cut_at_ms / 1000 + 1.8);
    placed++;
  }
  const rendered = await off.startRendering();
  const wav = encodeWav(rendered);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })); a.download = `${script.case_id}_${script.sample_id}.wav`; a.click();
  setIssues(`浏览器混音完成 · ${placed} 段`, 'ok');
}
function encodeWav(ab) {
  const ch = ab.numberOfChannels, n = ab.length, sr = ab.sampleRate;
  const buf = new ArrayBuffer(44 + n * ch * 2); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(ab.getChannelData(c));
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, chans[c][i])); v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true); o += 2; }
  return buf;
}

/* ---------------- 视图 ---------------- */
function switchView(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
}

async function init() {
  renderLogTools();
  try { state.status = await (await fetch('/api/status')).json(); } catch { state.status = { openai: false }; }
  const pill = $('#ttsStatus');
  pill.className = 'status-pill ' + (state.status.openai ? 'ok' : 'warn');
  pill.innerHTML = `<i></i>${state.status.openai ? 'OpenAI TTS · ' + esc(state.status.model) : 'TTS 未配置'}`;
  await loadCases();
  const want = location.hash.slice(1);
  const first = state.cases.find(c => c.id === want) || state.cases[0];
  if (first) await selectCase(first.id); else { $('#caseName').textContent = '没有 case'; }

  $('#caseChip').addEventListener('click', () => $('#caseChip').classList.toggle('open'));
  document.addEventListener('click', (e) => { if (!$('#caseChip').contains(e.target)) $('#caseChip').classList.remove('open'); });
  $$('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));
  $('#btnPlay').addEventListener('click', () => engine.play());
  $('#btnReset').addEventListener('click', () => { engine.reset(); state.sectionIdx = -1; $$('#beats .step-row').forEach(r => r.classList.remove('active', 'done')); $('#logBody').innerHTML = '<div class="log-empty editorial">按下播放,日志从这里开始。</div>'; });
  $('#btnSkipScene').addEventListener('click', () => { engine.skipScene = !engine.skipScene; $('#btnSkipScene').classList.toggle('warm', engine.skipScene); $('#btnSkipScene').textContent = engine.skipScene ? '场景音:跳过' : '跳过场景音'; });
  $('#micToggle').addEventListener('change', (e) => { engine.micEnabled = e.target.checked; });
  $$('#modeSeg button').forEach(b => b.addEventListener('click', () => { state.mode = b.dataset.mode; renderEditor(); }));
  $('#btnParse').addEventListener('click', parsePreview);
  $('#btnSave').addEventListener('click', () => saveCase().catch(e => showMsg('#editorMsg', 'err', e.message)));
  $('#btnNewCase').addEventListener('click', newCase);
  $('#btnTemplate').addEventListener('click', insertTemplate);
  $('#btnTtsMissing').addEventListener('click', () => runTts(false));
  $('#btnTtsAll').addEventListener('click', () => { if (confirm('全部重新生成会覆盖已有音频(含导入的片段),继续?')) runTts(true); });
  $('#btnTtsStop').addEventListener('click', () => state.ttsAbort?.abort());
  $('#btGenMissing').addEventListener('click', () => browserTts(false));
  $('#btGenAll').addEventListener('click', () => { if (confirm('用浏览器重新生成这个 case 的全部台词语音?')) browserTts(true); });
  $('#btStop').addEventListener('click', () => state.btAbort?.abort());
  $('#btClear').addEventListener('click', clearBrowserClips);
  $('#btKey').addEventListener('change', () => { try { localStorage.setItem('duplex.openai_key', $('#btKey').value.trim()); } catch { /* ignore */ } });
  $('#btnBuildJson').addEventListener('click', () => buildJson().catch(e => setIssues('生成失败:' + e.message, 'warn')));
  $('#btnMixBrowser').addEventListener('click', () => mixInBrowser().catch(e => setIssues('混音失败:' + e.message, 'warn')));
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (id && id !== state.id) selectCase(id); });
}
init();
