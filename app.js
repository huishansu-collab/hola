/* ============================================================
 * app.js — SPA 路由、状态与各页面渲染
 * 路由：#/workbench | #/new | #/principle | #/req/<id>/<stage>
 * ============================================================ */

const STORE_KEY = 'principle_workbench_v1';

/* ---------------- State ---------------- */
const State = {
  load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { reqs: [] }; }
    catch { return { reqs: [] }; }
  },
  save(data) { localStorage.setItem(STORE_KEY, JSON.stringify(data)); },
  all() { return this.load().reqs; },
  get(id) { return this.load().reqs.find(r => r.id === id); },
  upsert(req) {
    const data = this.load();
    const i = data.reqs.findIndex(r => r.id === req.id);
    req.updatedAt = Date.now();
    if (i >= 0) data.reqs[i] = req; else data.reqs.unshift(req);
    this.save(data);
  },
  remove(id) {
    const data = this.load();
    data.reqs = data.reqs.filter(r => r.id !== id);
    this.save(data);
  },
  clear() { localStorage.removeItem(STORE_KEY); },
};

/* ---------------- Utils ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = ts => { const d = new Date(ts); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const isTodoVal = v => !v || String(v).includes('待补充') || String(v).includes('待验证');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.hidden = true, 2200);
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast('已复制到剪贴板'),
    () => toast('复制失败，请手动选择'),
  );
}

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
  toast('已导出 ' + filename);
}

function kv(label, val, allowTodo = true) {
  const todo = allowTodo && isTodoVal(val);
  return `<div class="kv"><div class="kv-label">${esc(label)}</div>
    <div class="kv-val ${todo ? 'todo' : ''}">${esc(val || '待补充')}</div></div>`;
}

/* ---------------- Router ---------------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'req') return { route: 'req', id: parts[1], stage: parts[2] || 'smoke' };
  return { route: parts[0] || 'workbench' };
}

function navigate(hash) { location.hash = hash; }

function render() {
  const ctx = parseHash();
  const view = $('#view');
  updateNav(ctx);

  switch (ctx.route) {
    case 'new': view.innerHTML = ''; view.append(viewNew()); break;
    case 'principle': view.innerHTML = viewPrinciple(); break;
    case 'req': {
      const req = State.get(ctx.id);
      if (!req) { navigate('#/workbench'); return; }
      renderReqStage(req, ctx.stage);
      break;
    }
    case 'workbench':
    default: view.innerHTML = viewWorkbench(); bindWorkbench(); break;
  }
  view.scrollTop = 0;
}

function updateNav(ctx) {
  $$('.nav-item[data-route]').forEach(a =>
    a.classList.toggle('active', a.dataset.route === ctx.route ||
      (ctx.route === 'req' && a.dataset.route === 'workbench' && false)));

  const stageNav = $('#stage-nav');
  const active = ctx.route === 'req' ? State.get(ctx.id) : null;
  $$('.stage-link', stageNav).forEach(a => {
    const st = a.dataset.stage;
    if (!active) {
      a.classList.add('locked');
      a.href = '#';
      $(`.stage-dot`, a).dataset.state = 'todo';
      a.classList.remove('active');
      return;
    }
    a.classList.remove('locked');
    a.href = `#/req/${active.id}/${st}`;
    const reached = STAGE_INDEX[active.stage] >= STAGE_INDEX[st];
    const isCur = ctx.stage === st;
    a.classList.toggle('active', isCur);
    const dot = $('.stage-dot', a);
    dot.dataset.state = isCur ? 'active' : (reached ? 'done' : 'todo');
  });
}

/* ============================================================
 * VIEW: Workbench 工作台
 * ============================================================ */
let wbFilter = 'all';

function viewWorkbench() {
  const reqs = State.all();
  const filtered = wbFilter === 'all' ? reqs : reqs.filter(r => r.stage === wbFilter);

  const filters = [['all', '全部'], ...STAGES.map(s => [s.key, s.label])]
    .map(([k, l]) => {
      const n = k === 'all' ? reqs.length : reqs.filter(r => r.stage === k).length;
      return `<button class="chip-filter ${wbFilter === k ? 'sel' : ''}" data-f="${k}">${l} ${n ? `<span class="muted">${n}</span>` : ''}</button>`;
    }).join('');

  const rows = filtered.map(r => {
    const dir = DIRECTIONS[r.direction] || DIRECTIONS.general;
    const si = STAGE_INDEX[r.stage];
    const pills = STAGES.map((s, i) =>
      `<span class="stage-pill ${i < si ? 'done' : i === si ? 'active' : ''}"></span>`).join('');
    const oneliner = (r.draft && !isTodoVal(r.draft.oneLineConclusion) && r.draft.oneLineConclusion)
      || (r.smoke && !isTodoVal(r.smoke.conclusion) && r.smoke.conclusion) || '尚无一句话结论';
    const rec = r.review && r.review.decision ? DECISIONS[r.review.decision] : null;
    return `<tr class="req-row" data-id="${r.id}">
      <td><div class="req-name">${esc(r.name)}<div class="oneliner">${esc(oneliner)}</div></div></td>
      <td><span class="badge badge-brand">${dir.label}</span></td>
      <td><div class="stage-pills" title="${STAGES[si].label}">${pills}</div>
        <div class="muted" style="font-size:11.5px;margin-top:5px">${STAGES[si].label}</div></td>
      <td>${esc(r.owner || '—')}</td>
      <td>${rec ? `<span class="badge ${rec.badge}">${rec.label}</span>` : '<span class="muted">—</span>'}</td>
      <td class="muted" style="font-size:12px">${fmtDate(r.updatedAt)}</td>
    </tr>`;
  }).join('');

  const body = reqs.length === 0
    ? `<div class="empty"><h3>还没有需求</h3>
        <p>从一个想法或一段会议记录开始，选择方向与阶段，10 分钟内产出一张可评审 Draft。</p>
        <div class="spacer"></div>
        <a class="btn btn-primary" href="#/new">＋ 新建需求</a>
        <button class="btn" id="seed-inline">载入示例需求</button></div>`
    : `<div class="panel panel-pad">
        <div class="wb-toolbar">
          <div class="wb-filters">${filters}</div>
          <a class="btn btn-primary btn-sm" href="#/new">＋ 新建需求</a>
        </div>
        <table class="req-table">
          <thead><tr><th>需求</th><th>方向</th><th>阶段</th><th>负责人</th><th>最近结论</th><th>更新</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="muted" style="text-align:center;padding:30px">该阶段暂无需求</td></tr>`}</tbody>
        </table>
      </div>`;

  return `<div class="page-head">
      <h1 class="page-title">工作台</h1>
      <p class="page-sub">把一号位的判断原则显性化：为什么做、为谁做、做到什么程度、哪些暂时不做、需要谁一起完成。</p>
    </div>${body}`;
}

function bindWorkbench() {
  $$('.chip-filter').forEach(b => b.onclick = () => { wbFilter = b.dataset.f; render(); });
  $$('.req-row').forEach(tr => tr.onclick = () => {
    const r = State.get(tr.dataset.id);
    navigate(`#/req/${r.id}/${r.stage}`);
  });
  const si = $('#seed-inline'); if (si) si.onclick = seedExample;
}

/* ============================================================
 * VIEW: New 新建需求
 * ============================================================ */
function viewNew() {
  const el = document.createElement('div');
  const dirChips = DIRECTION_ORDER.map(k => {
    const d = DIRECTIONS[k];
    return `<div class="choice ${k === 'general' ? 'sel' : ''}" data-dir="${k}">
      ${d.label}<small>${d.hint}</small></div>`;
  }).join('');

  el.innerHTML = `
    <div class="page-head">
      <h1 class="page-title">新建需求</h1>
      <p class="page-sub">输入一个想法或粘贴会议记录，选择方向与阶段。平台会据此替换必填问题、风险清单、指标建议与架构占位。</p>
    </div>
    <div class="split">
      <div class="panel panel-pad">
        <label class="field">
          <div class="field-label">需求名称</div>
          <input type="text" id="f-name" placeholder="例如：通话中实时话术助攻" />
        </label>
        <div class="grid cols-2">
          <label class="field">
            <div class="field-label">提出人 / 来源 <span class="opt">选填</span></div>
            <input type="text" id="f-source" placeholder="例如：客服团队反馈 / 周会" />
          </label>
          <label class="field">
            <div class="field-label">执行负责人 <span class="opt">选填</span></div>
            <input type="text" id="f-owner" placeholder="例如：小林（产品）" />
          </label>
        </div>
        <label class="field">
          <div class="field-label">想法 / 会议记录</div>
          <textarea id="f-input" rows="7" placeholder="用几句话描述：谁、在什么场景、遇到什么阻碍、你想做成什么。也可以直接粘贴一段会议记录。"></textarea>
        </label>
      </div>

      <div class="panel panel-pad">
        <div class="section-title">方向</div>
        <p class="section-hint">不同方向会切换 SOP：必填问题、风险清单、指标与架构占位。</p>
        <div class="choices" id="dir-choices">${dirChips}</div>
        <div class="hint-box" id="dir-focus" style="margin-top:14px"></div>

        <div class="section-title">起始阶段</div>
        <p class="section-hint">通常从「冒烟讨论」开始，先对齐价值与方向。</p>
        <div class="choices" id="stage-choices">
          ${STAGES.map((s, i) => `<div class="choice ${i === 0 ? 'sel' : ''}" data-stage="${s.key}">${s.label}</div>`).join('')}
        </div>

        <div class="spacer"></div>
        <div class="btn-row">
          <button class="btn btn-primary" id="create-btn">创建并进入</button>
          <a class="btn" href="#/workbench">取消</a>
        </div>
      </div>
    </div>`;

  let dir = 'general', stage = 'smoke';
  const focusBox = $('#dir-focus', el);
  const renderFocus = () => {
    const d = DIRECTIONS[dir];
    focusBox.innerHTML = `<b>${d.label} · 验证重点</b><br>${esc(d.focus)}`;
  };
  renderFocus();

  $$('#dir-choices .choice', el).forEach(c => c.onclick = () => {
    $$('#dir-choices .choice', el).forEach(x => x.classList.remove('sel'));
    c.classList.add('sel'); dir = c.dataset.dir; renderFocus();
  });
  $$('#stage-choices .choice', el).forEach(c => c.onclick = () => {
    $$('#stage-choices .choice', el).forEach(x => x.classList.remove('sel'));
    c.classList.add('sel'); stage = c.dataset.stage;
  });

  $('#create-btn', el).onclick = () => {
    const name = $('#f-name', el).value.trim();
    if (!name) { toast('请先填写需求名称'); $('#f-name', el).focus(); return; }
    const req = {
      id: uid(), name,
      source: $('#f-source', el).value.trim(),
      owner: $('#f-owner', el).value.trim(),
      input: $('#f-input', el).value.trim(),
      direction: dir, stage,
      createdAt: Date.now(), updatedAt: Date.now(),
      chat: [], smoke: null, draft: null, review: null,
    };
    State.upsert(req);
    toast('已创建需求');
    navigate(`#/req/${req.id}/${stage}`);
  };

  return el;
}

/* ============================================================
 * Requirement stage router
 * ============================================================ */
function reqHeader(req, stage) {
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  const st = STAGES[STAGE_INDEX[stage]];
  return `<div class="crumbs">
      <a href="#/workbench" style="color:inherit;text-decoration:none">工作台</a> ›
      <b>${esc(req.name)}</b> › ${st.label}
    </div>
    <div class="page-head flex-between">
      <div>
        <h1 class="page-title">${esc(req.name)}</h1>
        <p class="page-sub"><span class="badge badge-brand">${dir.label}</span>
          <span class="muted" style="margin-left:8px">${st.goal} ｜ 通过条件：${st.pass}</span></p>
      </div>
    </div>`;
}

function stageStepper(req, stage) {
  return `<div class="panel panel-pad" style="margin-bottom:18px">
    <div class="btn-row" style="justify-content:space-between">
      <div class="btn-row">
        ${STAGES.map(s => {
          const reached = STAGE_INDEX[req.stage] >= STAGE_INDEX[s.key];
          const cur = s.key === stage;
          return `<a class="btn btn-sm ${cur ? 'btn-primary' : ''}" href="#/req/${req.id}/${s.key}"
            style="${reached || cur ? '' : 'opacity:.55'}">${reached && !cur ? '✓ ' : ''}${s.short}</a>`;
        }).join('<span class="muted" style="align-self:center">→</span>')}
      </div>
      <div class="muted" style="font-size:12px;align-self:center">最近更新 ${fmtDate(req.updatedAt)}</div>
    </div>
  </div>`;
}

function renderReqStage(req, stage) {
  const view = $('#view');
  view.innerHTML = reqHeader(req, stage) + stageStepper(req, stage) + `<div id="stage-body"></div>`;
  const body = $('#stage-body');
  if (stage === 'smoke') renderSmoke(req, body);
  else if (stage === 'draft') renderDraft(req, body);
  else if (stage === 'architecture') renderArchitecture(req, body);
  else if (stage === 'review') renderReview(req, body);
}

function advanceStage(req, to) {
  if (STAGE_INDEX[to] > STAGE_INDEX[req.stage]) { req.stage = to; State.upsert(req); }
  else State.upsert(req);
}

/* ============================================================
 * STAGE: Smoke 冒烟讨论（左对话，右实时卡片）
 * ============================================================ */
function renderSmoke(req, root) {
  req.chat = req.chat || [];
  if (!req.smoke) req.smoke = generateSmokeCard(req);

  root.innerHTML = `<div class="split">
    <div class="panel panel-pad">
      <div class="section-title">冒烟讨论</div>
      <p class="section-hint">顺序：问题 → 价值 → 方向 → 边界 → 验证。助手只追问最关键的 1–3 个问题。</p>
      <div class="chat">
        <div class="chat-log" id="chat-log"></div>
        <div class="chat-input">
          <textarea id="chat-in" rows="1" placeholder="补充信息或回答助手的追问…（Enter 发送）"></textarea>
          <button class="btn btn-primary" id="chat-send">发送</button>
        </div>
      </div>
    </div>

    <div class="panel panel-pad" id="smoke-card"></div>
  </div>`;

  // seed chat
  if (req.chat.length === 0) {
    req.chat.push({ role: 'bot', text: '我是 Principle 一号位助手。我已根据你的输入生成了一张冒烟卡片（右侧），并区分了「已知 / 假设 / 待验证」。\n\n先回答最关键的问题：' + (DIRECTIONS[req.direction] || DIRECTIONS.general).questions[0] });
    State.upsert(req);
  }

  const log = $('#chat-log', root);
  const renderChat = () => {
    log.innerHTML = req.chat.map(m => m.role === 'user'
      ? `<div class="msg user">${esc(m.text)}</div>`
      : `<div class="msg bot"><div class="msg-role">一号位助手</div>${esc(m.text)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
  };
  renderChat();
  renderSmokeCard(req, $('#smoke-card', root));

  const input = $('#chat-in', root);
  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    req.chat.push({ role: 'user', text });
    // 助手：把用户输入并入 input 并重新解析卡片相关字段
    req.input = (req.input ? req.input + '\n' : '') + text;
    reparseSmoke(req);
    const rd = evaluateReadiness(req);
    const missing = rd.checks.filter(c => !c.ok).map(c => c.key);
    const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
    const qIdx = Math.min(req.chat.filter(m => m.role === 'bot').length, dir.questions.length - 1);
    const follow = missing.length
      ? `已更新卡片（完成度 ${rd.pct}%）。还差：${missing.slice(0, 3).join('、')}。\n\n下一个关键问题：${dir.questions[qIdx]}`
      : `信息已较完整（完成度 ${rd.pct}%）。建议进入 Draft 做结构化拆解。`;
    req.chat.push({ role: 'bot', text: follow });
    State.upsert(req);
    input.value = ''; input.style.height = 'auto';
    renderChat();
    renderSmokeCard(req, $('#smoke-card', root));
  };
  $('#chat-send', root).onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
  input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };
}

/* 依据 req.input 重新解析冒烟卡片里可推断的字段（保留用户已手改的内容策略：直接重算 targetUser/scene/pain） */
function reparseSmoke(req) {
  const fresh = generateSmokeCard(req);
  const s = req.smoke;
  ['targetUser', 'scene', 'painPoint', 'valueProp', 'conclusion'].forEach(k => {
    if (isTodoVal(s[k])) s[k] = fresh[k];
  });
}

function renderSmokeCard(req, box) {
  const s = req.smoke;
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  const rd = evaluateReadiness(req);

  box.innerHTML = `
    <div class="flex-between">
      <div class="section-title">冒烟卡片</div>
      <div class="readiness">
        <div class="ring" style="--p:${rd.pct}" data-label="${rd.pct}%"></div>
      </div>
    </div>
    <p class="section-hint">灰色斜体 = 待补充 / 待验证。可点击任意字段直接编辑。</p>

    ${editableKV('目标用户', s.targetUser, 'targetUser')}
    ${editableKV('关键场景', s.scene, 'scene')}
    ${editableKV('当前痛点', s.painPoint, 'painPoint')}
    ${editableKV('一句话价值主张', s.valueProp, 'valueProp')}
    ${editableKV('一句话结论', s.conclusion, 'conclusion')}

    <div class="kv"><div class="kv-label">P0 主路径</div>
      <div class="flow">${s.p0Path.map((n, i) =>
        `<span class="flow-node">${esc(n)}</span>${i < s.p0Path.length - 1 ? '<span class="flow-arrow">→</span>' : ''}`).join('')}</div></div>

    <div class="kv"><div class="kv-label">核心假设</div>
      <div class="kv-val">${s.assumptions.map(a => `• ${esc(a)}`).join('<br>')}</div></div>

    ${editableKV('证据 / 数据 / 用户原话', s.evidence, 'evidence')}
    ${editableKV('本期不做', s.notInScope, 'notInScope')}
    ${editableKV('最小验证', s.minValidation, 'minValidation')}

    <div class="kv"><div class="kv-label">需要参与的人</div>
      <div class="tag-list">${ROLES.map(r => {
        const on = s.participants.includes(r);
        return `<span class="tag" data-role="${r}" style="cursor:pointer;${on ? 'background:var(--brand-soft);color:var(--brand);font-weight:600' : ''}">${r}</span>`;
      }).join('')}</div></div>

    <div class="kv"><div class="kv-label">待验证问题（${dir.label}）</div>
      <div class="kv-val">${dir.questions.map(q => `• ${esc(q)}`).join('<br>')}</div></div>

    <div class="spacer"></div>
    <div class="btn-row">
      <button class="btn btn-primary" id="to-draft">生成 Draft →</button>
      <button class="btn" id="regen-smoke">重新生成</button>
    </div>`;

  // editable fields
  $$('[data-edit]', box).forEach(el => el.onclick = () => makeEditable(el, req, 'smoke'));
  // role toggles
  $$('[data-role]', box).forEach(t => t.onclick = () => {
    const r = t.dataset.role;
    const i = s.participants.indexOf(r);
    if (i >= 0) s.participants.splice(i, 1); else s.participants.push(r);
    State.upsert(req); renderSmokeCard(req, box);
    $$('[data-edit]', box).forEach(el => el.onclick = () => makeEditable(el, req, 'smoke'));
  });
  $('#regen-smoke', box).onclick = () => {
    req.smoke = generateSmokeCard(req); State.upsert(req); renderSmoke(req, $('#stage-body')); toast('已按当前输入重新生成');
  };
  $('#to-draft', box).onclick = () => {
    if (!req.draft) req.draft = generateDraft(req);
    advanceStage(req, 'draft');
    toast('已生成 Draft 骨架');
    navigate(`#/req/${req.id}/draft`);
  };
}

function editableKV(label, val, field) {
  const todo = isTodoVal(val);
  return `<div class="kv"><div class="kv-label">${esc(label)}</div>
    <div class="kv-val ${todo ? 'todo' : ''}" data-edit="${field}" title="点击编辑" style="cursor:text">${esc(val || '待补充')}</div></div>`;
}

function makeEditable(el, req, bag) {
  const field = el.dataset.edit;
  const cur = req[bag][field];
  const startVal = isTodoVal(cur) ? '' : cur;
  const ta = document.createElement('textarea');
  ta.value = startVal; ta.rows = 2; ta.style.marginTop = '2px';
  el.replaceWith(ta); ta.focus();
  const commit = () => {
    req[bag][field] = ta.value.trim() || '待补充';
    State.upsert(req);
    // re-render the whole card/section for consistency
    if (bag === 'smoke') renderSmokeCard(req, $('#smoke-card'));
    else render();
  };
  ta.onblur = commit;
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); } if (e.key === 'Escape') { ta.value = startVal; ta.blur(); } };
}

/* ============================================================
 * STAGE: Draft 章节化编辑 + 缺失项提示
 * ============================================================ */
function renderDraft(req, root) {
  if (!req.draft) req.draft = generateDraft(req);
  const d = req.draft;
  const rd = evaluateReadiness(req);

  const complexityRows = d.complexity.map((c, i) => `<tr>
    <td>${esc(c.dim)}</td>
    <td>${levelSelect(c.level, i)}</td>
    <td class="${isTodoVal(c.reason) ? 'todo' : ''}" data-dedit="complexity.${i}.reason">${esc(c.reason)}</td>
    <td class="${isTodoVal(c.owner) ? 'todo' : ''}" data-dedit="complexity.${i}.owner">${esc(c.owner)}</td>
  </tr>`).join('');

  const featureRows = d.features.map((f, i) => `<tr>
    <td data-dedit="features.${i}.name" class="${isTodoVal(f.name) ? 'todo' : ''}">${esc(f.name)}</td>
    <td><span class="pri ${f.pri === 'P0' ? 'pri-p0' : 'pri-p1'}" data-prit="${i}" style="cursor:pointer">${f.pri}</span></td>
    <td data-dedit="features.${i}.userGoal" class="${isTodoVal(f.userGoal) ? 'todo' : ''}">${esc(f.userGoal)}</td>
    <td data-dedit="features.${i}.system" class="${isTodoVal(f.system) ? 'todo' : ''}">${esc(f.system)}</td>
    <td data-dedit="features.${i}.accept" class="${isTodoVal(f.accept) ? 'todo' : ''}">${esc(f.accept)}</td>
  </tr>`).join('');

  const compRows = d.competitors.map((c, i) => `<tr>
    <td data-dedit="competitors.${i}.name" class="${isTodoVal(c.name) ? 'todo' : ''}">${esc(c.name)}</td>
    <td data-dedit="competitors.${i}.approach" class="${isTodoVal(c.approach) ? 'todo' : ''}">${esc(c.approach)}</td>
    <td data-dedit="competitors.${i}.learn" class="${isTodoVal(c.learn) ? 'todo' : ''}">${esc(c.learn)}</td>
    <td data-dedit="competitors.${i}.diff" class="${isTodoVal(c.diff) ? 'todo' : ''}">${esc(c.diff)}</td>
    <td data-dedit="competitors.${i}.evidence" class="${isTodoVal(c.evidence) ? 'todo' : ''}">${esc(c.evidence)}</td>
  </tr>`).join('');

  const riskRows = d.risks.map((r, i) => `<tr>
    <td>${esc(r.risk)}</td>
    <td data-dedit="risks.${i}.trigger" class="${isTodoVal(r.trigger) ? 'todo' : ''}">${esc(r.trigger)}</td>
    <td>${esc(r.mitig)}</td>
  </tr>`).join('');

  const metricBlocks = Object.entries(d.metrics).map(([k, v]) =>
    `<div class="kv"><div class="kv-label">${k}</div><div class="tag-list">${v.map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div></div>`).join('');

  root.innerHTML = `<div class="split">
    <div>
      <div class="panel panel-pad">
        <div class="section-title">Draft · 需求草案</div>
        <p class="section-hint">竞品事实不编造；缺内容标记「待补充」。点击任意灰色斜体单元格可编辑。</p>

        <div class="draft-sec">
          <div class="section-title" style="font-size:14px">4.2 一句话结论</div>
          ${editableKVBag('oneLineConclusion', d.oneLineConclusion, 'draft')}
        </div>

        <div class="draft-sec">
          <div class="section-title" style="font-size:14px">4.4 竞品与替代方案</div>
          <table class="mini-table"><thead><tr><th>竞品/替代</th><th>核心做法</th><th>借鉴</th><th>差异</th><th>证据</th></tr></thead>
            <tbody>${compRows}</tbody></table>
          <div class="spacer-sm"></div><button class="btn btn-sm" id="add-comp">+ 增加一行</button>
        </div>

        <div class="draft-sec">
          <div class="section-title" style="font-size:14px">4.5 关键流程与功能</div>
          <table class="mini-table"><thead><tr><th>功能</th><th>优先级</th><th>用户完成</th><th>系统怎么做</th><th>验收标准</th></tr></thead>
            <tbody>${featureRows}</tbody></table>
          <div class="spacer-sm"></div><button class="btn btn-sm" id="add-feat">+ 增加功能</button>
        </div>

        <div class="draft-sec">
          <div class="section-title" style="font-size:14px">4.6 难度与协作判断 <span class="muted" style="font-weight:400;font-size:12px">S / M / L / XL</span></div>
          <table class="mini-table"><thead><tr><th>维度</th><th>等级</th><th>理由 / 前置</th><th>负责人</th></tr></thead>
            <tbody>${complexityRows}</tbody></table>
        </div>

        <div class="draft-sec">
          <div class="section-title" style="font-size:14px">4.8 风险、指标与不在本期</div>
          <table class="mini-table"><thead><tr><th>风险</th><th>触发条件</th><th>缓解动作</th></tr></thead>
            <tbody>${riskRows}</tbody></table>
          <div class="spacer"></div>
          <div class="grid cols-2">${metricBlocks}</div>
          <div class="spacer"></div>
          <div class="kv-label">本期不做</div>
          ${d.notInScope.map((n, i) => `<div class="kv-val ${isTodoVal(n.item) ? 'todo' : ''}" data-dedit="notInScope.${i}.item">${esc(n.item)}<span class="muted"> — 原因：</span><span class="${isTodoVal(n.reason) ? 'todo' : ''}" data-dedit="notInScope.${i}.reason">${esc(n.reason)}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div>
      <div class="panel panel-pad" style="position:sticky;top:0">
        <div class="flex-between">
          <div class="section-title">缺失项提示</div>
          <div class="ring" style="--p:${rd.pct}" data-label="${rd.pct}%"></div>
        </div>
        <p class="section-hint">对照「进入排期的完成标准」（${rd.done}/${rd.total}）。</p>
        <ul class="checklist">
          ${rd.checks.map(c => `<li>
            <span class="check-ico ${c.ok ? 'ok' : 'miss'}">${c.ok ? '✓' : '!'}</span>
            <span class="check-txt"><span class="t">${esc(c.key)}</span><span class="d">${esc(c.detail)}</span></span>
          </li>`).join('')}
        </ul>
        <div class="spacer"></div>
        <div class="btn-row">
          <button class="btn btn-primary" id="to-arch">进入架构拆解 →</button>
        </div>
        <div class="spacer-sm"></div>
        <div class="btn-row">
          <a class="btn btn-sm" href="#/req/${req.id}/smoke">← 回冒烟</a>
          <button class="btn btn-sm" id="to-review">直接去评审</button>
        </div>
      </div>
    </div>
  </div>`;

  // editable cells
  $$('[data-dedit]', root).forEach(el => el.onclick = () => makeDeepEditable(el, req));
  $$('[data-edit]', root).forEach(el => el.onclick = () => makeEditable(el, req, 'draft'));
  // priority toggle
  $$('[data-prit]', root).forEach(el => el.onclick = () => {
    const f = d.features[+el.dataset.prit];
    f.pri = f.pri === 'P0' ? 'P1' : 'P0'; State.upsert(req); renderDraft(req, root);
  });
  // level selects
  $$('select[data-lvl]', root).forEach(sel => sel.onchange = () => {
    d.complexity[+sel.dataset.lvl].level = sel.value; State.upsert(req); renderDraft(req, root);
  });
  $('#add-comp', root).onclick = () => { d.competitors.push({ name: '待补充', approach: '待补充', learn: '待补充', diff: '待补充', evidence: '待补充' }); State.upsert(req); renderDraft(req, root); };
  $('#add-feat', root).onclick = () => { d.features.push({ name: '待补充', pri: 'P1', userGoal: '待补充', system: '待补充', dep: '', accept: '待补充' }); State.upsert(req); renderDraft(req, root); };
  $('#to-arch', root).onclick = () => { advanceStage(req, 'architecture'); navigate(`#/req/${req.id}/architecture`); };
  $('#to-review', root).onclick = () => { advanceStage(req, 'review'); navigate(`#/req/${req.id}/review`); };
}

function editableKVBag(field, val, bag) {
  const todo = isTodoVal(val);
  return `<div class="kv-val ${todo ? 'todo' : ''}" data-edit="${field}" title="点击编辑" style="cursor:text">${esc(val || '待补充')}</div>`;
}

function levelSelect(val, i) {
  const opts = ['', 'S', 'M', 'L', 'XL'];
  return `<select data-lvl="${i}">${opts.map(o =>
    `<option value="${o}" ${o === val ? 'selected' : ''}>${o || '—'}</option>`).join('')}</select>`;
}

/* deep path editing: e.g. "features.0.accept" */
function makeDeepEditable(el, req) {
  const path = el.dataset.dedit.split('.');
  let obj = req.draft;
  for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
  const key = path[path.length - 1];
  const cur = obj[key];
  const startVal = isTodoVal(cur) ? '' : cur;
  const ta = document.createElement('textarea');
  ta.value = startVal; ta.rows = 2;
  const parent = el; const tag = el.tagName;
  el.replaceWith(ta); ta.focus();
  const commit = () => {
    obj[key] = ta.value.trim() || '待补充';
    State.upsert(req);
    renderReqStage(req, 'draft');
  };
  ta.onblur = commit;
  ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); } if (e.key === 'Escape') { ta.value = startVal; ta.blur(); } };
}

/* ============================================================
 * STAGE: Architecture 架构拆解（四模块卡片 + 可替换占位）
 * ============================================================ */
function renderArchitecture(req, root) {
  const active = (DIRECTIONS[req.direction] || DIRECTIONS.general).arch;
  const modules = [
    { key: 'voice-duplex', ...DIRECTIONS['voice-duplex'].arch },
    { key: 'call-assist', ...DIRECTIONS['call-assist'].arch },
    { key: 'memory', ...DIRECTIONS['memory'].arch },
    { key: 'agentic', ...DIRECTIONS['agentic'].arch },
  ];
  const supplements = ['架构图', '数据流', '接口', '时延预算', '异常路径', '评估集', '灰度方案'];

  const cards = modules.map(m => {
    const isActive = active && active.module === m.module;
    return `<div class="arch-card ${isActive ? '' : 'dim'}">
      <div class="flex-between"><h4>${esc(m.module)}</h4>
        ${isActive ? '<span class="badge badge-brand">当前方向</span>' : '<span class="badge badge-mute">占位</span>'}</div>
      <p class="arch-focus">${esc(DIRECTIONS[m.key].focus)}</p>
      <div class="arch-placeholder">${esc(m.module)} ${esc(m.slots)}</div>
      <ul class="arch-todo">${supplements.map(s => `<li>${s}</li>`).join('')}</ul>
    </div>`;
  }).join('');

  root.innerHTML = `
    <div class="hint-box"><b>架构占位说明：</b>平台按「方向」高亮当前模块，其余模块保留占位。每个模块需补齐：架构图、数据流、接口、时延预算、异常路径、评估集、灰度方案。在线编辑架构图放在后续版本。</div>
    <div class="grid cols-2">${cards}</div>
    <div class="spacer"></div>
    <div class="panel panel-pad">
      <div class="section-title">技术负责人确认</div>
      <p class="section-hint">通过条件：技术负责人确认边界和实现路径。</p>
      <label class="field">
        <div class="field-label">边界与实现路径确认</div>
        <textarea id="arch-note" rows="3" placeholder="记录技术负责人对模块边界、接口、数据流与实现路径的确认意见…">${esc(req.archNote || '')}</textarea>
      </label>
      <div class="btn-row">
        <button class="btn btn-primary" id="to-review2">进入评审 / 排期 →</button>
        <a class="btn" href="#/req/${req.id}/draft">← 回 Draft</a>
      </div>
    </div>`;

  $('#arch-note', root).onblur = e => { req.archNote = e.target.value; State.upsert(req); };
  $('#to-review2', root).onclick = () => { req.archNote = $('#arch-note', root).value; advanceStage(req, 'review'); navigate(`#/req/${req.id}/review`); };
}

/* ============================================================
 * STAGE: Review 评审 / 排期 + 导出
 * ============================================================ */
function renderReview(req, root) {
  if (!req.review) req.review = suggestReview(req);
  const r = req.review;
  const rd = evaluateReadiness(req);

  const decisionCards = Object.entries(DECISIONS).map(([k, v]) =>
    `<div class="decision ${r.decision === k ? 'sel' : ''}" data-k="${k}">
      <div class="d-title">${v.label}</div><div class="d-desc">${v.desc}</div></div>`).join('');

  root.innerHTML = `<div class="split">
    <div class="panel panel-pad">
      <div class="section-title">一号位评审</div>
      <p class="section-hint">每次只推进一个评审问题：是否继续、改什么、谁负责、何时再看。判断需引用 Draft 已有信息。</p>

      <div class="field-label">建议结论</div>
      <div class="decision-grid">${decisionCards}</div>
      <div class="spacer"></div>

      <label class="field"><div class="field-label">最值得保留（3 点）</div>
        <textarea id="rv-keep" rows="2">${esc(r.keep3)}</textarea></label>
      <label class="field"><div class="field-label">最大风险（3 点）</div>
        <textarea id="rv-risk" rows="2">${esc(r.risk3)}</textarea></label>
      <label class="field"><div class="field-label">必须补齐</div>
        <textarea id="rv-must" rows="2">${esc(r.mustAdd)}</textarea></label>
      <div class="grid cols-2">
        <label class="field"><div class="field-label">下一步动作</div>
          <input type="text" id="rv-next" value="${esc(r.nextStep)}"></label>
        <label class="field"><div class="field-label">负责人角色</div>
          <input type="text" id="rv-owner" value="${esc(r.ownerRole)}"></label>
      </div>
      <label class="field"><div class="field-label">时间点</div>
        <input type="text" id="rv-time" value="${esc(r.timepoint)}" placeholder="例如：下周三前补齐后复评"></label>

      <div class="btn-row">
        <button class="btn btn-primary" id="rv-save">保存评审结论</button>
        <a class="btn" href="#/req/${req.id}/architecture">← 回架构</a>
      </div>
    </div>

    <div class="panel panel-pad">
      <div class="flex-between">
        <div class="section-title">评审记录导出</div>
        <div class="ring" style="--p:${rd.pct}" data-label="${rd.pct}%"></div>
      </div>
      <p class="section-hint">导出结构化 Markdown，可直接粘贴进 Draft 文档或评审记录。</p>
      <div class="btn-row" style="margin-bottom:12px">
        <button class="btn btn-primary btn-sm" id="exp-copy">复制 Markdown</button>
        <button class="btn btn-sm" id="exp-dl">下载 .md</button>
      </div>
      <div class="export-pre" id="exp-pre"></div>
    </div>
  </div>`;

  const refreshExport = () => { $('#exp-pre', root).textContent = exportMarkdown(req); };

  $$('.decision', root).forEach(d => d.onclick = () => {
    r.decision = d.dataset.k;
    $$('.decision', root).forEach(x => x.classList.toggle('sel', x.dataset.k === r.decision));
    State.upsert(req); refreshExport();
  });

  const bind = (id, key) => { $(id, root).oninput = e => { r[key] = e.target.value; State.upsert(req); refreshExport(); }; };
  bind('#rv-keep', 'keep3'); bind('#rv-risk', 'risk3'); bind('#rv-must', 'mustAdd');
  bind('#rv-next', 'nextStep'); bind('#rv-owner', 'ownerRole'); bind('#rv-time', 'timepoint');

  $('#rv-save', root).onclick = () => {
    if (r.decision === 'pass') advanceStage(req, 'review');
    State.upsert(req); toast('评审结论已保存');
  };
  $('#exp-copy', root).onclick = () => copyText(exportMarkdown(req));
  $('#exp-dl', root).onclick = () => download(`${req.name || 'draft'}-评审记录.md`, exportMarkdown(req));

  refreshExport();
}

/* ============================================================
 * VIEW: Principle 总原则
 * ============================================================ */
function viewPrinciple() {
  const list = PRINCIPLES.map(([t, d], i) =>
    `<li><span class="p-num">${i + 1}</span><div class="p-body"><b>${esc(t)}</b><span>${esc(d)}</span></div></li>`).join('');

  const flowRows = STAGES.map(s =>
    `<tr><td><b>${s.label}</b></td><td>${s.goal}</td><td>${s.output}</td><td>${s.pass}</td></tr>`).join('');

  const dod = DEFINITION_OF_DONE.map(x => `<span class="tag">${esc(x)}</span>`).join('');

  return `<div class="page-head">
      <h1 class="page-title">总原则 · Principle</h1>
      <p class="page-sub">当一个需求从想法进入执行，先回答：为什么做、为谁做、做到什么程度、哪些暂时不做、需要谁一起完成。</p>
    </div>
    <div class="split">
      <div class="panel panel-pad">
        <div class="section-title">判断原则</div>
        <p class="section-hint">让小同学沿同一套路径产出，减少反复返工。</p>
        <ul class="principle-list">${list}</ul>
      </div>
      <div>
        <div class="panel panel-pad">
          <div class="section-title">进入排期的完成标准</div>
          <p class="section-hint">同时具备以下内容才可进入排期：</p>
          <div class="tag-list">${dod}</div>
        </div>
        <div class="spacer"></div>
        <div class="panel panel-pad">
          <div class="section-title">核心产物</div>
          <div class="kv"><div class="kv-label">Principle</div><div class="kv-val">判断一件事是否值得做、先做什么、什么算完成。</div></div>
          <div class="kv"><div class="kv-label">SOP</div><div class="kv-val">按方向和阶段给出下一步动作、必填问题和评审门槛。</div></div>
          <div class="kv"><div class="kv-label">Draft</div><div class="kv-val">把结论沉淀成可评审、可协作、可追踪的需求草案。</div></div>
        </div>
      </div>
    </div>
    <div class="spacer"></div>
    <div class="panel panel-pad">
      <div class="section-title">全流程总览</div>
      <table class="flow-table">
        <thead><tr><th>阶段</th><th>目标</th><th>必须产出</th><th>通过条件</th></tr></thead>
        <tbody>${flowRows}</tbody>
      </table>
    </div>`;
}

/* ============================================================
 * Example seed
 * ============================================================ */
function seedExample() {
  const req = {
    id: uid(),
    name: '通话中实时话术助攻',
    source: '客服团队周会反馈',
    owner: '小林（产品）',
    direction: 'call-assist',
    stage: 'draft',
    input: '客服坐席在通话过程中经常想不起最合适的话术，遇到客户异议时容易卡壳，导致转化下降。希望在通话时根据实时对话，把最该说的一句话术在正确时机推到坐席屏幕上，坐席一眼能看到并决定是否采纳。',
    createdAt: Date.now(), updatedAt: Date.now(),
    chat: [],
  };
  req.smoke = generateSmokeCard(req);
  req.smoke.targetUser = '一线客服坐席（尤其新人）';
  req.smoke.scene = '与客户实时通话、遇到异议或复杂问题时';
  req.smoke.painPoint = '想不起最合适话术、遇异议卡壳，转化下降';
  req.smoke.valueProp = '在正确时机把最该说的一句话术推给坐席，降低卡壳、提升转化';
  req.smoke.conclusion = '要做成：通话中按实时对话推送单条最优话术并可一键采纳';
  req.smoke.evidence = '周会反馈：新人首月转化比老人低 20%（待用数据核实）';
  req.smoke.notInScope = '本期不做全自动应答、不做通话后质检报告';
  req.smoke.minValidation = '选 1 个高频异议场景灰度，成功信号=建议采纳率>30% 且转化不降';
  req.draft = generateDraft(req);
  req.draft.oneLineConclusion = '面向 [一线客服坐席]，在 [实时通话遇到客户异议] 时，通过 [实时话术建议]，让坐席获得 [更高的异议化解率与转化]';
  req.draft.features[0] = { name: '实时话术建议卡', pri: 'P0', userGoal: '在正确时机看到单条最优话术', system: '监听通话事件→匹配话术→在静默窗口推送', dep: '通话助攻', accept: '建议时机准确率>80%，同屏建议≤1条' };
  req.draft.features.push({ name: '一键采纳与回写', pri: 'P0', userGoal: '一键采用并记录效果', system: '采纳埋点→回写通话记录', dep: '数据', accept: '采纳可回写，采纳率可统计' });
  State.upsert(req);
  toast('已载入示例需求');
  navigate(`#/req/${req.id}/draft`);
}

/* ============================================================
 * Boot
 * ============================================================ */
$('#seed-btn').onclick = seedExample;
$('#reset-btn').onclick = () => {
  if (confirm('清空本地全部需求数据？此操作不可恢复。')) { State.clear(); navigate('#/workbench'); render(); toast('已清空'); }
};
window.addEventListener('hashchange', render);
if (!location.hash) location.hash = '#/workbench';
render();
