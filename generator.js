/* ============================================================
 * generator.js — Demo 版「Principle 一号位助手」
 *
 * 可离线运行：用规则 + 模板把输入 / 上传物料结构化为
 * 冒烟 / Draft / PRD 文档，严格对齐范本章节。
 * 上传的 HTML 抽正文关键信息填字段；图片/视频充当范本里「必填」的线框图/截图/高保真。
 * 不编造事实，缺内容一律标「待补充」。接真实模型时替换这些函数为 §7 各阶段 Prompt 调用。
 * ============================================================ */

const TODO = '待补充';
const isTodo = v => v == null || String(v).trim() === '' || String(v).includes('待补充');

/* ---------- 文本抽取 ---------- */
function splitSentences(text) {
  return String(text || '').replace(/\s+/g, ' ').split(/[。.!?！？\n；;]/).map(s => s.trim()).filter(Boolean);
}
function firstSentence(text) { return splitSentences(text)[0] || ''; }
function pickAround(text, keywords) {
  for (const line of splitSentences(text)) if (keywords.some(k => line.includes(k))) return line;
  return '';
}

/* 从上传的 HTML 抽取标题 / 小标题 / 正文关键句 */
function extractHtmlText(html) {
  const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  const grab = re => { const out = []; let m; while ((m = re.exec(html))) out.push(strip(m[1])); return out.filter(Boolean); };
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const h1 = grab(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
  const h = grab(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi);
  const p = grab(/<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>/gi);
  const bodyText = strip((html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, html])[1]);
  return { title: title ? strip(title) : (h1[0] || ''), headings: h, paras: p, text: bodyText };
}

/* 汇总所有附件里可用于分析的文本 */
function gatheredText(req) {
  let t = req.input || '';
  (req.attachments || []).forEach(a => {
    if (a.kind === 'html' && a.text) { const e = extractHtmlText(a.text); t += '\n' + [e.title, ...e.headings, ...e.paras].join('\n'); }
    if (a.kind === 'file' && a.text) t += '\n' + a.text;
    if (a.note) t += '\n' + a.note;
  });
  return t;
}
function attachmentsByKind(req, kind) { return (req.attachments || []).filter(a => a.kind === kind); }

/* ---------- 冒烟文档 ---------- */
function generateSmoke(req) {
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  const text = gatheredText(req);
  const lead = firstSentence(text);
  const wire = attachmentsByKind(req, 'image').concat(attachmentsByKind(req, 'video'));
  return {
    generatedAt: Date.now(),
    conclusion: lead ? `${lead}（${TODO}：补「为什么现在做」）` : TODO,
    background: pickAround(text, ['来自', '反馈', '数据', '战略', '发布会', '老板', '因为']) || TODO,
    goals: [pickAround(text, ['目标', '做成', '希望', '让用户', '完成']) || TODO],
    nonGoals: [pickAround(text, ['不做', '非目标', '暂不', '本期不']) || TODO],
    approach: pickAround(text, ['方案', '怎么做', '通过', '实现', '流程']) || (lead ? `围绕「${lead}」的主路径（${TODO}）` : TODO),
    assumptions: dir.assume.slice(),
    complexity: SMOKE_TEMPLATE.complexity.dims.map(d => ({
      dim: d, level: '', basis: TODO,
    })),
    openQuestions: dir.questions.slice(),
    wireframeCount: wire.length,
    decision: '',
  };
}

/* ---------- Draft 文档 ---------- */
function generateDraft(req) {
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  const s = req.smoke || {};
  const text = gatheredText(req);
  const images = attachmentsByKind(req, 'image');
  return {
    generatedAt: Date.now(),
    basic: {
      '需求登记': req.name || TODO,
      '执行负责人': req.owner || TODO,
      'UED 接口人': TODO,
      '研发接口人': TODO,
      '所属团队/模块': dir.label,
      '目标版本/班车': TODO,
      '冒烟文档': req.smoke ? '已生成（见冒烟阶段）' : TODO,
      '文档状态': 'Draft 评审中',
    },
    conclusion: (s.conclusion && !isTodo(s.conclusion)) ? s.conclusion : TODO,
    bg_from: (s.background && !isTodo(s.background)) ? s.background : (pickAround(text, ['来自', '反馈', '数据', '战略']) || TODO),
    bg_now: pickAround(text, ['现状', '问题', '目前', '现在', '痛点']) || TODO,
    bg_ifnot: TODO,
    uv_who: pickAround(text, ['用户', '面向', '客户', '坐席', 'Maker', '创客']) || TODO,
    uv_better: (s.goals && s.goals[0] && !isTodo(s.goals[0])) ? s.goals[0] : TODO,
    uv_why: TODO,
    competitors: [{ name: TODO, approach: TODO, shot: images[0] ? images[0].id : '', compare: TODO }],
    features: [{
      name: TODO, pri: 'P0',
      scenario: (s.approach && !isTodo(s.approach)) ? s.approach : TODO,
      how: '1. 用户……\n2. 系统……\n3. ……',
      wire: images[0] ? images[0].id : '', note: '不触发条件 / 冲突 / 硬依赖：' + TODO,
    }],
    notInScope: [{ feature: (s.nonGoals && s.nonGoals[0] && !isTodo(s.nonGoals[0])) ? s.nonGoals[0] : TODO, reason: TODO }],
  };
}

/* ---------- PRD 文档 ---------- */
function generatePRD(req) {
  const images = attachmentsByKind(req, 'image');
  const d = req.draft || {};
  return {
    generatedAt: Date.now(),
    mainFlow: (d.features && d.features[0] && !isTodo(d.features[0].scenario)) ? d.features[0].scenario : TODO,
    visualIds: images.map(i => i.id),
    copy: [{ pos: TODO, text: TODO, note: TODO }],
    tracking: [{ event: TODO, when: TODO, params: TODO, use: TODO }],
    glossary: [{ term: TODO, def: TODO }],
    changelog: [{ date: new Date().toISOString().slice(0, 10), change: '初稿冻结', impact: '进入排期' }],
    frozen: false,
  };
}

/* ---------- 上传自动分析：把物料映射进当前阶段文档 ---------- */
function analyzeUpload(req) {
  const stage = req.stage;
  const hasDemo = (req.attachments || []).some(a => a.kind === 'html' || a.kind === 'code');
  if (hasDemo) {
    // 有 demo / 工程文件 → 直接拆解并生成内容（只填空字段，不覆盖手改）
    const ana = analyzeDemo(req);
    if (!req.smoke) req.smoke = generateSmoke(req);
    decomposeToSmoke(req, ana);
    if (stage === 'draft' || stage === 'prd') { if (!req.draft) req.draft = generateDraft(req); decomposeToDraft(req, ana); }
  } else {
    if (stage === 'smoke') mergeSmoke(req);
    else if (stage === 'draft') mergeDraft(req);
    else mergePRD(req);
  }
  const imgs = attachmentsByKind(req, 'image').length;
  const vids = attachmentsByKind(req, 'video').length;
  const htmls = attachmentsByKind(req, 'html').length;
  const codes = attachmentsByKind(req, 'code').length;
  const bits = [];
  if (htmls || codes) bits.push(`已拆解 ${htmls} 个 demo${codes ? ` / ${codes} 个工程文件` : ''} 并生成文档内容`);
  if (imgs) bits.push(`${imgs} 张图片作为线框图 / 截图`);
  if (vids) bits.push(`${vids} 段视频作为演示证据`);
  return bits.length ? bits.join('；') : '未识别到可分析的物料';
}

function mergeSmoke(req) {
  if (!req.smoke) { req.smoke = generateSmoke(req); return; }
  const fresh = generateSmoke(req);
  ['conclusion', 'background', 'approach'].forEach(k => { if (isTodo(req.smoke[k])) req.smoke[k] = fresh[k]; });
  ['goals', 'nonGoals'].forEach(k => { if (!req.smoke[k] || req.smoke[k].every(isTodo)) req.smoke[k] = fresh[k]; });
}
function mergeDraft(req) {
  if (!req.draft) { req.draft = generateDraft(req); return; }
  const fresh = generateDraft(req);
  ['conclusion', 'bg_from', 'bg_now', 'uv_who', 'uv_better'].forEach(k => { if (isTodo(req.draft[k])) req.draft[k] = fresh[k]; });
  // 补挂截图/线框图
  const imgs = attachmentsByKind(req, 'image');
  if (imgs[0] && req.draft.competitors[0] && !req.draft.competitors[0].shot) req.draft.competitors[0].shot = imgs[0].id;
  if (imgs[0] && req.draft.features[0] && !req.draft.features[0].wire) req.draft.features[0].wire = imgs[0].id;
}
function mergePRD(req) {
  if (!req.prd) { req.prd = generatePRD(req); return; }
  req.prd.visualIds = attachmentsByKind(req, 'image').map(i => i.id);
}

/* ---------- 完成度 / 缺失项（按阶段范本必填项） ---------- */
function evaluateReadiness(req, stage) {
  stage = stage || req.stage;
  let checks = [];
  if (stage === 'smoke') {
    const s = req.smoke || {};
    checks = [
      { key: '一句话结论', ok: !isTodo(s.conclusion), detail: '想做什么 + 为什么现在做' },
      { key: '背景', ok: !isTodo(s.background), detail: '需求来自哪里' },
      { key: '目标 / 非目标', ok: (s.goals || []).some(v => !isTodo(v)) && (s.nonGoals || []).some(v => !isTodo(v)), detail: '做成了什么变了 + 明确不做' },
      { key: '方案方向', ok: !isTodo(s.approach), detail: '粗颗粒怎么做' },
      { key: '尚未验证的假设', ok: (s.assumptions || []).some(v => !isTodo(v)), detail: '要赌的前提' },
      { key: '复杂度预判', ok: (s.complexity || []).every(c => c.level), detail: '研发/设计/依赖方 量级' },
      { key: '线框图 / 演示物料', ok: (s.wireframeCount || attachmentsByKind(req, 'image').length + attachmentsByKind(req, 'video').length) > 0, detail: '上传图片/视频/HTML 作为证据' },
      { key: '开放问题', ok: (s.openQuestions || []).some(v => !isTodo(v)), detail: '评审现场要对齐的问题' },
    ];
  } else if (stage === 'draft') {
    const d = req.draft || {};
    const b = d.basic || {};
    checks = [
      { key: '基本信息', ok: !isTodo(b['执行负责人']) && !isTodo(b['所属团队/模块']), detail: '登记/负责人/接口人/版本' },
      { key: '一句话结论', ok: !isTodo(d.conclusion), detail: '要做成什么样' },
      { key: '需求背景', ok: !isTodo(d.bg_from) && !isTodo(d.bg_now), detail: '来自哪里 + 现状问题 + 不做会怎样' },
      { key: '用户价值', ok: !isTodo(d.uv_who) && !isTodo(d.uv_better), detail: '目标用户 + 变好在哪 + 为什么会用' },
      { key: '竞品分析（截图必填）', ok: (d.competitors || []).some(c => !isTodo(c.name) && c.shot), detail: '竞品做法 + 截图 + 对比' },
      { key: '关键功能（线框图必填）', ok: (d.features || []).some(f => !isTodo(f.name) && f.wire), detail: '每个功能附线框图/高保真' },
      { key: '不在本期', ok: (d.notInScope || []).some(n => !isTodo(n.feature) && !isTodo(n.reason)), detail: '功能 + 原因' },
    ];
  } else if (stage === 'prd') {
    const p = req.prd || {};
    checks = [
      { key: '主流程与状态', ok: !isTodo(p.mainFlow), detail: '状态流转 + 异常分支' },
      { key: '主视觉 / 视觉稿', ok: (p.visualIds || []).length > 0, detail: '定稿高保真' },
      { key: '文案表', ok: (p.copy || []).some(c => !isTodo(c.text)), detail: '位置 + 文案' },
      { key: '埋点表', ok: (p.tracking || []).some(t => !isTodo(t.event)), detail: '事件 + 时机 + 参数' },
      { key: '名词表', ok: (p.glossary || []).some(g => !isTodo(g.term)), detail: '统一口径' },
      { key: '冻结 / Change Log', ok: !!p.frozen, detail: '定稿即承诺' },
    ];
  }
  const done = checks.filter(c => c.ok).length;
  return { checks, done, total: checks.length, pct: checks.length ? Math.round(done / checks.length * 100) : 0 };
}

/* ---------- 导出 Markdown（严格按范本章节顺序） ---------- */
function mdLine(label, v) { return `- **${label}**：${isTodo(v) ? TODO : v}`; }
function attName(req, id) { const a = (req.attachments || []).find(x => x.id === id); return a ? `［${a.kind === 'image' ? '截图' : a.kind}: ${a.name}］` : TODO; }

function exportMarkdown(req, stage) {
  stage = stage || req.stage;
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  const rd = evaluateReadiness(req, stage);
  const gate = (req.gates || {})[stage];
  const dec = gate && gate.decision ? DECISIONS[gate.decision] : null;
  const out = [];
  const st = STAGES[STAGE_INDEX[stage]];
  out.push(`# 【${st.label}】${req.name || '未命名需求'}`);
  out.push(`> 方向：**${dir.label}** ｜ 阶段：**${st.label}** ｜ 完成度：**${rd.pct}%**（${rd.done}/${rd.total}）` + (dec ? ` ｜ 评审：**${dec.label}**` : ''));
  out.push('');

  if (stage === 'smoke') {
    const s = req.smoke || {};
    out.push('## 一句话结论'); out.push(isTodo(s.conclusion) ? TODO : s.conclusion); out.push('');
    out.push('## 背景'); out.push(isTodo(s.background) ? TODO : s.background); out.push('');
    out.push('## 目标 / 非目标');
    (s.goals || []).forEach(g => out.push(`- 目标：${isTodo(g) ? TODO : g}`));
    (s.nonGoals || []).forEach(g => out.push(`- 非目标：${isTodo(g) ? TODO : g}`)); out.push('');
    out.push('## 思路 & 线框图');
    out.push(mdLine('方案方向', s.approach));
    (s.assumptions || []).forEach((a, i) => out.push(`- 尚未验证的假设 ${i + 1}：${isTodo(a) ? TODO : a}`));
    attachmentsByKind(req, 'image').concat(attachmentsByKind(req, 'video')).forEach(a => out.push(`- 线框图/演示：${a.kind === 'image' ? '截图' : '视频'} ${a.name}`));
    out.push('');
    out.push('## 复杂度预判');
    out.push('| 维度 | 预判 | 依据/不确定处 |'); out.push('|---|---|---|');
    (s.complexity || []).forEach(c => out.push(`| ${c.dim} | ${c.level || TODO} | ${isTodo(c.basis) ? TODO : c.basis} |`));
    out.push('');
    out.push('## 开放问题');
    (s.openQuestions || []).forEach((q, i) => out.push(`${i + 1}. ${isTodo(q) ? TODO : q}`));
  }

  if (stage === 'draft') {
    const d = req.draft || {};
    out.push('## 1. 基本信息');
    Object.entries(d.basic || {}).forEach(([k, v]) => out.push(mdLine(k, v))); out.push('');
    out.push('## 2. 一句话结论'); out.push(isTodo(d.conclusion) ? TODO : d.conclusion); out.push('');
    out.push('## 3. 需求背景与用户价值');
    out.push('**3.1 需求背景**');
    out.push(mdLine('需求来自哪里', d.bg_from)); out.push(mdLine('现状与问题', d.bg_now)); out.push(mdLine('不做会怎样', d.bg_ifnot));
    out.push('**3.2 用户价值**');
    out.push(mdLine('目标用户', d.uv_who)); out.push(mdLine('比现在哪里变好', d.uv_better)); out.push(mdLine('为什么会用', d.uv_why)); out.push('');
    out.push('## 4. 竞品分析');
    out.push('| 竞品 | 他们怎么做 | 截图 | 与我们的对比 |'); out.push('|---|---|---|---|');
    (d.competitors || []).forEach(c => out.push(`| ${isTodo(c.name) ? TODO : c.name} | ${isTodo(c.approach) ? TODO : c.approach} | ${c.shot ? attName(req, c.shot) : TODO} | ${isTodo(c.compare) ? TODO : c.compare} |`));
    out.push('');
    out.push('## 5. 关键功能');
    out.push('| 功能 | 优先级 | 做什么 | 怎么做 | 线框图 | 备注 |'); out.push('|---|---|---|---|---|---|');
    (d.features || []).forEach(f => out.push(`| ${isTodo(f.name) ? TODO : f.name} | ${f.pri} | ${isTodo(f.scenario) ? TODO : f.scenario} | ${(f.how || '').replace(/\n/g, '<br>')} | ${f.wire ? attName(req, f.wire) : TODO} | ${isTodo(f.note) ? TODO : f.note} |`));
    out.push('');
    out.push('## 6. 不在本期');
    out.push('| 功能 | 原因 |'); out.push('|---|---|');
    (d.notInScope || []).forEach(n => out.push(`| ${isTodo(n.feature) ? TODO : n.feature} | ${isTodo(n.reason) ? TODO : n.reason} |`));
  }

  if (stage === 'prd') {
    const p = req.prd || {};
    out.push('## 主流程与状态'); out.push(isTodo(p.mainFlow) ? TODO : p.mainFlow); out.push('');
    out.push('## 主视觉 / 视觉稿');
    (p.visualIds || []).forEach(id => out.push(`- ${attName(req, id)}`)); if (!(p.visualIds || []).length) out.push(TODO); out.push('');
    out.push('## 文案表'); out.push('| 位置 | 文案 | 备注 |'); out.push('|---|---|---|');
    (p.copy || []).forEach(c => out.push(`| ${isTodo(c.pos) ? TODO : c.pos} | ${isTodo(c.text) ? TODO : c.text} | ${isTodo(c.note) ? TODO : c.note} |`)); out.push('');
    out.push('## 埋点表'); out.push('| 事件 | 触发时机 | 参数 | 用途 |'); out.push('|---|---|---|---|');
    (p.tracking || []).forEach(t => out.push(`| ${isTodo(t.event) ? TODO : t.event} | ${isTodo(t.when) ? TODO : t.when} | ${isTodo(t.params) ? TODO : t.params} | ${isTodo(t.use) ? TODO : t.use} |`)); out.push('');
    out.push('## 名词表'); out.push('| 名词 | 定义 |'); out.push('|---|---|');
    (p.glossary || []).forEach(g => out.push(`| ${isTodo(g.term) ? TODO : g.term} | ${isTodo(g.def) ? TODO : g.def} |`)); out.push('');
    out.push('## Change Log'); out.push('| 日期 | 变更 | 影响 |'); out.push('|---|---|---|');
    (p.changelog || []).forEach(c => out.push(`| ${c.date} | ${c.change} | ${c.impact} |`));
  }

  out.push('');
  if (gate) {
    out.push('## 评审门槛');
    out.push(mdLine('评审人', st.gate));
    out.push(mdLine('结论', dec ? `${dec.label}（${dec.desc}）` : '待评审'));
    out.push(mdLine('评审记录', gate.note));
  }
  out.push('');
  out.push('---');
  out.push('_由 Principle 工作台（Demo）导出 · 结论需引用文档内已有信息，缺内容标「待补充」。_');
  return out.join('\n');
}

/* ============================================================
 * demo 拆解：把上传的 HTML / 工程文件结构化，拆成冒烟 / Draft
 * 做图 Skill（解析结构）+ 框架 Skill（填进范本）
 * ============================================================ */
function uniqArr(a) { return [...new Set(a.map(s => String(s).replace(/\s+/g, ' ').trim()).filter(Boolean))]; }

/* 结构化解析单个 HTML demo（浏览器 DOMParser） */
function analyzeHtml(html, name) {
  let doc;
  try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (e) { return null; }
  const txt = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  const title = txt(doc.querySelector('title')) || txt(doc.querySelector('h1')) || (name || '').replace(/\.html?$/i, '');
  const headings = uniqArr([...doc.querySelectorAll('h1,h2,h3')].map(txt)).slice(0, 24);
  const buttons = uniqArr([...doc.querySelectorAll('button,[role=button],.btn,input[type=submit],input[type=button]')].map(el => txt(el) || el.value || '')).slice(0, 24);
  const navItems = uniqArr([...doc.querySelectorAll('nav a,[class*=nav] a,[class*=menu] a,[class*=tab] a,[class*=sidebar] a')].map(txt)).slice(0, 16);
  const links = uniqArr([...doc.querySelectorAll('a')].map(txt)).slice(0, 24);
  const inputs = uniqArr([...doc.querySelectorAll('input,select,textarea')].map(el => el.getAttribute('placeholder') || el.getAttribute('name') || el.type || '')).slice(0, 20);
  const paras = uniqArr([...doc.querySelectorAll('p,li')].map(txt).filter(t => t.length > 6)).slice(0, 40);
  return { name, title, headings, buttons, navItems, links, inputs, paras,
    forms: doc.querySelectorAll('form').length, imgs: doc.querySelectorAll('img').length };
}

function fileStats(req) {
  const stat = {};
  (req.attachments || []).forEach(a => { const ext = (a.name.split('.').pop() || '').toLowerCase(); stat[ext] = (stat[ext] || 0) + 1; });
  return stat;
}

/* 汇总所有 demo / 工程文件 → 拆解结果 */
function analyzeDemo(req) {
  const htmls = (req.attachments || []).filter(a => a.kind === 'html' && a.text);
  const parts = htmls.map(a => analyzeHtml(a.text, a.name)).filter(Boolean);
  const flat = key => uniqArr([].concat(...parts.map(p => p[key] || [])));
  const title = (parts.find(p => p.title) || {}).title || req.name || '';
  const pages = flat('navItems').length ? flat('navItems') : flat('headings').slice(0, 8);
  const actions = flat('buttons');
  const headings = flat('headings');
  const texts = uniqArr([].concat(...parts.map(p => p.paras || []))).slice(0, 20);
  const featureCands = (actions.length ? actions : headings).slice(0, 8);
  const stats = fileStats(req);
  const codeN = Object.entries(stats).filter(([e]) => ['js', 'ts', 'jsx', 'tsx', 'vue', 'css', 'scss', 'py', 'go', 'java'].includes(e)).reduce((n, [, c]) => n + c, 0);
  const forms = parts.reduce((n, p) => n + p.forms, 0);
  const imgs = parts.reduce((n, p) => n + p.imgs, 0);
  return { title, pages, actions, headings, texts, featureCands, forms, imgs, stats, codeN,
    htmlCount: htmls.length, fileCount: (req.attachments || []).length, previewId: htmls[0] && htmls[0].id };
}

/* ---------- 内容推断（把结构映射成完整文案，尽量少留待补充） ---------- */
const ROLE_HINTS = [
  [/(坐席|客服|话务)/, '一线客服坐席'], [/(创客|maker)/i, '创客 / Maker'],
  [/(开发者|工程师|developer|coder)/i, '开发者'], [/(运营)/, '运营同学'],
  [/(商家|卖家|merchant|店铺)/i, '商家'], [/(学生|老师|教师|家长)/, '教育场景用户'],
  [/(医生|患者|就诊)/, '医疗场景用户'], [/(用户|会员|访客)/, '终端用户'],
];
function inferUser(text) { for (const [re, u] of ROLE_HINTS) if (re.test(text || '')) return u; return '目标用户'; }

/* 交互动词 → 系统行为 + 验收，用于把按钮拆成「怎么做」 */
const ACTION_SYS = [
  [/(采纳|接受|应用|采用)/, '把该内容写入并回写记录', '采纳可回写、采纳率可统计'],
  [/(搜索|查询|检索|查找|筛选)/, '按关键词检索并按相关度返回', '检索结果相关、响应 < 1s'],
  [/(提交|保存|发布|上架|确认)/, '校验后保存 / 提交审核', '提交成功并可追踪状态'],
  [/(删除|移除|清除|撤销)/, '二次确认后删除并即时生效', '删除即时生效、有撤销窗口'],
  [/(创建|新建|添加|新增|录入)/, '打开编辑器并初始化模板', '可创建并保存草稿'],
  [/(登录|注册|授权|绑定)/, '校验身份并建立会话', '登录成功率与失败提示达标'],
  [/(忽略|取消|跳过|关闭|返回)/, '关闭当前项且不打断主线', '操作后不影响主流程'],
  [/(编辑|修改|更新|调整)/, '进入可编辑态并保存变更', '修改可保存、可回看'],
  [/(查看|详情|预览|打开|展开)/, '展开对应详情 / 预览', '详情完整、加载 < 1s'],
  [/(上传|导入|附件)/, '接收文件并解析 / 挂载', '上传成功并可预览'],
  [/(分享|转发|导出|下载)/, '生成可分享内容 / 文件', '导出内容完整可用'],
];
function actionBehavior(name) {
  for (const [re, sys, acc] of ACTION_SYS) if (re.test(name)) return { sys, acc };
  return { sys: `处理「${name}」并给出反馈`, acc: `「${name}」在主场景可用、响应及时` };
}
function composeOneLiner(ana, user) {
  const acts = (ana.actions.length ? ana.actions : ana.featureCands).slice(0, 3).join('、');
  const path = ana.pages.length ? `覆盖 ${ana.pages.slice(0, 4).join(' → ')} 的闭环` : '跑通主路径闭环';
  return `面向${user}，通过「${ana.title || '该 demo'}」让用户能${acts ? `完成 ${acts}` : '完成主路径操作'}——${path}。`;
}

/* 拆成冒烟（尽量填满） */
function decomposeToSmoke(req, ana) {
  if (!req.smoke) req.smoke = generateSmoke(req);
  const s = req.smoke;
  const ctx = [ana.texts.join(' '), ana.title, ana.actions.join(' '), req.input || ''].join(' ');
  const user = inferUser(ctx);
  const acts = ana.actions.length ? ana.actions : ana.featureCands;
  const fill = (k, v) => { if (isTodo(s[k])) s[k] = v; };

  fill('conclusion', composeOneLiner(ana, user));
  fill('background', ana.texts.length ? ana.texts.slice(0, 2).join(' ')
    : `需求来自 demo「${ana.title || req.name}」，已示范主路径：${ana.pages.join(' → ') || '（见 demo）'}。`);
  if (!s.goals || s.goals.every(isTodo)) s.goals = [
    acts.length ? `让${user}能完成：${acts.slice(0, 4).join(' / ')}` : '在产品内跑通主路径闭环',
    ana.texts[1] || '把上述操作在产品内闭环，减少人工与工具间跳转',
  ];
  if (!s.nonGoals || s.nonGoals.every(isTodo)) s.nonGoals = [
    acts.length > 2 ? `本期不做非主路径能力：${acts.slice(2, 5).join(' / ')}` : '本期不做权限 / 管理 / 历史版本等非核心能力',
    '不做资源计费与复杂配置，先跑通闭环',
  ];
  s.approach = '主路径：' + (ana.pages.slice(0, 6).join(' → ') || '（见 demo）') + (acts.length ? `；关键操作：${acts.slice(0, 4).join(' / ')}` : '');
  s.assumptions = [...new Set([
    `${user}确实需要在此场景完成「${acts[0] || ana.title || '主操作'}」`,
    ana.forms ? '表单 / 输入环节的数据可获取且可校验' : '主路径能在本期资源内实现',
    ...(s.assumptions || []).filter(v => !isTodo(v)),
  ])].slice(0, 3);
  s.complexity = [
    { dim: '研发', level: ana.codeN > 12 ? '大' : ana.codeN > 4 ? '中' : '小', basis: `demo 含 ${ana.codeN} 个源码文件、${ana.forms} 表单、${ana.pages.length} 页面` },
    { dim: '设计', level: ana.pages.length > 6 ? '大' : ana.pages.length > 2 ? '中' : '小', basis: `约 ${ana.pages.length} 个页面 / 区块、${acts.length} 个交互` },
    { dim: '依赖方', level: (ana.forms || ana.imgs) ? '有：数据 / 内容源' : '无', basis: ana.forms ? '需数据 / 接口支撑表单' : '以前端交互为主' },
  ];
  s.openQuestions = [
    acts.length ? `「${acts[0]}」的成功标准与失败兜底是什么？` : '主路径的成功标准是什么？',
    ana.pages.length > 1 ? `${ana.pages.slice(0, 3).join(' / ')} 里哪个是 P0 必须先做？` : '哪个环节是 P0 必须先做？',
    '最小验证怎么做、成功信号是什么？',
  ];
  s.wireframeCount = attachmentsByKind(req, 'image').length + attachmentsByKind(req, 'video').length + attachmentsByKind(req, 'html').length;
  req.smoke = s;
}

/* 拆成 Draft（尽量填满，每个功能用 demo 预览作为线框图） */
function decomposeToDraft(req, ana) {
  if (!req.draft) req.draft = generateDraft(req);
  const d = req.draft;
  const ctx = [ana.texts.join(' '), ana.title, req.input || ''].join(' ');
  const user = inferUser(ctx);
  const acts = ana.featureCands.length ? ana.featureCands : ana.actions;
  const img = attachmentsByKind(req, 'image')[0];
  const wireId = ana.previewId || (img && img.id) || '';
  const fill = (k, v) => { if (isTodo(d[k])) d[k] = v; };

  if (isTodo(d.basic['所属团队/模块'])) d.basic['所属团队/模块'] = (DIRECTIONS[req.direction] || DIRECTIONS.general).label;
  fill('conclusion', `面向 ${user}，通过「${ana.title || '该能力'}」，让用户能${acts.length ? `完成 ${acts.slice(0, 3).join('、')}` : '完成主路径'}${ana.pages.length ? `，覆盖 ${ana.pages.slice(0, 4).join(' → ')} 的闭环` : ''}。`);
  fill('bg_from', req.source ? req.source : `来自 demo「${ana.title || req.name}」`);
  fill('bg_now', ana.texts[0] || `现状缺少「${ana.title || req.name}」这样的一站式能力，${user}需人工或多处跳转完成。`);
  fill('bg_ifnot', `不做则 ${user} 仍需人工完成${acts.length ? `「${acts[0]}」等` : ''}操作，效率与体验受限、也无法在发布上稳定展示。`);
  if (isTodo(d.uv_who) || d.uv_who.length > 16) d.uv_who = user; // 覆盖粗匹配到的冗长文本，回填干净的用户角色
  fill('uv_better', ana.texts[1] || `从 ${ana.pages[0] || '入口'} 到结果一站式完成，减少跳转与等待。`);
  fill('uv_why', `一处完成${acts.length ? `「${acts.slice(0, 2).join(' / ')}」` : '主路径'}，${ana.forms ? '表单即填即用' : '即用即得'}。`);
  if (!d.competitors || d.competitors.every(c => isTodo(c.name))) {
    d.competitors = [{ name: '现有做法 / 人工方式', approach: `${user}目前手工完成上述操作，或在多个工具间切换`, shot: wireId,
      compare: `本方案把「${acts[0] || ana.title || '主操作'}」在产品内${ana.pages.length > 1 ? '串成闭环并' : ''}自动化 / 前置` }];
  }
  if (acts.length) {
    d.features = acts.slice(0, 8).map((name, i) => {
      const beh = actionBehavior(name); const page = ana.pages[i] || ana.pages[0] || '';
      return { name, pri: i < 2 ? 'P0' : 'P1',
        scenario: `${user}在${page ? `「${page}」` : '主路径'}中需要${name}`,
        how: `1. 用户点击「${name}」\n2. 系统${beh.sys}\n3. 反馈结果并可继续下一步`,
        wire: wireId,
        note: `验收：${beh.acc}${ana.forms ? '；依赖表单 / 数据' : ''}` };
    });
  }
  if (!d.notInScope || d.notInScope.every(n => isTodo(n.feature))) {
    d.notInScope = [
      { feature: acts.length > 2 ? acts.slice(2, 5).join(' / ') : '权限 / 管理 / 历史版本', reason: '非主路径，本期先跑通 P0 闭环' },
      { feature: '资源计费与复杂配置', reason: '首版按限免 / 默认处理，加速交付' },
    ];
  }
  req.draft = d;
}
