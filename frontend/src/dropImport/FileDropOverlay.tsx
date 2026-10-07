import type { FileDropRect } from './useFileDropImport';

/** Viewport-fixed overlay over the drop target (the target itself scrolls). */
export default function FileDropOverlay({ rect, label }: { rect: FileDropRect | null; label: string }) {
  if (!rect) return null;
  return (
    <div
      data-testid="file-drop-overlay"
      style={{
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        border: '2px dashed var(--accent)',
        background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--accent)',
        fontWeight: 600,
        fontSize: '15px',
        pointerEvents: 'none',
        zIndex: 50,
      }}
    >
      {label}
    </div>
  );
}
