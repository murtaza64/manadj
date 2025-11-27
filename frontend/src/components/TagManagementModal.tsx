import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag, TagCategory, TagCreate, TagUpdate } from '../types';
import { COLOR_PALETTE, getNextColor, isValidHexColor } from '../utils/colorUtils';
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

export default function TagManagementModal({ isOpen, onClose }: Props) {
  const queryClient = useQueryClient();

  // State for batch editing
  const [editedTags, setEditedTags] = useState<{ [id: number]: TagEdit }>({});
  const [newTags, setNewTags] = useState<NewTag[]>([]);
  const [deletedTagIds, setDeletedTagIds] = useState<Set<number>>(new Set());
  const [showColorPicker, setShowColorPicker] = useState<number | string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [newTagName, setNewTagName] = useState<{ [categoryId: number]: string }>({});

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
      setDeletedTagIds(new Set());
      setHasChanges(false);
    }
  }, [isOpen, allTags]);

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
      setShowColorPicker(null);
      setNewTagName({});
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

  const handleSave = () => {
    // Validate all colors (existing and new tags)
    const invalidExistingColors = Object.values(editedTags).filter(
      (tag) => tag.color && !isValidHexColor(tag.color)
    );
    const invalidNewColors = newTags.filter(
      (tag) => tag.color && !isValidHexColor(tag.color)
    );

    if (invalidExistingColors.length > 0 || invalidNewColors.length > 0) {
      alert('Some tags have invalid hex colors. Please fix them before saving.');
      return;
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
      changedTags.length > 0 || newTags.length > 0 || deletedTagIds.size > 0;

    if (!hasAnyChanges) return;

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
        return;
      }
    }

    batchSaveMutation.mutate({
      creates: newTags,
      updates: changedTags,
      deletes: Array.from(deletedTagIds),
    });
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
      setDeletedTagIds(new Set());
      setHasChanges(false);
      setShowColorPicker(null);
      setNewTagName({});
    }
  };

  const handleAddNewTag = (categoryId: number) => {
    const name = newTagName[categoryId]?.trim();
    if (!name) return;

    const newTag: NewTag = {
      tempId: `temp-${Date.now()}-${Math.random()}`,
      name,
      color: getNextColor(),
      category_id: categoryId,
    };

    setNewTags((prev) => [...prev, newTag]);
    setNewTagName({ ...newTagName, [categoryId]: '' });
    setHasChanges(true);
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage Tags</h2>
          <button onClick={onClose} className="modal-close-btn">×</button>
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
                  return (
                    <div key={tag.id} className="tag-grid-item">
                      {/* Color Picker */}
                      <div className="tag-color-picker">
                        <div
                          className={`tag-color-swatch ${isColorInvalid ? 'invalid' : ''}`}
                          style={{ background: isValidHexColor(tag.color) ? tag.color : 'var(--surface0)' }}
                          onClick={() =>
                            setShowColorPicker(showColorPicker === tag.id ? null : tag.id)
                          }
                          title="Click to change color"
                        />

                        {showColorPicker === tag.id && (
                          <div className="color-picker-dropdown">
                            {/* Palette Grid */}
                            <div className="color-palette-grid">
                              {COLOR_PALETTE.map((color) => (
                                <div
                                  key={color.hex}
                                  className="color-palette-item"
                                  style={{ background: color.hex }}
                                  onClick={() => {
                                    handleTagChange(tag.id, 'color', color.hex);
                                    setShowColorPicker(null);
                                  }}
                                  title={color.name}
                                />
                              ))}
                            </div>

                            {/* Custom Hex Input */}
                            <div className="color-hex-input">
                              <input
                                type="text"
                                value={tag.color}
                                onChange={(e) => handleTagChange(tag.id, 'color', e.target.value)}
                                placeholder="#cba6f7"
                                className="hex-input"
                                maxLength={7}
                              />
                              {isColorInvalid && (
                                <span className="hex-error">Invalid format</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Tag Name Input */}
                      <input
                        type="text"
                        value={tag.name}
                        onChange={(e) => handleTagChange(tag.id, 'name', e.target.value)}
                        className="tag-name-input"
                      />

                      {/* Delete Button */}
                      <button
                        onClick={() => handleDeleteExistingTag(tag.id)}
                        className="btn-delete-small"
                        title="Delete tag"
                      >
                        ×
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
                          onClick={() =>
                            setShowColorPicker(showColorPicker === tag.tempId ? null : tag.tempId)
                          }
                          title="Click to change color"
                        />

                        {showColorPicker === tag.tempId && (
                          <div className="color-picker-dropdown">
                            {/* Palette Grid */}
                            <div className="color-palette-grid">
                              {COLOR_PALETTE.map((color) => (
                                <div
                                  key={color.hex}
                                  className="color-palette-item"
                                  style={{ background: color.hex }}
                                  onClick={() => {
                                    handleNewTagChange(tag.tempId, 'color', color.hex);
                                    setShowColorPicker(null);
                                  }}
                                  title={color.name}
                                />
                              ))}
                            </div>

                            {/* Custom Hex Input */}
                            <div className="color-hex-input">
                              <input
                                type="text"
                                value={tag.color}
                                onChange={(e) => handleNewTagChange(tag.tempId, 'color', e.target.value)}
                                placeholder="#cba6f7"
                                className="hex-input"
                                maxLength={7}
                              />
                              {isColorInvalid && (
                                <span className="hex-error">Invalid format</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Tag Name Input */}
                      <input
                        type="text"
                        value={tag.name}
                        onChange={(e) => handleNewTagChange(tag.tempId, 'name', e.target.value)}
                        className="tag-name-input"
                      />

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
              </div>

              {/* Create New Tag Form */}
              <div className="tag-create-form">
                <input
                  type="text"
                  placeholder="New tag name..."
                  value={newTagName[category.id] || ''}
                  onChange={(e) =>
                    setNewTagName({ ...newTagName, [category.id]: e.target.value })
                  }
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddNewTag(category.id);
                    }
                  }}
                  className="tag-name-input"
                />
                <button
                  onClick={() => handleAddNewTag(category.id)}
                  className="btn-create"
                  disabled={!newTagName[category.id]?.trim()}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>

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
