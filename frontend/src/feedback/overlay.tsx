/**
 * Capture overlay (feedback #518 v3): a small floating bar over the live
 * app, Editspace-surfaces style. The reporter draws full-screen on the
 * real UI and optionally points at an element; the report form opens only
 * after Done captures the app, so capture never waits on a popup. The
 * overlay is a manual popover: top layer (visible above modal dialogs)
 * without inerting the app the way showModal would.
 */
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  appendPoint, normalizePoint, PEN_COLORS, PEN_WIDTH, renderAnnotations, type Stroke,
} from './annotate';
import type { PointerInfo } from './pointer';

export function CaptureOverlay({ drawing, strokes, pointer, pointerText, penColor,
  onStroke, onToggleDraw, onPenColor, onUndo, onClear, onInvalidate, onPoint, onRemovePointer, onDone, onCancel }: {
  drawing: boolean;
  strokes: Stroke[];
  pointer: PointerInfo | null;
  pointerText: string | null;
  penColor: string;
  onStroke: (stroke: Stroke) => void;
  onToggleDraw: () => void;
  onPenColor: (color: string) => void;
  onUndo: () => void;
  onClear: () => void;
  onInvalidate: () => void;
  onPoint: () => void;
  onRemovePointer: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Stroke['points'] | null>(null);

  // Top layer keeps the bar reachable above modal dialogs without
  // inerting the app beneath it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.setAttribute('popover', 'manual');
    try { (el as HTMLElement & { showPopover?: () => void }).showPopover?.(); }
    catch { /* Non-top-layer runtime (jsdom): fixed positioning still covers. */ }
  }, []);

  // Esc cancels the overlay. Bubble phase on window: the element picker's
  // capture-phase Esc stops propagation, so picking wins over cancelling.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Ink describes the current viewport only. Never stretch it onto newly
  // positioned content after scrolling, navigation, resize or app interaction.
  useEffect(() => {
    const invalidate = () => {
      setDraft(null);
      onInvalidate();
      setNotice('View changed. Marks cleared; draw again before Done.');
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Element && ref.current?.contains(event.target)) return;
      invalidate();
    };
    const interact = (event: Event) => {
      if (drawing || !(event.target instanceof Element) || ref.current?.contains(event.target) || event.target.closest('.feedback-picker')) return;
      invalidate();
    };
    window.addEventListener('resize', invalidate);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('hashchange', invalidate);
    window.addEventListener('popstate', invalidate);
    window.addEventListener('pointerdown', interact, true);
    return () => {
      window.removeEventListener('resize', invalidate);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('hashchange', invalidate);
      window.removeEventListener('popstate', invalidate);
      window.removeEventListener('pointerdown', interact, true);
    };
  }, [drawing, onInvalidate]);

  // Full-viewport ink canvas. Strokes stay normalized (0..1) so the
  // report's screenshot bake maps them through the captured viewport.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const context = canvas.getContext('2d');
      if (!context) return;
      const live = draft?.length ? [...strokes, { color: penColor, width: PEN_WIDTH, points: draft }] : strokes;
      renderAnnotations(context, canvas.width, canvas.height, live, pointer,
        { width: window.innerWidth, height: window.innerHeight });
    };
    paint();
    window.addEventListener('resize', paint);
    return () => window.removeEventListener('resize', paint);
  }, [strokes, draft, pointer, penColor]);

  const pointAt = (event: PointerEvent) =>
    normalizePoint(event.clientX, event.clientY, canvasRef.current!.getBoundingClientRect());

  return <div ref={ref} className="feedback-overlay" data-feedback-private role="group" aria-label="Feedback capture" data-focusable>
    <canvas ref={canvasRef} aria-hidden="true"
      className={`feedback-overlay-canvas${drawing ? ' feedback-overlay-drawing' : ''}`}
      onPointerDown={(event) => {
        if (!drawing) return;
        event.preventDefault();
        try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* synthetic events */ }
        setNotice('');
        setDraft([pointAt(event)]);
      }}
      onPointerMove={(event) => {
        if (!drawing || !draft) return;
        event.preventDefault();
        setDraft(appendPoint(draft, pointAt(event)));
      }}
      onPointerUp={(event) => {
        if (!drawing || !draft) return;
        event.preventDefault();
        const points = appendPoint(draft, pointAt(event));
        setDraft(null);
        onStroke({ color: penColor, width: PEN_WIDTH, points });
      }}
      onPointerCancel={() => setDraft(null)} />
    <div className="feedback-bar">
      {notice && <span role="status">{notice}</span>}
      <button type="button" className={`btn btn-secondary btn-mini${drawing ? ' btn-selected' : ''}`}
        title="Draw freehand over the app" onClick={onToggleDraw}>Draw</button>
      {drawing && <>
        {PEN_COLORS.map((color) => <button key={color} type="button" aria-label={`Pen ${color}`}
          className={`feedback-pen${color === penColor ? ' feedback-pen-selected' : ''}`}
          style={{ background: color }} onClick={() => onPenColor(color)} />)}
        <button type="button" className="btn btn-secondary btn-mini" disabled={!strokes.length} onClick={onUndo}>Undo</button>
        <button type="button" className="btn btn-secondary btn-mini" disabled={!strokes.length} onClick={onClear}>Clear</button>
      </>}
      <button type="button" className={`btn btn-secondary btn-mini${pointer ? ' btn-selected' : ''}`}
        title="Point at the element this report is about" onClick={onPoint}>{pointer ? 'Repoint' : 'Point'}</button>
      {pointerText && <span className="feedback-pointer-chip">Element: {pointerText}
        <button type="button" className="btn btn-secondary btn-mini" onClick={onRemovePointer}>Remove element</button>
      </span>}
      <button type="button" className="btn btn-primary btn-mini"
        title="Capture the app and write the report" onClick={onDone}>Done</button>
      <button type="button" className="btn btn-secondary btn-mini" onClick={onCancel}>Cancel</button>
    </div>
  </div>;
}
