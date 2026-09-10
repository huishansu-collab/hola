import {
  buildRuntime,
  type CasePackage,
  type RuntimeCase,
} from '../lib/case-package/index.ts';
import {
  readZip,
  readJson,
  sourcePackage,
  snapshotFromFiles,
  type CaseSnapshot,
} from '../lib/case-package/archive';
import { buildCaseData } from './case-data';
import { audioClips } from './audio/use-timeline-audio';
import { packageToScenario } from './package-scenario';
export type ImportedCase = {
  id: string;
  title: string;
  revision: string;
  runtime?: RuntimeCase;
  pack?: CasePackage;
  snapshot?: CaseSnapshot;
  archive?: Uint8Array;
};
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('track-studio-case-packages-v1', 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore('packages', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function storedPackages() {
  const db = await database();
  return new Promise<ImportedCase[]>((resolve, reject) => {
    const t = db.transaction('packages');
    const r = t.objectStore('packages').getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => db.close();
  });
}
export async function importPackage(file: File): Promise<ImportedCase> {
  if (file.size > 64 * 1024 * 1024) throw Error('Case 包不能超过 64 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let pack: CasePackage | undefined,
    snapshot: CaseSnapshot | undefined,
    archive: Uint8Array | undefined;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    archive = bytes;
    const files = readZip(bytes),
      m = readJson(files, 'manifest.json');
    if (m.format === 'interaction-case-snapshot/1') {
      snapshot = snapshotFromFiles(files);
      const s = snapshot.scenario;
      const document = buildCaseData({
        caseId: snapshot.id,
        caseTitle: snapshot.title,
        durationMs: s.END,
        events: s.inputEvents,
        utterances: s.utterances,
        controls: s.controlAnnotations,
        metaOverride: s.meta,
      }).document;
      const stable = (v: unknown): string =>
        JSON.stringify(v, (_key, x) =>
          x && typeof x === 'object' && !Array.isArray(x)
            ? Object.fromEntries(
                Object.keys(x)
                  .sort()
                  .map((k) => [k, x[k]]),
              )
            : x,
        );
      if (stable(document) !== stable(readJson(files, m.files.case)))
        throw Error('case.json 与时间线不一致，请同步更新后导入');
    } else pack = sourcePackage(files);
  } else {
    try {
      pack = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw Error('请选择完整 Case ZIP 或 .case.json 文件');
    }
  }
  const runtime = pack ? buildRuntime(pack) : undefined;
  const id = snapshot?.id ?? runtime!.manifest.case_id;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const revision = Array.from(new Uint8Array(hash), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
  const item: ImportedCase = {
    id,
    title: snapshot?.title ?? runtime!.manifest.title,
    revision,
    runtime,
    pack,
    snapshot,
    archive,
  };
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction('packages', 'readwrite');
    t.objectStore('packages').put(item);
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onabort = t.onerror = () => {
      db.close();
      reject(Error('无法保存 Case 包；请检查浏览器存储空间'));
    };
  });
  return item;
}
export function importedScenario(item: ImportedCase) {
  const namespace = `package/${item.id}/${item.revision}`;
  if (item.snapshot) {
    const scenario = structuredClone(item.snapshot.scenario);
    for (const [key, audio] of Object.entries(item.snapshot.audio))
      audioClips[`${namespace}/${key}`] = audio;
    for (const clip of new Set([
      ...scenario.playableClips,
      ...scenario.tracks.flatMap((t) => t.clips),
    ]))
      if (clip.audioKey) clip.audioKey = `${namespace}/${clip.audioKey}`;
    return scenario;
  }
  for (const [id, audio] of Object.entries(item.runtime!.audio))
    audioClips[`${namespace}/${id}`] = audio;
  return packageToScenario(item.runtime!, namespace);
}
