import type { Scenario, Clip } from '../app/page';
import { roles, type RuntimeCase } from '../lib/case-package/index.ts';
type Checkpoint = Scenario['events'][number];
export function packageToScenario(
  runtime: RuntimeCase,
  namespace = runtime.manifest.case_id,
): Scenario {
  const d = runtime.case,
    t = runtime.timeline;
  const planned = d.static_context?.constraints?.timing_status === 'planned';
  const utterance = (id: string) => d.utterances.find((u: any) => u.id === id);
  // Expression clips index into this list so the inspector can open them.
  const expressions = (
    t.tracks.find((x: any) => x.id === 'expression')?.clips ?? []
  ).map((c: any) => ({
    a: c.start_at_ms,
    b: c.end_at_ms,
    label: c.label,
    trigger: c.trigger ?? '',
    delivery: c.delivery ?? c.label,
    annotation: c.annotation ?? c.description ?? '',
  }));
  const tracks = roles.map(([id, name, color]) => ({
    name,
    color,
    en: id === 'assistant' || id === 'user' ? '实际语音' : '',
    clips: t.tracks
      .find((x: any) => x.id === id)
      .clips.map((c: any): Clip => {
        if (c.kind === 'speech') {
          const u = utterance(c.utterance_id),
            i = t.interruptions?.find((i: any) => i.assistant_id === u.id),
            voiced = !!runtime.audio[u.id];
          return {
            a: u.start_at_ms,
            b: u.end_at_ms,
            label: u.text,
            wave: voiced,
            audioKey: voiced ? `${namespace}/${u.id}` : undefined,
            lane: c.lane,
            fadeMs: i ? i.stop_at_ms - i.fade_start_at_ms : undefined,
          };
        }
        if (c.kind === 'tool') {
          const es = d.events.filter((e: any) => e.event_id === c.event_id);
          return {
            a: es[0].time_at_ms,
            b: es[1].time_at_ms,
            label: es[0].tool_name + '()',
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
          ...(id === 'expression'
            ? {
                expression: Math.max(
                  0,
                  expressions.findIndex((e: any) => e.a === c.start_at_ms),
                ),
              }
            : {}),
        };
      }),
  }));
  const base = {
    quote: '',
    tag: '交互节点',
    plan: '',
    heard: '',
    drop: '',
    tool: '模拟 Case',
    overlap: null,
  };
  // A case with nothing interrupted still needs somewhere to point the reader,
  // so declared checkpoints sit alongside the interruptions on the same bar.
  const marks: Checkpoint[] = [
    ...(t.interruptions ?? []).map((i: any, n: number) => {
      const u = utterance(i.user_id);
      return {
        ...base,
        id: 0,
        t: u.start_at_ms,
        end: i.stop_at_ms,
        name: `打断 ${n + 1}`,
        title: '用户插话 · 助手停播',
        quote: u.text,
        tag: '用户打断',
        actions: ['接收用户输入并停止当前播报'],
        tool: 'audio.stop()',
        note: `${i.stop_at_ms} ms 停声`,
        overlap: [u.start_at_ms, i.stop_at_ms] as [number, number],
      };
    }),
    ...(t.checkpoints ?? []).map((c: any) => ({
      ...base,
      id: 0,
      t: c.start_at_ms,
      end: c.end_at_ms,
      name: c.name,
      title: c.title,
      note: c.note,
      quote: c.quote ?? '',
      heard: c.quote ?? '',
      tag: c.tag ?? '交互节点',
      actions: [c.note],
    })),
  ];
  const events = marks
    .sort((a, b) => a.t - b.t || a.end - b.end)
    .map((e, id) => ({ ...e, id }));
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
    expressions,
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
    timingStatus: planned ? 'planned' : 'aligned',
  };
}
