#!/usr/bin/env node
/*
 * server/cli.js — 命令行:
 *   node server/cli.js list
 *   node server/cli.js parse <script.dsl> [--out script.json]        剧本 → script.json
 *   node server/cli.js validate <caseId|script.json>
 *   node server/cli.js plan <caseId>                                  逐句语音计划 JSON(离线引擎 tools/offline_tts.py 用)
 *   node server/cli.js tts <caseId> [--provider openai|qwen] [--model …] [--force] [--only u001,u002]   生成语音
 *   node server/cli.js export <caseId> [--out dir] [--sample s01]    规范化 JSON + 双声道 WAV
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ROOT, listCases, loadCase, audioDir } from './cases.js';
import { generateCaseAudio, ttsConfig } from './tts.js';
import { ttsPlan, PROVIDERS } from '../shared/tts.js';
import { mixSchedule } from './audio.js';
import { parseDSL } from '../shared/dsl.js';
import { validateScript, normalizeScript } from '../shared/script.js';
import { buildNormalized, checkNormalized } from '../shared/normalize.js';

try { if (existsSync(path.join(ROOT, '.env'))) process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* ignore */ }

const [, , cmd, ...rest] = process.argv;
const flags = {}; const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const k = rest[i].slice(2); const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; flags[k] = v; }
  else args.push(rest[i]);
}

async function main() {
  switch (cmd) {
    case 'list': {
      for (const c of await listCases()) console.log(`${c.id.padEnd(12)} ${String(c.case_id).padEnd(6)} ${c.name}  · 语音 ${c.audio_ready}/${c.utterances}${c.has_dsl ? ' · dsl' : ''}`);
      break;
    }
    case 'parse': {
      const file = args[0]; if (!file) throw new Error('用法:parse <script.dsl> [--out script.json]');
      const { script, warnings } = parseDSL(await fs.readFile(file, 'utf8'));
      const v = validateScript(script);
      warnings.concat(v.warnings).forEach(w => console.warn('⚠', w));
      v.errors.forEach(e => console.error('✗', e));
      const out = flags.out || file.replace(/\.dsl$/, '') + '.json';
      await fs.writeFile(out, JSON.stringify(script, null, 2) + '\n');
      console.log(`→ ${out}  (${script.timeline.length} steps, ${script.timeline.filter(s => s.type === 'say').length} utterances)`);
      if (v.errors.length) process.exit(1);
      break;
    }
    case 'validate': {
      const target = args[0]; if (!target) throw new Error('用法:validate <caseId|script.json>');
      const script = target.endsWith('.json') ? JSON.parse(await fs.readFile(target, 'utf8')) : (await loadCase(target)).script;
      const v = validateScript(script);
      v.warnings.forEach(w => console.warn('⚠', w)); v.errors.forEach(e => console.error('✗', e));
      console.log(v.errors.length ? '校验失败' : '校验通过');
      if (v.errors.length) process.exit(1);
      break;
    }
    case 'plan': {
      const id = args[0]; if (!id) throw new Error('用法:plan <caseId>');
      const c = await loadCase(id);
      const s = normalizeScript(c.script);
      const steps = Object.fromEntries(s.timeline.filter(x => x.type === 'say').map(x => [x.id, x]));
      const items = ttsPlan(s, { provider: flags.provider, model: flags.model }).map(it => {
        const st = steps[it.id] || {}; const sp = s.speakers[it.speaker] || {};
        const have = c.manifest.clips?.[it.clip] || null;
        return { ...it, role: sp.role || (it.speaker === 'assistant' ? 'assistant' : 'user'), local_voice: sp.tts?.local_voice || st.tts?.local_voice || null,
          direction: st.direction || null, whisper: !!st.whisper, soft: !!st.soft, tone: st.tone || null,
          have: have ? { file: have.file, source: have.source || null, hash: have.hash || null, text: have.text ?? null } : null };
      });
      console.log(JSON.stringify({ id, name: s.name, audio_dir: audioDir(id), speakers: s.speakers, items }, null, flags.compact ? 0 : 2));
      break;
    }
    case 'tts': {
      const id = args[0]; if (!id) throw new Error('用法:tts <caseId> [--force] [--only u001,u002]');
      const cfg = ttsConfig(process.env, flags.provider);
      if (flags.provider && !PROVIDERS[flags.provider]) throw new Error(`未知 provider ${flags.provider}(可选:${Object.keys(PROVIDERS).join(' / ')})`);
      if (!cfg.apiKey) throw new Error(`缺少 ${cfg.envKey}(复制 .env.example 为 .env 并填入)`);
      console.log(`引擎:${cfg.name} · ${flags.model || cfg.model}`);
      if (cfg.proxyHint) console.warn('提示:检测到 HTTPS_PROXY,如需走代理请用 NODE_USE_ENV_PROXY=1 运行');
      const c = await loadCase(id);
      const only = flags.only ? String(flags.only).split(',') : null;
      const r = await generateCaseAudio(id, c.script, { force: !!flags.force, only, provider: flags.provider, model: flags.model, onProgress: p => console.log(`[${p.index}/${p.total}] ${p.id} ${p.status} ${p.message || ''}`) });
      console.log(`生成 ${r.generated.length} · 缓存 ${r.skipped.length} · 失败 ${r.failed.length}`);
      r.failed.forEach(f => console.error('✗', f.id, f.error));
      if (r.failed.length) process.exit(1);
      break;
    }
    case 'export': {
      const id = args[0]; if (!id) throw new Error('用法:export <caseId> [--out dir] [--sample s01]');
      const c = await loadCase(id);
      const { json, schedule } = buildNormalized(c.script, c.durations, { sample_id: flags.sample });
      const issues = checkNormalized(json);
      const base = `${json.meta_data.sample.case_id}_${json.meta_data.sample.sample_id}`;
      const outDir = flags.out || path.join(ROOT, 'cases', id, 'export');
      await fs.mkdir(path.join(outDir, 'json', 'synthetic'), { recursive: true });
      await fs.mkdir(path.join(outDir, 'audio', 'synthetic'), { recursive: true });
      await fs.writeFile(path.join(outDir, 'json', 'synthetic', base + '.json'), JSON.stringify(json, null, 2) + '\n');
      const mix = await mixSchedule(schedule, audioDir(id), c.manifest);
      await fs.writeFile(path.join(outDir, 'audio', 'synthetic', base + '.wav'), mix.wav);
      console.log(`→ ${outDir}/json/synthetic/${base}.json  (${json.utterances.length} utterances, ${json.events.length} events, ${json.annotation.fdx_annotation.length} fdx)`);
      console.log(`→ ${outDir}/audio/synthetic/${base}.wav  (${(mix.duration_ms / 1000).toFixed(1)}s, 放入 ${mix.placed.length} 段${mix.skipped.length ? `, 跳过 ${mix.skipped.length} 段:` + mix.skipped.map(x => x.clip + '(' + x.reason + ')').join(' ') : ''})`);
      issues.forEach(i => console.warn('⚠', i));
      break;
    }
    default:
      console.log('用法:node server/cli.js <list|parse|validate|tts|export> …');
  }
}
main().catch(e => { console.error('✗', e.message); process.exit(1); });
