import { createContext, useContext, useState, ReactNode } from 'react';

interface FilterState {
  search: string;
  selectedTagIds: number[];
  energyMin: number;
  energyMax: number;
  tagMatchMode: 'ANY' | 'ALL';
  bpmCenter: number | null;
  bpmThresholdPercent: number;
  selectedKeyCamelotIds: string[];
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
};

interface FilterContextType {
  filters: FilterState;
  setFilters: (filters: FilterState | ((prev: FilterState) => FilterState)) => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  return (
    <FilterContext.Provider value={{ filters, setFilters }}>
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
