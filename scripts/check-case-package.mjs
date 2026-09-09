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
// A package may be authored before its speech exists, and every overlap of
// real voices has to say which kind it is.
const planned = JSON.parse(
  fs.readFileSync('case-packages/backchannel/build/backchannel.case.json'),
);
validatePackage(planned);
const ps = packageToScenario(buildRuntime(planned));
assert.equal(ps.timingStatus, 'planned');
assert.equal(ps.playableClips.length, 0);
assert(ps.tracks[0].clips.every((c) => !c.audioKey && !c.wave));
assert.equal(ps.expressions.length, 4);
assert.equal(ps.expressions[0].delivery, '嗐');
assert.equal(ps.tracks[3].clips[0].expression, 0);
// Checkpoints survive even though nothing in this case was interrupted.
assert.equal(ps.events.length, 3);
assert.deepEqual(
  ps.events.map((e) => [e.t, e.name]),
  [
    [15200, '首次附和'],
    [26000, '句中附和'],
    [39600, '用户接管'],
  ],
);
assert(ps.events.every((e) => e.overlap === null));
const failPlanned = (edit, pattern) => {
  const p = structuredClone(planned);
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
      utterance_id: 'u001',
      source: 'a.wav',
      source_start_ms: 0,
      source_end_ms: 1,
    }),
  /planned|音频/,
);
failPlanned((p) => (p.timeline.backchannels = []), /未声明为打断或附和/);
failPlanned(
  (p) => (p.timeline.backchannels[0].over_user_id = 'u009'),
  /落在用户人声内部/,
);
failPlanned((p) => (p.timeline.checkpoints[0].note = ''), /检查点/);
fs.mkdirSync('/tmp/case-package-tests', { recursive: true });
fs.writeFileSync('/tmp/case-package-tests/new.case.json', JSON.stringify(copy));
console.log(
  'PASS package parity, PCM audio, overlap, planned packages, backchannels, checkpoints, validation failures, arbitrary ID',
);
