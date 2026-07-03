/**
 * Column widths for the library track table: defaults from columnConfig,
 * user overrides persisted to localStorage, exposed as CSS variables so
 * resizing never re-renders the (hundreds of) rows.
 *
 * Variables set on the table container:
 *   --colw-<id>     width of column <id>
 *   --colleft-<id>  sticky left offset (sticky columns only)
 */

import { useCallback, useMemo, useState } from 'react';
import { COLUMN_CONFIG } from '../components/columnConfig';

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function useColumnWidths() {
  const [widths, setWidths] = useState<Widths>(load);

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

  /** CSS variables for the table container. */
  const cssVars = useMemo(() => {
    const vars: Record<string, string> = {};
    let stickyLeft = 0;
    let total = 0;
    for (const col of COLUMN_CONFIG) {
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
  }, [widths]);

  return { widths, setWidth, resetWidth, cssVars };
}
