import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag, Track } from '../types';
import { getTagColor } from '../utils/colorUtils';
import { getBpmColor, getAverageKeyColor } from '../utils/displayColors';
import EnergySquare from './EnergySquare';
import { CrosshairIcon, EnergyIcon, SearchIcon, SpeedIcon, KeyIcon, SlidersIcon, TagIcon } from './icons';
import CircleOfFifthsModal from './CircleOfFifthsModal';
import BpmModal from './BpmModal';
import FollowParamsModal from './FollowParamsModal';
import { DEFAULT_FILTERS, useFilters } from '../contexts/FilterContext';
import { useSearchKeys } from './searchKeys';
import { dispatchFollow, useFollowFlags } from '../follow/followStore';
import { useFollowParams } from '../follow/paramsStore';
import { followedReferences, followSummary } from '../follow/model';
import './FilterBar.css';

interface FilterBarProps {
  totalTracks: number;
  filteredCount: number;
  /** Loaded decks — Follow's reference model: the followed Deck's loaded
   * Track is the match reference, never the selection. */
  loadedA: Track | null;
  loadedB: Track | null;
}

export default function FilterBar({ totalTracks, filteredCount, loadedA, loadedB }: FilterBarProps) {
  const { filters, setFilters } = useFilters();
  const [searchInput, setSearchInput] = useState(filters.search);
  const searchRef = useRef<HTMLInputElement>(null);

  // Cmd+F focus + staged Escape clear (keyboard-focus 02) — document
  // listener; FilterBar rides along in every view with a browse surface.
  useSearchKeys(searchRef);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [keyModalPosition, setKeyModalPosition] = useState<{ x: number; y: number } | undefined>(undefined);
  const [isBpmModalOpen, setIsBpmModalOpen] = useState(false);
  const [bpmModalPosition, setBpmModalPosition] = useState<{ x: number; y: number } | undefined>(undefined);
  const [showTagFilters, setShowTagFilters] = useState(false);
  const [showParamsModal, setShowParamsModal] = useState(false);
  const [paramsModalPosition, setParamsModalPosition] = useState<{ x: number; y: number } | undefined>(undefined);

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

  // Follow external search changes (the staged Escape clears through
  // FilterContext.clearSearch): committed search moved → mirror it in the
  // field (adjust-during-render pattern, same as TransitionSwitcher's nav
  // reset). On a debounce commit the values are already equal — no-op.
  const [seenSearch, setSeenSearch] = useState(filters.search);
  if (filters.search !== seenSearch) {
    setSeenSearch(filters.search);
    setSearchInput(filters.search);
  }

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

  const followFlags = useFollowFlags();
  const followParams = useFollowParams();
  const queryClient = useQueryClient();
  const loadedByDeck = { A: loadedA, B: loadedB } as const;
  /** Followed references, for the summary chips and the modal context —
   * facts through the track cache (ADR 0027 §7), so the modal shows the
   * edited BPM, not the load-time snapshot. */
  const followedRefs = followedReferences(followFlags, loadedByDeck, (id) =>
    queryClient.getQueryData<Track>(['track', id])
  );

  const openParamsModal = (e: React.MouseEvent<HTMLButtonElement>) => {
    setParamsModalPosition({ x: e.clientX, y: e.clientY });
    setShowParamsModal(true);
  };

  /** Anything non-default that Clear All would clear (sort is exempt). */
  const hasActiveFilters =
    filters.search !== '' ||
    filters.selectedTagIds.length > 0 ||
    filters.energyMin !== 1 ||
    filters.energyMax !== 5 ||
    filters.bpmCenter !== null ||
    filters.selectedKeyCamelotIds.length > 0;

  return (
    <div style={{
      background: 'var(--mantle)',
      borderBottom: '1px solid var(--surface0)',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px'
    }}>
      {/* Filter bar - order: Tag, Search, Energy, Key, BPM, Follow toggles + summary, Clear All, Result Count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Tag Toggle Icon with Red Dot Indicator */}
        <div
          onClick={() => setShowTagFilters(!showTagFilters)}
          className={`filter-bar-tag-toggle${showTagFilters ? ' open' : ''}`}
        >
          <TagIcon />
          {filters.selectedTagIds.length > 0 && !showTagFilters && (
            <div style={{
              position: 'absolute',
              top: '-2px',
              right: '-2px',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--red)'
            }} />
          )}
        </div>

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
          ref={searchRef}
          type="text"
          placeholder="Search by filename..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            // Keyboard exit (keyboard-focus 02): Enter and Escape hand the
            // keyboard back to the decks, filter KEPT (Escape-clearing is
            // the staged, unfocused Escape — searchKeys.ts). stopPropagation
            // keeps this Escape from doubling as the staged clear.
            if (e.key === 'Enter' || e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.blur();
            }
          }}
          className="filter-bar-search"
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
          className="filter-bar-key-btn"
          style={{
            minWidth: '70px',
            // Active filter = accent border (inline wins over the CSS
            // hover, so the accent holds — unified vocabulary)
            ...(filters.selectedKeyCamelotIds.length > 0
              ? { borderColor: getAverageKeyColor(filters.selectedKeyCamelotIds) || 'var(--mauve)' }
              : {}),
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
          className="filter-bar-bpm-btn"
          style={{
            minWidth: '60px',
            ...(filters.bpmCenter !== null
              ? { borderColor: getBpmColor(filters.bpmCenter) || 'var(--mauve)' }
              : {}),
          }}
        >
          {filters.bpmCenter !== null
            ? `${Math.round(filters.bpmCenter - filters.bpmCenter * filters.bpmThresholdPercent / 100)}-${Math.round(filters.bpmCenter + filters.bpmCenter * filters.bpmThresholdPercent / 100)}`
            : 'BPM'
          }
        </button>

        {/* Follow mode: ◎ [A][B][⚙] (follow-mode 07). Per-Deck toggles
            compose beside the manual filters (never writes them); the list
            keeps matching the followed Deck's loaded Track hands-off. The
            derived summary lives in the toggles' tooltips (no layout
            shift); the gear opens the parameters modal. */}
        <div style={{ width: '16px', flexShrink: 0 }}>
          <CrosshairIcon />
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {(['A', 'B'] as const).map((deck) => {
            const reference = loadedByDeck[deck];
            const on = followFlags[deck];
            // Only ENABLING requires a loaded Track — an on-flag must
            // always be turn-off-able, even if the Deck somehow emptied.
            // (The reducer enforces the same rule; disabled is just UI.)
            const actionable = reference !== null || on;
            // Deck color when on (identity, CONTEXT.md: Deck color) —
            // green would say "active" without saying which deck. Applied
            // via the on-a/on-b classes (FilterBar.css).
            return (
              <button
                key={deck}
                onClick={() => dispatchFollow({ type: 'toggle', deck, loaded: reference !== null })}
                disabled={!actionable}
                className={`filter-bar-follow-btn${on ? ` on-${deck.toLowerCase()}` : ''}`}
                aria-pressed={on}
                title={
                  on && reference
                    ? `Following Deck ${deck} — deriving: ${followSummary(reference, followParams)}`
                    : actionable
                      ? `Follow Deck ${deck}: keep the list matched to its loaded track`
                      : `Load Deck ${deck} first`
                }
                style={{ padding: '4px 0', width: '28px' }}
              >
                {deck}
              </button>
            );
          })}
          <button
            onClick={openParamsModal}
            className="filter-bar-follow-btn"
            title="Follow parameters"
            style={{
              padding: '4px 6px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <SlidersIcon width={14} height={14} />
          </button>
        </div>

        {/* Clear All Filters Button */}
        <button
          onClick={() => {
            setSearchInput('');
            setFilters({ ...DEFAULT_FILTERS });
          }}
          disabled={!hasActiveFilters}
          className="filter-bar-clear-all-btn"
        >
          Clear All
        </button>

        {/* Result Count */}
        <div style={{
          fontSize: '14px',
          color: 'var(--subtext1)',
          minWidth: '80px',
          flexShrink: 0
        }}>
          {filteredCount} / {totalTracks}
        </div>
      </div>

      {/* Tags with Match Mode Toggle - Collapsible */}
      {showTagFilters && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={toggleMatchMode}
            className={`filter-bar-match-mode-btn${filters.tagMatchMode === 'ANY' ? ' on' : ''}`}
          >
            ANY
          </button>
          <button
            onClick={toggleMatchMode}
            className={`filter-bar-match-mode-btn${filters.tagMatchMode === 'ALL' ? ' on' : ''}`}
          >
            ALL
          </button>
          {allTags?.map((tag: Tag) => {
            const isSelected = filters.selectedTagIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className="filter-bar-tag-pill"
                style={
                  // Selected = inverted fill in the tag's color (inline
                  // wins over the CSS hover, pinning the accent)
                  isSelected
                    ? {
                        background: getTagColor(tag),
                        borderColor: getTagColor(tag),
                        color: 'var(--base)',
                      }
                    : undefined
                }
              >
                {tag.name}
              </button>
            );
          })}
        </div>
      )}

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

      <FollowParamsModal
        isOpen={showParamsModal}
        onClose={() => setShowParamsModal(false)}
        references={followedRefs}
        openPosition={paramsModalPosition}
      />
    </div>
  );
}
