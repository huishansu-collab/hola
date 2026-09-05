/*
 * shared/tracks.js — 八轨日志的结构化解析("日志 → 事件/标注"的挖掘规则)。
 * 输入是脚本作者按 Golden Case 口径写的日志行,如:
 *   【任务】任务类型｜查天气（查一下再答（快））：weather.today(本地,当日)→结果 16‒24℃·晴（耗时 0.6s）
 *   【记忆】Recall类型｜偏好；记忆消费｜直接用→先给「可以穿风衣」· user_profile.dressing=偏怕冷；记忆更新｜不更新
 *   【硬件交互】用哪种硬件反馈｜边缘灯效·唤醒；时延档｜即时≤50ms
 *   【语音·用户】对谁说的｜对助手说；话语类型｜指令；情绪｜焦虑；发声方式｜正常；这句之后的停顿｜点名要你答
 */

import { parseLogLine } from './script.js';

/* "0.6s" / "1m21s" / "300ms" / "约1分钟" / "2m39s" / "64s" → ms */
export function elapsedToMs(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(/约|大约|预计/g, '');
  let m;
  if ((m = s.match(/^(\d+)\s*m\s*(\d+(?:\.\d+)?)\s*s$/))) return Math.round(+m[1] * 60000 + +m[2] * 1000);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*ms$/))) return Math.round(+m[1]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(s|秒)$/))) return Math.round(+m[1] * 1000);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|分钟|分)$/))) return Math.round(+m[1] * 60000);
  if ((m = s.match(/^(\d+)\s*分\s*(\d+)\s*秒$/))) return Math.round(+m[1] * 60000 + +m[2] * 1000);
  if ((m = s.match(/(\d+(?:\.\d+)?)/))) return Math.round(+m[1] * 1000);
  return null;
}

/* 工具名 / 任务类型 → 图标(public/assets/icons/*.png) */
export function guessIcon(name = '', taskType = '') {
  const n = (name + ' ' + taskType).toLowerCase();
  const rules = [
    [/weather|天气/, 'weather'], [/timer|alarm|计时|闹钟/, 'timer'], [/map|route|eta|导航|车程|路线/, 'loc'],
    [/didi|amap|call_car|cancel_car|order_status|叫车|打车/, 'car'], [/price|compare|比价|算/, 'price'],
    [/calendar|meeting|日程|会议室/, 'doc'], [/news|search|web|搜索|资讯|brief/, 'search'], [/kb|knowledge|知识库|查资料/, 'book'],
    [/image|图片|示意图/, 'sparkles'], [/doc\.|prd|文档|q&a|annotate|生成文本/, 'doc'], [/lock|door|门锁|门磁/, 'shield'],
    [/ac|空调/, 'ac'], [/humid|加湿/, 'humid'], [/bed|卧室/, 'bed'], [/stock|quote|行情|股/, 'chart'], [/coffee|咖啡/, 'coffee'],
    [/order|外卖|下单/, 'bag'], [/phone|call|电话/, 'phone'], [/person|人物/, 'person'], [/screen|读屏|截屏/, 'screenshot'],
    [/game|接龙/, 'game'], [/memory|记忆/, 'shield'], [/alert|提醒/, 'alert'],
  ];
  for (const [re, icon] of rules) if (re.test(n)) return icon;
  return 'sparkles';
}

/*
 * 解析【任务】行:返回 [{ name, args, result, elapsed_ms, task_type, speed, priority, delivery, status }]
 * 支持 "a(x)∥b(y)" 并行、"受理/进行中/结果到点" 等无结果形态。
 */
const TASK_META_KEYS = new Set(['备注', '优先级', '交付形态', '保质期', '保质期·第几秒过期', '任务属性·被催促', '被催促', '请求描述', '用自然语言描述请求/事件', '任务类型（即时/快/慢）', '状态', 'result', '说明']);

export function parseTaskLine(fieldsOrText) {
  const fields = typeof fieldsOrText === 'string' ? parseLogLine(fieldsOrText).fields : (fieldsOrText || {});
  const out = [];
  const sources = [];
  for (const [key, val] of Object.entries(fields)) {
    if (TASK_META_KEYS.has(key) || !val) continue;
    if (key === '_') for (const seg of String(val).split(/[；;]/)) { if (seg.trim()) sources.push({ key, src: seg.trim() }); }
    else sources.push({ key, src: String(val) });
  }
  let firstSrc = null;
  for (const { key, src } of sources) {
    if (firstSrc == null) firstSrc = src;
    let taskType = null, speed = null, rest = src, m;
    if (key === '任务类型' || key === '任务' || key === '_') {
      if ((m = src.match(/^([^（(：:]+?)\s*[（(]([^：:]*?)[）)]\s*[:：]\s*(.*)$/s))) { taskType = m[1].trim(); speed = m[2].trim(); rest = m[3]; }
      else if ((m = src.match(/^([^：:]+?)\s*[:：]\s*(.*)$/s)) && !/[()（）]/.test(m[1])) { taskType = m[1].trim(); rest = m[2]; }
    } else {
      taskType = key.replace(/^任务类型[·:：]?/, '').trim();
      if ((m = src.match(/^[（(]([^）)]*)[）)]\s*[:：]\s*(.*)$/s))) { speed = m[1].trim(); rest = m[2]; }
      else if ((m = src.match(/^([^（(：:]+?)\s*[（(]([^：:]*?)[）)]\s*[:：]\s*(.*)$/s))) { taskType = m[1].trim(); speed = m[2].trim(); rest = m[3]; }
    }
    const parts = rest.split(/∥|‖|\|\|/);
    for (const part of parts) {
      const p = part.trim();
      const cm = p.match(/([A-Za-z_][\w.]*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/);
      if (!cm) continue;
      const call = { name: cm[1], args: cm[2].trim(), task_type: taskType, speed, result: null, elapsed_ms: null, status: 'done' };
      const after = p.slice(cm.index + cm[0].length);
      const rm = after.match(/(?:→|->|=>)\s*(?:结果\s*)?(.*)$/s);
      let resText = rm ? rm[1].trim() : '';
      const em = resText.match(/[（(]\s*(?:耗时|用时)\s*([^）)]+)[）)]/);
      if (em) { call.elapsed_ms = elapsedToMs(em[1]); resText = resText.replace(em[0], '').trim(); }
      else {
        const em2 = (after + ' ' + (fields['备注'] || '')).match(/[（(]\s*([\d.]+\s*(?:s|秒|ms|m\d+s))[，,)）]/);
        if (em2) call.elapsed_ms = elapsedToMs(em2[1]);
      }
      resText = resText.replace(/[；;]\s*备注.*$/s, '').replace(/^[·•]\s*/, '').trim();
      if (/^(进行中|受理|等待|未返回|null)/.test(resText) && resText.length < 24) { call.status = 'pending'; call.result = null; }
      else call.result = resText || null;
      if (!call.result && /进行中|受理/.test(fields['备注'] || '')) call.status = 'pending';
      out.push(call);
    }
  }
  if (!out.length && firstSrc && /受理|进行中/.test(firstSrc)) out.push({ name: null, args: '', task_type: null, speed: null, result: null, elapsed_ms: null, status: 'pending', text: firstSrc });
  const meta = {
    priority: fields['优先级'] || null,
    delivery: fields['交付形态'] || null,
    shelf_life: fields['保质期'] || fields['保质期·第几秒过期'] || null,
    rushed: fields['任务属性·被催促'] || fields['被催促'] || null,
    request: fields['请求描述'] || fields['用自然语言描述请求/事件'] || null,
    note: fields['备注'] || null,
    kind: fields['任务类型（即时/快/慢）'] || null,
  };
  return out.map(c => ({ ...meta, ...c }));
}

/* 解析【记忆】行 */
export function parseMemoryLine(fieldsOrText) {
  const fields = typeof fieldsOrText === 'string' ? parseLogLine(fieldsOrText).fields : (fieldsOrText || {});
  const consume = fields['记忆消费'] || '';
  const refM = (consume + ' ' + (fields._ || '')).match(/([A-Za-z_][\w.]*(?:\[[^\]]*\])?)\s*=\s*([^；;]+)/);
  const recall = fields['Recall类型'] || fields['Recall 类型'] || fields['recall类型'] || null;
  if (!recall && !consume && !fields['记忆更新']) return null;
  return {
    recall_type: recall,
    consume: consume || null,
    update: fields['记忆更新'] || null,
    override: fields['当轮指令是否覆盖'] || null,
    ref: refM ? { key: refM[1].trim(), value: refM[2].trim() } : null,
    query: refM ? refM[1].trim() : (recall ? `召回${recall}` : null),
    result: refM ? refM[2].trim() : (consume || null),
    kind: /核对后用|长|详细/.test(consume) ? 'memory_call' : 'memory_call_fast',
  };
}

/* 解析【世界信息】行 → world_signal */
export function parseWorldLine(fieldsOrText) {
  const fields = typeof fieldsOrText === 'string' ? parseLogLine(fieldsOrText).fields : (fieldsOrText || {});
  const out = {
    scene_state: fields['场景/状态'] || fields['场景'] || fields['状态'] || null,
    signal_source: fields['信号来源'] || null,
    trigger: fields['怎么收到的·触发方式'] || fields['怎么收到的'] || fields['触发方式'] || null,
    disturb_worth: fields['值不值得打扰'] || null,
    when: fields['什么时候发生'] || fields['某一刻'] || fields['一段时间'] || null,
    note: fields['备注说明'] || fields['说明'] || fields['备注'] || fields._ || null,
  };
  if (!out.scene_state && !out.signal_source && !out.note) return null;
  return out;
}

/* 解析【硬件交互】行 → { feedback, latency, actions[] } */
export function parseHardwareLine(fieldsOrText) {
  const fields = typeof fieldsOrText === 'string' ? parseLogLine(fieldsOrText).fields : (fieldsOrText || {});
  const feedback = fields['用哪种硬件反馈'] || fields['硬件反馈'] || fields._ || '';
  const latency = fields['时延档'] || null;
  const actions = [];
  const f = feedback;
  if (/唤醒/.test(f)) actions.push({ type: 'edge', action: 'on' });
  if (/聆听态/.test(f)) actions.push({ type: 'edge', action: 'listen' });
  if (/说话态/.test(f)) actions.push({ type: 'edge', action: 'on' });
  if (/震动/.test(f)) actions.push({ type: 'hardware', feedback: 'vibrate' });
  if (/闪光|亮屏|炫光/.test(f)) actions.push({ type: 'hardware', feedback: 'flash' });
  if (/生卡片|角标/.test(f)) actions.push({ type: 'hardware', feedback: 'card' });
  if (/音量档·压低|压低/.test(f)) actions.push({ type: 'hardware', feedback: 'volume_low' });
  if (/提示音/.test(f)) actions.push({ type: 'fx', name: 'ding' });
  if (/^无|零反馈|·无/.test(f)) actions.push({ type: 'hardware', feedback: 'none' });
  return { feedback: feedback || null, latency, note: fields['什么时候发生/备注'] || fields['备注'] || null, actions };
}

/* 解析【语音·用户】/【语音·助手】行 → say 的标注字段 */
export function parseSpeechLine(fieldsOrText, sub = null) {
  const parsed = typeof fieldsOrText === 'string' ? parseLogLine(fieldsOrText) : { fields: fieldsOrText || {}, sub };
  const f = parsed.fields || {};
  const out = {};
  const pick = (...keys) => { for (const k of keys) if (f[k]) return f[k]; return undefined; };
  const to = pick('对谁说的', '对谁说');
  if (to) out.to = to;
  const kind = pick('话语类型', '话语类型（用户句）');
  if (kind) out.kind = kind;
  const emotion = pick('情绪', '用户此刻的情绪', '用户情绪');
  if (emotion) out.emotion = emotion;
  const voicing = pick('发声方式');
  if (voicing) out.voicing = voicing;
  const pause = pick('这句之后的停顿', '停顿');
  if (pause) out.pause_after = pause;
  const overlap = pick('是否重叠', '是否重叠（被谁叠上）', '重叠');
  if (overlap) out.overlap = overlap;
  const nature = pick('助手句性质', '句性质');
  if (nature) out.nature = nature;
  const tone = pick('语气');
  if (tone) out.tone = tone;
  const who = pick('谁在说', '说话人');
  if (who) out.who = who;
  return out;
}

/* 由 say 的标注字段推导 fdx 类型 */
export function inferFdx(st) {
  const set = new Set(st.fdx || []);
  const to = st.to || '', nature = st.nature || '', overlap = st.overlap || '', pause = st.pause_after || '', kind = st.kind || '';
  if (st.barge_in || /竞争打断.*叠在|叠在.*上/.test(overlap) && !/被/.test(overlap.split('·')[0] || '')) set.add('打断');
  if (/^附和|附和(?!重叠)/.test(to) || /附和在场/.test(nature) || kind === '附和') set.add('附和');
  if (/在想词/.test(pause)) set.add('非结束性停顿');
  if (/主动播报|主动开口|插话/.test(nature)) set.add('主动开口');
  if (/承接|填充|垫/.test(nature) || /垫句|垫场/.test(kind)) set.add('战术性垫句');
  if (/接话|合作补充/.test(nature)) set.add('补话');
  if (/自言自语|自语|朗读演练|边缘指向/.test(to)) set.add('无关话题语言');
  if (/对别人说|对司机|对同事/.test(to) && st.role !== 'assistant') set.add('用户和他人对话');
  if (/他人|旁人/.test(to) && st.role === 'third_party' && !/对用户|对主用户/.test(to)) set.add('他人多人聊天');
  return [...set];
}
