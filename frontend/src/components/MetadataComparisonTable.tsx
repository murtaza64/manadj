import React from 'react';
import type { MetadataComparison } from '../types';

interface Props {
  comparisons: MetadataComparison[];
  selectedTracks: Set<number>;
  selectedFields: Set<string>;
  onToggleTrack: (trackId: number) => void;
  onToggleAll: () => void;
}

export const MetadataComparisonTable: React.FC<Props> = ({
  comparisons,
  selectedTracks,
  selectedFields,
  onToggleTrack,
  onToggleAll,
}) => {
  const allSelected = comparisons.length > 0 && comparisons.every(c => selectedTracks.has(c.track_id));
  const someSelected = comparisons.some(c => selectedTracks.has(c.track_id));

  const getConflictClass = (conflictType: string): string => {
    switch (conflictType) {
      case 'conflict': return 'conflict-both';
      case 'only_in_file': return 'conflict-file';
      case 'only_in_db': return 'conflict-db';
      default: return '';
    }
  };

  const shouldShowDifference = (field: string): boolean => {
    return selectedFields.has(field);
  };

  return (
    <div className="metadata-comparison-table">
      <table>
        <thead>
          <tr>
            <th className="checkbox-col">
              <input
                type="checkbox"
                checked={allSelected}
                ref={input => {
                  if (input) input.indeterminate = someSelected && !allSelected;
                }}
                onChange={onToggleAll}
              />
            </th>
            <th>Filename</th>
            <th>Field</th>
            <th>Current (DB)</th>
            <th>File (ID3)</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {comparisons.map(comparison => {
            const visibleDifferences = comparison.differences.filter(shouldShowDifference);

            if (visibleDifferences.length === 0) {
              return null;
            }

            return visibleDifferences.map((field, idx) => (
              <tr key={`${comparison.track_id}-${field}`} className={getConflictClass(comparison.conflict_type)}>
                {idx === 0 && (
                  <>
                    <td className="checkbox-col" rowSpan={visibleDifferences.length}>
                      <input
                        type="checkbox"
                        checked={selectedTracks.has(comparison.track_id)}
                        onChange={() => onToggleTrack(comparison.track_id)}
                      />
                    </td>
                    <td rowSpan={visibleDifferences.length} className="filename-col">
                      {comparison.filename}
                    </td>
                  </>
                )}
                <td className="field-col">{field}</td>
                <td className="value-col">
                  {String(comparison.current[field as keyof typeof comparison.current] ?? '')}
                </td>
                <td className="value-col">
                  {String(comparison.file[field as keyof typeof comparison.file] ?? '')}
                </td>
                {idx === 0 && (
                  <td rowSpan={visibleDifferences.length} className="status-col">
                    {comparison.conflict_type === 'conflict' && 'Both have values'}
                    {comparison.conflict_type === 'only_in_file' && 'Only in file'}
                    {comparison.conflict_type === 'only_in_db' && 'Only in DB'}
                  </td>
                )}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
};
