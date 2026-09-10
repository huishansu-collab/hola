import { formatToolCall } from '../lib/tool-label.ts';
import type { Scenario, Clip } from '../app/page';
import { roles, type RuntimeCase } from '../lib/case-package/index.ts';
export function packageToScenario(
  runtime: RuntimeCase,
  namespace = runtime.manifest.case_id,
): Scenario {
  const d = runtime.case,
    t = runtime.timeline;
  const tracks = roles.map(([id, name, color]) => ({
    name,
    color,
    en: id === 'assistant' || id === 'user' ? '实际语音' : '',
    clips: t.tracks
      .find((x: any) => x.id === id)
      .clips.map((c: any): Clip => {
        if (c.kind === 'speech') {
          const u = d.utterances.find((u: any) => u.id === c.utterance_id),
            i = t.interruptions?.find((i: any) => i.assistant_id === u.id);
          return {
            utteranceId: u.id,
            a: u.start_at_ms,
            b: u.end_at_ms,
            label: u.text,
            wave: true,
            audioKey: `${namespace}/${u.id}`,
            lane: c.lane,
            fadeMs: i ? i.stop_at_ms - i.fade_start_at_ms : undefined,
          };
        }
        if (c.kind === 'tool') {
          const es = d.events.filter((e: any) => e.event_id === c.event_id);
          return {
            toolEventId: c.event_id,
            a: es[0].time_at_ms,
            b: es[1].time_at_ms,
            label: formatToolCall(es[0].tool_name, es[0].query, es[0].display_bindings),
            sub: c.description,
            lane: c.lane,
          };
        }
        return {
          a: c.start_at_ms,
          b: c.end_at_ms,
          label: c.label,
          sub: c.description,
          lane: c.lane,
        };
      }),
  }));
  const events = (t.interruptions ?? []).map((i: any, id: number) => ({
    id,
    t: d.utterances.find((u: any) => u.id === i.user_id).start_at_ms,
    end: i.stop_at_ms,
    name: `打断 ${id + 1}`,
    title: '用户插话 · 助手停播',
    quote: d.utterances.find((u: any) => u.id === i.user_id).text,
    tag: '用户打断',
    plan: '',
    heard: '',
    drop: '',
    actions: ['接收用户输入并停止当前播报'],
    tool: 'audio.stop()',
    note: `${i.stop_at_ms} ms 停声`,
    overlap: [
      d.utterances.find((u: any) => u.id === i.user_id).start_at_ms,
      i.stop_at_ms,
    ],
  }));
  const {
    utterances,
    events: inputEvents,
    fdx_annotation,
    emotion_annotation,
    paralinguistic_annotation,
    custom_annotation,
    ...meta
  } = d;
  return {
    END: d.meta_data.media.audio.duration_ms,
    tracks,
    events,
    expressions: [],
    playableClips: tracks.flatMap((x) => x.clips).filter((c) => c.audioKey),
    utterances,
    inputEvents,
    controlAnnotations: {
      fdx_annotation,
      emotion_annotation,
      paralinguistic_annotation,
      custom_annotation,
    },
    meta,
    timingStatus: 'aligned',
  };
}
