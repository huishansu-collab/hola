// 脚本 → Case 包：把 script.dsl 编成 case.json / timeline.json，写回同一个包目录。
//
//   node scripts/script-to-package.mjs case-packages/meeting-milk-tea
//   node scripts/script-to-package.mjs 某个.dsl --out case-packages/xxx --id xxx
//
// 编完立刻过一遍正式校验器；不过就不落盘，免得留下一个坏包。
import fs from 'node:fs';
import path from 'node:path';
import { compileScript } from '../components/script-dsl.ts';
import { validatePackage } from '../lib/case-package/index.ts';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) i++;
  else positional.push(args[i]);
}
const target = positional[0];
if (!target) {
  console.error('用法：node scripts/script-to-package.mjs <包目录或 .dsl 文件> [--out 目录] [--id 名字]');
  process.exit(1);
}
const isDir = fs.existsSync(target) && fs.statSync(target).isDirectory();
const source = isDir ? path.join(target, 'script.dsl') : target;
const out = flag('--out', isDir ? target : path.dirname(source));
const id = flag('--id', path.basename(out));
const baseMeta = JSON.parse(fs.readFileSync('components/meta-data.json', 'utf8'));
const previous = fs.existsSync(path.join(out, 'case.json'))
  ? JSON.parse(fs.readFileSync(path.join(out, 'case.json'), 'utf8')).static_context?.constraints?.uuid_v7
  : undefined;
const result = compileScript(fs.readFileSync(source, 'utf8'), { baseMeta, caseId: id, uuid: flag('--uuid', previous) });
const width = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
for (const r of result.rows)
  console.log(`${String(r.start).padStart(6)} → ${String(r.end).padStart(6)}  ${width(r.track, 10)}${r.lane ? `#${r.lane + 1} ` : '   '}${r.label}${r.tag ? `  · ${r.tag}` : ''}`);
for (const w of result.warnings) console.log(`⚠ 第 ${w.line} 行：${w.message}`);
if (result.errors.length) {
  for (const e of result.errors) console.error(`✗ 第 ${e.line} 行：${e.message}`);
  process.exit(1);
}
validatePackage(result.pack);
const write = (file, value) => {
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
};
write('manifest.json', result.pack.manifest);
write('case.json', result.pack.case);
write('timeline.json', result.pack.timeline);
write('generation/alignment.json', result.pack.alignment);
const { user, assistant, tools, duration } = result.stats;
console.log(`\n✓ ${result.title}：用户 ${user} 段 · 助手 ${assistant} 段 · 工具 ${tools} 次 · ${(duration / 1000).toFixed(1)} 秒 → ${out}`);
