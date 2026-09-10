import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  validatePackage,
  buildRuntime,
  renderStereo,
} from '../lib/case-package/index.ts';
import { decodeWav, unbase64 } from '../lib/case-package/audio.ts';
import { packageToScenario } from '../components/package-scenario.ts';
const bundle = JSON.parse(
  fs.readFileSync('case-packages/gmail/build/gmail.case.json'),
);
const fail = (edit, pattern) => {
  const p = structuredClone(bundle);
  edit(p);
  assert.throws(() => validatePackage(p), pattern);
};
validatePackage(bundle);
const runtime = buildRuntime(bundle),
  s = packageToScenario(runtime),
  baseline = JSON.parse(fs.readFileSync('scripts/fixtures/gmail-parity.json')),
  legacy = baseline.case;
assert.deepEqual(runtime.case, legacy);
assert.equal(s.tracks.length, 7);
assert.equal(s.tracks[1].clips.length, 0);
assert(s.tracks[2].clips[0].fadeMs === 120 && !s.tracks[2].clips[0].fadeOut);
for (const [id, audio] of Object.entries(runtime.audio))
  assert.equal(
    crypto.createHash('sha256').update(audio.src).digest('hex'),
    baseline.audioHashes[id],
  );
const stereo = renderStereo(runtime),
  dv = new DataView(stereo.wav.buffer);
assert.equal(dv.getUint16(22, true), 2);
assert.equal(dv.getUint32(24, true), 48000);
for (const c of [0, 1]) {
  let max = 0;
  for (let i = 11.17 * 48000; i < 11.28 * 48000; i++)
    max = Math.max(
      max,
      Math.abs(dv.getInt16(44 + Math.round(i) * 4 + c * 2, true)),
    );
  assert(max > 100);
}
for (let i = 11.32 * 48000; i < 13.2 * 48000; i++)
  assert.equal(dv.getInt16(44 + Math.round(i) * 4 + 2, true), 0);
fail((p) => (p.manifest.schema_version = 2), /版本/);
fail((p) => (p.manifest.case_id = '../bad'), /ID/);
fail((p) => (p.alignment.clips[0].source = '../secret.wav'), /路径/);
fail((p) => delete p.sources[p.alignment.clips[0].source], /缺少音频/);
fail((p) => (p.alignment.clips[0].source_end_ms += 100), /音频长度/);
fail((p) => (p.case.utterances[0].end_at_ms = -1), /起止/);
fail((p) => (p.timeline.tracks[0].clips[0].label = 'duplicate'), /仅保存在/);
fail(
  (p) => (p.case.events.find((e) => e.query).tool_name = 'unknown'),
  /未定义/,
);
fail((p) => p.case.events.pop(), /配对/);
fail(
  (p) =>
    (p.timeline.tool_dependencies.find(
      (x) => x.event_id === 'gmail_discovery',
    ).depends_on = ['gmail_config_card']),
  /依赖/,
);
fail((p) => p.timeline.interruptions[0].stop_at_ms++, /停声/);
// Internal speech interruption retains real overlap/fade checks without
// inventing an audio-effect stop tool call.
const internal = structuredClone(bundle);
const interruption = internal.timeline.interruptions[0];
interruption.control_type = 'speech_interruption';
const stopId = internal.case.events.find(
  (e) => e.tool_name === 'audio.stop' && e.time_at_ms === interruption.stop_command_at_ms,
).event_id;
internal.case.events = internal.case.events.filter((e) => e.event_id !== stopId);
for (const track of internal.timeline.tracks)
  track.clips = track.clips.filter((c) => c.event_id !== stopId);
internal.timeline.tool_dependencies = internal.timeline.tool_dependencies
  .filter((d) => d.event_id !== stopId)
  .map((d) => ({ ...d, depends_on: d.depends_on.filter((id) => id !== stopId) }));
internal.case.static_context.tools = internal.case.static_context.tools.filter(
  (tool) => internal.case.events.some((e) => e.tool_name === tool.function.name),
);
validatePackage(internal);
assert.deepEqual(renderStereo(buildRuntime(internal)).wav, stereo.wav);
const invalidInternal = structuredClone(internal);
invalidInternal.timeline.interruptions[0].stop_at_ms++;
assert.throws(() => validatePackage(invalidInternal), /停声/);
fail((p) => p.case.fdx_annotation.push({ fdx_type: '打断' }), /Annotation/);
fail((p) => p.case.meta_data.media.audio.tracks.reverse(), /声道/);
fail((p) => p.timeline.tracks.pop(), /七条/);
// A new title and new ID require data changes only.
const copy = structuredClone(bundle);
copy.manifest.case_id = 'team-demo';
copy.manifest.title = '同事的案例';
Object.assign(copy.case.meta_data.sample, {
  case_id: 'team-demo',
  case_name: '同事的案例',
});
assert.equal(
  packageToScenario(buildRuntime(copy)).meta.meta_data.sample.case_id,
  'team-demo',
);
// A package may be authored before its speech exists. The planned fixture is
// derived here rather than pinned to a case, so voicing one never breaks it.
const plannedOf = (src) => {
  const p = structuredClone(src);
  Object.assign(p.case.static_context.constraints, {
    timing_status: 'planned',
    audio_status: 'none',
  });
  p.alignment.clips = [];
  p.sources = {};
  return p;
};
const planned = plannedOf(bundle);
validatePackage(planned);
const plannedScenario = packageToScenario(buildRuntime(planned));
assert.equal(plannedScenario.timingStatus, 'planned');
assert.equal(plannedScenario.playableClips.length, 0);
assert(plannedScenario.tracks[0].clips.every((c) => !c.audioKey && !c.wave));
const failPlanned = (edit, pattern) => {
  const p = plannedOf(bundle);
  edit(p);
  assert.throws(() => validatePackage(p), pattern);
};
failPlanned(
  (p) => (p.case.static_context.constraints.audio_status = 'generated'),
  /planned/,
);
failPlanned(
  (p) =>
    p.alignment.clips.push({
      utterance_id: p.case.utterances[0].id,
      source: 'a.wav',
      source_start_ms: 0,
      source_end_ms: 1,
    }),
  /planned|音频/,
);

// Every overlap of real voices has to say which kind it is, and a backchannel
// has to stay inside the user's turn.
const voiced = JSON.parse(
  fs.readFileSync('case-packages/backchannel/build/backchannel.case.json'),
);
validatePackage(voiced);
const vs = packageToScenario(buildRuntime(voiced));
assert.equal(vs.timingStatus, 'aligned');
assert.equal(vs.playableClips.length, voiced.case.utterances.length);
assert.equal(vs.expressions.length, 5);
assert.equal(vs.expressions[0].delivery, '嗯');
assert.equal(vs.tracks[3].clips[0].expression, 0);
// Checkpoints survive even though nothing in this case was interrupted.
assert.equal(vs.events.length, 4);
assert.deepEqual(
  vs.events.map((e) => e.name),
  ['首次附和', '连声附和', '句中附和', '用户接管'],
);
assert(vs.events.every((e) => e.overlap === null));
const u = (id) => voiced.case.utterances.find((x) => x.id === id);
for (const b of voiced.timeline.backchannels) {
  const over = u(b.over_user_id),
    said = u(b.assistant_id);
  assert(over.start_at_ms < said.start_at_ms && said.end_at_ms < over.end_at_ms);
  assert(over.end_at_ms - said.end_at_ms >= 800);
}
const failVoiced = (edit, pattern) => {
  const p = structuredClone(voiced);
  edit(p);
  assert.throws(() => validatePackage(p), pattern);
};
failVoiced((p) => (p.timeline.backchannels = []), /未声明为打断或附和/);
failVoiced(
  (p) => (p.timeline.backchannels[0].over_user_id = 'u009'),
  /落在用户人声内部/,
);
failVoiced((p) => (p.timeline.checkpoints[0].note = ''), /检查点/);
fs.mkdirSync('/tmp/case-package-tests', { recursive: true });
fs.writeFileSync('/tmp/case-package-tests/new.case.json', JSON.stringify(copy));
console.log(
  'PASS package parity, PCM audio, overlap, planned packages, voiced backchannels, checkpoints, validation failures, arbitrary ID',
);
