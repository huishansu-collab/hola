import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadCases } from './load-cases.mjs';
import {
  snapshotFiles,
  snapshotFromFiles,
  writeZip,
  readZip,
  sourcePackage,
  sourceFiles,
} from '../lib/case-package/archive.ts';
const registry = Object.assign(
  {},
  ...['clips', 'actor-clips', 'ride-clips', 'coffee-clips', 'sms-clips'].map(
    (n) => JSON.parse(fs.readFileSync(`components/audio/${n}.json`)),
  ),
);
const runtime = JSON.parse(
  fs.readFileSync('case-packages/gmail/build/runtime.json'),
);
for (const [id, a] of Object.entries(runtime.audio))
  registry['package/gmail/' + id] = a;
for (const [id, scenario] of Object.entries(loadCases())) {
  const keys = [
    ...new Set(
      [
        ...scenario.playableClips,
        ...scenario.tracks.flatMap((t) => t.clips),
      ].flatMap((c) => (c.audioKey ? [c.audioKey] : [])),
    ),
  ];
  const snapshot = {
    format: 'interaction-case-snapshot/1',
    id,
    title: id,
    scenario,
    audio: Object.fromEntries(keys.map((k) => [k, registry[k]])),
  };
  const files = snapshotFiles(snapshot),
    zip = writeZip(files);
  assert.deepEqual(
    snapshotFromFiles(readZip(zip)),
    JSON.parse(JSON.stringify(snapshot)),
  );
  console.log(
    `PASS ${id}: ${keys.length} audio sources, ${(zip.length / 1048576).toFixed(1)} MB ZIP round trip`,
  );
  const broken = { ...files };
  delete broken['audio/clips/001.wav'];
  assert.throws(() => snapshotFromFiles(broken));
}
const source = JSON.parse(
  fs.readFileSync('case-packages/gmail/build/gmail.case.json'),
);
assert.deepEqual(
  sourcePackage(readZip(writeZip(sourceFiles(source, '')))),
  source,
);
assert.throws(() =>
  readZip(writeZip({ '../outside.txt': new Uint8Array([1]) })),
);
console.log(
  'PASS source package, notes and requests round trip; missing audio and unsafe paths rejected',
);
