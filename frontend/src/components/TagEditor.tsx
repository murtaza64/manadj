import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Track, Tag } from '../types';
import './TagEditor.css';

interface Props {
  track: Track | null;
  onSave: (data: { energy?: number; tag_ids?: number[] }) => void;
}

export default function TagEditor({ track, onSave }: Props) {
  const isDisabled = !track;

  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(
    new Set(track?.tags.map(t => t.id) || [])
  );
  const [energy, setEnergy] = useState<number | undefined>(track?.energy);

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

  // Extract just the filename from the full path
  const filename = track?.filename.split('/').pop() || 'No track selected';

  return (
    <div className={`tag-editor ${isDisabled ? 'tag-editor-disabled' : ''}`}>
        {/* Energy Selector */}
        <div className="tag-editor-energy-row">
          <span className="tag-editor-energy-label">Energy:</span>
          <div
            className="tag-editor-energy-bar"
            onClick={(e) => {
              if (isDisabled) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const x = e.clientX - rect.left;
              const level = Math.max(1, Math.min(5, Math.ceil((x / rect.width) * 5)));
              handleEnergyChange(level);
            }}
            style={{ cursor: isDisabled ? 'not-allowed' : 'pointer' }}
          >
            {[1, 2, 3, 4, 5].map(level => {
              const isFilled = energy !== undefined && level <= energy;
              const colors = [
                'var(--energy-1)',
                'var(--energy-2)',
                'var(--energy-3)',
                'var(--energy-4)',
                'var(--energy-5)'
              ];
              const color = isFilled ? colors[level - 1] : 'var(--surface0)';

              return (
                <div
                  key={level}
                  className="tag-editor-energy-cell"
                  style={{ background: color }}
                />
              );
            })}
          </div>
        </div>

        {/* Tags */}
        <div className="tag-editor-tags">
          {allTags?.map((tag: Tag) => {
            const isSelected = selectedTagIds.has(tag.id);
            const borderColor = isSelected
              ? (tag.category.color || 'var(--surface0)')
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
        </div>
    </div>
  );
}
