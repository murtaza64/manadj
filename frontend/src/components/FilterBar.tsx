import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag } from '../types';
import { getTagColor } from '../utils/colorUtils';
import { getAllCamelotKeys } from '../utils/keyUtils';
import EnergySquare from './EnergySquare';
import { EnergyIcon, SearchIcon, SpeedIcon, KeyIcon, TagIcon } from './icons';
import CircleOfFifthsModal from './CircleOfFifthsModal';
import BpmModal from './BpmModal';
import { useFilters } from '../contexts/FilterContext';
import './FilterBar.css';

interface FilterBarProps {
  totalTracks: number;
  filteredCount: number;
}

export default function FilterBar({ totalTracks, filteredCount }: FilterBarProps) {
  const { filters, setFilters } = useFilters();
  const [searchInput, setSearchInput] = useState(filters.search);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [keyModalPosition, setKeyModalPosition] = useState<{ x: number; y: number } | undefined>(undefined);
  const [isBpmModalOpen, setIsBpmModalOpen] = useState(false);
  const [bpmModalPosition, setBpmModalPosition] = useState<{ x: number; y: number } | undefined>(undefined);

  // Fetch all tags
  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: api.tags.listAll,
  });

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.search) {
        setFilters({ ...filters, search: searchInput });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  const toggleTag = (tagId: number) => {
    const newSet = new Set(filters.selectedTagIds);
    if (newSet.has(tagId)) {
      newSet.delete(tagId);
    } else {
      newSet.add(tagId);
    }
    setFilters({ ...filters, selectedTagIds: Array.from(newSet) });
  };

  const toggleMatchMode = () => {
    setFilters({ ...filters, tagMatchMode: filters.tagMatchMode === 'ANY' ? 'ALL' : 'ANY' });
  };

  const clearSearch = () => {
    setSearchInput('');
    setFilters({ ...filters, search: '' });
  };

  // Group tags by category
  const tagsByCategory = allTags?.reduce((acc: Record<string, Tag[]>, tag: Tag) => {
    const categoryName = tag.category.name;
    if (!acc[categoryName]) acc[categoryName] = [];
    acc[categoryName].push(tag);
    return acc;
  }, {}) || {};

  return (
    <div style={{
      background: 'var(--mantle)',
      borderBottom: '1px solid var(--surface0)',
      padding: '12px'
    }}>
      {/* Search, Energy, and BPM on same line */}
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Result Count */}
        <div style={{
          fontSize: '14px',
          color: 'var(--subtext1)',
          minWidth: '80px',
          flexShrink: 0
        }}>
          {filteredCount} / {totalTracks}
        </div>

        {/* Clear All Filters Button */}
        <button
          onClick={() => {
            setSearchInput('');
            setFilters({
              search: '',
              selectedTagIds: [],
              energyMin: 1,
              energyMax: 5,
              tagMatchMode: 'ANY',
              bpmCenter: null,
              bpmThresholdPercent: 5,
              selectedKeyCamelotIds: [],
            });
          }}
          className="filter-bar-clear-all-btn"
        >
          Clear All
        </button>

        {/* Search Input */}
        <div style={{ width: '16px', flexShrink: 0 }}>
          {searchInput ? (
            <button
              onClick={clearSearch}
              className="filter-bar-x-btn"
              style={{ padding: 0, width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ×
            </button>
          ) : (
            <SearchIcon />
          )}
        </div>
        <input
          type="text"
          placeholder="Search by filename..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: 'var(--base)',
            border: '1px solid var(--surface0)',
            color: 'var(--text)',
            fontSize: '14px'
          }}
        />

        {/* Energy Range Selector */}
        <div style={{ width: '16px', flexShrink: 0 }}>
          {(filters.energyMin !== 1 || filters.energyMax !== 5) ? (
            <button
              onClick={() => {
                setFilters({ ...filters, energyMin: 1, energyMax: 5 });
              }}
              className="filter-bar-x-btn"
              style={{ padding: 0, width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ×
            </button>
          ) : (
            <EnergyIcon />
          )}
        </div>
        <div
          className="filter-bar-energy-selector"
          onMouseDown={(e) => {
            const getLevel = (target: HTMLElement): number | null => {
              const square = target.closest('[data-level]');
              if (!square) return null;
              return parseInt(square.getAttribute('data-level') || '0');
            };

            const startLevel = getLevel(e.target as HTMLElement);
            if (!startLevel) return;

            setFilters({ ...filters, energyMin: startLevel, energyMax: startLevel });

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const currentLevel = getLevel(moveEvent.target as HTMLElement);
              if (!currentLevel) return;

              const newMin = Math.min(startLevel, currentLevel);
              const newMax = Math.max(startLevel, currentLevel);
              setFilters({ ...filters, energyMin: newMin, energyMax: newMax });
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        >
          <div className="filter-bar-energy-squares">
            {[1, 2, 3, 4, 5].map(level => {
              const isFilterActive = filters.energyMin !== 1 || filters.energyMax !== 5;
              const isInRange = level >= filters.energyMin && level <= filters.energyMax;
              return (
                <div key={level} data-level={level}>
                  <EnergySquare
                    level={level}
                    filled={isFilterActive && isInRange}
                    showNumber={true}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Key Filter */}
        <div style={{ width: '16px', flexShrink: 0 }}>
          {filters.selectedKeyCamelotIds.length > 0 ? (
            <button
              onClick={() => setFilters({ ...filters, selectedKeyCamelotIds: [] })}
              className="filter-bar-x-btn"
              style={{ padding: 0, width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ×
            </button>
          ) : (
            <KeyIcon />
          )}
        </div>
        <button
          onClick={(e) => {
            setKeyModalPosition({ x: e.clientX, y: e.clientY });
            setIsKeyModalOpen(true);
          }}
          style={{
            padding: '4px 12px',
            border: `1px solid ${filters.selectedKeyCamelotIds.length > 0 ? 'var(--mauve)' : 'var(--surface0)'}`,
            cursor: 'pointer',
            fontSize: '13px',
            background: 'transparent',
            color: 'var(--text)',
            minWidth: '70px'
          }}
        >
          {filters.selectedKeyCamelotIds.length > 0 ? `Keys (${filters.selectedKeyCamelotIds.length})` : 'Keys'}
        </button>

        {/* BPM Filter */}
        <div style={{ width: '16px', flexShrink: 0 }}>
          {filters.bpmCenter !== null ? (
            <button
              onClick={() => setFilters({ ...filters, bpmCenter: null })}
              className="filter-bar-x-btn"
              style={{ padding: 0, width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ×
            </button>
          ) : (
            <SpeedIcon />
          )}
        </div>
        <button
          onClick={(e) => {
            setBpmModalPosition({ x: e.clientX, y: e.clientY });
            setIsBpmModalOpen(true);
          }}
          style={{
            padding: '4px 12px',
            border: `1px solid ${filters.bpmCenter !== null ? 'var(--mauve)' : 'var(--surface0)'}`,
            cursor: 'pointer',
            fontSize: '13px',
            background: 'transparent',
            color: 'var(--text)',
            minWidth: '110px'
          }}
        >
          {filters.bpmCenter !== null
            ? `${Math.round(filters.bpmCenter - filters.bpmCenter * filters.bpmThresholdPercent / 100)}-${Math.round(filters.bpmCenter + filters.bpmCenter * filters.bpmThresholdPercent / 100)}`
            : 'BPM'
          }
        </button>
      </div>

      {/* Tags with Match Mode Toggle */}
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ width: '16px', flexShrink: 0 }}>
          {filters.selectedTagIds.length > 0 ? (
            <button
              onClick={() => setFilters({ ...filters, selectedTagIds: [] })}
              className="filter-bar-x-btn"
              style={{ padding: 0, width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              ×
            </button>
          ) : (
            <TagIcon />
          )}
        </div>
        <button
          onClick={toggleMatchMode}
          style={{
            padding: '4px 12px',
            background: filters.tagMatchMode === 'ANY' ? 'var(--blue)' : 'var(--surface1)',
            color: filters.tagMatchMode === 'ANY' ? 'var(--base)' : 'var(--text)',
            border: '1px solid var(--surface0)',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 'bold'
          }}
        >
          ANY
        </button>
        <button
          onClick={toggleMatchMode}
          style={{
            padding: '4px 12px',
            background: filters.tagMatchMode === 'ALL' ? 'var(--blue)' : 'var(--surface1)',
            color: filters.tagMatchMode === 'ALL' ? 'var(--base)' : 'var(--text)',
            border: '1px solid var(--surface0)',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 'bold'
          }}
        >
          ALL
        </button>
        {allTags?.map((tag: Tag) => {
          const isSelected = filters.selectedTagIds.includes(tag.id);
          const borderColor = isSelected
            ? getTagColor(tag)
            : 'var(--surface0)';
          return (
            <button
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
              style={{
                padding: '4px 8px',
                border: `1px solid ${borderColor}`,
                cursor: 'pointer',
                fontSize: '13px',
                background: 'transparent',
                color: 'var(--text)'
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = 'var(--text)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = 'var(--surface0)';
                }
              }}
            >
              {tag.name}
            </button>
          );
        })}
      </div>

      <CircleOfFifthsModal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
        selectedKeys={new Set(filters.selectedKeyCamelotIds)}
        onToggleKey={(key) => {
          const newSet = new Set(filters.selectedKeyCamelotIds);
          if (newSet.has(key)) {
            newSet.delete(key);
          } else {
            newSet.add(key);
          }
          setFilters({ ...filters, selectedKeyCamelotIds: Array.from(newSet) });
        }}
        onClearAll={() => setFilters({ ...filters, selectedKeyCamelotIds: [] })}
        openPosition={keyModalPosition}
      />

      <BpmModal
        isOpen={isBpmModalOpen}
        onClose={() => setIsBpmModalOpen(false)}
        bpmCenter={filters.bpmCenter}
        bpmThresholdPercent={filters.bpmThresholdPercent}
        onBpmCenterChange={(value) => setFilters({ ...filters, bpmCenter: value })}
        onThresholdChange={(value) => setFilters({ ...filters, bpmThresholdPercent: value })}
        onClear={() => setFilters({ ...filters, bpmCenter: null })}
        openPosition={bpmModalPosition}
      />
    </div>
  );
}
