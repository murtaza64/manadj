import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Track, Tag } from '../types';
import { getTagColor } from '../utils/colorUtils';
import EditableCell from './EditableCell';
import EnergySquare from './EnergySquare';
import HotCue from './HotCue';
import WaveformMinimap from './WaveformMinimap';
import { MusicIcon, PersonIcon, EnergyIcon, TagIcon, NeedleIcon, BeatgridIcon, KeyIcon, SpeedIcon, SettingsIcon } from './icons';
import TagManagementModal from './TagManagementModal';
import { useSetBeatgridDownbeat, useNudgeBeatgrid } from '../hooks/useBeatgridData';
import { formatKeyDisplay } from '../utils/keyUtils';
import './TagEditor.css';

interface Props {
  track: Track | null;
  onSave: (data: { energy?: number; tag_ids?: number[] }) => void;
  onUpdate?: (trackId: number, field: 'title' | 'artist', value: string) => void;
  currentTime: number;
}

export default function TagEditor({ track, onSave, onUpdate, currentTime }: Props) {
  const isDisabled = !track;

  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(
    new Set(track?.tags.map(t => t.id) || [])
  );
  const [energy, setEnergy] = useState<number | undefined>(track?.energy);
  const [showManagementModal, setShowManagementModal] = useState(false);

  // Beatgrid editing mutations
  const setDownbeat = useSetBeatgridDownbeat();
  const nudgeGrid = useNudgeBeatgrid();

  // Sync internal state when track prop changes
  useEffect(() => {
    setSelectedTagIds(new Set(track?.tags.map(t => t.id) || []));
    setEnergy(track?.energy);
  }, [track]);

  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: api.tags.listAll,
  });

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

  // Handler for set downbeat button
  const handleSetDownbeat = () => {
    if (!track) return;
    setDownbeat.mutate({
      trackId: track.id,
      downbeatTime: currentTime
    });
  };

  // Handler for nudge buttons
  const handleNudge = (offsetMs: number) => {
    if (!track) return;
    nudgeGrid.mutate({
      trackId: track.id,
      offsetMs
    });
  };

  // Extract just the filename from the full path
  const filename = track?.filename.split('/').pop() || 'No track selected';

  return (
    <div className={`tag-editor ${isDisabled ? 'tag-editor-disabled' : ''}`}>
      <div style={{ display: 'flex', gap: '8px' }}>
        {/* Left side: Title, Artist, Energy in 3 rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '200px', minWidth: 0, flexShrink: 0 }}>
          {/* Row 1: Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MusicIcon />
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
            <PersonIcon />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
          {/* Row 1: Beatgrid controls, Key, BPM, Hot Cues, and Minimap side by side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <BeatgridIcon />
            <button
              onClick={() => handleNudge(-10)}
              disabled={isDisabled || nudgeGrid.isPending}
              className="player-button"
              title="Nudge grid 10ms earlier"
              style={{
                padding: '4px 8px',
                minWidth: '32px',
                fontSize: '12px',
                height: '24px',
              }}
            >
              ◄
            </button>
            <button
              onClick={handleSetDownbeat}
              disabled={isDisabled || setDownbeat.isPending}
              className="player-button"
              style={{
                color: 'var(--blue)',
                borderColor: 'var(--blue)',
                padding: '4px 8px',
                minWidth: '32px',
                fontSize: '12px',
                height: '24px',
              }}
              title="Set downbeat at current position"
            >
              D
            </button>
            <button
              onClick={() => handleNudge(10)}
              disabled={isDisabled || nudgeGrid.isPending}
              className="player-button"
              title="Nudge grid 10ms later"
              style={{
                padding: '4px 8px',
                minWidth: '32px',
                fontSize: '12px',
                height: '24px',
              }}
            >
              ►
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}>
              <KeyIcon />
              <span style={{ color: isDisabled ? 'var(--overlay0)' : 'var(--text)', fontSize: '12px' }}>
                {track ? formatKeyDisplay(track.key) : '-'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <SpeedIcon />
              <span style={{ color: isDisabled ? 'var(--overlay0)' : 'var(--text)', fontSize: '12px' }}>
                {track?.bpm ? `${track.bpm} BPM` : '-'}
              </span>
            </div>
            <NeedleIcon />
            {[1, 2, 3, 4, 5, 6, 7, 8].map(cueNum => (
              <HotCue
                key={cueNum}
                number={cueNum}
                isSet={false}
                disabled={isDisabled}
              />
            ))}
            <div style={{ flex: 1, minWidth: 0 }}>
              <WaveformMinimap trackId={track?.id ?? null} />
            </div>
          </div>

          {/* Row 2: Tags */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
            <TagIcon />
            {allTags?.map((tag: Tag) => {
              const isSelected = selectedTagIds.has(tag.id);
              const borderColor = isSelected
                ? getTagColor(tag)
                : 'var(--surface0)';
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  disabled={isDisabled}
                  className="tag-editor-tag-button"
                  style={{
                    border: `1px solid ${borderColor}`,
                    background: 'transparent',
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
          </div>
        </div>
      </div>
      <TagManagementModal
        isOpen={showManagementModal}
        onClose={() => setShowManagementModal(false)}
      />
    </div>
  );
}
