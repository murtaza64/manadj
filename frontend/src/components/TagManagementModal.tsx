import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag, TagCategory, TagCreate, TagUpdate } from '../types';
import { COLOR_PALETTE, getNextColor, isValidHexColor } from '../utils/colorUtils';
import './TagManagementModal.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function TagManagementModal({ isOpen, onClose }: Props) {
  const queryClient = useQueryClient();

  // State
  const [newTagName, setNewTagName] = useState<{ [categoryId: number]: string }>({});
  const [editingTagId, setEditingTagId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingColor, setEditingColor] = useState('');
  const [showColorPicker, setShowColorPicker] = useState<number | null>(null);

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

  // Mutations
  const createMutation = useMutation({
    mutationFn: (tag: TagCreate) => api.tags.create(tag),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setNewTagName({});
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: TagUpdate }) =>
      api.tags.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setEditingTagId(null);
      setShowColorPicker(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.tags.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    },
  });

  // Group tags by category
  const tagsByCategory: { [catId: number]: Tag[] } = {};
  allTags?.forEach((tag: Tag) => {
    if (!tagsByCategory[tag.category_id]) {
      tagsByCategory[tag.category_id] = [];
    }
    tagsByCategory[tag.category_id].push(tag);
  });

  // Handlers
  const handleCreateTag = (categoryId: number) => {
    const name = newTagName[categoryId]?.trim();
    if (!name) return;

    createMutation.mutate({
      name,
      category_id: categoryId,
      color: getNextColor(),
    });
  };

  const handleUpdateTag = (tagId: number, data: TagUpdate) => {
    updateMutation.mutate({ id: tagId, data });
  };

  const handleDeleteTag = (tagId: number) => {
    if (confirm('Delete this tag? It will be removed from all tracks.')) {
      deleteMutation.mutate(tagId);
    }
  };

  const startEditingTag = (tag: Tag) => {
    setEditingTagId(tag.id);
    setEditingName(tag.name);
    setEditingColor(tag.color || getNextColor());
  };

  const saveTagEdit = () => {
    if (!editingTagId) return;

    if (!isValidHexColor(editingColor)) {
      alert('Invalid hex color format. Use format: #cba6f7');
      return;
    }

    handleUpdateTag(editingTagId, {
      name: editingName,
      color: editingColor,
    });
  };

  const cancelEdit = () => {
    setEditingTagId(null);
    setEditingName('');
    setEditingColor('');
    setShowColorPicker(null);
  };

  if (!isOpen) return null;

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

              {/* Tag List */}
              <div className="tag-list">
                {tagsByCategory[category.id]?.map((tag: Tag) => (
                  <div key={tag.id} className="tag-item">
                    {editingTagId === tag.id ? (
                      // Edit Mode
                      <div className="tag-edit-form">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="tag-name-input"
                        />

                        {/* Color Display/Picker */}
                        <div className="tag-color-picker">
                          <div
                            className="tag-color-swatch"
                            style={{ background: editingColor }}
                            onClick={() => setShowColorPicker(
                              showColorPicker === tag.id ? null : tag.id
                            )}
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
                                      setEditingColor(color.hex);
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
                                  value={editingColor}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setEditingColor(val);
                                  }}
                                  placeholder="#cba6f7"
                                  className="hex-input"
                                  maxLength={7}
                                />
                                {editingColor && !isValidHexColor(editingColor) && (
                                  <span className="hex-error">Invalid hex format</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <button onClick={saveTagEdit} className="btn-save">
                          Save
                        </button>
                        <button onClick={cancelEdit} className="btn-cancel">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      // Display Mode
                      <>
                        <div
                          className="tag-color-swatch"
                          style={{ background: tag.color || 'var(--surface0)' }}
                        />
                        <span className="tag-name">{tag.name}</span>
                        <button
                          onClick={() => startEditingTag(tag)}
                          className="btn-edit"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteTag(tag.id)}
                          className="btn-delete"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Create New Tag */}
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
                      handleCreateTag(category.id);
                    }
                  }}
                  className="tag-name-input"
                />
                <button
                  onClick={() => handleCreateTag(category.id)}
                  className="btn-create"
                  disabled={!newTagName[category.id]?.trim()}
                >
                  Create
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
