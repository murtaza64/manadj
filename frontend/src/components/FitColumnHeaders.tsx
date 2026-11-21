import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import './FitColumnHeaders.css';

/** Transfer width between neighbours, never grow the table beyond its viewport. */
export function resizedShares(shares: number[], index: number, delta: number): number[] {
  if (index < 0 || index >= shares.length - 1 || !Number.isFinite(delta)) return shares;
  const next = [...shares], pair = next[index] + next[index + 1];
  const minimum = Math.min(4, pair / 3);
  next[index] = Math.max(minimum, Math.min(pair - minimum, next[index] + delta));
  next[index + 1] = pair - next[index];
  return next;
}
export function useFitColumns(ids: readonly string[], initial: readonly number[]) {
  const [shares, setShares] = useState(() => [...initial]);
  const tableRef = useRef<HTMLTableElement>(null);
  const resize = (index: number, delta: number) => setShares(previous => resizedShares(previous, index, delta));
  const start = (event: PointerEvent, index: number) => {
    event.preventDefault(); event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const width = tableRef.current?.getBoundingClientRect().width ?? 0;
    const original = [...shares], x = event.clientX;
    const move = (e: globalThis.PointerEvent) => { if (width > 0) setShares(resizedShares(original, index, (e.clientX - x) / width * 100)); };
    const end = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end);
  };
  const variables = Object.fromEntries(ids.map((id, i) => [`--colw-${id}`, `${shares[i]}%`])) as CSSProperties;
  const headers = (labels: readonly string[]) => <tr>{ids.map((id, index) => <th key={id} scope="col" style={{ width: `${shares[index]}%` }}>{labels[index]}
    {index < ids.length - 1 && <span role="separator" tabIndex={0} aria-label={`Resize ${labels[index] || id} column`} aria-orientation="vertical" aria-valuenow={Math.round(shares[index])} className="fit-column-grip"
      onPointerDown={e => start(e, index)} onDoubleClick={() => setShares([...initial])}
      onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); resize(index, e.key === 'ArrowLeft' ? -2 : 2); } }} title="Drag or use arrow keys to resize; double-click resets columns" />}
  </th>)}</tr>;
  return { tableRef, variables, headers };
}
