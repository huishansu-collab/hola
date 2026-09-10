import type {Scenario} from '../app/page';

const label = '悄悄话模式 · 仅文字回复';
/** Each expression annotation describes one actual Assistant reply interval. */
export function withExpressionMode(s: Scenario): Scenario {
  const messages = s.tracks.find(t => t.name === '助手')?.clips.filter(c => c.outputMode === 'text') ?? [];
  const track = s.tracks.find(t => t.name === '表达控制');
  if (!messages.length || !track) return s;
  // Replace the former full-Case span, including copies saved in edited snapshots.
  const retained = track.clips.filter(c => c.label !== label);
  const clips = messages.map(c => ({
    a: c.a, b: c.b, label,
    sub: `仅显示文字，不播报语音。${c.label}`,
    messageId: c.messageId,
    lane: retained.length ? 1 + Math.max(...retained.map(c => c.lane ?? 0)) : 0,
  }));
  const annotations = s.controlAnnotations.custom_annotation.filter((a: any) =>
    !(a.annotation_type === 'output_mode' && a.role === 'assistant' && a.mode === 'text_only'));
  return {...s,
    tracks: s.tracks.map(t => t !== track ? t : {...t, clips: [...retained, ...clips]}),
    controlAnnotations: {...s.controlAnnotations,
      custom_annotation: [...annotations, ...messages.map(c => ({
        annotation_type: 'output_mode', role: 'assistant', mode: 'text_only',
        ...(c.messageId ? {message_id: c.messageId} : {}),
        start_at_ms: c.a, end_at_ms: c.b,
        description: '悄悄话模式：此条助手回复仅显示文字，不播报语音。',
      }))],
    },
  };
}
