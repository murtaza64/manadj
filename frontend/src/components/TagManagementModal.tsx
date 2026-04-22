import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag, TagCategory } from '../types';
import { COLOR_PALETTE, NEUTRAL_COLOR_PALETTE, getNextColor, isValidHexColor } from '../utils/colorUtils';
import './TagManagementModal.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface TagEdit {
  id: number;
  name: string;
  color: string;
  category_id: number;
}

interface NewTag {
  tempId: string;
  name: string;
  color: string;
  category_id: number;
}

interface NewTagDraft {
  name: string;
  color: string;
}

interface PickerAnchor {
  top: number;
  bottom: number;
  left: number;
}

type ActiveColorPicker =
  | { type: 'existing'; tagId: number; anchor: PickerAnchor }
  | { type: 'new'; tempId: string; anchor: PickerAnchor }
  | { type: 'draft'; categoryId: number; anchor: PickerAnchor };

export default function TagManagementModal({ isOpen, onClose }: Props) {
  const queryClient = useQueryClient();
  const getNativeColorValue = (color: string): string => (isValidHexColor(color) ? color : '#e55f85');

  const getPickerAnchor = (el: HTMLElement): PickerAnchor => {
    const rect = el.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
    };
  };

  const getColorModalPosition = (anchor: PickerAnchor) => {
    const modalWidth = 320;
    const modalHeight = 320;
    const gap = 8;
    const edge = 8;

    const left = Math.max(edge, Math.min(anchor.left, window.innerWidth - modalWidth - edge));

    const canShowBelow = anchor.bottom + gap + modalHeight <= window.innerHeight - edge;
    const top = canShowBelow
      ? anchor.bottom + gap
      : Math.max(edge, anchor.top - modalHeight - gap);

    return { top, left };
  };

  // State for batch editing
  const [editedTags, setEditedTags] = useState<{ [id: number]: TagEdit }>({});
  const [newTags, setNewTags] = useState<NewTag[]>([]);
  const [newTagDrafts, setNewTagDrafts] = useState<{ [categoryId: number]: NewTagDraft }>({});
  const [deletedTagIds, setDeletedTagIds] = useState<Set<number>>(new Set());
  const [activeColorPicker, setActiveColorPicker] = useState<ActiveColorPicker | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch data
  const { data: categories } = useQuery({
    queryKey: ['tag-categories'],
    queryFn: api.tags.listCategories,
    enabled: isOpen,
  });

  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: api.tags.listAll,
    enabled: isOpen,
  });

  // Initialize edited tags when modal opens or tags change
  useEffect(() => {
    if (isOpen && allTags) {
      const initialEdits: { [id: number]: TagEdit } = {};
      allTags.forEach((tag: Tag) => {
        initialEdits[tag.id] = {
          id: tag.id,
          name: tag.name,
          color: tag.color || getNextColor(),
          category_id: tag.category_id,
        };
      });
      setEditedTags(initialEdits);
      setNewTags([]);
      setNewTagDrafts({});
      setDeletedTagIds(new Set());
      setHasChanges(false);
    }
  }, [isOpen, allTags]);

  useEffect(() => {
    if (!isOpen || !categories) return;

    setNewTagDrafts((prev) => {
      const next = { ...prev };
      let changed = false;

      categories.forEach((category: TagCategory) => {
        if (!next[category.id]) {
          next[category.id] = { name: '', color: getNextColor() };
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [isOpen, categories]);

  // Batch save mutation - handles creates, updates, and deletes
  const batchSaveMutation = useMutation({
    mutationFn: async ({
      creates,
      updates,
      deletes,
    }: {
      creates: NewTag[];
      updates: TagEdit[];
      deletes: number[];
    }) => {
      // Execute all operations in parallel
      await Promise.all([
        ...creates.map((tag) =>
          api.tags.create({
            name: tag.name,
            color: tag.color,
            category_id: tag.category_id,
          })
        ),
        ...updates.map((tag) =>
          api.tags.update(tag.id, {
            name: tag.name,
            color: tag.color,
          })
        ),
        ...deletes.map((id) => api.tags.delete(id)),
      ]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setHasChanges(false);
      setActiveColorPicker(null);
      setNewTagDrafts((prev) => {
        const reset: { [categoryId: number]: NewTagDraft } = {};
        Object.keys(prev).forEach((key) => {
          const categoryId = Number(key);
          reset[categoryId] = { name: '', color: getNextColor() };
        });
        return reset;
      });
    },
  });

  // Handlers
  const handleTagChange = (tagId: number, field: 'name' | 'color', value: string) => {
    setEditedTags((prev) => ({
      ...prev,
      [tagId]: {
        ...prev[tagId],
        [field]: value,
      },
    }));
    setHasChanges(true);
  };

  const savePendingChanges = (createsOverride?: NewTag[]) => {
    const creates = createsOverride ?? newTags;

    // Validate all colors (existing and new tags)
    const invalidExistingColors = Object.values(editedTags).filter(
      (tag) => tag.color && !isValidHexColor(tag.color)
    );
    const invalidNewColors = creates.filter(
      (tag) => tag.color && !isValidHexColor(tag.color)
    );

    if (invalidExistingColors.length > 0 || invalidNewColors.length > 0) {
      alert('Some tags have invalid hex colors. Please fix them before saving.');
      return false;
    }

    // Find changed tags
    const changedTags = Object.values(editedTags).filter((editedTag) => {
      if (deletedTagIds.has(editedTag.id)) return false; // Skip deleted tags
      const originalTag = allTags?.find((t: Tag) => t.id === editedTag.id);
      return (
        originalTag &&
        (originalTag.name !== editedTag.name || originalTag.color !== editedTag.color)
      );
    });

    const hasAnyChanges =
      changedTags.length > 0 || creates.length > 0 || deletedTagIds.size > 0;

    if (!hasAnyChanges) return false;

    // Confirm deletions if any
    if (deletedTagIds.size > 0) {
      const deletedTagNames = Array.from(deletedTagIds)
        .map((id) => {
          const tag = allTags?.find((t: Tag) => t.id === id);
          return tag ? tag.name : `ID ${id}`;
        })
        .join(', ');

      const confirmMessage =
        deletedTagIds.size === 1
          ? `Delete tag "${deletedTagNames}"? It will be removed from all tracks.`
          : `Delete ${deletedTagIds.size} tags (${deletedTagNames})? They will be removed from all tracks.`;

      if (!confirm(confirmMessage)) {
        return false;
      }
    }

    batchSaveMutation.mutate({
      creates,
      updates: changedTags,
      deletes: Array.from(deletedTagIds),
    });
    return true;
  };

  const handleSave = () => {
    savePendingChanges();
  };

  const handleCancel = () => {
    // Reset to original values
    if (allTags) {
      const resetEdits: { [id: number]: TagEdit } = {};
      allTags.forEach((tag: Tag) => {
        resetEdits[tag.id] = {
          id: tag.id,
          name: tag.name,
          color: tag.color || getNextColor(),
          category_id: tag.category_id,
        };
      });
      setEditedTags(resetEdits);
      setNewTags([]);
      setNewTagDrafts({});
      setDeletedTagIds(new Set());
      setHasChanges(false);
      setActiveColorPicker(null);
    }
  };

  const handleAddNewTag = (categoryId: number) => {
    const draft = newTagDrafts[categoryId];
    const name = draft?.name?.trim();
    if (!name) return;

    const newTag: NewTag = {
      tempId: `temp-${Date.now()}-${Math.random()}`,
      name,
      color: draft?.color || getNextColor(),
      category_id: categoryId,
    };

    setNewTags((prev) => [...prev, newTag]);
    setNewTagDrafts((prev) => ({
      ...prev,
      [categoryId]: { name: '', color: getNextColor() },
    }));
    setHasChanges(true);
  };

  const handleAddAndSaveNewTag = (categoryId: number) => {
    const draft = newTagDrafts[categoryId];
    const name = draft?.name?.trim();
    if (!name) return;

    const newTag: NewTag = {
      tempId: `temp-${Date.now()}-${Math.random()}`,
      name,
      color: draft?.color || getNextColor(),
      category_id: categoryId,
    };

    setNewTags((prev) => [...prev, newTag]);
    setNewTagDrafts((prev) => ({
      ...prev,
      [categoryId]: { name: '', color: getNextColor() },
    }));
    setHasChanges(true);

    savePendingChanges([...newTags, newTag]);
  };

  const handleDraftTagChange = (
    categoryId: number,
    field: 'name' | 'color',
    value: string
  ) => {
    setNewTagDrafts((prev) => ({
      ...prev,
      [categoryId]: {
        name: prev[categoryId]?.name || '',
        color: prev[categoryId]?.color || getNextColor(),
        [field]: value,
      },
    }));
  };

  const handleDeleteNewTag = (tempId: string) => {
    setNewTags((prev) => prev.filter((tag) => tag.tempId !== tempId));
    setHasChanges(true);
  };

  const handleDeleteExistingTag = (tagId: number) => {
    setDeletedTagIds((prev) => new Set(prev).add(tagId));
    setHasChanges(true);
  };

  const handleNewTagChange = (tempId: string, field: 'name' | 'color', value: string) => {
    setNewTags((prev) =>
      prev.map((tag) =>
        tag.tempId === tempId ? { ...tag, [field]: value } : tag
      )
    );
    setHasChanges(true);
  };

  const getActiveColorValue = (): string => {
    if (!activeColorPicker) return '#e55f85';

    if (activeColorPicker.type === 'existing') {
      return editedTags[activeColorPicker.tagId]?.color || '#e55f85';
    }

    if (activeColorPicker.type === 'new') {
      return newTags.find((tag) => tag.tempId === activeColorPicker.tempId)?.color || '#e55f85';
    }

    return newTagDrafts[activeColorPicker.categoryId]?.color || '#e55f85';
  };

  const setActiveColorValue = (color: string) => {
    if (!activeColorPicker) return;

    if (activeColorPicker.type === 'existing') {
      handleTagChange(activeColorPicker.tagId, 'color', color);
      return;
    }

    if (activeColorPicker.type === 'new') {
      handleNewTagChange(activeColorPicker.tempId, 'color', color);
      return;
    }

    handleDraftTagChange(activeColorPicker.categoryId, 'color', color);
  };

  const handleRequestClose = () => {
    if (activeColorPicker) {
      setActiveColorPicker(null);
      return;
    }

    if (hasChanges) {
      const shouldClose = confirm('Discard unsaved changes and close?');
      if (!shouldClose) return;
    }
    onClose();
  };

  if (!isOpen) return null;

  // Group edited tags by category (including deleted ones, we'll style them differently)
  const tagsByCategory: { [catId: number]: TagEdit[] } = {};
  Object.values(editedTags).forEach((tag) => {
    if (!tagsByCategory[tag.category_id]) {
      tagsByCategory[tag.category_id] = [];
    }
    tagsByCategory[tag.category_id].push(tag);
  });

  // Group new tags by category
  const newTagsByCategory: { [catId: number]: NewTag[] } = {};
  newTags.forEach((tag) => {
    if (!newTagsByCategory[tag.category_id]) {
      newTagsByCategory[tag.category_id] = [];
    }
    newTagsByCategory[tag.category_id].push(tag);
  });

  const activeColor = getActiveColorValue();
  const isActiveColorInvalid = activeColor && !isValidHexColor(activeColor);
  const activeColorModalPosition = activeColorPicker
    ? getColorModalPosition(activeColorPicker.anchor)
    : null;

  return (
    <div className="modal-overlay" onClick={handleRequestClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage Tags</h2>
          <button onClick={handleRequestClose} className="modal-close-btn">×</button>
        </div>

        <div className="modal-body">
          {categories?.map((category: TagCategory) => (
            <div key={category.id} className="category-section">
              <h3 className="category-title">{category.name}</h3>

              {/* Tag Grid - 3 columns */}
              <div className="tag-grid">
                {/* Existing Tags */}
                {tagsByCategory[category.id]?.map((tag) => {
                  const isColorInvalid = tag.color && !isValidHexColor(tag.color);
                  const isDeleted = deletedTagIds.has(tag.id);
                  return (
                    <div key={tag.id} className={`tag-grid-item ${isDeleted ? 'tag-grid-item-deleted' : ''}`}>
                      {/* Color Picker */}
                      <div className="tag-color-picker">
                        <div
                          className={`tag-color-swatch ${isColorInvalid ? 'invalid' : ''}`}
                          style={{ background: isValidHexColor(tag.color) ? tag.color : 'var(--surface0)' }}
                          onClick={(e) => {
                            if (!isDeleted) {
                              setActiveColorPicker({
                                type: 'existing',
                                tagId: tag.id,
                                anchor: getPickerAnchor(e.currentTarget),
                              });
                            }
                          }}
                          title={isDeleted ? 'Will be deleted' : 'Click to change color'}
                        />
                      </div>

                      {/* Tag Name Input */}
                      <input
                        type="text"
                        value={tag.name}
                        onChange={(e) => handleTagChange(tag.id, 'name', e.target.value)}
                        className="tag-name-input"
                        disabled={isDeleted}
                      />

                      {/* Track Count */}
                      {(() => {
                        const originalTag = allTags?.find((t: Tag) => t.id === tag.id);
                        const count = originalTag?.track_count ?? 0;
                        return (
                          <span className="tag-track-count" title={`${count} track${count !== 1 ? 's' : ''}`}>
                            {count}
                          </span>
                        );
                      })()}

                      {/* Delete/Restore Button */}
                      <button
                        onClick={() => {
                          if (isDeleted) {
                            // Restore tag
                            setDeletedTagIds((prev) => {
                              const newSet = new Set(prev);
                              newSet.delete(tag.id);
                              return newSet;
                            });
                            setHasChanges(true);
                          } else {
                            handleDeleteExistingTag(tag.id);
                          }
                        }}
                        className={isDeleted ? 'btn-restore-small' : 'btn-delete-small'}
                        title={isDeleted ? 'Restore tag' : 'Delete tag'}
                      >
                        {isDeleted ? '↶' : '×'}
                      </button>
                    </div>
                  );
                })}

                {/* New Tags (pending creation) */}
                {newTagsByCategory[category.id]?.map((tag) => {
                  const isColorInvalid = tag.color && !isValidHexColor(tag.color);
                  return (
                    <div key={tag.tempId} className="tag-grid-item tag-grid-item-new">
                      {/* Color Picker */}
                      <div className="tag-color-picker">
                        <div
                          className={`tag-color-swatch ${isColorInvalid ? 'invalid' : ''}`}
                          style={{ background: isValidHexColor(tag.color) ? tag.color : 'var(--surface0)' }}
                          onClick={(e) => setActiveColorPicker({
                            type: 'new',
                            tempId: tag.tempId,
                            anchor: getPickerAnchor(e.currentTarget),
                          })}
                          title="Click to change color"
                        />
                      </div>

                      {/* Tag Name Input */}
                      <input
                        type="text"
                        value={tag.name}
                        onChange={(e) => handleNewTagChange(tag.tempId, 'name', e.target.value)}
                        className="tag-name-input"
                      />

                      {/* Track Count (always 0 for new tags) */}
                      <span className="tag-track-count" title="0 tracks">
                        0
                      </span>

                      {/* Delete Button */}
                      <button
                        onClick={() => handleDeleteNewTag(tag.tempId)}
                        className="btn-delete-small"
                        title="Remove new tag"
                      >
                        ×
                      </button>
                    </div>
                  );
                })}

                {(() => {
                  const draft = newTagDrafts[category.id] || { name: '', color: '#e55f85' };
                  const isDraftColorInvalid = draft.color && !isValidHexColor(draft.color);

                  return (
                    <div className="tag-grid-item tag-grid-item-draft">
                      <div className="tag-color-picker">
                        <div
                          className={`tag-color-swatch ${isDraftColorInvalid ? 'invalid' : ''}`}
                          style={{ background: isValidHexColor(draft.color) ? draft.color : 'var(--surface0)' }}
                          onClick={(e) => setActiveColorPicker({
                            type: 'draft',
                            categoryId: category.id,
                            anchor: getPickerAnchor(e.currentTarget),
                          })}
                          title="Click to change color"
                        />
                      </div>

                      <input
                        type="text"
                        value={draft.name}
                        onChange={(e) => handleDraftTagChange(category.id, 'name', e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAddNewTag(category.id);
                          }
                        }}
                        className="tag-name-input"
                        placeholder="new tag"
                      />

                      <span className="tag-track-count" title="New tag">-</span>

                      <button
                        onClick={() => handleAddAndSaveNewTag(category.id)}
                        className="btn-create-small"
                        disabled={!draft.name.trim() || batchSaveMutation.isPending}
                        title="Create tag"
                      >
                        {batchSaveMutation.isPending ? '…' : '+'}
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>

        {activeColorPicker && (
          <div
            className="color-modal-overlay"
            onClick={(e) => {
              e.stopPropagation();
              setActiveColorPicker(null);
            }}
          >
            <div
              className="color-modal"
              style={activeColorModalPosition || undefined}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="color-palette-grid">
                {COLOR_PALETTE.map((color) => (
                  <div
                    key={color.hex}
                    className="color-palette-item"
                    style={{ background: color.hex }}
                    onClick={() => setActiveColorValue(color.hex)}
                    title={color.name}
                  />
                ))}
                {NEUTRAL_COLOR_PALETTE.map((color) => (
                  <div
                    key={color.hex}
                    className="color-palette-item"
                    style={{ background: color.hex }}
                    onClick={() => setActiveColorValue(color.hex)}
                    title={color.name}
                  />
                ))}
              </div>

              <div className="color-action-row">
                <button
                  type="button"
                  className="color-randomize-btn"
                  onClick={() => setActiveColorValue(getNextColor())}
                >
                  Randomize
                </button>

                <label className="color-choose-btn">
                  Choose...
                  <input
                    type="color"
                    className="native-color-input"
                    value={getNativeColorValue(activeColor)}
                    onChange={(e) => setActiveColorValue(e.target.value)}
                    aria-label="Choose custom tag color"
                  />
                </label>
              </div>

              <div className="color-hex-input">
                <input
                  type="text"
                  value={activeColor}
                  onChange={(e) => setActiveColorValue(e.target.value)}
                  placeholder="#e55f85"
                  className="hex-input"
                  maxLength={7}
                />
                {isActiveColorInvalid && (
                  <span className="hex-error">Invalid format</span>
                )}
              </div>

              <button
                type="button"
                className="color-done-btn"
                onClick={() => setActiveColorPicker(null)}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Modal Footer with Save/Cancel */}
        <div className="modal-footer">
          <div className="modal-footer-status">
            {hasChanges && <span className="changes-indicator">Unsaved changes</span>}
          </div>
          <div className="modal-footer-actions">
            <button
              onClick={handleCancel}
              className="btn-cancel-footer"
              disabled={!hasChanges || batchSaveMutation.isPending}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="btn-save-footer"
              disabled={!hasChanges || batchSaveMutation.isPending}
            >
              {batchSaveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
