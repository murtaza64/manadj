/**
 * Drag handle on a header cell's right edge. Drag to resize, double-click to
 * reset. Updates go through useColumnWidths (CSS variables), so rows follow
 * live without re-rendering.
 */

import { useRef } from 'react';

interface Props {
  columnId: string;
  currentWidth: number;
  onResize: (id: string, width: number) => void;
  onReset: (id: string) => void;
}

export function ColumnResizeHandle({ columnId, currentWidth, onResize, onReset }: Props) {
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // don't trigger the header's sort
    dragState.current = { startX: e.clientX, startWidth: currentWidth };

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return;
      onResize(columnId, dragState.current.startWidth + (ev.clientX - dragState.current.startX));
    };
    const onUp = () => {
      dragState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('col-resizing');
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.classList.add('col-resizing');
  };

  return (
    <span
      className="col-resize-handle"
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onReset(columnId);
      }}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize · double-click to reset"
    />
  );
}
