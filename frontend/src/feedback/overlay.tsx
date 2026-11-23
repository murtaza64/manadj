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
  description, onDescription, canSpeak, speaking, onSpeak, speechError, speechNotice,
  onStroke, onToggleDraw, onPenColor, onUndo, onClear, onInvalidate, onPoint, onRemovePointer, onDone, onCancel }: {
  description: string; onDescription: (value: string) => void;
  speechNotice?: string; canSpeak: boolean; speaking: boolean; onSpeak: () => void; speechError: string;
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
  const [tool, setTool] = useState<'draw' | 'point' | 'type' | 'speak'>('draw');
  const choose = (next: 'draw' | 'point' | 'type' | 'speak') => {
    if (speaking && next !== 'speak') onSpeak();
    if (draft?.length) { onStroke({color:penColor,width:PEN_WIDTH,points:draft}); setDraft(null); }
    setTool(next);
    if (drawing !== (next === 'draw')) onToggleDraw();
  };
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
      <div className="feedback-tools">
      <button type="button" className={`btn btn-secondary btn-mini${tool === 'draw' ? ' btn-selected' : ''}`}
        title="Draw freehand over the app" onClick={() => choose('draw')}>Draw</button>
      <button type="button" className={`btn btn-secondary btn-mini${tool === 'point' ? ' btn-selected' : ''}`}
        title="Point at the app, not this feedback bar" onClick={() => { choose('point'); onPoint(); }}>Point</button>
      <button type="button" className={`btn btn-secondary btn-mini${tool === 'type' ? ' btn-selected' : ''}`} onClick={() => choose('type')}>Type</button>
      <button type="button" className={`btn btn-secondary btn-mini${tool === 'speak' ? ' btn-selected' : ''}`} onClick={() => choose('speak')}>Speak</button>
      </div>
      <div className="feedback-tool-panel">
        {tool === 'point' ? <p>Choose an app element. Feedback controls cannot be selected. Esc cancels picking.</p> : tool === 'draw' ? <>
          <div className="feedback-pen-row">{PEN_COLORS.map((color) => <button key={color} type="button" aria-label={`Pen ${color}`}
            className={`feedback-pen${color === penColor ? ' feedback-pen-selected' : ''}`}
            style={{ background: color }} onClick={() => onPenColor(color)} />)}
          <button type="button" className="btn btn-secondary btn-mini" disabled={!strokes.length} onClick={onUndo}>Undo</button>
          <button type="button" className="btn btn-secondary btn-mini" disabled={!strokes.length} onClick={onClear}>Clear</button></div>
          <p>Draw on the app. Choose Point to identify an element.</p>
        </> : <>
          {tool === 'speak' && <div className="feedback-speech-controls">
            <span>{canSpeak ? (speechNotice ?? 'Start sends mic audio to the browser speech service. Transcript stays editable.') : 'Speech is unavailable here. Type below or use system dictation.'}</span>
            <button type="button" className="btn btn-secondary btn-mini" disabled={!canSpeak} onClick={onSpeak}>{speaking ? 'Stop dictation' : 'Start dictation'}</button>
          </div>}
          <label>Report notes<textarea aria-label="Report notes" rows={2} maxLength={10000} value={description} onChange={event => onDescription(event.target.value)} /></label>
        </>}
        <div className="feedback-tool-status" role="status">{speechError || notice || (pointerText ? `Element: ${pointerText}` : 'Nothing submitted. Done opens the final review.')}
          {pointerText && <button type="button" className="btn btn-secondary btn-mini" onClick={onRemovePointer}>Remove element</button>}
        </div>
      </div>
      <div className="feedback-complete">
      <button type="button" className="btn btn-primary btn-mini"
        title="Capture the app and write the report" onClick={() => { if (draft?.length) { onStroke({color:penColor,width:PEN_WIDTH,points:draft}); setDraft(null); } onDone(); }}>Done</button>
      <button type="button" className="btn btn-secondary btn-mini" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  </div>;
}
