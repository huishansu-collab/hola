/* ============================================================
 * app.js — SPA：三阶段（冒烟/Draft/PRD）文档工作台
 * 路由：#/workbench | #/new | #/flow | #/principle | #/req/<id>/<stage>
 * ============================================================ */

const STORE_KEY = 'principle_workbench_v2';

/* ---------------- State ---------------- */
const State = {
  load() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { reqs: [] }; } catch { return { reqs: [] }; } },
  save(d) { try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) { toast('本地存储已满（可能因附件过大）'); } },
  all() { return this.load().reqs; },
  get(id) { return this.load().reqs.find(r => r.id === id); },
  upsert(req) { const d = this.load(); const i = d.reqs.findIndex(r => r.id === req.id); req.updatedAt = Date.now(); if (i >= 0) d.reqs[i] = req; else d.reqs.unshift(req); this.save(d); },
  remove(id) { const d = this.load(); d.reqs = d.reqs.filter(r => r.id !== id); this.save(d); },
  getParadigm() { return this.load().paradigm || null; },
  saveParadigm(p) { const d = this.load(); d.paradigm = p; this.save(d); },
  clear() { localStorage.removeItem(STORE_KEY); },
};

/* ---------------- Utils ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const fmtDate = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, 2400); }
function copyText(t) { navigator.clipboard?.writeText(t).then(() => toast('已复制到剪贴板'), () => toast('复制失败')); }

/* editable-cell registry, rebuilt each render */
let EC = [];
let CUR = null; // 当前正在编辑的需求，供 ecell 提交后持久化
let PERSIST = null; // 非需求页（如工作范式）自定义持久化
function ecell(value, onSave, opts = {}) {
  const idx = EC.push({ onSave, multiline: opts.multiline }) - 1;
  const todo = isTodo(value);
  const cls = `ecell ${todo ? 'todo' : ''} ${opts.cls || ''}`;
  const disp = opts.multiline ? nl2br(todo ? (opts.ph || TODO) : value) : esc(todo ? (opts.ph || TODO) : value);
  return `<span class="${cls}" data-ec="${idx}" title="点击编辑">${disp}</span>`;
}
function wireEcells(root) {
  $$('[data-ec]', root).forEach(el => el.onclick = e => {
    e.stopPropagation();
    const rec = EC[+el.dataset.ec];
    const ta = document.createElement('textarea');
    ta.className = 'ecell-edit'; ta.value = el.classList.contains('todo') ? '' : el.textContent;
    ta.rows = rec.multiline ? 3 : 1;
    el.replaceWith(ta); ta.focus();
    const commit = () => { rec.onSave(ta.value.trim()); if (PERSIST) PERSIST(); else if (CUR) State.upsert(CUR); render(); };
    ta.onblur = commit;
    ta.onkeydown = ev => { if (ev.key === 'Enter' && !ev.shiftKey && !rec.multiline) { ev.preventDefault(); ta.blur(); } if (ev.key === 'Escape') { ta.value = '\0'; render(); } };
  });
}

/* ---------------- Router ---------------- */
function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'req') return { route: 'req', id: parts[1], stage: parts[2] || 'smoke' };
  return { route: parts[0] || 'workbench' };
}
const navigate = h => location.hash = h;

function render() {
  EC = [];
  LIST_REG = [];
  PERSIST = null;
  const ctx = parseHash();
  const view = $('#view');
  updateNav(ctx);
  if (ctx.route === 'new') { view.innerHTML = ''; view.append(viewNew()); }
  else if (ctx.route === 'principle') view.innerHTML = viewPrinciple();
  else if (ctx.route === 'flow') view.innerHTML = viewFlow();
  else if (ctx.route === 'handbook') { view.innerHTML = viewHandbook(); bindHandbook(); }
  else if (ctx.route === 'req') {
    const req = State.get(ctx.id); if (!req) return navigate('#/workbench');
    renderReqStage(req, ctx.stage);
  } else { view.innerHTML = viewWorkbench(); bindWorkbench(); }
  wireEcells(view);
  view.scrollTop = 0;
}

function updateNav(ctx) {
  $$('.nav-item[data-route]').forEach(a => a.classList.toggle('active', a.dataset.route === ctx.route));
  const active = ctx.route === 'req' ? State.get(ctx.id) : null;
  $$('#stage-nav .stage-link').forEach(a => {
    const st = a.dataset.stage;
    if (!active) { a.classList.add('locked'); a.href = '#'; $('.stage-dot', a).dataset.state = 'todo'; a.classList.remove('active'); return; }
    a.classList.remove('locked'); a.href = `#/req/${active.id}/${st}`;
    const reached = STAGE_INDEX[active.stage] >= STAGE_INDEX[st];
    const cur = ctx.stage === st;
    a.classList.toggle('active', cur);
    $('.stage-dot', a).dataset.state = cur ? 'active' : (reached ? 'done' : 'todo');
  });
}

/* ============================================================ Workbench */
let wbFilter = 'all';
function viewWorkbench() {
  const reqs = State.all();
  const filtered = wbFilter === 'all' ? reqs : reqs.filter(r => r.stage === wbFilter);
  const filters = [['all', '全部'], ...STAGES.map(s => [s.key, s.label])].map(([k, l]) => {
    const n = k === 'all' ? reqs.length : reqs.filter(r => r.stage === k).length;
    return `<button class="chip-filter ${wbFilter === k ? 'sel' : ''}" data-f="${k}">${l}${n ? ` <span class="muted">${n}</span>` : ''}</button>`;
  }).join('');
  const rows = filtered.map(r => {
    const dir = DIRECTIONS[r.direction] || DIRECTIONS.general;
    const si = STAGE_INDEX[r.stage];
    const pills = STAGES.map((s, i) => `<span class="stage-pill ${i < si ? 'done' : i === si ? 'active' : ''}" title="${s.label}"></span>`).join('');
    const cc = (r.smoke && !isTodo(r.smoke.conclusion) && r.smoke.conclusion) || (r.draft && !isTodo(r.draft.conclusion) && r.draft.conclusion) || '尚无一句话结论';
    const gate = (r.gates || {})[r.stage];
    const dec = gate && gate.decision ? DECISIONS[gate.decision] : null;
    const atn = (r.attachments || []).length;
    return `<tr class="req-row" data-id="${r.id}">
      <td><div class="req-name">${esc(r.name)}<div class="oneliner">${esc(cc)}</div></div></td>
      <td><span class="badge badge-brand">${dir.label}</span></td>
      <td><div class="stage-pills">${pills}</div><div class="muted" style="font-size:var(--fs-4);margin-top:5px">${STAGES[si].label}</div></td>
      <td>${esc(r.owner || '—')}</td>
      <td>${atn ? `<span class="badge badge-mute">📎 ${atn}</span>` : '<span class="muted">—</span>'}</td>
      <td>${dec ? `<span class="badge ${dec.badge}">${dec.label}</span>` : '<span class="muted">—</span>'}</td>
      <td class="muted" style="font-size:var(--fs-4)">${fmtDate(r.updatedAt)}</td>
    </tr>`;
  }).join('');
  const body = reqs.length === 0
    ? `<div class="empty"><h3>还没有需求</h3><p>从一个想法、或上传一份要走冒烟/Draft 的 demo 物料开始，10 分钟内产出一份对齐范本的结构化文档。</p>
        <div class="spacer"></div><a class="btn btn-primary" href="#/new">＋ 新建需求</a> <button class="btn" id="seed-inline">载入标杆示例</button></div>`
    : `<div class="panel panel-pad"><div class="wb-toolbar"><div class="wb-filters">${filters}</div><a class="btn btn-primary btn-sm" href="#/new">＋ 新建需求</a></div>
        <table class="req-table"><thead><tr><th>需求</th><th>方向</th><th>阶段</th><th>负责人</th><th>物料</th><th>评审</th><th>更新</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="muted" style="text-align:center;padding:30px">该阶段暂无需求</td></tr>`}</tbody></table></div>`;
  return `<div class="page-head"><h1 class="page-title">工作台</h1>
      <p class="page-sub">冒烟对齐方向 · Draft 对齐结构 · PRD 对齐细节，让否决发生在最便宜的时候。</p></div>${body}`;
}
function bindWorkbench() {
  $$('.chip-filter').forEach(b => b.onclick = () => { wbFilter = b.dataset.f; render(); });
  $$('.req-row').forEach(tr => tr.onclick = () => { const r = State.get(tr.dataset.id); navigate(`#/req/${r.id}/${r.stage}`); });
  const si = $('#seed-inline'); if (si) si.onclick = seedExample;
}

/* ============================================================ New */
function viewNew() {
  const el = document.createElement('div');
  el.innerHTML = `<div class="page-head"><h1 class="page-title">新建需求</h1>
      <p class="page-sub">输入想法，或上传要走冒烟/Draft 的 demo 物料（HTML / 图片 / 视频）。选择方向与起始阶段，平台据此产出对齐范本的结构化文档。</p></div>
    <div class="split">
      <div class="panel panel-pad">
        <label class="field"><div class="field-label">需求名称</div><input type="text" id="f-name" placeholder="例如：Step AI IDE"></label>
        <div class="grid cols-2">
          <label class="field"><div class="field-label">提出人 / 来源 <span class="opt">选填</span></div><input type="text" id="f-source" placeholder="例如：1013 发布会 / 客服周会"></label>
          <label class="field"><div class="field-label">执行负责人 <span class="opt">选填</span></div><input type="text" id="f-owner" placeholder="例如：Kaysaith"></label>
        </div>
        <label class="field"><div class="field-label">想法 / 会议记录</div>
          <textarea id="f-input" rows="6" placeholder="谁、在什么场景、遇到什么阻碍、你想做成什么。也可直接粘贴一段会议记录。"></textarea></label>
        <div class="field-label">上传 demo 物料 <span class="opt">选填，可拖拽</span></div>
        <div id="new-drop"></div>
      </div>
      <div class="panel panel-pad">
        <div class="section-title">方向</div><p class="section-hint">切换方向会调整假设、复杂度与开放问题的建议。</p>
        <div class="choices" id="dir-choices">${DIRECTION_ORDER.map((k, i) => { const d = DIRECTIONS[k]; return `<div class="choice ${i === 0 ? 'sel' : ''}" data-dir="${k}">${d.label}<small>${d.hint}</small></div>`; }).join('')}</div>
        <div class="hint-box" id="dir-focus" style="margin-top:14px"></div>
        <div class="section-title">起始阶段</div><p class="section-hint">默认从冒烟开始；中型需求可从 Draft 起步，小改动直接写 PRD（豁免须在需求登记注明）。</p>
        <div class="choices" id="stage-choices">${STAGES.map((s, i) => `<div class="choice ${i === 0 ? 'sel' : ''}" data-stage="${s.key}">${s.label}<small>${STAGE_ENTRY[s.key].replace(/：.*/, '')}</small></div>`).join('')}</div>
        <div class="spacer"></div>
        <div class="btn-row"><button class="btn btn-primary" id="create-btn">创建并进入</button><a class="btn" href="#/workbench">取消</a></div>
      </div>
    </div>`;
  let dir = 'general', stage = 'smoke';
  const pending = [];
  const focusBox = $('#dir-focus', el);
  const rf = () => focusBox.innerHTML = `<b>${DIRECTIONS[dir].label} · 验证重点</b><br>${esc(DIRECTIONS[dir].focus)}`;
  rf();
  $$('#dir-choices .choice', el).forEach(c => c.onclick = () => { $$('#dir-choices .choice', el).forEach(x => x.classList.remove('sel')); c.classList.add('sel'); dir = c.dataset.dir; rf(); });
  $$('#stage-choices .choice', el).forEach(c => c.onclick = () => { $$('#stage-choices .choice', el).forEach(x => x.classList.remove('sel')); c.classList.add('sel'); stage = c.dataset.stage; });
  mountDropzone($('#new-drop', el), pending, () => renderPendingList($('#new-drop', el), pending));
  $('#create-btn', el).onclick = () => {
    const name = $('#f-name', el).value.trim();
    if (!name) { toast('请先填写需求名称'); return $('#f-name', el).focus(); }
    const req = { id: uid(), name, source: $('#f-source', el).value.trim(), owner: $('#f-owner', el).value.trim(),
      input: $('#f-input', el).value.trim(), direction: dir, stage, createdAt: Date.now(), updatedAt: Date.now(),
      attachments: pending.slice(), gates: {}, chat: [] };
    if (stage === 'smoke') req.smoke = generateSmoke(req);
    else if (stage === 'draft') { req.smoke = generateSmoke(req); req.draft = generateDraft(req); }
    else { req.smoke = generateSmoke(req); req.draft = generateDraft(req); req.prd = generatePRD(req); }
    State.upsert(req); toast('已创建'); navigate(`#/req/${req.id}/${stage}`);
  };
  return el;
}

/* ============================================================ Upload / attachments */
function fileToAttachment(file) {
  return new Promise(res => {
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video'
      : (/html/.test(file.type) || /\.html?$/i.test(file.name)) ? 'html' : 'file';
    const reader = new FileReader();
    reader.onload = () => res({ id: uid(), kind, name: file.name, size: file.size,
      dataUrl: (kind === 'image' || kind === 'video') ? reader.result : '', text: (kind === 'html' || kind === 'file') ? reader.result : '', note: '' });
    if (kind === 'image' || kind === 'video') reader.readAsDataURL(file); else reader.readAsText(file);
  });
}
function mountDropzone(host, list, onChange) {
  host.innerHTML = `<div class="dropzone" id="dz"><input type="file" id="dz-input" multiple accept="image/*,video/*,.html,.htm,.txt,.md" hidden>
      <div class="dz-inner"><span class="dz-ico">⇪</span><div><b>拖拽或点击上传</b><div class="muted" style="font-size:var(--fs-4)">图片/截图 → 线框图 · 视频 → 演示证据 · HTML → 抽正文</div></div></div></div>
    <div class="attach-list" id="dz-list"></div>`;
  const input = $('#dz-input', host), dz = $('#dz', host);
  dz.onclick = () => input.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = async e => { e.preventDefault(); dz.classList.remove('over'); await add(e.dataTransfer.files); };
  input.onchange = async () => { await add(input.files); input.value = ''; };
  async function add(files) { for (const f of files) { if (f.size > 8 * 1024 * 1024 && f.type.startsWith('video/')) { toast('视频过大，建议 <8MB'); } list.push(await fileToAttachment(f)); } onChange(); }
  renderPendingList(host, list);
}
function renderPendingList(host, list) {
  const box = $('#dz-list', host); if (!box) return;
  box.innerHTML = list.map((a, i) => attachChip(a, i)).join('');
  $$('.attach-del', box).forEach(b => b.onclick = () => { list.splice(+b.dataset.i, 1); renderPendingList(host, list); });
}
function attachChip(a, i) {
  const thumb = a.kind === 'image' ? `<img src="${a.dataUrl}" alt="">`
    : a.kind === 'video' ? `<span class="att-ico">▶</span>`
    : a.kind === 'html' ? `<span class="att-ico">&lt;/&gt;</span>` : `<span class="att-ico">✎</span>`;
  return `<div class="attach-chip"><div class="att-thumb">${thumb}</div><div class="att-meta"><div class="att-name">${esc(a.name)}</div>
    <div class="att-kind">${UPLOAD_KINDS[a.kind].label}</div></div><button class="attach-del" data-i="${i}" title="移除">✕</button></div>`;
}

/* ============================================================ Requirement stage */
function reqHeader(req, stage) {
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  const st = STAGES[STAGE_INDEX[stage]];
  return `<div class="crumbs"><a href="#/workbench" style="color:inherit;text-decoration:none">工作台</a> › <b>${esc(req.name)}</b> › 【${st.label}】</div>
    <div class="page-head"><h1 class="page-title">【${st.label}】${esc(req.name)}</h1>
      <p class="page-sub"><span class="badge badge-brand">${dir.label}</span>
        <span class="muted" style="margin-left:8px">回答：${st.q} ｜ 氛围：${st.mood}</span></p></div>`;
}
function stageStepper(req, stage) {
  return `<div class="panel panel-pad" style="margin-bottom:18px"><div class="flex-between">
    <div class="stepper">${STAGES.map((s, i) => {
      const reached = STAGE_INDEX[req.stage] >= STAGE_INDEX[s.key]; const cur = s.key === stage;
      return `<a class="step ${cur ? 'cur' : ''} ${reached ? 'reached' : ''}" href="#/req/${req.id}/${s.key}">
        <span class="step-idx">${reached && !cur ? '✓' : s.idx}</span><span class="step-l">${s.label}<small>${s.en}</small></span></a>`;
    }).join('<span class="step-arrow">→</span>')}</div>
    <div class="muted" style="font-size:var(--fs-4)">Kay：${STAGES[STAGE_INDEX[stage]].kay} ｜ 更新 ${fmtDate(req.updatedAt)}</div></div></div>`;
}
function renderReqStage(req, stage) {
  CUR = req;
  const view = $('#view');
  view.innerHTML = reqHeader(req, stage) + stageStepper(req, stage) + `<div id="stage-body"></div>`;
  const body = $('#stage-body');
  if (stage === 'smoke') { if (!req.smoke) req.smoke = generateSmoke(req); renderSmoke(req, body); }
  else if (stage === 'draft') { if (!req.draft) req.draft = generateDraft(req); renderDraft(req, body); }
  else { if (!req.prd) req.prd = generatePRD(req); renderPRD(req, body); }
}
function advance(req, to) { if (STAGE_INDEX[to] > STAGE_INDEX[req.stage]) req.stage = to; State.upsert(req); }
function save(req) { State.upsert(req); }

/* right rail: upload + attachments gallery + readiness + gate + export */
function rightRail(req, stage) {
  const rd = evaluateReadiness(req, stage);
  const st = STAGES[STAGE_INDEX[stage]];
  const gate = (req.gates || {})[stage] || {};
  const gallery = (req.attachments || []).map(a => attachGalleryItem(a)).join('') || '<div class="muted" style="font-size:var(--fs-4);padding:6px 0">暂无物料</div>';
  const decs = Object.entries(DECISIONS).map(([k, v]) => `<button class="gate-dec ${gate.decision === k ? 'sel' : ''}" data-gate="${k}">${v.label}</button>`).join('');
  return `<div class="rail">
    <div class="panel panel-pad">
      <div class="flex-between"><div class="section-title">完成度</div><div class="ring" style="--p:${rd.pct}" data-label="${rd.pct}%"></div></div>
      <p class="section-hint">对照【${st.label}】范本必填项（${rd.done}/${rd.total}）</p>
      <ul class="checklist">${rd.checks.map(c => `<li><span class="check-ico ${c.ok ? 'ok' : 'miss'}">${c.ok ? '✓' : '!'}</span>
        <span class="check-txt"><span class="t">${esc(c.key)}</span><span class="d">${esc(c.detail)}</span></span></li>`).join('')}</ul>
    </div>
    <div class="panel panel-pad">
      <div class="section-title">上传物料 · 自动分析</div>
      <p class="section-hint">图片→线框图/截图 · 视频→演示 · HTML→抽正文</p>
      <div id="rail-drop"></div>
      <div class="spacer-sm"></div>
      <div class="section-title" style="font-size:var(--fs-3)">已挂载 <span class="muted">(${(req.attachments || []).length})</span></div>
      <div class="gallery">${gallery}</div>
    </div>
    <div class="panel panel-pad">
      <div class="section-title">评审门槛 · GATE</div>
      <p class="section-hint">评审人：${st.gate}</p>
      <p class="section-hint" style="color:var(--ink-2)">退出条件：${st.exit}</p>
      <div class="gate-decs">${decs}</div>
      <div class="spacer-sm"></div>
      <textarea id="gate-note" rows="2" placeholder="评审记录：改什么、谁负责、何时再看…">${esc(gate.note || '')}</textarea>
      <div class="spacer-sm"></div>
      <div class="btn-row">
        <button class="btn btn-sm" id="exp-copy">复制 Markdown</button>
        ${STAGE_INDEX[stage] < STAGES.length - 1 ? `<button class="btn btn-primary btn-sm" id="to-next">进入 ${STAGES[STAGE_INDEX[stage] + 1].label} →</button>` : ''}
      </div>
    </div>
  </div>`;
}
function attachGalleryItem(a) {
  const thumb = a.kind === 'image' ? `<img src="${a.dataUrl}" alt="${esc(a.name)}">`
    : a.kind === 'video' ? `<video src="${a.dataUrl}" muted></video>`
    : `<span class="att-ico">${a.kind === 'html' ? '&lt;/&gt;' : '✎'}</span>`;
  return `<div class="gitem" title="${esc(a.name)}">${thumb}<span class="gitem-k">${a.kind === 'image' ? '截图' : a.kind === 'video' ? '视频' : a.kind === 'html' ? 'HTML' : '文本'}</span></div>`;
}
function wireRail(req, stage, root) {
  const list = req.attachments = req.attachments || [];
  mountDropzone($('#rail-drop', root), list, () => { const msg = analyzeUpload(req); save(req); toast('已分析：' + msg); render(); });
  $$('.gate-dec', root).forEach(b => b.onclick = () => { req.gates = req.gates || {}; const g = req.gates[stage] = req.gates[stage] || {}; g.decision = b.dataset.gate; save(req); render(); });
  const gn = $('#gate-note', root); if (gn) gn.onblur = () => { req.gates = req.gates || {}; (req.gates[stage] = req.gates[stage] || {}).note = gn.value; save(req); };
  $('#exp-copy', root).onclick = () => copyText(exportMarkdown(req, stage));
  const nx = $('#to-next', root);
  if (nx) nx.onclick = () => { const to = STAGES[STAGE_INDEX[stage] + 1].key; if (to === 'draft' && !req.draft) req.draft = generateDraft(req); if (to === 'prd' && !req.prd) req.prd = generatePRD(req); advance(req, to); navigate(`#/req/${req.id}/${to}`); };
}

/* ---------- attachment picker for 截图/线框图 cells ---------- */
function attachPicker(req, currentId, onPick) {
  const imgs = (req.attachments || []).filter(a => a.kind === 'image' || a.kind === 'video');
  const cur = imgs.find(a => a.id === currentId);
  if (cur) return `<div class="wire-cell" data-pick="1">${cur.kind === 'image' ? `<img src="${cur.dataUrl}">` : `<video src="${cur.dataUrl}" muted></video>`}<span class="wire-x" data-clear="1">✕</span></div>`;
  if (!imgs.length) return `<span class="muted" style="font-size:var(--fs-4)">先在右侧上传图片</span>`;
  return `<select class="wire-select"><option value="">选择物料…</option>${imgs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>`;
}

/* ============================================================ SMOKE stage */
function renderSmoke(req, root) {
  const s = req.smoke;
  root.innerHTML = `<div class="doc-split"><div class="panel panel-pad doc">
    <div class="doc-title">【冒烟】文档 <span class="muted" style="font-weight:400;font-size:var(--fs-4)">chill 对齐 · 容忍推翻</span></div>
    <div class="hint-box">范本要求：读完「一句话结论」就该能开始反对。冒烟只要方向与复杂度量级共识，不排期。</div>

    <div class="doc-sec"><div class="doc-h">一句话结论</div><div class="doc-hint">${esc(SMOKE_TEMPLATE.conclusion.hint)}</div>
      <div class="doc-body big">${ecell(s.conclusion, v => s.conclusion = v || TODO, { multiline: true })}</div></div>

    <div class="doc-sec"><div class="doc-h">背景</div><div class="doc-hint">${esc(SMOKE_TEMPLATE.background.hint)}</div>
      <div class="doc-body">${ecell(s.background, v => s.background = v || TODO, { multiline: true })}</div></div>

    <div class="doc-sec"><div class="doc-h">目标 / 非目标</div>
      <div class="two-col">
        <div><div class="col-label">目标 <span class="muted">做成了什么变了</span></div>${listEditor(s.goals, '目标', v => s.goals = v)}</div>
        <div><div class="col-label">非目标 <span class="muted">明确不做</span></div>${listEditor(s.nonGoals, '非目标', v => s.nonGoals = v)}</div>
      </div></div>

    <div class="doc-sec"><div class="doc-h">思路 & 线框图</div><div class="doc-hint">${esc(SMOKE_TEMPLATE.approach.hint)}</div>
      <div class="doc-body">${ecell(s.approach, v => s.approach = v || TODO, { multiline: true })}</div>
      <div class="col-label" style="margin-top:12px">尚未验证的假设</div>${listEditor(s.assumptions, '假设', v => s.assumptions = v)}
      ${smokeWires(req)}
    </div>

    <div class="doc-sec"><div class="doc-h">复杂度预判</div><div class="doc-hint">${esc(SMOKE_TEMPLATE.complexity.hint)}</div>
      <table class="mini-table"><thead><tr><th>维度</th><th>预判</th><th>依据 / 不确定处</th></tr></thead><tbody>
        ${s.complexity.map((c, i) => `<tr><td>${esc(c.dim)}</td><td>${levelSelect(c.level, i)}</td><td>${ecell(c.basis, v => c.basis = v || TODO)}</td></tr>`).join('')}
      </tbody></table></div>

    <div class="doc-sec"><div class="doc-h">开放问题</div><div class="doc-hint">${esc(SMOKE_TEMPLATE.openQuestions.hint)}</div>
      ${listEditor(s.openQuestions, '问题', v => s.openQuestions = v, true)}</div>
  </div>${rightRail(req, 'smoke')}</div>`;

  bindListEditors(req, root);
  $$('select[data-lvl]', root).forEach(sel => sel.onchange = () => { s.complexity[+sel.dataset.lvl].level = sel.value; save(req); render(); });
  wireRail(req, 'smoke', root);
  wireEcells(root);
}
function smokeWires(req) {
  const w = (req.attachments || []).filter(a => a.kind === 'image' || a.kind === 'video');
  if (!w.length) return `<div class="col-label" style="margin-top:12px">线框图 / 演示</div><div class="muted" style="font-size:var(--fs-4)">右侧上传图片或视频，自动作为线框图/演示证据</div>`;
  return `<div class="col-label" style="margin-top:12px">线框图 / 演示 <span class="muted">(${w.length})</span></div>
    <div class="wire-row">${w.map(a => a.kind === 'image' ? `<img class="wire-thumb" src="${a.dataUrl}">` : `<video class="wire-thumb" src="${a.dataUrl}" muted controls></video>`).join('')}</div>`;
}

/* ============================================================ DRAFT stage */
function renderDraft(req, root) {
  const d = req.draft;
  root.innerHTML = `<div class="doc-split"><div class="panel panel-pad doc">
    <div class="doc-title">【Draft】文档 <span class="muted" style="font-weight:400;font-size:var(--fs-4)">收敛 · 只聚焦关键需求</span></div>

    <div class="doc-sec"><div class="doc-h">1. 基本信息</div>
      <table class="mini-table kv-table"><tbody>${DRAFT_TEMPLATE.basicFields.map(f =>
        `<tr><th>${esc(f)}</th><td>${ecell(d.basic[f], v => d.basic[f] = v || TODO)}</td></tr>`).join('')}</tbody></table></div>

    <div class="doc-sec"><div class="doc-h">2. 一句话结论</div><div class="doc-hint">${esc(DRAFT_TEMPLATE.conclusion.hint)}</div>
      <div class="doc-body big">${ecell(d.conclusion, v => d.conclusion = v || TODO, { multiline: true })}</div></div>

    <div class="doc-sec"><div class="doc-h">3. 需求背景与用户价值</div>
      <div class="col-label">3.1 需求背景</div>
      ${miniKV('需求来自哪里', ecell(d.bg_from, v => d.bg_from = v || TODO, { multiline: true }))}
      ${miniKV('现状是什么，问题在哪', ecell(d.bg_now, v => d.bg_now = v || TODO, { multiline: true }))}
      ${miniKV('不做会怎样', ecell(d.bg_ifnot, v => d.bg_ifnot = v || TODO, { multiline: true }))}
      <div class="col-label" style="margin-top:12px">3.2 用户价值</div>
      ${miniKV('目标用户是谁', ecell(d.uv_who, v => d.uv_who = v || TODO, { multiline: true }))}
      ${miniKV('比现在哪里变好', ecell(d.uv_better, v => d.uv_better = v || TODO, { multiline: true }))}
      ${miniKV('为什么会用', ecell(d.uv_why, v => d.uv_why = v || TODO, { multiline: true }))}
    </div>

    <div class="doc-sec"><div class="doc-h">4. 竞品分析</div><div class="doc-hint">${esc(DRAFT_TEMPLATE.competitors.hint)}</div>
      <table class="mini-table"><thead><tr><th>竞品</th><th>他们怎么做</th><th style="width:140px">截图 <span class="req-star">必填</span></th><th>与我们的对比</th></tr></thead><tbody>
        ${d.competitors.map((c, i) => `<tr>
          <td>${ecell(c.name, v => c.name = v || TODO)}</td>
          <td>${ecell(c.approach, v => c.approach = v || TODO, { multiline: true })}</td>
          <td class="wire-td" data-wire="comp-${i}">${attachPicker(req, c.shot)}</td>
          <td>${ecell(c.compare, v => c.compare = v || TODO, { multiline: true })}</td></tr>`).join('')}
      </tbody></table><button class="btn btn-sm" id="add-comp">+ 增加竞品</button></div>

    <div class="doc-sec"><div class="doc-h">5. 关键功能</div><div class="doc-hint">${esc(DRAFT_TEMPLATE.features.hint)}</div>
      <table class="mini-table"><thead><tr><th>功能</th><th>优先级</th><th>做什么</th><th>怎么做</th><th style="width:140px">线框图 <span class="req-star">必填</span></th><th>备注</th></tr></thead><tbody>
        ${d.features.map((f, i) => `<tr>
          <td>${ecell(f.name, v => f.name = v || TODO)}</td>
          <td><span class="pri ${f.pri === 'P0' ? 'pri-p0' : 'pri-p1'}" data-pri="${i}">${f.pri}</span></td>
          <td>${ecell(f.scenario, v => f.scenario = v || TODO, { multiline: true })}</td>
          <td>${ecell(f.how, v => f.how = v || TODO, { multiline: true })}</td>
          <td class="wire-td" data-wire="feat-${i}">${attachPicker(req, f.wire)}</td>
          <td>${ecell(f.note, v => f.note = v || TODO, { multiline: true })}</td></tr>`).join('')}
      </tbody></table><button class="btn btn-sm" id="add-feat">+ 增加功能</button></div>

    <div class="doc-sec"><div class="doc-h">6. 不在本期</div>
      <table class="mini-table"><thead><tr><th>功能</th><th>原因</th></tr></thead><tbody>
        ${d.notInScope.map((n, i) => `<tr><td>${ecell(n.feature, v => n.feature = v || TODO)}</td><td>${ecell(n.reason, v => n.reason = v || TODO, { multiline: true })}</td></tr>`).join('')}
      </tbody></table><button class="btn btn-sm" id="add-nis">+ 增加一项</button></div>
  </div>${rightRail(req, 'draft')}</div>`;

  $$('[data-pri]', root).forEach(el => el.onclick = () => { const f = d.features[+el.dataset.pri]; f.pri = f.pri === 'P0' ? 'P1' : 'P0'; save(req); render(); });
  $('#add-comp', root).onclick = () => { d.competitors.push({ name: TODO, approach: TODO, shot: '', compare: TODO }); save(req); render(); };
  $('#add-feat', root).onclick = () => { d.features.push({ name: TODO, pri: 'P1', scenario: TODO, how: '1. 用户……\n2. 系统……', wire: '', note: TODO }); save(req); render(); };
  $('#add-nis', root).onclick = () => { d.notInScope.push({ feature: TODO, reason: TODO }); save(req); render(); };
  wireWireCells(req, root, (kind, idx, id) => { if (kind === 'comp') d.competitors[idx].shot = id; else d.features[idx].wire = id; save(req); render(); });
  wireRail(req, 'draft', root);
  wireEcells(root);
}

/* ============================================================ PRD stage */
function renderPRD(req, root) {
  const p = req.prd;
  const imgs = (req.attachments || []).filter(a => a.kind === 'image');
  root.innerHTML = `<div class="doc-split"><div class="panel panel-pad doc">
    <div class="doc-title">【PRD】文档 <span class="muted" style="font-weight:400;font-size:var(--fs-4)">严肃 · 定稿即承诺</span></div>
    <div class="hint-box">范本要求：细节到可落地——主视觉、文案、埋点、名词表。文档冻结后，变更走 change log。</div>

    <div class="doc-sec"><div class="doc-h">主流程与状态</div><div class="doc-hint">${esc(PRD_TEMPLATE.mainFlow.hint)}</div>
      <div class="doc-body">${ecell(p.mainFlow, v => p.mainFlow = v || TODO, { multiline: true })}</div></div>

    <div class="doc-sec"><div class="doc-h">主视觉 / 视觉稿</div>
      ${imgs.length ? `<div class="wire-row">${imgs.map(a => `<img class="wire-thumb lg" src="${a.dataUrl}">`).join('')}</div>` : `<div class="muted" style="font-size:var(--fs-4)">右侧上传高保真图作为定稿视觉</div>`}</div>

    <div class="doc-sec"><div class="doc-h">文案表</div>
      <table class="mini-table"><thead><tr><th>位置</th><th>文案</th><th>备注</th></tr></thead><tbody>
        ${p.copy.map(c => `<tr><td>${ecell(c.pos, v => c.pos = v || TODO)}</td><td>${ecell(c.text, v => c.text = v || TODO)}</td><td>${ecell(c.note, v => c.note = v || TODO)}</td></tr>`).join('')}
      </tbody></table><button class="btn btn-sm" id="add-copy">+ 文案</button></div>

    <div class="doc-sec"><div class="doc-h">埋点表</div>
      <table class="mini-table"><thead><tr><th>事件</th><th>触发时机</th><th>参数</th><th>用途</th></tr></thead><tbody>
        ${p.tracking.map(t => `<tr><td>${ecell(t.event, v => t.event = v || TODO)}</td><td>${ecell(t.when, v => t.when = v || TODO)}</td><td>${ecell(t.params, v => t.params = v || TODO)}</td><td>${ecell(t.use, v => t.use = v || TODO)}</td></tr>`).join('')}
      </tbody></table><button class="btn btn-sm" id="add-track">+ 埋点</button></div>

    <div class="doc-sec"><div class="doc-h">名词表</div>
      <table class="mini-table"><thead><tr><th>名词</th><th>定义</th></tr></thead><tbody>
        ${p.glossary.map(g => `<tr><td>${ecell(g.term, v => g.term = v || TODO)}</td><td>${ecell(g.def, v => g.def = v || TODO)}</td></tr>`).join('')}
      </tbody></table><button class="btn btn-sm" id="add-term">+ 名词</button></div>

    <div class="doc-sec"><div class="doc-h">Change Log</div>
      <table class="mini-table"><thead><tr><th>日期</th><th>变更</th><th>影响</th></tr></thead><tbody>
        ${p.changelog.map(c => `<tr><td>${esc(c.date)}</td><td>${ecell(c.change, v => c.change = v || TODO)}</td><td>${ecell(c.impact, v => c.impact = v || TODO)}</td></tr>`).join('')}
      </tbody></table>
      <div class="spacer-sm"></div>
      <label class="freeze"><input type="checkbox" id="frozen" ${p.frozen ? 'checked' : ''}> <b>文档冻结</b> —— 定稿即承诺，后续变更走 change log</label></div>
  </div>${rightRail(req, 'prd')}</div>`;

  $('#add-copy', root).onclick = () => { p.copy.push({ pos: TODO, text: TODO, note: TODO }); save(req); render(); };
  $('#add-track', root).onclick = () => { p.tracking.push({ event: TODO, when: TODO, params: TODO, use: TODO }); save(req); render(); };
  $('#add-term', root).onclick = () => { p.glossary.push({ term: TODO, def: TODO }); save(req); render(); };
  $('#frozen', root).onchange = e => { p.frozen = e.target.checked; save(req); render(); };
  wireRail(req, 'prd', root);
  wireEcells(root);
}

/* ---------- shared editors ---------- */
function miniKV(label, cellHtml) { return `<div class="mkv"><div class="mkv-l">${esc(label)}</div><div class="mkv-v">${cellHtml}</div></div>`; }
function levelSelect(val, i) { return `<select data-lvl="${i}">${['', '小', '中', '大'].map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o || '—'}</option>`).join('')}</select>`; }
function listEditor(arr, kind, setter, numbered) {
  arr = arr && arr.length ? arr : [TODO];
  const idx = LIST_REG.push({ arr, setter }) - 1;
  return `<div class="list-ed" data-list="${idx}" data-kind="${esc(kind)}" data-num="${numbered ? 1 : 0}">
    ${arr.map((v, i) => `<div class="list-item">${numbered ? `<span class="li-num">${i + 1}</span>` : '<span class="li-dot">•</span>'}
      ${ecell(v, nv => { arr[i] = nv || TODO; setter(arr); })}
      <button class="li-del" data-li="${i}">✕</button></div>`).join('')}
    <button class="li-add">+ 加一条${esc(kind)}</button></div>`;
}
let LIST_REG = [];
function bindListEditors(req, root) {
  $$('.list-ed', root).forEach(box => {
    const reg = LIST_REG[+box.dataset.list];
    $('.li-add', box).onclick = () => { reg.arr.push(TODO); reg.setter(reg.arr); save(req); render(); };
    $$('.li-del', box).forEach(b => b.onclick = () => { reg.arr.splice(+b.dataset.li, 1); if (!reg.arr.length) reg.arr.push(TODO); reg.setter(reg.arr); save(req); render(); });
  });
}
function wireWireCells(req, root, onSet) {
  $$('.wire-td', root).forEach(td => {
    const [kind, idx] = td.dataset.wire.split('-');
    const sel = $('.wire-select', td); if (sel) sel.onchange = () => { if (sel.value) onSet(kind, +idx, sel.value); };
    const clear = $('[data-clear]', td); if (clear) clear.onclick = () => onSet(kind, +idx, '');
  });
}

/* ============================================================ Flow page (三阶段流程) */
function viewFlow() {
  const cards = STAGES.map(s => `<div class="flow-card ${s.key === 'prd' ? 'dark' : ''}">
    <div class="fc-top"><span class="fc-idx">${s.idx}</span></div>
    <div class="fc-name">${s.label}<small>${s.en}</small></div>
    <div class="fc-block"><div class="fc-k">回答的问题</div><div class="fc-v">${esc(s.q)}</div></div>
    <div class="fc-block"><div class="fc-k">氛围</div><div class="fc-pill">${esc(s.mood)}</div></div>
    <div class="fc-block"><div class="fc-k">退出条件</div><div class="fc-v">${esc(s.exit)}</div></div>
    <div class="fc-gate"><span class="fc-k">GATE</span> ${esc(s.gate)}</div></div>`).join('<div class="flow-conn">✓</div>');
  return `<div class="page-head"><h1 class="page-title">三阶段流程</h1>
      <p class="page-sub">冒烟对齐方向 · Draft 对齐结构 · PRD 对齐细节，让否决发生在最便宜的时候。</p></div>
    <div class="panel panel-pad">
      <div class="flow-entry"><span>跳阶段（豁免须在需求登记注明）：</span>
        ${Object.entries(STAGE_ENTRY).map(([k, v]) => `<span class="entry-chip">${STAGES[STAGE_INDEX[k]].label}：${esc(v)}</span>`).join('')}</div>
      <div class="flow-cards">${cards}</div>
      <div class="spacer"></div>
      <div class="grid cols-2">
        <div class="mini-panel"><div class="section-title" style="font-size:var(--fs-3)">Kay · 递减介入曲线</div>
          <ul class="kay-curve">${STAGES.map(s => `<li><span class="kay-dot ${s.key === 'prd' ? 'hollow' : ''}"></span><b>${s.label}</b><span>${esc(s.kay)}</span></li>`).join('')}</ul>
          <p class="muted" style="font-size:var(--fs-4)">推翻 Draft 结论的变更须重新上升 · 三个团队两周</p></div>
        <div class="mini-panel"><div class="section-title" style="font-size:var(--fs-3)">推翻成本 · Cost of reversal</div>
          <div class="cost-bar"><span class="cost-seg s1">冒烟<br><small>一页纸</small></span><span class="cost-seg s2">Draft<br><small>结构返工</small></span><span class="cost-seg s3">PRD<br><small>定稿即承诺</small></span></div>
          <p class="muted" style="font-size:var(--fs-4);margin-top:10px">越往后推翻越贵，所以把判断尽量前置到冒烟。</p></div>
      </div>
    </div>`;
}

/* ============================================================ Team Handbook（大部门规定 + 我的团队工作范式） */
let hbTab = 'dept';
let PAR = null; // 当前工作范式对象，handbookMine 与 bindHandbook 共享同一实例
function viewHandbook() {
  const tabs = `<div class="hb-tabs">
    <button class="hb-tab ${hbTab === 'dept' ? 'sel' : ''}" data-tab="dept">大部门规定</button>
    <button class="hb-tab ${hbTab === 'mine' ? 'sel' : ''}" data-tab="mine">我的团队工作范式</button></div>`;
  return `<div class="page-head"><h1 class="page-title">团队手册</h1>
      <p class="page-sub">大部门规定是所有团队的共同规范；在此基础上，用「我的团队工作范式」写清自己团队怎么落地。</p></div>
    ${tabs}${hbTab === 'dept' ? handbookDept() : handbookMine()}`;
}

function handbookDept() {
  const a = HANDBOOK.about;
  const about = `<div class="hb-about">
    <div class="hb-h1">${esc(a.title)}</div>
    ${a.paras.map(p => `<p class="hb-p">${esc(p)}</p>`).join('')}
    <blockquote class="hb-quote">${esc(a.quote)}</blockquote>
    <div class="hb-lineage">${a.lineage.map((x, i) => `<span class="hb-node">${esc(x)}</span>${i < a.lineage.length - 1 ? '<span class="hb-arrow">→</span>' : ''}`).join('')}</div>
    <div class="hb-layers">${a.layers.map(x => `<span class="hb-layer">${esc(x)}</span>`).join('')}</div>
  </div>`;
  const sections = HANDBOOK.guidelines.map(g => `<div class="hb-sec">
    <div class="hb-h2"><span class="hb-no">${g.no}</span>${esc(g.title)}</div>
    ${g.intro ? `<p class="hb-intro">${esc(g.intro)}</p>` : ''}
    ${g.items.map(it => `<div class="hb-item">
      <div class="hb-h3"><span class="hb-no sm">${it.no}</span>${esc(it.title)}</div>
      <p class="hb-body">${esc(it.body)}</p>
      ${it.bad || it.good ? `<div class="hb-cases">
        ${it.bad ? `<div class="hb-case bad"><span class="case-tag">✕ Bad</span><code>${esc(it.bad)}</code></div>` : ''}
        ${it.good ? `<div class="hb-case good"><span class="case-tag">✓ Good</span><code>${esc(it.good)}</code></div>` : ''}
      </div>` : ''}
      ${it.steps ? `<table class="mini-table hb-steps"><thead><tr><th style="width:120px">步骤</th><th>做什么</th></tr></thead>
        <tbody>${it.steps.map(s => `<tr><td><b>${esc(s[0])}</b></td><td>${esc(s[1])}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>`).join('')}
  </div>`).join('');
  return `<div class="panel panel-pad hb-doc">
    <div class="hb-meta">${esc(HANDBOOK.name)} · <span class="muted">${esc(HANDBOOK.owner)}</span> <span class="badge badge-mute" style="margin-left:8px">部门级规范 · 只读</span></div>
    ${about}
    <div class="hb-h1" style="margin-top:26px">2. Team Guidelines</div>
    ${sections}
  </div>`;
}

function handbookMine() {
  PAR = State.getParadigm() || defaultParadigm();
  const par = PAR;
  const secs = par.sections.map((s, si) => `<div class="doc-sec">
    <div class="doc-h">${ecell(s.title, v => s.title = v || '（章节）')}</div>
    ${paradigmList(s.items, si)}
  </div>`).join('');
  return `<div class="doc-split"><div class="panel panel-pad doc hb-doc">
    <div class="flex-between"><div class="doc-title" style="border:none;margin:0;padding:0">我的团队工作范式</div>
      ${State.getParadigm() ? '' : '<span class="badge badge-warn">未保存 · 编辑即保存</span>'}</div>
    <div class="hb-intro" style="margin:6px 0 16px">参考左侧「大部门规定」来写：先立使命，再写「怎么写文档 / 怎么开会 / 怎么沟通 / 怎么做产品」。点击任意文字即可编辑。</div>
    <table class="mini-table kv-table"><tbody>
      <tr><th>团队</th><td>${ecell(par.team, v => par.team = v || '（我的团队）')}</td></tr>
      <tr><th>负责人</th><td>${ecell(par.owner, v => par.owner = v || '（负责人）')}</td></tr>
    </tbody></table>
    <div class="doc-sec"><div class="doc-h">使命 · 一句话</div><div class="doc-hint">参考 About 的写法：从下一代交互到下一代产品。</div>
      <div class="doc-body big">${ecell(par.mission, v => par.mission = v || TODO, { multiline: true })}</div></div>
    ${secs}
    <button class="btn btn-sm" id="par-add-sec">+ 增加章节</button>
  </div>
  <div class="rail"><div class="panel panel-pad">
    <div class="section-title">导出</div><p class="section-hint">导出为 Markdown，可粘进飞书 / Book。</p>
    <div class="btn-row"><button class="btn btn-sm" id="par-copy">复制 Markdown</button><button class="btn btn-sm" id="par-reset">重置为范例</button></div>
  </div>
  <div class="panel panel-pad"><div class="section-title">写作规范速查</div>
    <ul class="checklist">
      <li><span class="check-ico ok">✓</span><span class="check-txt"><span class="t">结论优先</span><span class="d">先结论，后理由</span></span></li>
      <li><span class="check-ico ok">✓</span><span class="check-txt"><span class="t">慎用加重</span><span class="d">到处加重等于没重点</span></span></li>
      <li><span class="check-ico ok">✓</span><span class="check-txt"><span class="t">中英留空格</span><span class="d">英文别用驼峰</span></span></li>
      <li><span class="check-ico ok">✓</span><span class="check-txt"><span class="t">列表巧思</span><span class="d">无先后用无序列表</span></span></li>
      <li><span class="check-ico ok">✓</span><span class="check-txt"><span class="t">数字用 K</span><span class="d">不用 w / 万混写</span></span></li>
    </ul></div></div></div>`;
}

function paradigmList(items, si) {
  items = items && items.length ? items : ['（写一条）'];
  const idx = LIST_REG.push({ arr: items }) - 1;
  return `<div class="list-ed" data-plist="${idx}" data-si="${si}">
    ${items.map((v, i) => `<div class="list-item"><span class="li-dot">•</span>${ecell(v, nv => items[i] = nv || '（写一条）')}<button class="li-del" data-li="${i}">✕</button></div>`).join('')}
    <button class="li-add">+ 加一条</button></div>`;
}

function bindHandbook() {
  $$('.hb-tab').forEach(b => b.onclick = () => { hbTab = b.dataset.tab; render(); });
  if (hbTab !== 'mine') return;
  const par = PAR || (PAR = State.getParadigm() || defaultParadigm());
  PERSIST = () => State.saveParadigm(par);
  const persist = () => { State.saveParadigm(par); render(); };
  $$('.list-ed[data-plist]').forEach(box => {
    const si = +box.dataset.si;
    $('.li-add', box).onclick = () => { par.sections[si].items.push('（写一条）'); persist(); };
    $$('.li-del', box).forEach(b => b.onclick = () => { par.sections[si].items.splice(+b.dataset.li, 1); if (!par.sections[si].items.length) par.sections[si].items.push('（写一条）'); persist(); });
  });
  const addSec = $('#par-add-sec'); if (addSec) addSec.onclick = () => { par.sections.push({ title: '（新章节）', items: ['（写一条）'] }); persist(); };
  const cp = $('#par-copy'); if (cp) cp.onclick = () => copyText(exportParadigm(par));
  const rs = $('#par-reset'); if (rs) rs.onclick = () => { if (confirm('重置为范例？当前编辑会丢失。')) { State.saveParadigm(defaultParadigm()); render(); toast('已重置'); } };
}

function exportParadigm(par) {
  const out = [`# ${par.team} · 团队工作范式`, `> 负责人：${par.owner}`, '', '## 使命', par.mission, ''];
  par.sections.forEach(s => { out.push(`## ${s.title}`); s.items.forEach(i => out.push(`- ${i}`)); out.push(''); });
  out.push('---', '_参考大部门规定（Intelligence Works Team Handbook）书写 · 由 Principle 工作台导出。_');
  return out.join('\n');
}

/* ============================================================ Principle page */
function viewPrinciple() {
  const list = PRINCIPLES.map(([t, d], i) => `<li><span class="p-num">${i + 1}</span><div class="p-body"><b>${esc(t)}</b><span>${esc(d)}</span></div></li>`).join('');
  const tmpl = (title, items) => `<div class="mini-panel"><div class="section-title" style="font-size:var(--fs-3)">${title}</div><ol class="tmpl-list">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`;
  return `<div class="page-head"><h1 class="page-title">总原则 · Principle</h1>
      <p class="page-sub">把一号位的判断显性化，让小同学沿同一套路径产出：为什么做、为谁做、做到什么程度、哪些暂时不做、需要谁一起完成。</p></div>
    <div class="split">
      <div class="panel panel-pad"><div class="section-title">判断原则</div><ul class="principle-list">${list}</ul></div>
      <div>
        ${tmpl('冒烟文档范本', ['一句话结论', '背景', '目标 / 非目标', '思路 & 线框图（方案方向 + 尚未验证的假设）', '复杂度预判（研发/设计/依赖方）', '开放问题'])}
        <div class="spacer"></div>
        ${tmpl('Draft 文档范本', ['基本信息', '一句话结论', '需求背景与用户价值', '竞品分析（截图必填）', '关键功能（线框图必填）', '不在本期'])}
        <div class="spacer"></div>
        ${tmpl('PRD 文档范本', ['主流程与状态', '主视觉 / 视觉稿', '文案表', '埋点表', '名词表', 'Change Log（冻结即承诺）'])}
      </div>
    </div>`;
}

/* ============================================================ Seed（标杆示例：Step AI IDE 冒烟 → Draft） */
function seedExample() {
  const req = { id: uid(), name: 'Step AI IDE', source: '1013 发布会', owner: 'Kaysaith',
    direction: 'agentic', stage: 'draft', createdAt: Date.now(), updatedAt: Date.now(),
    input: '面向 Step Maker 的 AI IDE，统一调度 Amoo 数字资产与记忆、Step Phone 系统与硬件能力，构建 Skill/Routine/Agent/AI App 并一键发布到 Step Phone。',
    attachments: [], gates: { smoke: { decision: 'pass', note: '方向与复杂度量级已对齐，进入 Draft。' } }, chat: [] };
  req.smoke = generateSmoke(req);
  req.smoke.conclusion = '面向 Step Maker 的 AI IDE：用户在这里统一调度 Amoo 的数字资产与记忆、Step Phone 的系统与硬件能力，构建 Skill/Routine/Agent/AI App 并一键发布到 Step Phone 使用——为 1013 发布会跑通「创作到发布」的完整闭环。';
  req.smoke.background = 'for 1013 发布会，创客版重点展示 Step AI Phone 的 Maker 从创作到发布的完整闭环，让用户直观理解产品能力和核心价值。1013 非最终形态，是面向发布会的阶段性版本。';
  req.smoke.goals = ['跑通闭环、讲清价值、稳定展示', 'AI App 采用 WebKit 容器 + 前端代码方案，优先完成可用版本'];
  req.smoke.nonGoals = ['版本管理、权限体系等复杂且对首版体验不显性的能力本期不建设', '运行期沙箱/Token 等资源成本本期统一按限免处理'];
  req.smoke.approach = '用户用 Amoo 账号在 Web 登录 Amoo AI IDE → 选择 Skill/Routine/Agent/AI App 创作 → 发布到自己的潘多拉手机真机体验或邀请好友体验 → 发布到 Amoo Store（提交物料表单，审核后上架）。';
  req.smoke.assumptions = ['WebKit 容器 + 前端代码能满足首版可用体验', '发布链路（真机/邀请/Store）在发布会现场稳定'];
  req.smoke.complexity = [{ dim: '研发', level: '大', basis: '容器、发布链路、Store 审核多环节' }, { dim: '设计', level: '中', basis: '四类产物的创作与发布界面' }, { dim: '依赖方', level: '有：Amoo / Step Phone / Store', basis: '账号、硬件、审核' }];
  req.smoke.openQuestions = ['四类产物（Skill/Routine/Agent/AI App）首版是否都要上？', '发布会现场演示走真机还是录屏兜底？', 'Store 审核的三条红线如何界定？'];
  req.draft = generateDraft(req);
  req.draft.basic['所属团队/模块'] = 'IDE · Amoo Builder';
  req.draft.basic['目标版本/班车'] = '9.4 班车 / Web 10.11';
  req.draft.basic['冒烟文档'] = 'Step AI IDE（已通过）';
  req.draft.conclusion = 'Amoo AI Builder：面向创客的手机 Skill/Agent/AI App 创建与发布平台，兼容 Prompt / MCP / VibeCoding，创作后一键发布到手机使用。';
  req.draft.bg_from = '1013 发布会需要展示 Maker 从创作到发布的完整闭环。';
  req.draft.bg_now = '现状缺少让创客在手机上创作并直接发布可用产物的一站式路径。';
  req.draft.bg_ifnot = '发布会无法直观展示产品核心价值与闭环。';
  req.draft.uv_who = 'Step Maker / 创客（含非专业开发者）。';
  req.draft.uv_better = '从想法到可用产物、再到发布上架，在一个 IDE 内闭环完成。';
  req.draft.uv_why = '一处创作、一键发布、真机即用。';
  req.draft.competitors = [{ name: 'Workbuddy', approach: 'MCP + Skill CLI + Skill 的开发方式', shot: '', compare: '我们更偏手机端、面向创客、发布链路一站式' }];
  req.draft.features = [
    { name: '四类产物创作', pri: 'P0', scenario: '创客选择 Skill/Routine/Agent/AI App 编写内容', how: '1. 用户选择产物类型\n2. 系统提供对应编辑器与模板\n3. 用户编写并保存', wire: '', note: '硬依赖：Amoo 账号体系' },
    { name: '一键发布', pri: 'P0', scenario: '把产物发布到真机 / 邀请好友 / 上架 Store', how: '1. 用户提交物料表单\n2. 系统走审核\n3. 通过后上架 / 分发', wire: '', note: '不触发：未通过审核不上架' },
  ];
  req.draft.notInScope = [{ feature: '版本管理与权限体系', reason: '复杂且对首版体验不显性，加速 1013 交付' }, { feature: '资源计费体系', reason: '运行期成本本期按限免处理' }];
  State.upsert(req);
  toast('已载入标杆示例：Step AI IDE');
  navigate(`#/req/${req.id}/draft`);
}

/* ============================================================ Boot */
$('#seed-btn').onclick = seedExample;
$('#reset-btn').onclick = () => { if (confirm('清空本地全部需求数据？')) { State.clear(); navigate('#/workbench'); render(); toast('已清空'); } };
window.addEventListener('hashchange', () => { LIST_REG = []; render(); });
if (!location.hash) location.hash = '#/workbench';
LIST_REG = [];
render();
