/*
 * shared/schedule.js — 离线时间轴调度:把 timeline 按引擎相同的规则铺到毫秒轴上。
 * 输出供:规范化 JSON 的 start_at_ms / end_at_ms / time_at_ms、服务端立体声混音、UI 时间轴。
 *
 * 规则(与 public/js/engine.js 一致):
 *  - say(非并行):先等所有并行项结束(join),再按说话人切换加首包间隔(400ms / 同人 300ms)
 *  - say(parallel):开始后不阻塞,后续 step 与之并行
 *  - say(barge_in):叠在最近一条"另一说话人"的 say 上,at_ms 为相对目标开始的偏移(默认 60%)
 *      目标句在打断点后 700ms 全音量重叠,1750ms 归零
 *  - tool / memory / backend / agent:逐字打出 + 执行时长 + 180ms 收尾;parallel 时不阻塞
 *  - wait / skip / system / overlay / call / edge 等按常量占位
 */

import { T, estimateDurationMs, typedDurationMs, normalizeScript, clockToMs } from './script.js';

export function schedule(input, durations = {}) {
  const s = input?.timeline?.[0]?.i != null ? input : normalizeScript(input);
  const steps = [];
  const utterances = [];
  const events = [];
  let cursor = 0;
  let pending = [];           // 并行项的结束时刻
  let lastSpeaker = null;
  let anchorStart = 0;        // 最近一条 say / system 的开始时刻(anchor: 'prev_start' 用)
  const baseOf = (st) => (st.anchor === 'prev_start' ? anchorStart : cursor) + (st.delay_ms || 0);
  const says = [];            // 已排期的 say(引用 utterances 内的对象)
  let evN = 0;
  const evId = () => 'ev' + String(++evN).padStart(3, '0');
  let storyMs = clockToMs(s.scene?.clock);
  let storyAnchor = 0;        // storyMs 对应的 cursor

  const join = () => { if (pending.length) { cursor = Math.max(cursor, ...pending); pending = []; } };
  const setStory = (clock, at) => { const ms = clockToMs(clock); if (ms != null) { storyMs = ms; storyAnchor = at; } };
  const storyAt = (at) => (storyMs == null ? null : storyMs + (at - storyAnchor));

  const durationOf = (st) => {
    if (st.typed) return typedDurationMs(st.text);
    if (st.duration_ms) return st.duration_ms;
    const d = st.clip ? durations[st.clip] : null;
    if (typeof d === 'number' && d > 0) return Math.round(d < 1000 && d % 1 !== 0 ? d * 1000 : d);
    return estimateDurationMs(st.text);
  };

  const pushEvent = (ev) => { events.push(ev); return ev; };

  /* 工具类步骤的通用排期(tool / memory / backend) */
  const runToolLike = (st, start) => {
    const doing = st.ui && st.ui !== false ? (st.ui.doing || '') : '';
    const typing = st.ui === false || st.silent ? 0 : doing.length * T.agentTypeMs;
    const elapsed = st.elapsed_ms != null ? st.elapsed_ms : (st.ui?.ms ?? 1600);
    if (st.backdate) {
      /* 结果通知:发起时刻回溯 elapsed,结果就在此刻;界面只闪一下 */
      const uiMs = st.ui === false || st.silent ? 0 : (st.ui?.ms ?? 1200);
      return { end: start + typing + uiMs + (uiMs ? T.agentSettle : 0), resultAt: start, callAt: Math.max(0, start - elapsed), typing };
    }
    const uiMs = st.ui === false || st.silent ? elapsed : Math.max(st.ui?.ms ?? 0, elapsed);
    const settle = st.ui === false || st.silent ? 0 : T.agentSettle;
    const end = start + typing + uiMs + settle;
    const resultAt = start + typing + elapsed;
    return { end, resultAt, callAt: start, typing };
  };

  s.timeline.forEach((st) => {
    const rec = { i: st.i, type: st.type, start: cursor, end: cursor };
    if (st.clock) setStory(st.clock, cursor);
    switch (st.type) {
      case 'section': {
        if (st.clock) setStory(st.clock, cursor);
        break;
      }
      case 'edge': {
        const a = st.action || 'touch';
        const dur = a === 'touch' ? T.edgeTouch : a === 'double' ? T.edgeDouble : (a === 'flash' || a === 'listen' || a === 'gflash') ? T.edgeFlash : 0;
        rec.start = cursor; cursor += dur; rec.end = cursor;
        if (a === 'touch' || a === 'double') lastSpeaker = null;
        break;
      }
      case 'say': {
        const dur = durationOf(st);
        let start;
        let target = null;
        if (st.barge_in || st.backchannel) {
          target = [...says].reverse().find(u => u.speaker !== st.speaker && !u.typed && u.end > cursor - 5000);
          if (!target) target = [...says].reverse().find(u => u.speaker !== st.speaker && !u.typed) || null;
          if (target) {
            const at = st.at_ms != null ? st.at_ms : (st.at_ratio != null ? Math.round(target.dur * st.at_ratio) : Math.round(target.dur * 0.6));
            start = target.start + Math.max(0, Math.min(at, target.dur));
            if (st.barge_in) {
              target.cut_at_ms = start;
              target.end = Math.min(target.end, start + T.cutFade);
              target.cut = true;
              pending = pending.filter(p => p !== target._pendingEnd);
            }
          } else {
            start = cursor;
          }
        } else {
          if (!st.parallel || st.join) join();
          const gap = st.gap_ms != null ? st.gap_ms : (lastSpeaker == null ? 0 : (lastSpeaker !== st.speaker ? T.firstPacket : T.sameSpeakerGap));
          start = cursor + gap + (st.delay_ms || 0);
        }
        const u = {
          index: st.i, id: st.id, speaker: st.speaker, role: st.role, text: st.text, clip: st.clip, typed: !!st.typed,
          start, end: start + dur, dur, cut: false, cut_at_ms: null, story_start: storyAt(start),
          barge_in: !!st.barge_in, backchannel: !!st.backchannel, interrupts: target && st.barge_in ? target.id : null, overlaps: target && st.backchannel ? target.id : null,
        };
        utterances.push(u); says.push(u);
        rec.start = start; rec.end = u.end;
        anchorStart = start;
        if (st.backchannel) { u._pendingEnd = u.end; pending.push(u.end); cursor = Math.max(cursor, start); }
        else if (st.parallel && !st.barge_in) { u._pendingEnd = u.end; pending.push(u.end); cursor = start; }
        else cursor = u.end;
        lastSpeaker = st.speaker;
        break;
      }
      case 'tool': case 'memory': case 'backend': {
        if (st.join) join();
        const start = Math.max(0, baseOf(st));
        const r = runToolLike(st, start);
        rec.start = start; rec.end = r.end;
        const id = evId();
        if (st.type === 'tool') {
          if (st.event !== false && st.name) {
            if (st.backdate) {
              /* 回溯的发起时刻不早于同名工具上一次"转后台 / 受理"的时刻 */
              const prev = [...events].reverse().find(e => e.event_type === 'function_call' && e.tool_name === st.name && e.results === undefined);
              if (prev) r.callAt = Math.max(r.callAt, prev.time_at_ms + 1);
            }
            pushEvent({ event_id: id, event_type: 'function_call', tool_name: st.name, time_at_ms: r.callAt, query: st.query || null, arguments: st.args ?? null, step: st.i });
            if (st.status !== 'pending' && st.result !== undefined) pushEvent({ event_id: id, event_type: 'function_call', tool_name: st.name, time_at_ms: r.resultAt, results: st.result, step: st.i });
          }
        } else if (st.type === 'memory') {
          const kind = st.kind || 'memory_call_fast';
          pushEvent({ event_id: id, event_type: kind, query: st.query || null, time_at_ms: r.callAt, step: st.i });
          if (st.result != null) pushEvent({ event_id: id, event_type: kind, result: st.result, confidence: st.confidence ?? (kind === 'memory_call' ? 0.8 : 0.65), time_at_ms: r.resultAt, step: st.i });
        } else {
          pushEvent({ event_id: id, event_type: 'backend_call', time_at_ms: r.callAt, context: st.context || {}, query: st.query || null, step: st.i });
          if (st.result != null) pushEvent({ event_id: id, event_type: 'backend_call', time_at_ms: r.resultAt, result: st.result, step: st.i });
        }
        if (st.parallel) { pending.push(r.end); } else cursor = r.end;
        break;
      }
      case 'agent': {
        if (st.join) join();
        let t = Math.max(0, baseOf(st));
        rec.start = t;
        if (st.think) t += st.think.length * T.thinkTypeMs;
        rec.substeps = [];
        for (const sub of st.steps || []) {
          const typing = (sub.doing || '').length * T.agentTypeMs;
          const ms = sub.ms != null ? sub.ms : 2400;
          const start = t, resultAt = t + typing + ms, end = resultAt + T.agentSettle;
          rec.substeps.push({ j: sub.j, start, end });
          if (sub.tool) {
            const id = evId();
            pushEvent({ event_id: id, event_type: 'function_call', tool_name: sub.tool, time_at_ms: start, query: sub.query || null, arguments: sub.args ?? null, step: st.i, substep: sub.j });
            if (sub.result !== undefined) pushEvent({ event_id: id, event_type: 'function_call', tool_name: sub.tool, time_at_ms: resultAt, results: sub.result ?? sub.done ?? null, step: st.i, substep: sub.j });
          }
          t = end;
        }
        rec.end = t;
        if (st.parallel) pending.push(t); else cursor = t;
        break;
      }
      case 'card': {
        const start = Math.max(0, baseOf(st));
        rec.start = start; rec.end = start;
        if (st.button && st.await !== false) { const w = st.button.wait_ms ?? T.cardWait; rec.end = start + w; if (!st.parallel) cursor = Math.max(cursor, start + w); }
        break;
      }
      case 'pill': {
        rec.start = cursor;
        if (st.countdown) { const n = st.countdown.steps ?? 5; const ms = st.countdown.step_ms ?? 1000; cursor += n * ms + 400; }
        rec.end = cursor;
        break;
      }
      case 'call': {
        rec.start = cursor;
        if ((st.action || 'ring') === 'ring') cursor += st.wait_ms ?? T.callRing;
        rec.end = cursor;
        break;
      }
      case 'overlay': {
        rec.start = cursor;
        if (st.action === 'collapse') cursor += T.overlayCollapse;
        else if (st.action === 'drop') cursor += T.overlayDrop;
        rec.end = cursor;
        break;
      }
      case 'banner': rec.start = cursor; cursor += T.bannerHold; rec.end = cursor; break;
      case 'article': rec.start = cursor; cursor += st.hold_ms || 0; rec.end = cursor; break;
      case 'wait': rec.start = cursor; cursor += st.ms || 0; rec.end = cursor; break;
      case 'skip': case 'system': {
        if (!st.parallel) join();
        rec.start = cursor; anchorStart = cursor;
        const hold = st.hold_ms != null ? st.hold_ms : T.skipHold;
        if (st.parallel) rec.end = cursor + hold; else { cursor += hold; rec.end = cursor; }
        if (st.type === 'skip' && st.to) setStory(st.to, rec.end);
        if (st.type === 'system' && st.clock_end && !st.parallel) setStory(st.clock_end, rec.end);
        break;
      }
      case 'join': join(); rec.start = rec.end = cursor; break;
      case 'hardware': case 'rec': case 'transcript': case 'fx': case 'ambience': case 'log': case 'world': case 'end': default: {
        rec.start = rec.end = Math.max(0, baseOf(st));
        if (st.type === 'world') {
          pushEvent({ event_id: evId(), event_type: 'world_signal', time_at_ms: rec.start, signal: worldSignalOf(st), step: st.i });
        }
        break;
      }
    }
    rec.story_start = storyAt(rec.start);
    steps.push(rec);
  });
  join();
  const total = Math.max(cursor, ...utterances.map(u => u.end), 0);
  utterances.forEach(u => { delete u._pendingEnd; });
  events.sort((a, b) => a.time_at_ms - b.time_at_ms || a.event_id.localeCompare(b.event_id));
  return { steps, utterances, events, total_ms: total, story_start_ms: clockToMs(s.scene?.clock) };
}

export function worldSignalOf(st) {
  const sig = {};
  for (const k of ['scene_state', 'signal_source', 'trigger', 'disturb_worth', 'when', 'note']) if (st[k] != null) sig[k] = st[k];
  if (st.signal && typeof st.signal === 'object') Object.assign(sig, st.signal);
  if (st.text && !sig.note && !sig.scene_state) sig.note = st.text;
  return sig;
}
