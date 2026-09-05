/*
 * shared/normalize.js — 脚本 + 时间轴调度 → Live Interaction Normalized JSON(Draft v5)。
 *
 * 顶层结构严格按 Draft v5 骨架:
 *   meta_data / static_context / dynamic_context / utterances / events / annotation
 * 其中 annotation 内除 fdx_annotation / emotion_annotation / paralinguistic_annotation 三个规范字段外,
 * 额外保留 track_annotation(八轨日志原文 + 结构化字段),供数据工作检索;模型不消费。
 */

import { normalizeScript, FDX_TYPES } from './script.js';
import { schedule } from './schedule.js';
import { inferFdx } from './tracks.js';

const SPEAKER_KIND = { user: 'user', assistant: 'assistant', third_party: 'third_party', system: 'system' };

export function buildNormalized(input, durations = {}, opts = {}) {
  const s = normalizeScript(input);
  const sch = schedule(s, durations);
  const sampleId = opts.sample_id || s.sample_id || 's01';
  const caseId = String(opts.case_id || s.case_id);
  const base = `${caseId}_${sampleId}`;
  const byIndex = new Map(sch.utterances.map(u => [u.index, u]));

  /* ---------- utterances ---------- */
  const utterances = [];
  for (const st of s.timeline) {
    if (st.type !== 'say') continue;
    const u = byIndex.get(st.i);
    const sp = s.speakers[st.speaker] || {};
    const row = {
      id: st.id,
      speaker: SPEAKER_KIND[st.role] || 'third_party',
      speaker_id: sp.speaker_id || st.speaker,
      text: st.text,
      sample_seg_id: st.id,
      start_at_ms: u.start,
      end_at_ms: u.end,
    };
    if (u.cut) row.cut_at_ms = u.cut_at_ms;          // 被打断:实际让位时刻(扩展字段)
    if (u.interrupts) row.interrupts = u.interrupts;  // 打断了哪一句(扩展字段)
    if (st.typed) row.modality = 'text';              // 打字回复,无语音(扩展字段)
    if (u.story_start != null) row.story_clock_ms = u.story_start;
    if (sp.name && st.role === 'third_party') row.speaker_name = sp.name;
    utterances.push(row);
  }

  /* ---------- events ---------- */
  const events = sch.events.filter(e => e.event_type !== 'world_signal').map(e => {
    const { step, substep, ...rest } = e;
    return rest;
  });

  /* ---------- dynamic_context.world_signal ---------- */
  const world_signal = sch.events.filter(e => e.event_type === 'world_signal').map(e => ({ time_at_ms: e.time_at_ms, ...e.signal }));

  /* ---------- annotations ---------- */
  const fdx = [], emotion = [], para = [], tracks = [];
  const utterById = new Map(sch.utterances.map(u => [u.id, u]));
  for (const st of s.timeline) {
    const u = st.type === 'say' ? byIndex.get(st.i) : null;
    const rec = sch.steps[st.i];
    const roleTrack = (r) => (r === 'assistant' ? 'assistant' : 'user');
    if (st.type === 'say') {
      const role = roleTrack(st.role);
      for (const type of inferFdx(st)) {
        if (!FDX_TYPES.includes(type)) continue;
        let start = u.start, end = u.end;
        if (type === '打断' && u.interrupts) {
          const target = utterById.get(u.interrupts);
          end = Math.min(u.end, target ? target.end : u.end);
          if (end - start < 400) end = start + 400;
        } else if (type === '非结束性停顿') {
          start = Math.max(u.start, u.end - 400);
        } else if (type === '主动开口') {
          start = Math.max(0, u.start - 200); end = u.start + 200;
        }
        fdx.push({ fdx_type: type, role, start_at_ms: start, end_at_ms: end, utterance_id: st.id });
      }
      if (st.emotion) emotion.push({ emotion_type: st.emotion, role, start_at_ms: u.start, end_at_ms: u.end, utterance_id: st.id });
      const voicing = st.voicing || '';
      const paraTypes = new Set(st.paralinguistic || []);
      for (const [re, name] of [[/低语|低声/, '低语'], [/叹气/, '叹气'], [/轻笑|笑/, '轻笑'], [/语气词|念叨/, '语气词'], [/含糊|含混/, '含糊'], [/急促/, '急促']]) {
        if (re.test(voicing) || re.test(st.tone || '')) paraTypes.add(name);
      }
      for (const p of paraTypes) para.push({ paralinguistic_type: p, role, start_at_ms: u.start, end_at_ms: u.end, utterance_id: st.id });
    }
    for (const lg of st.log || []) {
      const role = st.type === 'say' ? roleTrack(st.role) : (lg.sub === '助手' ? 'assistant' : lg.sub === '用户' ? 'user' : null);
      tracks.push({
        track: lg.track, sub: lg.sub || null, role, time_at_ms: rec ? rec.start : 0,
        end_at_ms: rec ? rec.end : 0, utterance_id: st.type === 'say' ? st.id : null, step: st.i,
        text: lg.text, fields: lg.fields || {},
      });
    }
    if (st.screen) tracks.push({ track: '自定义', sub: '屏幕', role: null, time_at_ms: rec ? rec.start : 0, end_at_ms: rec ? rec.end : 0, utterance_id: st.type === 'say' ? st.id : null, step: st.i, text: st.screen, fields: {} });
  }

  const ctx = s.context || {};
  const json = {
    meta_data: {
      sample: {
        sample_id: sampleId,
        sample_name: s.sample_name || s.name,
        case_id: caseId,
        case_name: s.name,
        source_type: opts.source_type || 'synthetic_generation',
        case_spec_ref: `json/synthetic/${base}.json`,
        script_ref: `cases/${s.id}/script.json`,
        generated_at: opts.generated_at || new Date().toISOString(),
        generator: 'duplex-demo-platform',
        scene: s.scene?.title || s.scene?.desc || null,
        story_clock_start: s.scene?.clock || null,
      },
      media: {
        audio: {
          duration_ms: sch.total_ms,
          file: `audio/synthetic/${base}.wav`,
          sample_rate_hz: opts.sample_rate_hz || 24000,
          tracks: [
            { track_ref: 'Channel 1', role: 'user' },
            { track_ref: 'Channel 2', role: 'assistant' },
          ],
          clips: opts.include_clips === false ? undefined : utterances.filter(u => u.modality !== 'text').map(u => ({ id: u.id, file: `cases/${s.id}/audio/${(s.timeline.find(x => x.id === u.id) || {}).clip}` })),
        },
      },
    },
    static_context: {
      'system prompts': ctx.system_prompts || ctx['system prompts'] || {},
      device_state: ctx.device_state || {},
      memory: ctx.memory || {},
      constraints: ctx.constraints || {},
      tools: ctx.tools || [],
    },
    dynamic_context: {
      time_at_ms: ctx.dynamic_time_at_ms ?? 400,
      world_signal,
    },
    utterances,
    events,
    annotation: {
      fdx_annotation: fdx,
      emotion_annotation: emotion,
      paralinguistic_annotation: para,
      track_annotation: tracks,
    },
  };
  return { json, schedule: sch, script: s };
}

/* 简单一致性检查:时间单调、utterance 不越界、事件成对 */
export function checkNormalized(json) {
  const issues = [];
  const utts = json.utterances || [];
  utts.forEach((u, i) => {
    if (u.end_at_ms < u.start_at_ms) issues.push(`${u.id}: end < start`);
    if (u.end_at_ms > json.meta_data.media.audio.duration_ms + 1) issues.push(`${u.id}: 超出音频总长`);
  });
  const seen = new Map();
  for (const e of json.events || []) seen.set(e.event_id, (seen.get(e.event_id) || 0) + 1);
  for (const [id, n] of seen) if (n > 2) issues.push(`event ${id} 出现 ${n} 次`);
  for (const a of json.annotation?.fdx_annotation || []) if (!FDX_TYPES.includes(a.fdx_type)) issues.push(`未知 fdx_type ${a.fdx_type}`);
  return issues;
}
