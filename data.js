/* ============================================================
 * data.js — 三阶段流程 + 文档范本配置
 * 冒烟对齐方向 · Draft 对齐结构 · PRD 对齐细节，让否决发生在最便宜的时候。
 * 严格对齐范本：冒烟文档范本 / Draft 文档范本。
 * ============================================================ */

/* 三阶段（对应「三阶段流程」图） */
const STAGES = [
  {
    key: 'smoke', label: '冒烟', en: 'SMOKE', idx: '01',
    q: '值不值得做、大概多复杂',
    mood: 'chill 对齐 · 容忍推翻',
    exit: '各方对方向和复杂度量级、无重大分歧',
    gate: '需求提出方 · 执行负责人 · Kay',
    kay: '全程参加',
  },
  {
    key: 'draft', label: 'Draft', en: 'STRUCTURE', idx: '02',
    q: '核心方案长什么样、关键需求加线框图',
    mood: '收敛 · 只聚焦关键需求',
    exit: '线框图和核心流程被 UED、研发确认可行',
    gate: '冒烟三方 + UED · 研发 · Kay',
    kay: '全程参加',
  },
  {
    key: 'prd', label: 'PRD', en: 'DETAIL', idx: '03',
    q: '每个细节怎么落地 · 主视觉 / 文案 / 埋点 / 名词表',
    mood: '严肃 · 定稿即承诺',
    exit: '文档冻结，后续变更走 change log',
    gate: 'UI: Kay / 细节：执行层自闭环',
    kay: '只参加 UI 评审',
  },
];
const STAGE_INDEX = STAGES.reduce((m, s, i) => (m[s.key] = i, m), {});

/* 跳阶段规则（豁免须在需求登记注明） */
const STAGE_ENTRY = {
  smoke: '完整走三阶段（默认）',
  draft: '中型需求：从 Draft 起步',
  prd: '小改动：直接写 PRD',
};

/* 方向：影响假设 / 复杂度 / 开放问题的建议（保留原 SOP 切换能力） */
const DIRECTIONS = {
  general: { key: 'general', label: '通用', hint: '标准需求',
    focus: '先证明用户问题和业务价值，再讨论功能与实现',
    assume: ['用户确实需要它并愿意改变现有做法', '主路径能在本期资源内跑通'],
    questions: ['如果只能保留一个用户结果，保留什么？', '用户现在怎么解决，为什么不够？', '最大的不确定性是什么？'] },
  'voice-duplex': { key: 'voice-duplex', label: '语音双工', hint: '自然打断 / 时延',
    focus: '优先验证自然打断、响应时延、轮次衔接和噪声环境',
    assume: ['端到端时延可压到可接受范围', '在真实噪声下打断判定仍可用'],
    questions: ['在什么噪声/网络下必须仍可用？', '自然打断的判定标准与容忍时延？', '一次响应太慢的代价有多大？'] },
  'call-assist': { key: 'call-assist', label: '通话助攻', hint: '实时建议 / 采纳',
    focus: '优先验证实时信息是否在正确时机出现，以及建议是否被采纳',
    assume: ['能在正确时机触发建议', '坐席愿意在通话中采纳建议'],
    questions: ['哪些实时事件应触发建议？错误时机代价？', '建议以什么形式出现才不打断主线？', '「被采纳」如何度量并回写？'] },
  memory: { key: 'memory', label: 'Memory', hint: '有用 / 准确 / 可控',
    focus: '优先验证记忆是否有用、准确、可控，并支持查看、修改、删除',
    assume: ['记忆能真正改变下一次交互', '用户可控（查看/修改/删除）成立'],
    questions: ['哪类记忆真正改变了下一次交互？', '写错/过期的代价与纠正路径？', '用户如何查看、修改、删除记忆？'] },
  agentic: { key: 'agentic', label: 'Agentic', hint: '成功率 / 恢复 / 接管',
    focus: '优先验证任务成功率、工具选择、失败恢复和人工接管',
    assume: ['高频任务成功率达标', '失败可安全恢复或人工接管'],
    questions: ['哪些任务可自动执行、哪些必须人工审批？', '失败时如何恢复或回滚？', '人工接管的触发条件与交接方式？'] },
};
const DIRECTION_ORDER = ['general', 'voice-duplex', 'call-assist', 'memory', 'agentic'];

/* 总原则（Principle） */
const PRINCIPLES = [
  ['先价值，后方案', '先证明用户问题和业务价值，再讨论功能。'],
  ['先收敛，后发散', '冒烟阶段只对齐一条主路径，不同时解决所有问题。'],
  ['结论必须可证伪', '每个判断都要有证据、假设和验证方式；读完一句话结论就该能开始反对。'],
  ['结构先于细节', '先拆清用户、场景、流程、系统边界，再补文案和埋点。'],
  ['复杂度前置', '冒烟就拍量级共识；Draft 明确模型、数据、端、服务、合规和协作依赖。'],
  ['体验由闭环定义', '从触发到反馈再到结果，完整链路优先于单点功能。'],
  ['不做也是结论', '明确非目标 / 不在本期，防止范围漂移。'],
  ['让否决发生在最便宜的时候', '推翻成本随阶段递增——冒烟一页纸就能推翻，PRD 定稿即承诺。'],
];

const ROLES = ['产品', '设计', '算法', '工程', '数据', '运营', 'UED', '研发'];

/* 评审门槛结论 */
const DECISIONS = {
  pass:       { label: '通过',   desc: '量级/结构/细节已对齐，进入下一阶段', badge: 'badge-ok' },
  supplement: { label: '补充',   desc: '补齐关键项后再看', badge: 'badge-warn' },
  hold:       { label: '暂缓',   desc: '方向成立但时机未到', badge: 'badge-hold' },
  reject:     { label: '推翻',   desc: '方向不成立，回上一阶段或废弃', badge: 'badge-danger' },
};

/* ============================================================
 * 文档范本（严格对齐 PDF 范本的章节与提示语）
 * ============================================================ */

/* 冒烟文档范本 */
const SMOKE_TEMPLATE = {
  title: '冒烟文档',
  conclusion:  { label: '一句话结论', hint: '用一句话说清：想做什么，为什么现在做。（结论先行——读完这句，应该已经可以开始反对了）' },
  background:  { label: '背景', hint: '需求来自哪里（用户反馈 / 数据 / 战略 / 老板一句话——如实写）' },
  goals:       { label: '目标', hint: '这件事做成了，什么变了（1–3 条）' },
  nonGoals:    { label: '非目标', hint: '明确不在这次范围内的（防止评审时被扩大）' },
  approach:    { label: '方案方向', hint: '粗颗粒描述大概怎么做，可以只有一段话；允许不确定、多方案并列、"还没想清楚"。' },
  assumptions: { label: '尚未验证的假设', hint: '把要赌的前提写清楚，评审现场就赌这些。' },
  complexity:  { label: '复杂度预判', hint: '拍脑袋即可，冒烟阶段要的是量级共识，不是排期。', dims: ['研发', '设计', '依赖方'] },
  openQuestions:{ label: '开放问题', hint: '列出希望评审现场对齐的问题，越具体越好。' },
};

/* Draft 文档范本 */
const DRAFT_TEMPLATE = {
  title: 'Draft 文档',
  basicFields: ['需求登记', '执行负责人', 'UED 接口人', '研发接口人', '所属团队/模块', '目标版本/班车', '冒烟文档', '文档状态'],
  conclusion:  { label: '一句话结论', hint: '要做成什么样。' },
  bg_from:     { label: '需求来自哪里', hint: '用户反馈 / 数据 / 战略' },
  bg_now:      { label: '现状是什么，问题在哪', hint: '' },
  bg_ifnot:    { label: '不做会怎样', hint: '' },
  uv_who:      { label: '目标用户是谁', hint: '' },
  uv_better:   { label: '做完后用户得到什么，比现在哪里变好', hint: '' },
  uv_why:      { label: '一句话说清用户为什么会用', hint: '' },
  competitors: { label: '竞品分析', hint: '截图必填。', cols: ['竞品', '他们怎么做', '截图', '与我们的对比'] },
  features:    { label: '关键功能', hint: '只写冒烟对齐的关键功能；埋点、专有名词、文案不写。每个功能必须附线框图或高保真图。',
                 cols: ['功能', '优先级', '做什么（用户场景）', '怎么做（用户/系统步骤）', '线框图/高保真', '备注'] },
  notInScope:  { label: '不在本期', hint: '', cols: ['功能', '原因'] },
};

/* PRD 文档范本（细节：主视觉 / 文案 / 埋点 / 名词表） */
const PRD_TEMPLATE = {
  title: 'PRD 文档',
  mainFlow:    { label: '主流程与状态', hint: '每条主路径的状态流转与异常分支。' },
  visual:      { label: '主视觉 / 视觉稿', hint: '定稿视觉，必附高保真。' },
  copy:        { label: '文案表', hint: '', cols: ['位置', '文案', '备注'] },
  tracking:    { label: '埋点表', hint: '', cols: ['事件', '触发时机', '参数', '用途'] },
  glossary:    { label: '名词表', hint: '', cols: ['名词', '定义'] },
  changelog:   { label: 'Change Log', hint: '文档冻结后，后续变更走 change log。', cols: ['日期', '变更', '影响'] },
};

/* 上传物料类型 */
const UPLOAD_KINDS = {
  image: { label: '图片 / 截图', use: '充当线框图 / 高保真 / 竞品截图', accept: 'image/*' },
  video: { label: '视频 / 录屏', use: '充当 demo 演示证据', accept: 'video/*' },
  html:  { label: 'HTML / 网页', use: '抽取正文关键信息填入文档', accept: '.html,.htm,text/html' },
  file:  { label: '文本 / 其他', use: '作为附件与证据', accept: '.txt,.md' },
};
