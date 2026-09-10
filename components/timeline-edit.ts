import { withExpressionMode } from './expression-mode.ts';
import type { Scenario, Clip } from '../app/page';
export type TimelineEdit = {
  sourceRevision: string;
  version: number;
  scenario: Scenario;
};
export const timelineEditKey = 'track-studio-timeline-edits-v1';
export function readTimelineEdits(): Record<string, TimelineEdit> {
  try {
    const value = JSON.parse(localStorage.getItem(timelineEditKey) ?? '{}');
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, v]: any) =>
          v &&
          typeof v.sourceRevision === 'string' &&
          Number.isFinite(v.version) &&
          Array.isArray(v.scenario?.tracks) &&
          Number.isFinite(v.scenario?.END),
      ),
    ) as Record<string, TimelineEdit>;
  } catch {
    return {};
  }
}
export function canResizeClip(track: { name: string }, clip: Clip): boolean {
  return !clip.audioKey && !clip.wave &&
    (!['用户', '助手'].includes(track.name) || clip.outputMode === 'text');
}
export function editTimeline(
  base: Scenario,
  trackIndex: number,
  clipIndex: number,
  mode: 'move' | 'resize',
  value: number,
): Scenario {
  if (mode === 'resize' && !canResizeClip(base.tracks[trackIndex], base.tracks[trackIndex].clips[clipIndex])) return base;
  const s = structuredClone(base),
    track = s.tracks[trackIndex],
    c = track.clips[clipIndex],
    old = { ...c };
  const step = track.name === '用户' ? 1 : 400;
  const snap = (n: number) => Math.round(n / step) * step;
  if (mode === 'move') {
    c.a = Math.max(0, snap(value));
    c.b = c.a + (old.b - old.a);
    if (c.audioEnd !== undefined) c.audioEnd += c.a - old.a;
  } else {
    c.b = Math.max(c.a + step, snap(value));
  }
  const delta = c.a - old.a;
  const mapTime = (time: number) =>
    mode === 'move'
      ? time + delta
      : c.a + ((time - old.a) / (old.b - old.a)) * (c.b - c.a);
  if (c.gainPoints)
    c.gainPoints = c.gainPoints.map(([time, gain]) => [
      Math.round(mapTime(time)),
      gain,
    ]);
  const speech = track.name === '用户' || track.name === '助手';
  if (speech) {
    const u = s.utterances.find((u) =>
      c.utteranceId
        ? u.id === c.utteranceId
        : Math.round(u.start_at_ms) === Math.round(old.a) &&
          (track.name === '助手'
            ? u.speaker === 'assistant'
            : u.speaker !== 'assistant'),
    );
    if (u) {
      c.utteranceId = u.id;
      u.start_at_ms = c.a;
      u.end_at_ms = c.audioEnd ?? c.b;
    }
  }
  if (track.name === '工具调用') {
    const requests = s.inputEvents.filter(
      (e) => e.tool_name && Math.round(e.time_at_ms) === Math.round(old.a) && e.query !== undefined,
    );
    const request = c.toolEventId
      ? s.inputEvents.find(
          (e) => e.event_id === c.toolEventId && e.query !== undefined,
        )
      : (() => {
          const candidates = requests.filter(e => s.inputEvents.some(r =>
            r.event_id === e.event_id && r.query === undefined &&
            Math.round(r.time_at_ms) === Math.round(old.b)));
          // Legacy labels may use aliases; a unique request/response interval is authoritative.
          return candidates.find(e => c.label.includes(e.tool_name!)) ??
            (candidates.length === 1 ? candidates[0] : undefined);
        })();
    if (request) {
      c.toolEventId = request.event_id;
      for (const e of s.inputEvents.filter(
        (e) => e.event_id === request.event_id,
      )) {
        e.time_at_ms = e.query !== undefined ? c.a : c.b;
        if (e.results && typeof e.results.stopped_at_ms === 'number')
          e.results.stopped_at_ms = Math.round(
            mapTime(e.results.stopped_at_ms),
          );
      }
      if (
        request.tool_name === 'audio.play' &&
        typeof request.query === 'string'
      )
        try {
          const q = JSON.parse(request.query);
          q.duration_ms = c.b - c.a;
          request.query = JSON.stringify(q);
        } catch {}
    }
  }
  // State spans can describe a tool's running period after its request completes.
  if (track.name === '工具调用' && !c.toolEventId) {
    const result = s.inputEvents.find(e => e.results?.started_at_ms === old.a &&
      Number(e.results.duration_ms) === old.b - old.a);
    if (result?.results) {
      result.results.started_at_ms = c.a;
      result.results.duration_ms = c.b - c.a;
      result.time_at_ms = c.a;
      const request = s.inputEvents.find(e => e.event_id === result.event_id && e.query !== undefined);
      if (request && typeof request.query === 'string') {
        try { const q = JSON.parse(request.query); q.duration_ms = c.b-c.a; request.query = JSON.stringify(q); } catch {}
      }
      for (const e of s.inputEvents) if (e.context?.related_event_id === result.event_id && e.time_at_ms === old.b) {
        e.time_at_ms = c.b;
        e.context.elapsed_ms = c.b - c.a;
        for (const sibling of track.clips) if (sibling !== c && sibling.a === old.b) {
          sibling.b += c.b-old.b; sibling.a = c.b;
        }
      }
    }
  }
  if (track.name === '用户控制' || track.name === '世界' || track.name === '工具调用')
    for (const e of s.inputEvents) {
      if (!e.tool_name && e.time_at_ms === old.a) e.time_at_ms = c.a;
    }
  if (track.name === '表达控制') {
    for (const list of Object.values(s.controlAnnotations))
      for (const a of list as any[])
        if (a.start_at_ms >= Math.round(old.a) && a.end_at_ms <= Math.round(old.b)) {
          a.start_at_ms = Math.round(mapTime(a.start_at_ms));
          a.end_at_ms = Math.round(mapTime(a.end_at_ms));
        }
  }
  if (c.expression !== undefined && s.expressions[c.expression]) {
    s.expressions[c.expression].a = c.a;
    s.expressions[c.expression].b = c.b;
  }
  if (speech && mode === 'move')
    for (const e of s.events) {
      if (track.name === '用户' && e.t === old.a) {
        e.t += delta;
        e.end += delta;
      }
      if (e.overlap) {
        const user = s.tracks
          .find((t) => t.name === '用户')
          ?.clips.find((x) => x.a <= e.t && x.b > e.t);
        const assistant = s.tracks
          .find((t) => t.name === '助手')
          ?.clips.find((x) => x.a < e.t && (x.audioEnd ?? x.b) > e.t);
        e.overlap =
          user && assistant
            ? [
                Math.max(user.a, assistant.a),
                Math.min(
                  user.audioEnd ?? user.b,
                  assistant.audioEnd ?? assistant.b,
                ),
              ]
            : null;
      }
    }
  s.utterances.sort((a, b) => a.start_at_ms - b.start_at_ms);
  s.inputEvents.sort((a, b) => a.time_at_ms - b.time_at_ms);
  s.playableClips = s.tracks.flatMap((t) => t.clips).filter((c) => c.audioKey);
  s.END = Math.max(base.END, Math.ceil(c.b / 400) * 400);
  const meta: any = s.meta ?? {};
  s.edited = true;
  if (s.meta)
    s.meta = {
      ...meta,
      meta_data: {
        ...meta.meta_data,
        media: {
          ...meta.meta_data?.media,
          audio: { ...meta.meta_data?.media?.audio, duration_ms: s.END },
        },
      },
      static_context: {
        ...meta.static_context,
        constraints: {
          ...meta.static_context?.constraints,
          timing_status: 'edited',
        },
      },
    };
  return withExpressionMode(s);
}
