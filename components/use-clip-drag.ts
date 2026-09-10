import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { Scenario } from '../app/page';
import { canResizeClip, editTimeline, moveClips } from './timeline-edit';
export type ClipRef = { ti: number; ci: number };
export function useClipDrag({
  scenario,
  caseId,
  scale,
  scroller,
  onStart,
  selected = [],
  onSelect,
  onCommit,
}: {
  scenario: Scenario;
  caseId: string;
  scale: number;
  scroller: RefObject<HTMLDivElement | null>;
  onStart: () => void;
  // 框选之后拖其中任意一个，整组一起走。
  selected?: ClipRef[];
  onSelect?: (list: ClipRef[]) => void;
  onCommit: (s: Scenario) => void;
}) {
  const [preview, setPreview] = useState<Scenario | null>(null),
    [extent, setExtent] = useState(0);
  const active = useRef<any>(null),
    frame = useRef(0),
    suppressClick = useRef(false);
  const latest = useRef({ scenario, scale, onStart, onCommit });
  latest.current = { scenario, scale, onStart, onCommit };
  const [dragging, setDragging] = useState(false);
  const cancel = () => {
    cancelAnimationFrame(frame.current);
    active.current = null;
    setPreview(null);
    setExtent(0);
    setDragging(false);
  };
  useEffect(() => {
    cancel();
    return () => cancelAnimationFrame(frame.current);
  }, [caseId]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && active.current) {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  const begin = (
    e: PointerEvent,
    ti: number,
    ci: number,
    mode: 'move' | 'resize',
  ) => {
    if (e.button !== 0 || (mode === 'resize' && !canResizeClip(scenario.tracks[ti], scenario.tracks[ti].clips[ci]))) return;
    e.preventDefault();
    e.stopPropagation();
    const el = scroller.current;
    if (!el) return;
    latest.current.onStart();
    suppressClick.current = false;
    (e.currentTarget as HTMLElement).focus({ preventScroll: true });
    const base = latest.current.scenario;
    const targets = mode === 'move' && selected.some((t) => t.ti === ti && t.ci === ci) ? selected : [{ ti, ci }];
    onSelect?.(targets);
    active.current = {
      base,
      targets,
      ti,
      ci,
      mode,
      startX: e.clientX,
      x: e.clientX,
      startScroll: el.scrollLeft,
      scroll: el.scrollLeft,
      scale: latest.current.scale,
      result: base,
      moved: false,
      last: performance.now(),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    const tick = (now: number) => {
      const d = active.current,
        v = scroller.current;
      if (!d || !v) return;
      const dt = Math.min(40, now - d.last);
      d.last = now;
      if (d.moved) {
        const r = v.getBoundingClientRect(),
          edge = 48;
        const velocity =
          d.x > r.right - edge
            ? Math.min(1, (d.x - (r.right - edge)) / edge) * 0.7
            : d.x < r.left + edge
              ? -Math.min(1, (r.left + edge - d.x) / edge) * 0.7
              : 0;
        d.scroll = Math.max(0, d.scroll + velocity * dt);
        const original = d.base.tracks[d.ti].clips[d.ci];
        const delta =
          ((d.x - d.startX + d.scroll - d.startScroll) / d.scale) * 1000;
        const result =
          d.mode === 'move' && d.targets.length > 1
            ? moveClips(d.base, d.targets, delta)
            : editTimeline(d.base, d.ti, d.ci, d.mode, (d.mode === 'move' ? original.a : original.b) + delta);
        d.result = result;
        setPreview(result);
        setExtent(
          Math.max(
            result.END,
            ((d.scroll + v.clientWidth + 64) / d.scale) * 1000,
          ),
        );
        v.scrollLeft = d.scroll;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const move = (e: PointerEvent) => {
    const d = active.current;
    if (!d) return;
    e.stopPropagation();
    d.x = e.clientX;
    if (Math.abs(d.x - d.startX) > 3) {
      d.moved = true;
      suppressClick.current = true;
      setDragging(true);
    }
  };
  const end = (e: PointerEvent) => {
    if (!active.current) return;
    e.stopPropagation();
    const d = active.current;
    cancelAnimationFrame(frame.current);
    if (d.moved) {
      const c = d.base.tracks[d.ti].clips[d.ci];
      const delta =
        ((e.clientX - d.startX + d.scroll - d.startScroll) / d.scale) * 1000;
      latest.current.onCommit(
        d.mode === 'move' && d.targets.length > 1
          ? moveClips(d.base, d.targets, delta)
          : editTimeline(d.base, d.ti, d.ci, d.mode, (d.mode === 'move' ? c.a : c.b) + delta),
      );
    }
    cancel();
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return {
    preview,
    extent,
    dragging,
    target: active.current
      ? { ti: active.current.ti, ci: active.current.ci }
      : null,
    suppressClick,
    begin,
    move,
    end,
    cancel,
  };
}
