import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Track, Tag, GridAnalysisResponse, KeyAnalysisResponse } from '../types';
import { getTagColor } from '../utils/colorUtils';
import EditableCell from './EditableCell';
import EnergySquare from './EnergySquare';
import WaveformMinimap from './WaveformMinimap';
import { useDeck, useDeckReady, useDeckSnapshot } from '../hooks/useDeck';
import { BpmControl } from './deckControls/BpmControl';
import { MusicIcon, PersonIcon, EnergyIcon, TagIcon, NeedleIcon, KeyIcon, SpeedIcon, SettingsIcon } from './icons';
import TagManagementModal from './TagManagementModal';
import { formatKeyDisplay } from '../utils/keyUtils';
import './TagEditor.css';

interface Props {
  track: Track | null;
  /** May return a promise; BPM edits AWAIT it so the beatgrid regeneration
   * sees the committed BPM (issue 24 — regenerating before the PATCH landed
   * rebuilt the grid from the old BPM, and staleTime: Infinity kept it). */
  onSave: (data: {
    energy?: number;
    tag_ids?: number[];
    bpm?: number;
    key?: number;
  }) => void | Promise<unknown>;
  onUpdate?: (trackId: number, field: 'title' | 'artist', value: string) => void;
  onEnergyEditModeChange?: (isActive: boolean) => void;
}

export interface TagEditorHandle {
  enterTagEditMode: () => void;
  toggleEnergyEditMode: () => void;
}

const TagEditor = forwardRef<TagEditorHandle, Props>(({ track, onSave, onUpdate, onEnergyEditModeChange }, ref) => {
  const isDisabled = !track;
  const queryClient = useQueryClient();
  // Beatgrid edits are playhead-dependent: they only apply when the track
  // being edited is the one on the Deck. Narrow selectors keep transport
  // events from re-rendering the editor.
  const { engine, loadedTrack } = useDeck();
  const deckReady = useDeckReady();
  const deckCuePoint = useDeckSnapshot((s) => s.cuePoint);
  const isBeatgridEditable = !!track && loadedTrack?.id === track.id && deckReady;

  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(
    new Set(track?.tags.map(t => t.id) || [])
  );
  const [energy, setEnergy] = useState<number | undefined>(track?.energy);
  const [showManagementModal, setShowManagementModal] = useState(false);

  // Tag edit mode state
  const [isTagEditMode, setIsTagEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Energy edit mode state
  const [isEnergyEditMode, setIsEnergyEditMode] = useState(false);

  // Notify parent when energy edit mode changes
  useEffect(() => {
    onEnergyEditModeChange?.(isEnergyEditMode);
  }, [isEnergyEditMode, onEnergyEditModeChange]);

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResults, setAnalysisResults] = useState<{
    grid?: GridAnalysisResponse;
    key?: KeyAnalysisResponse;
  } | null>(null);
  // Sync internal state when track prop changes
  useEffect(() => {
    setSelectedTagIds(new Set(track?.tags.map(t => t.id) || []));
    setEnergy(track?.energy);
    setAnalysisResults(null);

    // Try to load existing grid-analysis diagnostics (shows a past bail)
    if (track?.id) {
      api.analyze.getGrid(track.id)
        .then(gridResult => {
          setAnalysisResults(prev => ({ ...prev, grid: gridResult }));
        })
        .catch(() => {
          // No analysis exists yet, that's ok
        });
    }
  }, [track?.id]);

  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: api.tags.listAll,
  });

  // Filter tags based on search query
  const filteredTags = useMemo(() => {
    if (!allTags) return [];
    if (!searchQuery.trim()) return allTags;
    return allTags.filter((tag: Tag) =>
      tag.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allTags, searchQuery]);

  // Expose method via ref
  useImperativeHandle(ref, () => ({
    enterTagEditMode: () => {
      if (isDisabled || !allTags || allTags.length === 0) return;
      setIsEnergyEditMode(false);  // Exit energy mode
      setIsTagEditMode(true);
      setSearchQuery('');
      setSelectedIndex(-1);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    },
    toggleEnergyEditMode: () => {
      if (isDisabled) return;
      setIsTagEditMode(false);  // Exit tag mode
      setSearchQuery('');
      setIsEnergyEditMode(prev => !prev);
    }
  }));

  const toggleTag = (tagId: number) => {
    if (isDisabled) return;
    const newSet = new Set(selectedTagIds);
    if (newSet.has(tagId)) {
      newSet.delete(tagId);
    } else {
      newSet.add(tagId);
    }
    setSelectedTagIds(newSet);
    // Save instantly
    onSave({
      energy,
      tag_ids: Array.from(newSet),
    });
  };

  const handleEnergyChange = (newEnergy: number) => {
    if (isDisabled) return;
    setEnergy(newEnergy);
    // Save instantly
    onSave({
      energy: newEnergy,
      tag_ids: Array.from(selectedTagIds),
    });
  };

  // Handler for analyze button
  const handleAnalyze = async () => {
    if (!track) return;

    setIsAnalyzing(true);
    try {
      // Run both analyses in parallel
      const [gridResult, keyResult] = await Promise.all([
        api.analyze.grid(track.id),
        api.analyze.key(track.id)
      ]);

      setAnalysisResults({ grid: gridResult, key: keyResult });

      // Grid analysis writes server-side (analyzed Beatgrid + BPM
      // projection, ADR 0024) — or bails and writes nothing; the client
      // only refetches. Key still rides the PATCH until issue 08 gives
      // the key path its own server-side write.
      await onSave({
        key: keyResult.formats.engine_id ?? undefined
      });
      queryClient.invalidateQueries({ queryKey: ['beatgrid', track.id] });
      queryClient.invalidateQueries({ queryKey: ['tracks'] });

    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Keyboard handler for tag edit mode
  useEffect(() => {
    if (!isTagEditMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      const key = event.key.toLowerCase();

      if (key === 'escape') {
        event.preventDefault();
        setIsTagEditMode(false);
        setSearchQuery('');
      } else if (key === 'arrowdown') {
        event.preventDefault();
        setSelectedIndex(prev =>
          prev >= filteredTags.length - 1 ? 0 : prev + 1
        );
      } else if (key === 'arrowup') {
        event.preventDefault();
        setSelectedIndex(prev =>
          prev <= 0 ? filteredTags.length - 1 : prev - 1
        );
      } else if (key === 'enter') {
        event.preventDefault();
        if (filteredTags.length > 0) {
          toggleTag(filteredTags[selectedIndex].id);
          setIsTagEditMode(false);
          setSearchQuery('');
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTagEditMode, filteredTags, selectedIndex]);

  // Reset selectedIndex on search change
  useEffect(() => {
    // If search is empty, no selection. Otherwise select first match.
    setSelectedIndex(searchQuery.trim() ? 0 : -1);
  }, [searchQuery]);

  // Keyboard handler for energy edit mode
  useEffect(() => {
    if (!isEnergyEditMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      const key = event.key.toLowerCase();

      if (key === 'escape' || key === 'e') {
        event.preventDefault();
        setIsEnergyEditMode(false);
      } else if (['1', '2', '3', '4', '5'].includes(key)) {
        event.preventDefault();
        const energyLevel = parseInt(key);
        handleEnergyChange(energyLevel);
        setIsEnergyEditMode(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEnergyEditMode]);

  // Extract just the filename from the full path
  const filename = track?.filename.split('/').pop() || 'No track selected';

  return (
    <div className={`tag-editor ${isDisabled ? 'tag-editor-disabled' : ''}`}>
      <div style={{ display: 'flex', gap: '8px' }}>
        {/* Left side: Title, Artist, Energy in 3 rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '200px', minWidth: 0, flexShrink: 0 }}>
          {/* Row 1: Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flexShrink: 0 }}>
              <MusicIcon />
            </div>
            {track && onUpdate ? (
              <div style={{ minWidth: 0 }}>
                <EditableCell
                  value={track.title || ''}
                  onSave={(newValue) => onUpdate(track.id, 'title', newValue)}
                  placeholder={filename}
                />
              </div>
            ) : (
              <span style={{ color: isDisabled ? 'var(--overlay0)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {track?.title || filename}
              </span>
            )}
          </div>

          {/* Row 2: Artist */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flexShrink: 0 }}>
              <PersonIcon />
            </div>
            {track && onUpdate ? (
              <div style={{ minWidth: 0 }}>
                <EditableCell
                  value={track.artist || ''}
                  onSave={(newValue) => onUpdate(track.id, 'artist', newValue)}
                  placeholder="Unknown Artist"
                />
              </div>
            ) : (
              <span style={{ color: isDisabled ? 'var(--overlay0)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {track?.artist || '-'}
              </span>
            )}
          </div>

          {/* Row 3: Energy */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            position: 'relative',
            zIndex: isEnergyEditMode ? 10 : 'auto'
          }}>
            <EnergyIcon />
            <div style={{ display: 'flex', gap: '2px' }}>
              {[1, 2, 3, 4, 5].map(level => (
                <EnergySquare
                  key={level}
                  level={level}
                  filled={energy === level}
                  onClick={() => {
                    if (!isDisabled) {
                      handleEnergyChange(level);
                    }
                  }}
                  disabled={isDisabled}
                  showNumber={true}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right side: Beatgrid controls with Key/BPM, Hot Cues with Minimap, and Tags in separate rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
          {/* Row 1: the tempo/grid cluster (one domain — ADR 0016), Key,
              Hot Cues, and Minimap side by side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <SpeedIcon />
            <BpmControl
              track={track}
              disabled={isDisabled}
              onSave={(bpm) => onSave({ bpm })}
              // Keep the loaded deck's beat-jump math honest (the engine
              // learns bpm at Load; TagEditor edits the loaded track —
              // issue 23).
              onCommitted={(bpm) => {
                if (track && loadedTrack?.id === track.id) {
                  engine.setTrackBpm(track.id, bpm);
                }
              }}
              grid={{
                getPlayhead: () => engine.getPlayhead(),
                disabled: !isBeatgridEditable,
                disabledTitle: 'Load this track to edit its beatgrid',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}>
              <KeyIcon />
              <span style={{
                color: isDisabled ? 'var(--overlay0)' : 'var(--text)',
                fontSize: '12px',
                opacity: analysisResults?.key ? 1 : 0.6
              }}>
                {track ? formatKeyDisplay(track.key) : '-'}
              </span>
            </div>
            <button
              onClick={handleAnalyze}
              disabled={isDisabled || isAnalyzing}
              className="player-button"
              style={{
                color: 'var(--green)',
                borderColor: 'var(--green)',
                padding: '4px 8px',
                minWidth: '32px',
                fontSize: '12px',
                height: '24px',
                marginLeft: '4px',
              }}
              title="Analyze grid and key"
            >
              {isAnalyzing ? '...' : 'A'}
            </button>
            {analysisResults?.grid?.bailed && (
              <span
                style={{ color: 'var(--red)', fontSize: '12px', fontWeight: 700 }}
                title={`Grid analysis bailed: ${String(analysisResults.grid.evidence?.reason ?? 'unknown')} — no grid or BPM written; needs attention`}
              >
                !
              </span>
            )}
            <NeedleIcon />
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Minimap follows the Deck (loaded Track), not the selection */}
              <WaveformMinimap
                trackId={loadedTrack?.id ?? null}
                clock={engine}
                cuePoint={deckCuePoint}
                onSeek={(t) => engine.seek(t)}
                dimmed={loadedTrack !== null && !deckReady}
              />
            </div>
          </div>

          {/* Row 2: Tags */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '4px' }}>
            <TagIcon />
            <div style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '4px',
              flex: 1,
              zIndex: isTagEditMode ? 10 : 'auto'
            }}>
              {/* Floating search input (only visible in tag edit mode) */}
              {isTagEditMode && (
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Type to filter tags..."
                  style={{
                    position: 'absolute',
                    top: '-32px',
                    left: 0,
                    right: 0,
                    padding: '4px 8px',
                    background: 'var(--base)',
                    border: '1px solid var(--lavender)',
                    color: 'var(--text)',
                    fontSize: '12px',
                    fontFamily: 'UbuntuMono Nerd Font, monospace',
                    outline: 'none',
                  }}
                />
              )}

              {/* Tags row */}
              {allTags?.map((tag: Tag) => {
                const isToggled = selectedTagIds.has(tag.id);
                const isMatching = isTagEditMode && filteredTags.includes(tag);
                const matchingIndex = isTagEditMode ? filteredTags.indexOf(tag) : -1;
                const isSelectedByArrow = isTagEditMode && matchingIndex === selectedIndex;

                const borderColor = isToggled
                  ? getTagColor(tag)
                  : 'var(--surface0)';

                // Glow color: red if tag would be removed, peach if it would be added
                const glowColor = isSelectedByArrow && isToggled ? 'var(--red)' : 'var(--peach)';

                return (
                  <button
                    key={tag.id}
                    onClick={() => {
                      toggleTag(tag.id);
                      if (isTagEditMode) {
                        setIsTagEditMode(false);
                        setSearchQuery('');
                      }
                    }}
                    disabled={isDisabled}
                    className="tag-editor-tag-button"
                    style={{
                      border: `1px solid ${borderColor}`,
                      background: 'transparent',
                      opacity: isTagEditMode && !isMatching ? 0.3 : 1,
                      boxShadow: isSelectedByArrow ? `0 0 4px 1px ${glowColor}` : 'none',
                      color: isToggled ? getTagColor(tag) : 'var(--text)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isToggled && !isTagEditMode) {
                        e.currentTarget.style.borderColor = 'var(--text)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isToggled && !isTagEditMode) {
                        e.currentTarget.style.borderColor = 'var(--surface0)';
                      }
                    }}
                  >
                    {tag.name}
                  </button>
                );
              })}
              {!isTagEditMode && (
                <button
                  onClick={() => setShowManagementModal(true)}
                  disabled={isDisabled}
                  className="tag-editor-manage-button"
                  style={{
                    border: '1px solid var(--surface0)',
                    background: 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <SettingsIcon width={12} height={12} opacity={0.6} />
                  <span>Manage...</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <TagManagementModal
        isOpen={showManagementModal}
        onClose={() => setShowManagementModal(false)}
      />

      {/* Dark overlay when in tag edit mode */}
      {isTagEditMode && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            zIndex: 5,
            pointerEvents: 'none',
          }}
          onClick={() => {
            setIsTagEditMode(false);
            setSearchQuery('');
          }}
        />
      )}

      {/* Dark overlay when in energy edit mode */}
      {isEnergyEditMode && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            zIndex: 5,
            pointerEvents: 'none',
          }}
          onClick={() => {
            setIsEnergyEditMode(false);
          }}
        />
      )}
    </div>
  );
});

TagEditor.displayName = 'TagEditor';

export default TagEditor;
