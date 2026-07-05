import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

interface FilterState {
  search: string;
  selectedTagIds: number[];
  energyMin: number;
  energyMax: number;
  tagMatchMode: 'ANY' | 'ALL';
  bpmCenter: number | null;
  bpmThresholdPercent: number;
  selectedKeyCamelotIds: string[];
  sortColumn: 'key' | 'bpm' | 'energy' | 'title' | 'artist' | 'created_at' | 'bitrate_kbps' | 'filesize_bytes' | 'provenance' | null;
  sortDirection: 'asc' | 'desc';
}

const DEFAULT_FILTERS: FilterState = {
  search: '',
  selectedTagIds: [],
  energyMin: 1,
  energyMax: 5,
  tagMatchMode: 'ANY',
  bpmCenter: null,
  bpmThresholdPercent: 5,
  selectedKeyCamelotIds: [],
  sortColumn: 'created_at',
  sortDirection: 'desc',
};

interface FilterContextType {
  filters: FilterState;
  setFilters: (filters: FilterState | ((prev: FilterState) => FilterState)) => void;
  /** Clear the text search only (keyboard-focus 02: the staged Escape).
   * Other filter axes are untouched — clearing is a separate act. */
  clearSearch: () => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<FilterState>(() => {
    const savedSort = localStorage.getItem('trackListSort');
    if (savedSort) {
      try {
        const { column, direction } = JSON.parse(savedSort);
        return { ...DEFAULT_FILTERS, sortColumn: column, sortDirection: direction };
      } catch {
        return DEFAULT_FILTERS;
      }
    }
    return DEFAULT_FILTERS;
  });

  useEffect(() => {
    if (filters.sortColumn) {
      localStorage.setItem('trackListSort', JSON.stringify({
        column: filters.sortColumn,
        direction: filters.sortDirection
      }));
    }
  }, [filters.sortColumn, filters.sortDirection]);

  const clearSearch = useCallback(() => {
    setFilters((prev) => (prev.search === '' ? prev : { ...prev, search: '' }));
  }, []);

  return (
    <FilterContext.Provider value={{ filters, setFilters, clearSearch }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useFilters() {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useFilters must be used within FilterProvider');
  }
  return context;
}

export type { FilterState };
export { DEFAULT_FILTERS };
