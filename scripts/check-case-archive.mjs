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
// 所有 Case 包的音频都要进注册表：漏一个，那个 Case 的 audioKey 就查不到，
// 这里会直接崩在 a.src 上（backchannel 和导入的 explicit-* 都是这么暴露出来的）。
for (const dir of fs.readdirSync('case-packages', { withFileTypes: true })) {
  const file = `case-packages/${dir.name}/build/runtime.json`;
  if (!dir.isDirectory() || !fs.existsSync(file)) continue;
  const runtime = JSON.parse(fs.readFileSync(file));
  for (const [id, a] of Object.entries(runtime.audio))
    registry[`package/${runtime.manifest.case_id}/${id}`] = a;
}
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
  // 缺文件必须解不出来。没配音的 Case（planned）压根没有 audio/clips，
  // 拿它去删一个不存在的文件，assert.throws 反而不成立——改成删这个包真有的必需文件。
  const broken = { ...files };
  delete broken[keys.length ? 'audio/clips/001.wav' : 'timeline.json'];
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
