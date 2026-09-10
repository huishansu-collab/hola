import assert from 'node:assert/strict';
import fs from 'node:fs';
import { editTimeline } from '../components/timeline-edit.ts';
import { packageToScenario } from '../components/package-scenario.ts';
const original = packageToScenario(
  JSON.parse(fs.readFileSync('case-packages/gmail/build/runtime.json')),
  'package/gmail',
);
const user = editTimeline(original, 0, 0, 'move', 137.4);
assert.equal(user.tracks[0].clips[0].a, 137);
assert.equal(user.utterances.find((u) => u.id === 'u001').start_at_ms, 137);
assert.deepEqual(user.tracks[2], original.tracks[2]);
const assistant = editTimeline(original, 2, 0, 'move', 6357);
assert.equal(assistant.tracks[2].clips[0].a, 6400);
assert.equal(
  assistant.utterances.find((u) => u.id === 'u002').start_at_ms,
  6400,
);
const resized = editTimeline(original, 2, 0, 'resize', 16070);
assert.equal(resized, original);
const resizedUser = editTimeline(original, 0, 0, 'resize', 20000);
assert.equal(resizedUser, original);
const legacy = structuredClone(original);
delete legacy.tracks[6].clips[0].toolEventId;
legacy.tracks[6].clips[0].label = '旧版工具显示别名';
const stretched = editTimeline(legacy, 6, 0, 'resize', 5600);
const eventId = stretched.tracks[6].clips[0].toolEventId;
assert(eventId);
assert.equal(stretched.inputEvents.find(e=>e.event_id===eventId && e.query===undefined).time_at_ms,5600);
const repeated = editTimeline(stretched, 6, 0, 'move', 8400);
assert.equal(repeated.inputEvents.find(e=>e.event_id===eventId && e.query!==undefined).time_at_ms,8400);
assert.equal(repeated.inputEvents.find(e=>e.event_id===eventId && e.query===undefined).time_at_ms,repeated.tracks[6].clips[0].b);
const tool = editTimeline(original, 6, 0, 'move', 8351);
assert.equal(tool.tracks[6].clips[0].a, 8400);
const id = tool.tracks[6].clips[0].toolEventId;
assert.equal(
  tool.inputEvents.find((e) => e.event_id === id && e.query !== undefined)
    .time_at_ms,
  8400,
);
const long = editTimeline(original, 0, 0, 'move', 900013);
assert(long.END > 900000);
assert.equal(original.tracks[0].clips[0].a, 0);
console.log(
  'PASS user 1 ms, other tracks 400 ms, same-track edits, locked audio duration, linked JSON and duration growth',
);

// All built-in tool regions, including legacy display aliases, retain their event identity.
const {loadCases} = await import('./load-cases.mjs');
for (const [caseId, scenario] of Object.entries(loadCases())) {
  const ti = scenario.tracks.findIndex(t=>t.name==='工具调用');
  for (const [ci, c] of scenario.tracks[ti].clips.entries()) {
    const updated = editTimeline(scenario, ti, ci, 'move', c.a+400);
    const hasRequest = scenario.inputEvents.some(e => e.tool_name && e.query !== undefined && Math.round(e.time_at_ms)===Math.round(c.a) && scenario.inputEvents.some(r=>r.event_id===e.event_id && r.query===undefined && Math.round(r.time_at_ms)===Math.round(c.b)));
    if (hasRequest) assert(updated.tracks[ti].clips[ci].toolEventId, `${caseId}: unbound ${c.label} ${c.a}-${c.b}`);
  }
}
