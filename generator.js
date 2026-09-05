/* ============================================================
 * generator.js — Demo 版「Principle 一号位助手」
 *
 * 说明：这是一个可离线运行的 Demo。它用规则 + 模板把用户输入结构化为
 * 冒烟卡片 / Draft 骨架，并按「方向」注入必填问题、风险、指标和架构占位。
 * 它不会编造竞品事实；信息不足处一律标记为「待补充 / 待验证」，
 * 与系统 Prompt 的要求一致（区分 已知事实 / 用户假设 / 待验证问题）。
 * 接入真实模型时，只需把这些函数替换为对应阶段的 Prompt 调用即可。
 * ============================================================ */

const TODO = '待补充';

/* 从一段文本里抽取第一句 / 关键句，作为回显 */
function firstSentence(text) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const m = clean.split(/[。.!?！？\n]/).map(s => s.trim()).filter(Boolean);
  return m[0] || clean;
}

function pickAround(text, keywords) {
  if (!text) return '';
  const lines = text.split(/[。.!?！？\n]/).map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    if (keywords.some(k => line.includes(k))) return line;
  }
  return '';
}

/* 生成冒烟卡片骨架 —— 对应「冒烟阶段 Prompt」 */
function generateSmokeCard(req) {
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  const input = req.input || '';
  const lead = firstSentence(input);

  const targetUser = pickAround(input, ['用户', '客户', '坐席', '同学', '面向', '为']) || TODO;
  const scene = pickAround(input, ['场景', '通话', '时候', '当', '在']) || TODO;
  const pain = pickAround(input, ['痛点', '问题', '难', '慢', '不能', '无法', '缺']) || TODO;

  return {
    generatedAt: Date.now(),
    targetUser,
    scene,
    painPoint: pain,
    valueProp: lead ? `围绕「${lead}」为目标用户创造可衡量的结果（${TODO}：量化指标）` : TODO,
    conclusion: lead ? `要做成：${lead}` : TODO,
    p0Path: ['触发', '系统动作', '用户反馈', '结果'],
    assumptions: [
      lead ? `用户确实需要「${lead}」并愿意改变现有行为` : `核心价值假设（${TODO}）`,
      `${dir.label} 方向下的关键不确定性可被最小验证覆盖`,
    ],
    evidence: TODO + '（用户原话 / 数据 / 埋点）',
    notInScope: TODO + '（本期明确不解决的事项）',
    minValidation: `围绕「${dir.focus}」设计最小验证；成功信号 = ${TODO}`,
    participants: dir.key === 'general' ? ['产品', '设计', '工程']
      : dir.key === 'voice-duplex' ? ['产品', '算法', '工程', '数据']
      : dir.key === 'call-assist' ? ['产品', '设计', '工程', '运营']
      : dir.key === 'memory' ? ['产品', '算法', '工程', '数据']
      : ['产品', '算法', '工程'],
    openQuestions: dir.questions.slice(),
    recommendation: 'supplement', // 继续Draft/补证据/暂缓/推翻 → 默认建议补证据
  };
}

/* 基于冒烟卡片生成 Draft 骨架 —— 对应「Draft 阶段 Prompt」 */
function generateDraft(req) {
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  const s = req.smoke || {};
  return {
    generatedAt: Date.now(),
    basicInfo: {
      需求登记: req.name || TODO,
      执行负责人: req.owner || TODO,
      UED接口人: TODO,
      研发接口人: TODO,
      所属模块: dir.label,
      目标版本: TODO,
      文档状态: 'Draft 评审中',
    },
    oneLineConclusion: s.conclusion && s.conclusion !== TODO
      ? `面向 [${s.targetUser}]，在 [${s.scene}] 下，通过 [核心能力]，让用户获得 [可衡量结果]`
      : TODO,
    background: {
      需求来源: req.source || TODO,
      现状问题: s.painPoint || TODO,
      不做的影响: TODO,
      目标用户: s.targetUser || TODO,
      前后变化: TODO,
    },
    competitors: [
      { name: TODO, approach: TODO, learn: TODO, diff: TODO, evidence: TODO },
    ],
    features: [
      { name: s.conclusion && s.conclusion !== TODO ? '主路径核心功能' : TODO,
        pri: 'P0',
        userGoal: s.valueProp || TODO,
        system: TODO, dep: dir.label, accept: TODO },
    ],
    complexity: [
      { dim: '客户端 / 服务端', level: TODO, reason: TODO, owner: TODO },
      { dim: '模型与推理', level: TODO, reason: TODO, owner: TODO },
      { dim: '数据与标注', level: TODO, reason: TODO, owner: TODO },
      { dim: '实时性', level: TODO, reason: TODO, owner: TODO },
      { dim: '权限与隐私', level: TODO, reason: TODO, owner: TODO },
      { dim: '监控与运营', level: TODO, reason: TODO, owner: TODO },
    ],
    risks: dir.risks.map(x => ({ risk: x.r, trigger: TODO, mitig: x.mitig })),
    metrics: dir.metrics,
    notInScope: (s.notInScope && s.notInScope !== TODO)
      ? [{ item: s.notInScope, reason: TODO }]
      : [{ item: TODO, reason: TODO }],
    openQuestions: (s.openQuestions || dir.questions).slice(),
  };
}

/* ---------- 缺失项检测（缺失项提示 / 完成标准对照） ---------- */

function isFilled(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '' && !v.includes(TODO) && v !== '待验证';
  if (Array.isArray(v)) return v.length > 0 && v.some(isFilled);
  return true;
}

/* 对照「进入排期的完成标准」逐项检查 */
function evaluateReadiness(req) {
  const s = req.smoke || {};
  const d = req.draft || {};
  const checks = [
    { key: '一句话结论', ok: isFilled(d.oneLineConclusion) || isFilled(s.conclusion),
      detail: '面向[用户]在[场景]下通过[能力]获得[结果]' },
    { key: '目标用户与场景', ok: isFilled(s.targetUser) && isFilled(s.scene),
      detail: '谁在什么场景遇到什么阻碍' },
    { key: '核心价值', ok: isFilled(s.valueProp),
      detail: '解决后用户行为 / 结果如何改变' },
    { key: '关键流程', ok: Array.isArray(s.p0Path) && s.p0Path.length >= 3,
      detail: '触发 → 系统动作 → 用户反馈 → 结果' },
    { key: 'P0 功能及线框图', ok: d.features ? d.features.some(f => isFilled(f.name) && isFilled(f.accept)) : false,
      detail: '每个 P0 功能附验收标准与线框图' },
    { key: '技术 / 协作依赖', ok: d.complexity ? d.complexity.some(c => isFilled(c.level)) : false,
      detail: '模型 / 数据 / 端 / 服务 / 合规 / 协作' },
    { key: '风险与验证指标', ok: (d.risks && d.risks.some(r => isFilled(r.trigger))) && isFilled(d.metrics),
      detail: '风险含触发条件；指标覆盖体验/效果/效率/安全' },
    { key: '本期不做项', ok: (d.notInScope && d.notInScope.some(n => isFilled(n.item))) || isFilled(s.notInScope),
      detail: '明确不做什么并附原因' },
    { key: '负责人和下一步', ok: isFilled(req.owner),
      detail: '责任到人，下一步找谁' },
  ];
  const done = checks.filter(c => c.ok).length;
  return { checks, done, total: checks.length, pct: Math.round(done / checks.length * 100) };
}

/* ---------- 评审结论导出（Markdown） ---------- */

function line(label, v) { return `- **${label}**：${isFilled(v) ? v : (v || '待补充')}`; }

function exportMarkdown(req) {
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  const s = req.smoke || {};
  const d = req.draft || {};
  const r = req.review || {};
  const rd = evaluateReadiness(req);
  const dec = r.decision ? DECISIONS[r.decision] : null;

  const out = [];
  out.push(`# ${req.name || '未命名需求'}`);
  out.push('');
  out.push(`> 方向：**${dir.label}** ｜ 阶段：**${(STAGES[STAGE_INDEX[req.stage]] || {}).label || req.stage}** ｜ 完成度：**${rd.pct}%**（${rd.done}/${rd.total}）`);
  out.push('');

  out.push('## 一句话结论');
  out.push((isFilled(d.oneLineConclusion) && d.oneLineConclusion) || (isFilled(s.conclusion) && s.conclusion) || '待补充');
  out.push('');

  out.push('## 冒烟结论');
  out.push(line('目标用户', s.targetUser));
  out.push(line('关键场景', s.scene));
  out.push(line('当前痛点', s.painPoint));
  out.push(line('价值主张', s.valueProp));
  out.push(`- **P0 主路径**：${(s.p0Path || []).join(' → ') || '待补充'}`);
  out.push(line('核心假设', (s.assumptions || []).join('；')));
  out.push(line('本期不做', s.notInScope));
  out.push(line('最小验证', s.minValidation));
  out.push(`- **需要参与**：${(s.participants || []).join(' / ') || '待补充'}`);
  out.push('');

  if (d.risks) {
    out.push('## 风险与指标');
    d.risks.forEach(rk => out.push(`- 风险：${rk.risk} ｜ 触发：${isFilled(rk.trigger) ? rk.trigger : '待补充'} ｜ 缓解：${rk.mitig}`));
    if (d.metrics) {
      out.push('');
      out.push('指标建议：');
      Object.entries(d.metrics).forEach(([k, v]) => out.push(`- ${k}：${v.join('、')}`));
    }
    out.push('');
  }

  out.push('## 完成标准对照');
  rd.checks.forEach(c => out.push(`- [${c.ok ? 'x' : ' '}] ${c.key}`));
  out.push('');

  out.push('## 评审结论');
  out.push(line('结论', dec ? `${dec.label}（${dec.desc}）` : '待评审'));
  out.push(`- **最值得保留（3 点）**：${isFilled(r.keep3) ? r.keep3 : '待补充'}`);
  out.push(`- **最大风险（3 点）**：${isFilled(r.risk3) ? r.risk3 : '待补充'}`);
  out.push(`- **必须补齐**：${isFilled(r.mustAdd) ? r.mustAdd : '待补充'}`);
  out.push(line('下一步动作', r.nextStep));
  out.push(line('负责人角色', r.ownerRole || req.owner));
  out.push(line('时间点', r.timepoint));
  out.push('');
  out.push('---');
  out.push('_由 Principle 工作台（Demo）导出，结论需引用文档内已有信息，不凭空增加事实。_');
  return out.join('\n');
}

/* 一号位评审视角：自动给出「保留 / 风险 / 必补」的草稿建议（可编辑） */
function suggestReview(req) {
  const rd = evaluateReadiness(req);
  const missing = rd.checks.filter(c => !c.ok).map(c => c.key);
  const dir = DIRECTIONS[req.direction] || DIRECTIONS.general;
  return {
    keep3: '（待一号位填写：最值得保留的 3 点，需引用 Draft 已有信息）',
    risk3: dir.risks.map(r => r.r).slice(0, 3).join('；'),
    mustAdd: missing.length ? missing.slice(0, 5).join('、') : '完成标准已齐，可进入排期',
    nextStep: missing.length ? '补齐上述缺失项后复评' : '进入架构拆解 / 排期',
    ownerRole: req.owner || '产品负责人',
    timepoint: '待补充',
    decision: missing.length > 3 ? 'supplement' : (missing.length ? 'supplement' : 'pass'),
  };
}
