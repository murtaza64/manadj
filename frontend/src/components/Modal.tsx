/**
 * The one modal primitive (DESIGN.md Components; gh#202). Owns the
 * overlay, centering, escape/backdrop close, `--z-modal`, and the title
 * bar — panels keep only content and content-specific sizing (via
 * `className` on the panel).
 *
 * Two presentations:
 * - default: dark backdrop, flex-centered panel;
 * - `anchor`: the panel sits at a viewport point (clamped to bounds) over
 *   a light backdrop with a radial darkening spotlight — the filter-bar
 *   popover-modal dialect (BPM / key wheel / follow params).
 */
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import './Modal.css';

export interface ModalProps {
  onClose: () => void;
  /** Title bar content; omitting it omits the whole bar (and its ×). */
  title?: ReactNode;
  /** Extra class(es) on the panel for content-specific sizing/layout. */
  className?: string;
  /** Anchored dialect: center the panel on this viewport point. */
  anchor?: { x: number; y: number };
  /** Approximate panel size used to clamp `anchor` into the viewport. */
  anchorSize?: { width: number; height: number };
  children: ReactNode;
}

const ANCHOR_VIEWPORT_PADDING = 20;

function clampAnchor(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
) {
  const minX = size.width / 2 + ANCHOR_VIEWPORT_PADDING;
  const maxX = window.innerWidth - size.width / 2 - ANCHOR_VIEWPORT_PADDING;
  const minY = size.height / 2 + ANCHOR_VIEWPORT_PADDING;
  const maxY = window.innerHeight - size.height / 2 - ANCHOR_VIEWPORT_PADDING;
  return {
    x: Math.max(minX, Math.min(maxX, anchor.x)),
    y: Math.max(minY, Math.min(maxY, anchor.y)),
  };
}

export default function Modal({
  onClose,
  title,
  className,
  anchor,
  anchorSize,
  children,
}: ModalProps) {
  // Escape closes — capture + stopPropagation: a modal's Escape must beat
  // the staged search-clear and the view hubs (keyboard-focus 02).
  // Mounted only while open (parents gate rendering).
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onEsc, { capture: true });
    return () => document.removeEventListener('keydown', onEsc, { capture: true });
  }, [onClose]);

  const pos = anchor
    ? clampAnchor(anchor, anchorSize ?? { width: 400, height: 400 })
    : null;

  return (
    <div
      className={`modal-overlay${pos ? ' modal-overlay-anchored' : ''}`}
      onMouseDown={onClose}
      style={
        pos
          ? ({
              '--blur-center-x': `${pos.x}px`,
              '--blur-center-y': `${pos.y}px`,
            } as CSSProperties)
          : undefined
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`modal-panel${className ? ` ${className}` : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        style={
          pos
            ? {
                position: 'fixed',
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                transform: 'translate(-50%, -45%)',
              }
            : undefined
        }
      >
        {title !== undefined && (
          <div className="modal-titlebar">
            <div className="modal-title">{title}</div>
            <button
              type="button"
              className="modal-x"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
