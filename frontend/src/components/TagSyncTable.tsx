import { Fragment } from 'react';
import type { UnifiedTagView } from '../types';
import { TagSyncRow } from './TagSyncRow';
import './TagSyncTable.css';

interface TagSyncTableProps {
  tagsByCategory: Record<string, UnifiedTagView[]>;
  expandedCategories: Set<string>;
  onToggleCategory: (category: string) => void;
}

export function TagSyncTable({
  tagsByCategory,
  expandedCategories,
  onToggleCategory
}: TagSyncTableProps) {
  return (
    <div className="tag-sync-table-container">
      <table className="tag-sync-table">
        <thead>
          <tr className="tag-sync-header-row">
            <th>Tag (manadj)</th>
            <th>Engine DJ</th>
            <th>Rekordbox</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(tagsByCategory).map(([category, tags]) => (
            <Fragment key={category}>
              <tr
                className="tag-sync-category-row"
                onClick={() => onToggleCategory(category)}
              >
                <td colSpan={3}>
                  <span className="category-expand-icon">
                    {expandedCategories.has(category) ? '▼' : '▶'}
                  </span>
                  <span className="category-name">{category}</span>
                  <span className="category-count">({tags.length})</span>
                </td>
              </tr>
              {expandedCategories.has(category) && tags.map(tag => (
                <TagSyncRow key={`${tag.category_name}-${tag.tag_name}`} tag={tag} />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
