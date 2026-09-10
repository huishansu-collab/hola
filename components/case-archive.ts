import type { Scenario } from '../app/page';
import { audioClips } from './audio/use-timeline-audio';
import { synthesize, type SpeechClip } from './audio/synthesis';
import { buildCaseData } from './case-data';
import { storedPackages } from './case-package-store';
import {
  snapshotFiles,
  sourceFiles,
  readZip,
  writeZip,
  jsonBytes,
  type CaseSnapshot,
} from '../lib/case-package/archive';
import { type CasePackage } from '../lib/case-package/index';
import gmailPack from '../case-packages/gmail/build/gmail.case.json';

export async function downloadCaseZip(
  id: string,
  title: string,
  scenario: Scenario,
) {
  const saved = (await storedPackages()).find((p) => p.id === id);
  const copy = structuredClone(scenario);
  const audio: CaseSnapshot['audio'] = {};
  const keys = [
    ...new Set(
      [...copy.playableClips, ...copy.tracks.flatMap((t) => t.clips)].flatMap(
        (c) => (c.audioKey ? [c.audioKey] : []),
      ),
    ),
  ];
  const remap = new Map(keys.map((key, i) => [key, `clip-${i + 1}`]));
  for (const key of keys) {
    if (!audioClips[key]) throw Error('Case 音频缺失，请先生成语音');
    audio[remap.get(key)!] = audioClips[key];
  }
  for (const c of new Set([
    ...copy.playableClips,
    ...copy.tracks.flatMap((t) => t.clips),
  ]))
    if (c.audioKey) c.audioKey = remap.get(c.audioKey)!;
  const files = snapshotFiles({
    format: 'interaction-case-snapshot/1',
    id,
    title,
    scenario: copy,
    audio,
  });
  if (saved?.archive) {
    const previous = readZip(saved.archive);
    for (const [p, bytes] of Object.entries(previous))
      if (p.startsWith('source/') || p.startsWith('notes/')) files[p] = bytes;
  }
  const source =
    saved?.pack ??
    (!saved && id === 'gmail' ? (gmailPack as CasePackage) : undefined);
  if (source) Object.assign(files, sourceFiles(source));
  const document = buildCaseData({
    caseId: id,
    caseTitle: title,
    durationMs: scenario.END,
    events: scenario.inputEvents,
    utterances: scenario.utterances,
    controls: scenario.controlAnnotations,
    metaOverride: scenario.meta,
  }).document;
  files['case.json'] = jsonBytes(document);
  const speech: SpeechClip[] = scenario.tracks
    .filter((t) => ['用户', '助手'].includes(t.name))
    .flatMap((t) =>
      t.clips
        .filter((c) => c.audioKey)
        .map((c) => ({
          ...c,
          role: t.name === '用户' ? ('user' as const) : ('assistant' as const),
        })),
    );
  if (speech.length) {
    const mixed = await synthesize(id, scenario.END, speech);
    files['audio/combined.wav'] = new Uint8Array(await mixed.wav.arrayBuffer());
  }
  const script =
    `# ${title}\n\n` +
    scenario.utterances
      .map(
        (u) => `- ${u.start_at_ms}–${u.end_at_ms} ms · ${u.speaker}：${u.text}`,
      )
      .join('\n');
  files['script.md'] = new TextEncoder().encode(script + '\n');
  files['README.md'] = new TextEncoder().encode(
    `# ${title}\n\n时长：${scenario.END} ms。\n\n- case.json：Meta、Utterances、Events、Annotation 的完整数据。\n- timeline.json：全部轨道、打断、表达控制和播放时序。\n- script.md：对白及时间。\n- audio/clips/ 与 audio/index.json：全部引用音频及截取、循环参数，包含等待音效。\n- audio/combined.wav：用户左声道、助手右声道的完整对话音频（已有语音时提供）。\n${source || Object.keys(files).some((p) => p.startsWith('source/')) ? '- source/：保留原始制作包、源录音及生成记录；当前编辑后的时间线以根目录 case.json 和 timeline.json 为准。\n' : '- 此 Case 保留当前可用音频片段；原始生成提示词和母带未收录。\n'}\n在平台 Files 栏点击“导入 Case 包”，选择本 ZIP 即可恢复。相同 Case ID 更新现有 Case，保留所在文件夹。音频预览的 TAR 用于最终交付，本 ZIP 用于保存和重新导入。\n\n修改数据时，请同步 case.json 与 timeline.json；导入会检查一致性。\n`,
  );
  const bytes = writeZip(files),
    url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
    );
  const a = documentCreateLink(url, `${id}.case.zip`);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function documentCreateLink(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  return a;
}
