import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag } from '../types';

interface FilterBarProps {
  onFilterChange: (filters: {
    search: string;
    selectedTagIds: number[];
    energyMin: number | null;
    energyMax: number | null;
    tagMatchMode: 'ANY' | 'ALL';
  }) => void;
  totalTracks: number;
  filteredCount: number;
}

export default function FilterBar({ onFilterChange, totalTracks, filteredCount }: FilterBarProps) {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [energyMin, setEnergyMin] = useState<number>(1);
  const [energyMax, setEnergyMax] = useState<number>(5);
  const [tagMatchMode, setTagMatchMode] = useState<'ANY' | 'ALL'>('ANY');

  // Fetch all tags
  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: api.tags.listAll,
  });

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Notify parent of filter changes
  useEffect(() => {
    onFilterChange({
      search: debouncedSearch,
      selectedTagIds: Array.from(selectedTagIds),
      energyMin: energyMin,
      energyMax: energyMax,
      tagMatchMode,
    });
  }, [debouncedSearch, selectedTagIds, energyMin, energyMax, tagMatchMode]);

  const toggleTag = (tagId: number) => {
    const newSet = new Set(selectedTagIds);
    if (newSet.has(tagId)) {
      newSet.delete(tagId);
    } else {
      newSet.add(tagId);
    }
    setSelectedTagIds(newSet);
  };

  const toggleMatchMode = () => {
    setTagMatchMode(prev => prev === 'ANY' ? 'ALL' : 'ANY');
  };

  const clearSearch = () => {
    setSearchInput('');
    setDebouncedSearch('');
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
      {/* Search Input */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
        {searchInput && (
          <button
            onClick={clearSearch}
            style={{
              padding: '8px 12px',
              background: 'var(--red)',
              color: 'var(--base)',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Energy Range Bar */}
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{ display: 'inline-flex', cursor: 'pointer', userSelect: 'none' }}
          onMouseDown={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const getLevel = (clientX: number) => {
              const x = clientX - rect.left;
              return Math.max(1, Math.min(5, Math.ceil((x / rect.width) * 5)));
            };

            const startLevel = getLevel(e.clientX);
            setEnergyMin(startLevel);
            setEnergyMax(startLevel);

            const handleMouseMove = (moveEvent: MouseEvent) => {
              const currentLevel = getLevel(moveEvent.clientX);
              const newMin = Math.min(startLevel, currentLevel);
              const newMax = Math.max(startLevel, currentLevel);

              setEnergyMin(newMin);
              setEnergyMax(newMax);
            };

            const handleMouseUp = () => {
              document.removeEventListener('mousemove', handleMouseMove);
              document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
          }}
        >
          {[1, 2, 3, 4, 5].map(level => {
            const isInRange = level >= energyMin && level <= energyMax;
            const colors = [
              'var(--energy-1)',
              'var(--energy-2)',
              'var(--energy-3)',
              'var(--energy-4)',
              'var(--energy-5)'
            ];
            const color = isInRange ? colors[level - 1] : 'var(--surface0)';

            return (
              <div
                key={level}
                style={{
                  width: '32px',
                  height: '24px',
                  background: color,
                  flexShrink: 0
                }}
              />
            );
          })}
        </div>
        {(energyMin !== 1 || energyMax !== 5) && (
          <button
            onClick={() => {
              setEnergyMin(1);
              setEnergyMax(5);
            }}
            style={{
              padding: '4px 12px',
              background: 'var(--red)',
              color: 'var(--base)',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold'
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Tags with Match Mode Toggle */}
      <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '14px', color: 'var(--subtext1)' }}>Tags:</span>
        <button
          onClick={toggleMatchMode}
          style={{
            padding: '4px 12px',
            background: tagMatchMode === 'ANY' ? 'var(--blue)' : 'var(--surface1)',
            color: tagMatchMode === 'ANY' ? 'var(--base)' : 'var(--text)',
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
            background: tagMatchMode === 'ALL' ? 'var(--blue)' : 'var(--surface1)',
            color: tagMatchMode === 'ALL' ? 'var(--base)' : 'var(--text)',
            border: '1px solid var(--surface0)',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: 'bold'
          }}
        >
          ALL
        </button>
        {allTags?.map((tag: Tag) => {
          const isSelected = selectedTagIds.has(tag.id);
          const borderColor = isSelected
            ? (tag.category.color || 'var(--surface0)')
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

      {/* Result Count */}
      <div style={{
        fontSize: '14px',
        color: 'var(--subtext1)'
      }}>
        {filteredCount} / {totalTracks}
      </div>
    </div>
  );
}
