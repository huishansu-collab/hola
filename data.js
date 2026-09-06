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

/* ============================================================
 * 团队手册 · 大部门规定（Intelligence Works Team Handbook）
 * 忠实呈现手册的章节与规则，作为部门级规范只读展示。
 * ============================================================ */
const HANDBOOK = {
  name: 'Intelligence Works Team Handbook',
  owner: 'Kaysaith',
  about: {
    title: '1. About Intelligence Works',
    paras: [
      '2005 年，Apple 在 iPhone 发布现场演示的多点触控源自 FingerWorks——这家公司的手势交互专利，后来成为 iPhone 多点触控交互的重要基础。',
      '对我们来说，Works 有一层含义：从下一代交互，走到下一代产品。团队从 Model、Tools、System Infra 做起，优先推进 Interaction 与 Product，最终目标是让 Intelligence 成为新的计算基础。',
    ],
    quote: '这件事不会靠我一个人写完——就像 FingerWorks，一项技术就能改变整个交互方式。这一代要真正让 Intelligence 成为核心，成为大家的基础。',
    lineage: ['FingerWorks', 'Apple', 'iPhone', '智能手机', '移动互联网'],
    layers: ['Model', 'Tools', 'System Infra', 'Interaction', 'Product'],
  },
  guidelines: [
    { no: '2.1', title: '文档与写作', intro: '文档是对外交流的一环，读者是同事；不同类型的文档尽量维护统一的阅读习惯。', items: [
      { no: '2.1.1', title: '中英大写规则，英文别用驼峰与空格', body: '中文与英文 / 数字之间留一个空格；产品专有名词按官方大小写书写；正式文档遵循《中文文案排版指北》。',
        bad: 'IntelligenceWorks团队为Agent做Interaction相关工作', good: 'Intelligence Works 团队为 Agent 做 Interaction 相关工作' },
      { no: '2.1.2', title: '慎用加重表达', body: '加粗、变色、大字号会稀释重点；到处加重等于没有重点。把"加重"留给真正重要的表达。' },
      { no: '2.1.3', title: '列表的巧思', body: '没有先后关系时优先用无序列表；数字列表只用于真正有顺序或步骤的内容。',
        bad: '1. 介绍 A 　2. 介绍 B 　3. 介绍 C（其实无先后）', good: '• 介绍 A 　• 介绍 B 　• 介绍 C' },
      { no: '2.1.4', title: '数字简写用 K，不用「w」', body: '统一用 K 表示千（如 20K），不用「w / 万」混写，避免中英混排不一致。' },
      { no: '2.1.5', title: '文档形体规则', body: '能用图、线框图、Demo 链接说清的，不要只堆文字；结构先于文字。' },
    ] },
    { no: '2.2', title: '会议', items: [
      { no: '2.2.1', title: '小型线上会议（少于 5 人）默认打开摄像头', body: '开摄像头对齐 Social Presence（社会临在感），让讨论更聚焦、更有在场感。' },
      { no: '2.2.2', title: '飞阅会', body: '把要对齐的材料先写进飞书文档，与会者先读后议，用异步阅读替代同步宣读。',
        steps: [['开发 Brief', '由会议 Owner 写清背景、材料与要对齐的问题'], ['阅读 + 提异议', '与会者先读，逐条提出异议与疑问'], ['讨论收敛', '只讨论有异议处，快速收敛'], ['结论回写', '把结论与负责人回写文档']] },
      { no: '2.2.3', title: '会议纪要用 Book 汇合', body: '纪要统一沉淀到 Book，便于检索与追溯，避免散落各处。' },
      { no: '2.2.4', title: '严格控制会议时长', body: '默认 30 分钟；会前在会议 Description 写清目标与材料，超时另约。' },
    ] },
    { no: '2.3', title: '沟通', items: [
      { no: '2.3.1', title: '工作场合要求实名', body: '头像、姓名统一为实名，减少 Power Distance（权力距离），让信息更直接。' },
      { no: '2.3.2', title: '结论优先', body: '先给结论，再给理由与过程；必要时用 highlight 标出结论。',
        bad: '（长篇铺垫后才给出结论）', good: '结论：建议发行。理由：……' },
    ] },
    { no: '2.4', title: '产品', items: [
      { no: '2.4.1', title: '产品迭代流程', body: '冒烟 → Draft → PRD（与本工作台一致）：小改动直接写 PRD，中型需求从 Draft 起步，豁免须在需求登记注明。' },
    ] },
  ],
};

/* 我的团队工作范式（可编辑草稿，参考大部门规定来写） */
function defaultParadigm() {
  return {
    team: '（我的团队）', owner: '（负责人）', updated: Date.now(),
    mission: '一句话说清我们存在的意义与要做成的事（参考 About 的写法：从下一代交互到下一代产品）。',
    sections: [
      { title: '我们怎么写文档', items: ['遵循大部门《文档与写作》：中英留空格、慎用加重、列表有巧思、数字用 K', '每个需求走冒烟 / Draft / PRD 范本，结论先行、结构先于文字'] },
      { title: '我们怎么开会', items: ['少于 5 人的线上会默认开摄像头', '材料先写飞阅会文档，先读后议', '纪要沉淀到 Book，默认 30 分钟'] },
      { title: '我们怎么沟通', items: ['工作场合实名（头像 + 姓名）', '结论优先：先结论，后理由'] },
      { title: '我们怎么做产品', items: ['冒烟对齐方向 → Draft 对齐结构 → PRD 对齐细节', '让否决发生在最便宜的时候'] },
      { title: '新人上手清单', items: ['读一遍大部门规定与本范式', '跑通一个冒烟 → Draft 的示例需求'] },
    ],
  };
}
