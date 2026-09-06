/* ============================================================
 * skills.js — 把范式 / 范本 / 规范沉淀成可复用的 Skill
 *
 * 每个 skill = 一个模块化能力：既是知识载荷（模板 / 规则 / token），
 * 也带可运行行为（apply / check）。任何内容进来都能延用同一套判断。
 *
 * 组合管道：内容进来 → 框架定结构 → 做图归位物料 → 内容校对文字
 *          → 设计统一呈现 → 评审出结论
 * ============================================================ */

/* 内容 Skill 的写作规范（沉淀自大部门《文档与写作》） */
const CONTENT_RULES = [
  { key: 'conclusion', name: '结论优先', desc: '先给结论，再给理由；必要时 highlight 结论。' },
  { key: 'emphasis', name: '慎用加重', desc: '加粗/变色/大字号会稀释重点，到处加重等于没有重点。' },
  { key: 'spacing', name: '中英留空格', desc: '中文与英文/数字之间留一个空格；英文别用驼峰。' },
  { key: 'list', name: '列表巧思', desc: '无先后关系用无序列表，数字列表只给有顺序/步骤的内容。' },
  { key: 'number', name: '数字用 K', desc: '统一用 K，不用「w / 万」混写。' },
  { key: 'shape', name: '结构先于文字', desc: '能用图/线框图/Demo 说清的，不要只堆文字。' },
];

/* 内容 Skill 的可运行校对：返回 [{rule, level, msg, samples[]}] */
function lintText(text) {
  const t = String(text || '');
  const issues = [];
  const clip = s => s.length > 24 ? s.slice(0, 24) + '…' : s;

  // 中英之间缺空格
  const sp = new Set();
  const re1 = /([一-龥])([A-Za-z0-9])|([A-Za-z0-9])([一-龥])/g;
  let m;
  while ((m = re1.exec(t)) && sp.size < 5) sp.add((m[1] || m[3]) + (m[2] || m[4]));
  if (sp.size) issues.push({ rule: 'spacing', level: 'warn', msg: `中英/数字之间建议加空格（${sp.size} 处）`, samples: [...sp] });

  // 数字用「万 / w」
  const nums = (t.match(/\d+\s*[万wW]([^A-Za-z]|$)/g) || []).map(s => s.trim()).slice(0, 5);
  if (nums.length) issues.push({ rule: 'number', level: 'warn', msg: `数字简写建议用 K（发现 ${nums.length} 处「w/万」）`, samples: nums });

  // 疑似驼峰（两个首字母大写的词粘连，如 IntelligenceWorks）
  const camel = (t.match(/[A-Z][a-z]{2,}[A-Z][a-z]{2,}/g) || []).slice(0, 5);
  if (camel.length) issues.push({ rule: 'spacing', level: 'info', msg: `疑似驼峰，英文词间建议加空格（${camel.length} 处）`, samples: camel });

  // 结论优先（长文本但开头不像结论）
  const firstLine = t.split(/[\n。.！？!?]/)[0] || '';
  if (t.length > 40 && firstLine && !/^(结论|建议|要做成|一句话|面向|我们)/.test(firstLine.trim())) {
    issues.push({ rule: 'conclusion', level: 'info', msg: '考虑「结论优先」：把结论放到第一句。', samples: [clip(firstLine.trim())] });
  }
  return issues;
}

/* Skill 注册表 */
const SKILLS = [
  {
    id: 'framework', cat: '框架', name: '框架 Skill', icon: '▤',
    summary: '把想法 / 内容套进冒烟 · Draft · PRD 的结构骨架，缺项自动标待补充。',
    provides: ['冒烟 / Draft / PRD 章节骨架', '完成度与缺失项检查', '阶段 GATE 与退出条件'],
    applies: '新建需求 / 切换阶段时自动套用',
    payload: () => [
      { t: '冒烟范本', v: ['一句话结论', '背景', '目标/非目标', '思路&线框图', '复杂度预判', '开放问题'] },
      { t: 'Draft 范本', v: ['基本信息', '一句话结论', '背景与用户价值', '竞品分析', '关键功能', '不在本期'] },
      { t: 'PRD 范本', v: ['主流程与状态', '主视觉', '文案表', '埋点表', '名词表', 'Change Log'] },
    ],
  },
  {
    id: 'diagram', cat: '做图', name: '做图 Skill', icon: '◫',
    summary: '把上传的 demo（HTML / 工程 .zip）解析成结构，拆成冒烟 / Draft；截图 / 录屏归位成必填的线框图 / 高保真，demo 用 iframe 预览当线框图。',
    provides: ['demo / 工程文件 → 冒烟 / Draft 拆解', 'HTML 结构解析（页面 / 功能 / 主路径）', '物料 → 线框图 / 截图 自动归位'],
    applies: '上传 demo / 工程时解析并拆解',
    payload: () => Object.values(UPLOAD_KINDS).map(k => ({ t: k.label, v: [k.use] })),
  },
  {
    id: 'content', cat: '内容', name: '内容 Skill', icon: '✎',
    summary: '按大部门《文档与写作》规范生成与校对文字：结论优先、慎用加重、中英空格、列表巧思、数字用 K。',
    provides: ['写作体检（可运行校对）', '结论优先改写建议', '术语与大小写规范'],
    applies: '任意文档文字即时校对',
    payload: () => CONTENT_RULES.map(r => ({ t: r.name, v: [r.desc] })),
  },
  {
    id: 'design', cat: '设计', name: '设计 Skill', icon: '◐',
    summary: '统一视觉产出：苹方字体、4 级字号、克制配色、卡片 / 表格 / 留白规范。',
    provides: ['苹方 + 4 级字号（20 / 15 / 13.5 / 12）', '语义色：好 / 警告 / 危险', '卡片 / 表格 / 间距规范'],
    applies: '所有页面渲染',
    payload: () => [
      { t: '字体', v: ['Apple 苹方 PingFang SC 优先'] },
      { t: '字号（4 级）', v: ['标题 20 · 小标题 15 · 正文 13.5 · 注释 12'] },
      { t: '语义色', v: ['通过=绿 · 补充=黄 · 暂缓=紫 · 推翻=红'] },
    ],
  },
  {
    id: 'review', cat: '评审', name: '评审 Skill', icon: '✓',
    summary: '一号位视角给评审建议：缺失项汇总、结论（通过 / 补充 / 暂缓 / 推翻）、评审记录导出。',
    provides: ['缺失项汇总', '结论建议', '评审记录导出 Markdown'],
    applies: 'GATE 评审门槛',
    payload: () => Object.values(DECISIONS).map(d => ({ t: d.label, v: [d.desc] })),
  },
];
const SKILL_BY_ID = SKILLS.reduce((m, s) => (m[s.id] = s, m), {});

/* 每个阶段用到哪些 skill（用于流程标注） */
const STAGE_SKILLS = {
  smoke: ['framework', 'content', 'diagram', 'review'],
  draft: ['framework', 'diagram', 'content', 'design', 'review'],
  prd: ['framework', 'diagram', 'content', 'design', 'review'],
};
