import {
  buildRuntime,
  type CasePackage,
  type RuntimeCase,
} from '../lib/case-package/index.ts';
import { audioClips } from './audio/use-timeline-audio';
import { packageToScenario } from './package-scenario';
export type ImportedCase = {
  id: string;
  title: string;
  revision: string;
  runtime: RuntimeCase;
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
  const text = await file.text();
  let pack: CasePackage;
  try {
    pack = JSON.parse(text);
  } catch {
    throw Error('无法读取 Case 包，请选择构建生成的 .case.json 文件');
  }
  const runtime = buildRuntime(pack),
    id = runtime.manifest.case_id;
  if (['weather', 'actor', 'ride', 'coffee', 'sms'].includes(id))
    throw Error('此 ID 属于尚未迁移的内置 Case，请使用新的 Case ID');
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  const revision = Array.from(new Uint8Array(hash), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
  const item = { id, title: runtime.manifest.title, revision, runtime };
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
  for (const [id, audio] of Object.entries(item.runtime.audio))
    audioClips[`${namespace}/${id}`] = audio;
  return packageToScenario(item.runtime, namespace);
}
