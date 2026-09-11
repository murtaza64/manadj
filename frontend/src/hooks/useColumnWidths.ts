/**
 * Column widths for the library track table: defaults from columnConfig,
 * user overrides persisted to localStorage, exposed as CSS variables so
 * resizing never re-renders the (hundreds of) rows.
 *
 * Variables set on the table container:
 *   --colw-<id>     width of column <id>
 *   --colleft-<id>  sticky left offset (sticky columns only)
 */

import { useCallback, useLayoutEffect, useMemo, useState, type RefObject } from 'react';
import { COLUMN_CONFIG, type ColumnConfig } from '../components/columnConfig';
import { scrollableAncestor } from '../components/virtualRows';
import { writeSetting } from '../settings/persistedSettings';

const STORAGE_KEY = 'manadj-column-widths-v1';
export const MIN_COL_WIDTH = 40;

type Widths = Record<string, number>;

const DEFAULTS: Widths = Object.fromEntries(COLUMN_CONFIG.map((c) => [c.id, c.width]));

function load(): Widths {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...DEFAULTS, ...stored };
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(widths: Widths) {
  const overrides = Object.fromEntries(
    Object.entries(widths).filter(([id, w]) => w !== DEFAULTS[id]),
  );
  // Write-through (settings #176): DB + localStorage cache, best-effort.
  writeSetting(STORAGE_KEY, JSON.stringify(overrides));
}

export function useColumnWidths(configuredColumns: readonly ColumnConfig[], tableRef: RefObject<HTMLTableElement | null>) {
  const [widths, setWidths] = useState<Widths>(load);
  const [viewportWidth, setViewportWidth] = useState(Infinity);
  useLayoutEffect(() => {
    const scroller = scrollableAncestor(tableRef.current);
    if (!scroller) return;
    const measure = () => setViewportWidth(scroller.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [tableRef]);

  // Keep a usable scrolling region even when a wide column is moved to the front.
  const frozenBudget = viewportWidth - Math.min(160, viewportWidth / 2);
  let frozenWidth = 0;
  let frozenCount = 0;
  for (const column of configuredColumns) {
    const width = widths[column.id] ?? column.width;
    if (!column.sticky || frozenWidth + width > frozenBudget) break;
    frozenWidth += width;
    frozenCount++;
  }
  const columns = useMemo(() => configuredColumns.map((column, index) => ({
    ...column, sticky: index < frozenCount, showShadow: index === frozenCount - 1,
  })), [configuredColumns, frozenCount]);

  const setWidth = useCallback((id: string, width: number) => {
    setWidths((prev) => {
      const next = { ...prev, [id]: Math.max(MIN_COL_WIDTH, Math.round(width)) };
      persist(next);
      return next;
    });
  }, []);

  const resetWidth = useCallback((id: string) => {
    setWidths((prev) => {
      const next = { ...prev, [id]: DEFAULTS[id] };
      persist(next);
      return next;
    });
  }, []);

  /** CSS variables for the table container. The 'order' (#) column only
   * participates when the table shows it (playlist tables), so sticky
   * offsets stay correct in both layouts. */
  const cssVars = useMemo(() => {
    const vars: Record<string, string> = {};
    let stickyLeft = 0;
    let total = 0;
    for (const col of columns) {
      const w = widths[col.id] ?? col.width;
      vars[`--colw-${col.id}`] = `${w}px`;
      total += w;
      if (col.sticky) {
        vars[`--colleft-${col.id}`] = `${stickyLeft}px`;
        stickyLeft += w;
      }
    }
    // table-layout: fixed needs a definite width — max-content silently
    // degrades to auto layout and columns stop honoring configured widths
    vars['--table-width'] = `${total}px`;
    return vars as React.CSSProperties;
  }, [widths, columns]);

  return { columns, widths, setWidth, resetWidth, cssVars };
}
