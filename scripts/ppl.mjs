// 一条 Case 的流水线：脚本 → 人 review → 配音 → 对齐 → 校验 → 构建。
//
//   npm run ppl -- new <id> "<场景一句话>"   建草稿骨架，按 skill 写脚本
//   npm run ppl -- review <id>              把脚本打出来给人看
//   npm run ppl -- approve <id> --by <名字>  人 review 通过（花钱前的闸）
//   npm run ppl -- make <id>                approve 之后才动，做到能做的最后一步
//   npm run ppl -- status [id]              每条 Case 走到哪儿了
//
// make 是可重入的：每次都从「还差什么」接着做。母带没回来就停在等 CI，
// 母带回来了再跑一次就往下走到构建完成。中间任何一步不过就停在那儿，不往下带病走。
//
// 脚本本身由模型按 skills/interaction-case-pipeline 写——那一步是创作，不是脚本能替的；
// 这里负责把创作前后的确定性步骤串起来，并且守住「人没点头不花钱」这条线。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [command, id, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(name);
  return i < 0 ? null : rest[i + 1] ?? true;
};
const SKILL = 'skills/interaction-case-pipeline';
const pkg = (x) => path.join('case-packages', x);
const work = (x) => path.join('local', x);
const statePath = (x) => path.join('local/ppl', `${x}.json`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const run = (cmd, args) => {
  console.log(`  $ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit' });
};

const STAGES = ['draft', 'reviewed', 'voicing', 'aligned', 'built'];
function state(x, patch) {
  const p = statePath(x);
  const cur = fs.existsSync(p)
    ? readJson(p)
    : { case_id: x, stage: 'draft', history: [] };
  if (!patch) return cur;
  const next = { ...cur, ...patch };
  if (patch.stage && patch.stage !== cur.stage)
    next.history = [...cur.history, { at: now(), stage: patch.stage, note: patch.note ?? '' }];
  delete next.note;
  writeJson(p, next);
  return next;
}

function newCase() {
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id))
    die('用法：npm run ppl -- new <id> "<场景一句话>"，id 只能是小写字母、数字、-、_');
  const scene = rest.filter((x) => !x.startsWith('--')).join(' ');
  if (!scene) die('缺场景描述：一句话说清是谁、在哪、要办什么');
  if (fs.existsSync(pkg(id))) die(`${pkg(id)} 已存在，换个 id 或直接 review`);
  const t = readJson(path.join(SKILL, 'assets/case-template.json'));
  const uuid = execFileSync(process.execPath, ['scripts/case-package/cli.mjs', 'id'], {
    encoding: 'utf8',
  }).trim();
  t.manifest.case_id = id;
  t.manifest.title = scene.slice(0, 40);
  Object.assign(t.case.meta_data.sample, { case_id: id, case_name: scene.slice(0, 40) });
  // 模板写的是 pending，当前校验器要求 planned 包写 none。
  Object.assign(t.case.static_context.constraints, {
    audio_status: 'none',
    task_goal: scene,
    uuid_v7: uuid,
  });
  fs.mkdirSync(path.join(pkg(id), 'generation'), { recursive: true });
  writeJson(path.join(pkg(id), 'manifest.json'), t.manifest);
  writeJson(path.join(pkg(id), 'case.json'), t.case);
  writeJson(path.join(pkg(id), 'timeline.json'), t.timeline);
  writeJson(path.join(pkg(id), 'generation/alignment.json'), t.alignment);
  fs.writeFileSync(path.join(pkg(id), 'brief.md'), `# 需求：${scene}\n\n## 要考察什么\n\n（待填）\n`);
  fs.writeFileSync(path.join(pkg(id), 'script.md'), `# ${scene}\n\n（待填：脚本故事线）\n`);
  state(id, { stage: 'draft', scene, uuid_v7: uuid, note: '建骨架' });
  console.log(`✓ 骨架已建：${pkg(id)}　UUID ${uuid}`);
  console.log(`\n下一步（这一步是创作，交给模型按 skill 写，不是脚本能替的）：`);
  console.log(`  1. 读 ${SKILL}/SKILL.md，按「优先交付脚本故事线」写 script.md 与 brief.md`);
  console.log(`  2. 台词、工具、判断、表达控制写进 case.json / timeline.json`);
  console.log(`  3. npm run ppl -- review ${id}　把脚本交给人看`);
}

function review() {
  if (!id) die('用法：npm run ppl -- review <id>');
  const d = readJson(path.join(pkg(id), 'case.json'));
  const s = state(id);
  const script = path.join(pkg(id), 'script.md');
  console.log(`\n${'─'.repeat(64)}\n${d.meta_data.sample.case_name}　（${id}）\n${'─'.repeat(64)}`);
  console.log(fs.readFileSync(script, 'utf8').trim());
  const users = d.utterances.filter((u) => u.speaker !== 'assistant').length;
  const assistant = d.utterances.length - users;
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`用户 ${users} 段 · 助手 ${assistant} 段 · 工具 ${new Set(d.events.map((e) => e.event_id)).size} 次` +
    ` · 预计 ${(d.meta_data.media.audio.duration_ms ?? 0) / 1000} 秒（设计值，配音后按录音重排）`);
  console.log(`\n人要看的三件事：台词像不像人话；打断、附和、垫话该有的有没有；工具边界有没有越界。`);
  console.log(`没问题：npm run ppl -- approve ${id} --by <你的名字>`);
  console.log(`要改：直接改 script.md 与 case.json，改完再 review。当前状态 ${s.stage}`);
}

function approve() {
  if (!id) die('用法：npm run ppl -- approve <id> --by <名字>');
  const by = flag('--by');
  if (!by || by === true) die('要留名字：--by <名字>。这条记录是「谁点的头」，不是形式');
  check(id);
  state(id, { stage: 'reviewed', approved: { by, at: now() }, note: `${by} review 通过` });
  console.log(`✓ ${by} 已 review 通过，可以生成 demo 了：npm run ppl -- make ${id}`);
}

function check(x) {
  console.log('· 校验脚本与数据');
  run(process.execPath, ['scripts/case-package/cli.mjs', 'validate', pkg(x)]);
  run(process.execPath, ['scripts/check-case-json.mjs', x]);
}

function make() {
  if (!id) die('用法：npm run ppl -- make <id>');
  const s = state(id);
  if (!s.approved)
    die(`${id} 还没人 review 通过。配音要花钱，先 npm run ppl -- review ${id}`);
  const master = work(`${id}/audio/session-master.wav`);
  const request = work(`${id}/master-request.json`);
  const align = work(`${id}/align.json`);
  const d = () => readJson(path.join(pkg(id), 'case.json'));

  if (!fs.existsSync(request)) {
    console.log('· 生成 TTS 请求（含节奏说明与逐句读法）');
    run('python3', ['local/explicit-cases/voice_request.py', id]);
  }
  if (!fs.existsSync(master)) {
    const yml = '.github/synthesis-tts-request.yml';
    const run_no = (fs.readFileSync(yml, 'utf8').match(/^run:\s*(\d+)/m)?.[1] ?? 0) * 1 + 1;
    fs.writeFileSync(yml,
      `# 改这个文件并 push，就跑一次语音生成。cases 一行一个，需要 local/<case>/master-request.json。\n` +
      `# 请求文件用 local/explicit-cases/voice_request.py 生成。\ncases:\n  - ${id}\nrun: ${run_no}\n`);
    state(id, { stage: 'voicing', note: '等 CI 生成母带' });
    console.log(`· 母带还没回来。已把 ${id} 写进 ${yml}（run ${run_no}）`);
    console.log(`  push 这次改动触发 CI，母带会自动提交回分支；回来后再跑一次 make 就接着往下走。`);
    return;
  }
  if (!fs.existsSync(align) || fs.statSync(align).mtimeMs < fs.statSync(master).mtimeMs) {
    console.log('· 按录音对齐切点');
    run('python3', ['local/align_master.py', id]);
  }
  const low = readJson(align).clips.filter((c) => (c.similarity ?? 1) < 0.5);
  if (low.length)
    die(`识别匹配率过低：${low.map((c) => c.utterance_id).join('、')}。` +
      `多半是整句漏读，删掉 ${master} 重生成母带再来`);
  if (d().static_context.constraints.timing_status === 'planned') {
    console.log('· 按录音重排时间线（planned → aligned）');
    run('python3', ['local/explicit-cases/retime.py', id]);
    state(id, { stage: 'aligned', note: '按录音重排完成' });
  }
  check(id);
  console.log('· 构建交付产物');
  run(process.execPath, ['scripts/case-package/cli.mjs', 'build', pkg(id)]);
  const data = d();
  state(id, { stage: 'built', note: '构建完成' });
  console.log(`\n✓ demo 好了：${data.meta_data.sample.case_name}`);
  console.log(`  时长 ${data.meta_data.media.audio.duration_ms} ms · ` +
    `${data.utterances.length} 句 · 产物在 ${pkg(id)}/build/`);
  console.log(`  站内播放：npm run dev:local　交付：build/${id}.tar 与完整 ZIP`);
}

function status() {
  const ids = id ? [id] : fs.existsSync('local/ppl')
    ? fs.readdirSync('local/ppl').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
    : [];
  if (!ids.length) return console.log('还没有走流水线的 Case。npm run ppl -- new <id> "<场景>"');
  for (const x of ids) {
    const s = state(x);
    const bar = STAGES.map((g) => (STAGES.indexOf(s.stage) >= STAGES.indexOf(g) ? '●' : '○')).join('');
    console.log(`${bar} ${x.padEnd(18)} ${s.stage.padEnd(9)}` +
      (s.approved ? ` review: ${s.approved.by}` : ' 待 review'));
  }
  console.log(`\n${STAGES.join(' → ')}`);
}

const handlers = { new: newCase, review, approve, make, status };
const handler = handlers[command ?? 'status'];
if (!handler) die(`不认识的命令 ${command}。可用：${Object.keys(handlers).join('、')}`);
try {
  handler();
} catch (e) {
  die(e.stdout?.toString().trim() || e.message);
}
