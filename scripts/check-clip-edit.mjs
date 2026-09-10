// 片段增删改的数据检查：建出来的片段背后那份数据要跟着走。
//   node scripts/check-clip-edit.mjs
import assert from 'node:assert/strict';
import { loadCases } from './load-cases.mjs';
const { saveClip, deleteClip, availableTools, toolGroup, editableTrack } = await import('../components/clip-edit.ts');
const { moveClips, editTimeline } = await import('../components/timeline-edit.ts');

const cases = loadCases();
const base = cases.gmail ?? Object.values(cases)[0];
const index = (name) => base.tracks.findIndex((t) => t.name === name);
const track = (s, name) => s.tracks.find((t) => t.name === name);
const tool = (s, name) => availableTools(s).find((t) => t.function.name === name);

// 1. 工具片段：建出来就带一对 Events，工具定义进 meta，删掉一起消失。
{
  const ti = index('工具调用');
  const before = base.inputEvents.length;
  const s = saveClip(base, ti, null, {
    label: '', sub: '找连接器', a: 20000, b: 21200,
    tool: tool(base, 'mcps.search'), args: { query: '查找可用的外卖连接器' }, results: { candidates: 2 },
  });
  const added = track(s, '工具调用').clips.find((c) => c.a === 20000);
  assert.equal(added.label, 'mcps.search("查找可用的外卖连接器")');
  const pair = s.inputEvents.filter((e) => e.event_id === added.toolEventId);
  assert.equal(pair.length, 2);
  assert.deepEqual([pair[0].time_at_ms, pair[1].time_at_ms], [20000, 21200]);
  assert.equal(JSON.parse(pair[0].query).query, '查找可用的外卖连接器');
  assert.deepEqual(pair[1].results, { candidates: 2 });
  assert.ok(s.meta.static_context.tools.some((t) => t.function.name === 'mcps.search'), '工具定义没写进 meta');
  assert.equal(s.END >= 21200, true);
  const ci = track(s, '工具调用').clips.indexOf(added);
  const back = deleteClip(s, ti, ci);
  assert.equal(back.inputEvents.length, before, '删片段没把 Events 一起删掉');
  assert.equal(track(back, '工具调用').clips.some((c) => c.a === 20000), false);
}

// 2. 起止时间对齐 400，写错了要说清楚是哪一项。
{
  const ti = index('后台判断');
  const s = saveClip(base, ti, null, { label: '核对结果', a: 20050, b: 20790 });
  const added = track(s, '后台判断').clips.find((c) => c.label === '核对结果');
  assert.deepEqual([added.a, added.b], [20000, 20800]);
  assert.throws(() => saveClip(base, ti, null, { label: '', a: 20000, b: 20400 }), /请填写片段名称/);
  assert.throws(() => saveClip(base, ti, null, { label: '太短', a: 20000, b: 20100 }), /片段至少占 400 ms/);
  assert.throws(() => saveClip(base, ti, null, { label: '反了', a: 20000, b: 19000 }), /有效的开始和结束时间/);
  assert.throws(() => saveClip(base, index('工具调用'), null, { label: '', a: 20000, b: 20400 }), /请选择工具/);
  assert.throws(() => saveClip(base, index('用户'), null, { label: '不行', a: 20000, b: 20400 }), /此轨道不支持创建片段/);
  assert.throws(() => deleteClip(base, index('助手'), 0), /不支持删除/);
  assert.equal(editableTrack('助手'), false);
  assert.equal(editableTrack('世界'), true);
}

// 3. 世界 / 用户控制：一个事件，来源和动作写进 context。
{
  const ti = index('世界');
  const s = saveClip(base, ti, null, { label: '短信到达', sub: '运营商通知', a: 20000, b: 20400, source: 'sms', action: 'received', context: { text: '话费不足' } });
  const added = track(s, '世界').clips.find((c) => c.label === '短信到达');
  const event = s.inputEvents.find((e) => e.event_id === added.inputEventId);
  assert.equal(event.event_type, 'world_event');
  assert.equal(event.time_at_ms, 20000);
  assert.deepEqual(event.context, { text: '话费不足', source: 'sms', action: 'received', description: '短信到达' });
  // 挪片段，事件跟着挪。
  const ci = track(s, '世界').clips.indexOf(added);
  const moved = editTimeline(s, ti, ci, 'move', 24000);
  assert.equal(moved.inputEvents.find((e) => e.event_id === added.inputEventId).time_at_ms, 24000);
}

// 4. 表达控制：贴着选中的那句助手语音，标注进 fdx，删掉一起走。
{
  const ti = index('表达控制');
  const reply = track(base, '助手').clips.findIndex((c) => c.wave);
  const host = track(base, '助手').clips[reply];
  const s = saveClip(base, ti, null, { label: '垫句', sub: '等结果时垫一句', a: 0, b: 400, assistantIndex: reply, annotation: '垫句' });
  const added = track(s, '表达控制').clips.find((c) => c.annotationId);
  assert.deepEqual([added.a, added.b], [host.a, host.b], '表达片段没跟助手语音对齐');
  const annotation = s.controlAnnotations.fdx_annotation.find((a) => a.annotation_id === added.annotationId);
  assert.equal(annotation.fdx_type, '垫句');
  assert.equal(annotation.role, 'assistant');
  assert.throws(() => saveClip(base, ti, null, { label: '垫句', a: 0, b: 400, assistantIndex: -1, annotation: '垫句' }), /请选择对应的助手回复/);
  assert.throws(() => saveClip(base, ti, null, { label: '仅文字回复', a: 0, b: 400, assistantIndex: reply, annotation: '仅文字回复' }), /仅文字标注需要选择文字回复/);
  const ci = track(s, '表达控制').clips.indexOf(added);
  const back = deleteClip(s, ti, ci);
  assert.equal(back.controlAnnotations.fdx_annotation.some((a) => a.annotation_id === added.annotationId), false);
}

// 5. 框选之后整体移动：整组同一个位移，最靠前的那个不许被推到 0 之前。
{
  const ti = index('后台判断');
  const clips = base.tracks[ti].clips;
  const targets = [{ ti, ci: 0 }, { ti, ci: 1 }];
  const gaps = targets.map((t) => clips[t.ci].a);
  const moved = moveClips(base, targets, 2000);
  const after = targets.map((t) => moved.tracks[ti].clips[t.ci].a);
  assert.deepEqual(after, gaps.map((a) => a + 2000), '整体移动没有保持相对位置');
  const clamped = moveClips(base, targets, -1e6);
  assert.equal(Math.min(...targets.map((t) => clamped.tracks[ti].clips[t.ci].a)), 0, '整体移动越过了 0');
  assert.equal(moveClips(base, [], 400), base);
}

// 6. 工具字典分组：建片段时按这个分组挑工具。
{
  assert.equal(toolGroup('memory.get'), 'Memory 工具');
  assert.equal(toolGroup("mcp.connect('gmail').search_messages"), 'MCP 工具');
  assert.equal(toolGroup('audio.play'), '系统工具');
  assert.equal(toolGroup('weather.query'), '其他工具');
  const names = availableTools(base).map((t) => t.function.name);
  assert.ok(names.includes('mcps.search') && names.includes('light.blink'), '工具字典没接上');
  assert.equal(new Set(names).size, names.length, '工具重名');
}
console.log('clip-edit: 6 组检查通过');
