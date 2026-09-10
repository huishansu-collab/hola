// 脚本编译器的回归检查：一行一件事编出来的七轨，得能过正式校验器。
//   node scripts/check-script-dsl.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { compileScript, speechMs } from '../components/script-dsl.ts';
import { validatePackage } from '../lib/case-package/index.ts';

const baseMeta = JSON.parse(fs.readFileSync('components/meta-data.json', 'utf8'));
const build = (text, options = {}) => compileScript(text, { baseMeta, caseId: 'check-dsl', ...options });
const ok = (text, options) => {
  const r = build(text, options);
  assert.deepEqual(r.errors, [], `不该报错：${JSON.stringify(r.errors)}`);
  validatePackage(r.pack);
  return r;
};

// 1. 仓库里那条奶茶 Case 就是它的 script.dsl 编出来的，两边不能漂。
{
  const dir = 'case-packages/meeting-milk-tea';
  const committed = JSON.parse(fs.readFileSync(`${dir}/case.json`, 'utf8'));
  const r = ok(fs.readFileSync(`${dir}/script.dsl`, 'utf8'), {
    caseId: 'meeting-milk-tea',
    uuid: committed.static_context.constraints.uuid_v7,
  });
  for (const [name, value] of [['case', r.pack.case], ['timeline', r.pack.timeline], ['manifest', r.pack.manifest]])
    assert.equal(
      JSON.stringify(value, null, 2) + '\n',
      fs.readFileSync(`${dir}/${name === 'case' ? 'case' : name}.json`, 'utf8'),
      `${dir}/${name}.json 与 script.dsl 对不上，跑 node scripts/script-to-package.mjs ${dir}`,
    );
  assert.equal(r.stats.tools, 9);
  assert.deepEqual(r.warnings, []);
}

// 2. 非人工片段一律落在 400 ms 网格上，用户语音保留真实时刻。
{
  const r = ok(`标题 网格
用户 帮我看看明天天气。
判断 听清了 [时长 700]
工具 w1: weather.query(city=北京) => temp_c=20 [时长 900]
助手 明天二十度。 [依赖 w1]`);
  for (const u of r.pack.case.utterances)
    if (u.speaker === 'assistant') assert.equal(u.start_at_ms % 400, 0, `${u.id} 没对齐`);
  for (const track of r.pack.timeline.tracks)
    if (!['user', 'control'].includes(track.id))
      for (const c of track.clips)
        if (c.start_at_ms !== undefined) assert.equal(c.start_at_ms % 400, 0);
  for (const e of r.pack.case.events) assert.equal(e.time_at_ms % 400, 0);
  const [request, result] = r.pack.case.events;
  const answer = r.pack.case.utterances.find((u) => u.speaker === 'assistant');
  assert.ok(answer.start_at_ms >= result.time_at_ms + 400, '[依赖] 没留出 400 ms 微轮次');
  assert.deepEqual(r.pack.timeline.tool_dependencies, undefined);
  assert.equal(request.query, JSON.stringify({ city: '北京' }));
}

// 3. 打断：用户压在助手话里，停声就是助手那句的末端，丢弃的话留在数据里。
{
  const r = ok(`标题 打断
用户 帮我叫个车。
助手 好，叫上了，白色捷达，车牌—— [丢弃 京N·7T13]
用户 等下，先取消。 [打断]`);
  const [i] = r.pack.timeline.interruptions;
  const host = r.pack.case.utterances.find((u) => u.id === i.assistant_id);
  const cut = r.pack.case.utterances.find((u) => u.id === i.user_id);
  assert.equal(i.stop_at_ms, host.end_at_ms, '停声必须等于助手这句的末端');
  assert.ok(cut.start_at_ms > host.start_at_ms && cut.start_at_ms < host.end_at_ms, '打断没有重叠');
  assert.ok(i.detected_at_ms >= cut.start_at_ms && i.fade_start_at_ms < i.stop_at_ms);
  assert.equal(i.discarded_text, '京N·7T13');
  assert.equal(r.pack.timeline.backchannels, undefined);
}

// 4. 附和：整段压在用户人声里，用户继续说；塞不下就直说，不硬塞成打断。
{
  const r = ok(`标题 附和
用户 昨天那个会又改时间了，改到周四下午，我这边的排期全乱了。
助手 嗯。 [附和]
助手 那我把周四下午空出来。`);
  const [b] = r.pack.timeline.backchannels;
  const host = r.pack.case.utterances.find((u) => u.id === b.over_user_id);
  const nod = r.pack.case.utterances.find((u) => u.id === b.assistant_id);
  assert.ok(host.start_at_ms < nod.start_at_ms && nod.end_at_ms < host.end_at_ms, '附和没有整段压在用户话里');
  assert.equal(r.pack.timeline.interruptions, undefined);
  assert.ok(!(r.pack.timeline.response_links ?? []).some((l) => l.assistant_id === nod.id), '附和不是回应');
  const tight = build(`标题 塞不下
用户 好。
助手 嗯。 [附和]`);
  assert.match(tight.errors[0]?.message ?? '', /附和/);
  assert.equal(tight.pack, undefined, '有错就不该出包');
}

// 5. 表达标注只跟助手走，垫句和慢说各自映射到表达控制轨道。
{
  const r = ok(`标题 表达
用户 帮我查一下这周的机票。
助手 嗯……我看一下。 [垫句] [慢说]
工具 f1: flight.search(city=上海) => count=3 [时长 2400]
助手 有三班，最早的是早上八点。 [依赖 f1]`);
  const expression = r.pack.timeline.tracks.find((t) => t.id === 'expression').clips;
  assert.equal(expression.length, 2);
  assert.deepEqual(expression.map((c) => c.lane ?? 0), [0, 1], '同一句上的两条标注要分 lane');
  assert.deepEqual(r.pack.case.fdx_annotation.map((a) => a.fdx_type), ['垫句', '慢说']);
  for (const a of r.pack.case.fdx_annotation) {
    assert.equal(a.role, 'assistant');
    assert.ok(expression.some((c) => c.start_at_ms === a.start_at_ms && c.end_at_ms === a.end_at_ms));
  }
  assert.deepEqual(r.warnings, [], '这一轮已经垫过一句，不该再报静默');
}

// 6. 并行的工具同起点、分 lane；串行的工具之间留一个微轮次。
{
  const r = ok(`标题 并行
用户 帮我点一杯奶茶。
工具 a: location.current() => city=北京 [时长 800]
工具 b: memory.get(key=addresses) => count=3 [时长 800] [并行]
工具 c: shop.quote(item=奶茶) => price_cny=12 [依赖 a,b] [时长 1200]
助手 十二块，下单吗？ [依赖 c]`);
  const [a, b, c] = ['a', 'b', 'c'].map((id) => r.pack.case.events.filter((e) => e.event_id === id));
  assert.equal(a[0].time_at_ms, b[0].time_at_ms, '[并行] 没有同时开始');
  assert.ok(c[0].time_at_ms >= Math.max(a[1].time_at_ms, b[1].time_at_ms) + 400, '依赖没留出 400 ms');
  assert.deepEqual(r.pack.timeline.tool_dependencies, [{ event_id: 'c', depends_on: ['a', 'b'] }]);
  const tools = r.pack.timeline.tracks.find((t) => t.id === 'tools').clips;
  assert.deepEqual(tools.map((x) => x.lane ?? 0), [0, 1, 0]);
}

// 7. 长静默没人垫一句要提醒；用户耳语记在用户侧标注，不进表达控制。
{
  const quiet = build(`标题 静默
用户 帮我查一下这周的机票。 [低语]
工具 f1: flight.search(city=上海) => count=3 [时长 4000]
助手 有三班。 [依赖 f1]`);
  assert.deepEqual(quiet.errors, []);
  assert.match(quiet.warnings[0]?.message ?? '', /没人垫一句/);
  assert.equal(quiet.pack.case.paralinguistic_annotation[0].type, '低语');
  assert.equal(quiet.pack.case.paralinguistic_annotation[0].role, 'user');
  assert.equal(quiet.pack.timeline.tracks.find((t) => t.id === 'expression').clips.length, 0);
}

// 8. 写错了要说清是第几行、错在哪，别默默出一个坏包。
{
  const bad = build(`标题 写错
用户 帮我看看。
唱歌 啦啦啦
工具 这行不是工具写法
助手 好的。 [依赖 不存在]`);
  assert.equal(bad.pack, undefined);
  assert.deepEqual(bad.errors.map((e) => e.line), [3, 4, 5]);
  assert.match(bad.errors[0].message, /轨道关键词/);
  assert.match(bad.errors[2].message, /找不到这个工具/);
  assert.equal(build('标题 空的').errors[0].message, '脚本里一句台词都没有');
}

// 9. 台词时长按字数估：越长越久，标点各自留一个换气。
assert.ok(speechMs('好。') < speechMs('好的，我这就去办。'));
assert.ok(speechMs('好的我这就去办') < speechMs('好的，我这就去办。'));

console.log('script-dsl: 9 组检查通过');
