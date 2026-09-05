import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDSL, scriptToDSL } from '../shared/dsl.js';
import { validateScript, normalizeScript, clockToMs } from '../shared/script.js';
import { schedule } from '../shared/schedule.js';
import { buildNormalized, checkNormalized } from '../shared/normalize.js';
import { parseTaskLine, parseMemoryLine, elapsedToMs } from '../shared/tracks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DSL = `# 测试
id: t
clock: 08:03:00
## 段1｜08:03:00‒08:03:30｜开场
@edge touch
[08:03:00.0‒08:03:03.5] 用户: 几点了？
  【语音·用户】对谁说的｜对助手说；情绪｜焦虑；这句之后的停顿｜点名要你答
  【硬件交互】用哪种硬件反馈｜边缘灯效·唤醒；时延档｜即时≤50ms
[08:03:03.9‒08:03:08.4] 助手: 八点零三。
  【任务】任务类型｜查天气（查一下再答（快））：weather.today(本地)→结果 20℃（耗时 0.6s）
  【记忆】Recall类型｜偏好；记忆消费｜直接用 · user.dressing=偏怕冷；记忆更新｜不更新
[08:04:26.4‒08:04:38.0] 助手: 六分钟，火候上水保持小滚就行，太大了容易——
★ [08:04:36.0‒08:04:39.5] 用户（抢话，与 AI 语音重叠）: 行了行了，你帮我计时！
  【语音·用户】是否重叠｜竞争打断（叠在助手上 2.0s）；情绪｜不耐烦
[08:05:35.3‒08:05:41.0] 用户（嘟囔）: 盐呢……算了。
  【语音·用户】对谁说的｜自言自语（纯自语）；发声方式｜语气词（念叨）
[08:33:30.4‒08:33:44.0] 助手: 三样：手机、工牌、蓝色包。
[08:33:37.0‒08:33:38.0] 用户（与 AI 播报重叠，附和）: 嗯嗯。
  【语音·用户】对谁说的｜附和；是否重叠｜附和重叠（1.0s）
[08:38:20.0‒08:38:21.5] 系统（并行）: 流程示意图生成完成。
  【任务】生成图片｜image.generate(示意图)→结果 完成（耗时 1m21s）
@card id=c1 icon=timer title="Egg Timer" eta="6:00" meta="a|b" button="Start"
`;

test('DSL 编译:说话人、打断、附和、自语、并行系统行、日志派生 step', () => {
  const { script, warnings } = parseDSL(DSL);
  assert.equal(warnings.length, 0, warnings.join('\n'));
  const says = script.timeline.filter(s => s.type === 'say');
  assert.equal(says.length, 7);
  assert.equal(says[0].speaker, 'user');
  assert.equal(says[0].emotion, '焦虑');
  const barge = says.find(s => s.text.startsWith('行了行了'));
  assert.equal(barge.barge_in, true);
  assert.ok(barge.at_ratio > 0.7 && barge.at_ratio < 0.95, 'at_ratio 由时钟推导');
  const mumble = says.find(s => s.text.startsWith('盐呢'));
  assert.equal(mumble.no_bubble, true);
  const bc = says.find(s => s.text === '嗯嗯。');
  assert.equal(bc.backchannel, true);
  assert.equal(bc.barge_in, undefined);
  const sys = script.timeline.find(s => s.type === 'system');
  assert.equal(sys.parallel, true);
  const tools = script.timeline.filter(s => s.type === 'tool');
  assert.deepEqual(tools.map(t => t.name), ['weather.today', 'image.generate']);
  assert.equal(tools[0].elapsed_ms, 600);
  assert.equal(tools[0].anchor, 'prev_start');
  assert.equal(tools[1].backdate, true);
  const mem = script.timeline.find(s => s.type === 'memory');
  assert.equal(mem.query, 'user.dressing');
  assert.equal(mem.result, '偏怕冷');
  assert.equal(script.timeline.filter(s => s.type === 'edge').length, 1, '硬件交互·唤醒不重复插入 edge touch');
  const card = script.timeline.find(s => s.type === 'card');
  assert.deepEqual(card.meta, ['a', 'b']);
  assert.equal(card.button.label, 'Start');
  assert.equal(validateScript(script).errors.length, 0);
});

test('调度:打断切断目标句,附和不切,并行不阻塞', () => {
  const { script } = parseDSL(DSL);
  const sch = schedule(normalizeScript(script), {});
  const u = Object.fromEntries(sch.utterances.map(x => [x.text.slice(0, 4), x]));
  const target = u['六分钟，'], barge = u['行了行了'];
  assert.equal(target.cut, true);
  assert.equal(target.cut_at_ms, barge.start);
  assert.ok(target.end <= barge.start + 1750);
  const three = u['三样：手'], bc = u['嗯嗯。'];
  assert.equal(three.cut, false);
  assert.ok(bc.start > three.start && bc.start < three.end);
  assert.ok(sch.total_ms > 0);
  const ev = sch.events.filter(e => e.tool_name === 'image.generate');
  assert.equal(ev.length, 2);
  assert.ok(ev[0].time_at_ms < ev[1].time_at_ms, '回溯的发起时刻早于结果时刻');
});

test('规范化 JSON:结构、标注推导、一致性', () => {
  const { script } = parseDSL(DSL);
  const { json } = buildNormalized(script, {}, { generated_at: '2026-01-01T00:00:00Z' });
  for (const k of ['meta_data', 'static_context', 'dynamic_context', 'utterances', 'events', 'annotation']) assert.ok(k in json, k);
  assert.deepEqual(json.meta_data.media.audio.tracks.map(t => t.role), ['user', 'assistant']);
  assert.equal(json.utterances[0].speaker_id, 'user_1');
  const types = json.annotation.fdx_annotation.map(a => a.fdx_type);
  assert.ok(types.includes('打断'));
  assert.ok(types.includes('附和'));
  assert.ok(types.includes('无关话题语言'));
  assert.ok(json.annotation.emotion_annotation.some(e => e.emotion_type === '不耐烦'));
  assert.ok(json.annotation.paralinguistic_annotation.some(p => p.paralinguistic_type === '语气词'));
  assert.equal(json.events.filter(e => e.event_type === 'memory_call_fast').length, 2);
  assert.deepEqual(checkNormalized(json), []);
  assert.equal(json.utterances.find(u => u.text.startsWith('六分钟')).cut_at_ms, json.utterances.find(u => u.text.startsWith('行了')).start_at_ms);
});

test('轨道解析:任务行多字段、耗时单位、记忆引用', () => {
  const calls = parseTaskLine('任务类型｜查资料（长任务）：kb.search(通话助攻)→结果 命中 3 篇（耗时 4.2s）；生成文档｜doc.generate(PRD)∥image.generate(图)→结果 转后台（耗时 0.5s）');
  assert.deepEqual(calls.map(c => c.name), ['kb.search', 'doc.generate', 'image.generate']);
  assert.equal(calls[0].elapsed_ms, 4200);
  assert.equal(calls[1].task_type, '生成文档');
  assert.equal(elapsedToMs('1m21s'), 81000);
  assert.equal(elapsedToMs('300ms'), 300);
  const mem = parseMemoryLine('Recall类型｜事实；记忆消费｜接话补事实 · morning_items.badge_location=玄关托盘；记忆更新｜不更新');
  assert.equal(mem.ref.key, 'morning_items.badge_location');
  assert.equal(mem.ref.value, '玄关托盘');
});

test('JSON case → 剧本 → JSON 往返保住音频片段名', () => {
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'cases/commute/script.json'), 'utf8'));
  const dsl = scriptToDSL(src);
  const { script } = parseDSL(dsl);
  const clips = script.timeline.filter(s => s.type === 'say').map(s => s.clip);
  assert.deepEqual(clips.slice(0, 4), ['a0', 'q1', 'a1a', 'a1']);
});

test('内置 case 全部通过校验并能导出', () => {
  const dir = path.join(ROOT, 'cases');
  for (const id of fs.readdirSync(dir)) {
    const file = path.join(dir, id, 'script.json');
    if (!fs.existsSync(file) || id.startsWith('zz-')) continue;
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const v = validateScript(s);
    assert.equal(v.errors.length, 0, `${id}: ${v.errors.join(', ')}`);
    const { json } = buildNormalized(s, {});
    assert.deepEqual(checkNormalized(json), [], id);
    assert.ok(json.utterances.length > 0, id);
  }
});

test('时钟解析', () => {
  assert.equal(clockToMs('08:03:00.5'), (8 * 3600 + 3 * 60) * 1000 + 500);
  assert.equal(clockToMs('9:41'), (9 * 3600 + 41 * 60) * 1000);
});
