#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  validatePackage,
  buildRuntime,
  renderStereo,
  safePath,
} from '../../lib/case-package/index.ts';
const [command, folder, ...flags] = process.argv.slice(2);
async function file(root, name) {
  if (!safePath(name)) throw Error(`非法路径：${name}`);
  const real = await fs.realpath(path.resolve(root, name));
  if (!real.startsWith(root + path.sep))
    throw Error(`文件超出 Case 目录：${name}`);
  return fs.readFile(real);
}
async function load(folder) {
  const root = await fs.realpath(folder),
    manifest = JSON.parse(await file(root, 'manifest.json'));
  if (manifest.schema_version !== 1) throw Error('不支持的 manifest 版本');
  const json = async (p) => JSON.parse(await file(root, p));
  const d = await json(manifest.files.case),
    timeline = await json(manifest.files.timeline),
    alignment = await json(manifest.files.alignment),
    sources = {};
  for (const key of ['brief', 'script']) await file(root, manifest.files[key]);
  for (const p of new Set(alignment.clips.map((c) => c.source)))
    sources[p] = (await file(root, p)).toString('base64');
  return {
    format: 'interaction-case/1',
    manifest,
    case: d,
    timeline,
    alignment,
    sources,
  };
}
function tar(files) {
  const parts = [];
  for (const [name, bytes] of files) {
    const h = Buffer.alloc(512),
      str = (p, s) => h.write(s, p),
      oct = (p, n, v) => str(p, v.toString(8).padStart(n - 1, '0') + '\0');
    str(0, name);
    oct(100, 8, 0o644);
    oct(108, 8, 0);
    oct(116, 8, 0);
    oct(124, 12, bytes.length);
    oct(136, 12, 0);
    h.fill(32, 148, 156);
    str(156, '0');
    str(257, 'ustar\0');
    str(263, '00');
    str(
      148,
      h
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
    );
    parts.push(h, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
try {
  if (
    !['validate', 'build'].includes(command) ||
    !folder ||
    (flags.length !== 0 &&
      (command !== 'build' || flags.length !== 2 || flags[0] !== '--out'))
  )
    throw Error(
      '用法：npm run case:validate -- <目录> 或 npm run case:build -- <目录> [--out <产物目录>]',
    );
  const pack = await load(folder);
  validatePackage(pack);
  if (command === 'validate') {
    console.log(
      `PASS ${pack.manifest.case_id}: 数据、音频、时序及工具关联通过`,
    );
    process.exit(0);
  }
  const runtime = buildRuntime(pack),
    render = renderStereo(runtime),
    out = path.resolve(
      flags[0] === '--out' ? flags[1] : path.join(folder, 'build'),
    );
  if (
    out === path.resolve(folder) ||
    [
      ...Object.keys(pack.sources),
      ...Object.values(pack.manifest.files),
      'manifest.json',
    ].some((p) => path.resolve(folder, p).startsWith(out + path.sep))
  )
    throw Error('产物目录不能覆盖源文件');
  const json = {
    ...runtime.case,
    meta_data: {
      ...runtime.case.meta_data,
      media: {
        ...runtime.case.meta_data.media,
        audio: {
          ...runtime.case.meta_data.media.audio,
          file: 'audio.wav',
          sample_rate: 48000,
          channels: 2,
          encoding: 'PCM_16',
        },
      },
    },
  };
  const text = (d) => Buffer.from(JSON.stringify(d, null, 2) + '\n'),
    files = [
      ['audio.wav', Buffer.from(render.wav)],
      ['case.json', text(json)],
    ];
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir(path.join(out, 'clips'), { recursive: true });
  for (const [id, clip] of Object.entries(runtime.audio)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id))
      throw Error('Utterance ID 只能包含字母、数字、下划线和连字符');
    await fs.writeFile(
      path.join(out, 'clips', id + '.wav'),
      Buffer.from(clip.src.split(',')[1], 'base64'),
    );
  }
  for (const [name, bytes] of [
    ...files,
    ['peaks.json', text(render.peaks)],
    ['runtime.json', text(runtime)],
    [`${pack.manifest.case_id}.case.json`, text(pack)],
    [`${pack.manifest.case_id}.tar`, tar(files)],
  ])
    await fs.writeFile(path.join(out, name), bytes);
  console.log(
    `BUILD ${pack.manifest.case_id}: ${out}\n导入网站：${pack.manifest.case_id}.case.json\n交付：${pack.manifest.case_id}.tar`,
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
