import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { LibraryImportRequest } from '../types';

export function LibraryImport() {
  const [recursive, setRecursive] = useState(false);
  const queryClient = useQueryClient();

  // Fetch candidates with auto-refresh
  const { data: result, isLoading, error } = useQuery({
    queryKey: ['libraryImport', recursive],
    queryFn: () => api.libraryImport.getCandidates(recursive),
    refetchInterval: 30000, // Refresh every 30s
  });

  // Import mutation
  const importMutation = useMutation({
    mutationFn: (request: LibraryImportRequest) => api.libraryImport.import(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryImport'] });
      queryClient.invalidateQueries({ queryKey: ['tracks'] });
    },
  });

  const handleImport = () => {
    if (!result?.candidates.length) return;

    // Import all candidates
    importMutation.mutate({});
  };

  if (isLoading) {
    return <div style={{ padding: '20px' }}>Loading library scan...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: '20px', color: 'var(--red)' }}>
        Error: {error instanceof Error ? error.message : 'Failed to scan library'}
      </div>
    );
  }

  const stats = result?.stats;
  const candidates = result?.candidates || [];
  const importableCandidates = candidates.filter(c => c.has_metadata);

  return (
    <div style={{ padding: '20px' }}>
      {/* Statistics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
        marginBottom: '20px',
      }}>
        <div style={{
          background: 'var(--surface0)',
          padding: '12px',
        }}>
          <div style={{ color: 'var(--subtext1)', fontSize: '12px' }}>Files Scanned</div>
          <div style={{ color: 'var(--text)', fontSize: '24px', fontWeight: 'bold' }}>
            {stats?.files_scanned || 0}
          </div>
        </div>
        <div style={{
          background: 'var(--surface0)',
          padding: '12px',
        }}>
          <div style={{ color: 'var(--subtext1)', fontSize: '12px' }}>Already in DB</div>
          <div style={{ color: 'var(--text)', fontSize: '24px', fontWeight: 'bold' }}>
            {stats?.already_in_db || 0}
          </div>
        </div>
        <div style={{
          background: 'var(--surface0)',
          padding: '12px',
        }}>
          <div style={{ color: 'var(--subtext1)', fontSize: '12px' }}>New Tracks</div>
          <div style={{ color: 'var(--text)', fontSize: '24px', fontWeight: 'bold' }}>
            {stats?.new_tracks || 0}
          </div>
        </div>
        <div style={{
          background: 'var(--surface0)',
          padding: '12px',
        }}>
          <div style={{ color: 'var(--subtext1)', fontSize: '12px' }}>With Metadata</div>
          <div style={{ color: 'var(--green)', fontSize: '24px', fontWeight: 'bold' }}>
            {stats?.with_metadata || 0}
          </div>
        </div>
        <div style={{
          background: 'var(--surface0)',
          padding: '12px',
        }}>
          <div style={{ color: 'var(--subtext1)', fontSize: '12px' }}>Without Metadata</div>
          <div style={{ color: 'var(--yellow)', fontSize: '24px', fontWeight: 'bold' }}>
            {stats?.without_metadata || 0}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
          />
          <span style={{ color: 'var(--text)' }}>Scan subdirectories</span>
        </label>

        <button
          onClick={handleImport}
          disabled={importableCandidates.length === 0 || importMutation.isPending}
          style={{
            padding: '8px 16px',
            background: importableCandidates.length > 0 ? 'var(--green)' : 'var(--surface0)',
            color: importableCandidates.length > 0 ? 'var(--base)' : 'var(--subtext1)',
            border: 'none',
            cursor: importableCandidates.length > 0 ? 'pointer' : 'not-allowed',
            fontWeight: 'bold',
          }}
        >
          {importMutation.isPending ? 'Importing...' : `Import ${importableCandidates.length} Tracks`}
        </button>
      </div>

      {/* Import result */}
      {importMutation.isSuccess && (
        <div style={{
          padding: '12px',
          background: 'var(--surface0)',
          color: 'var(--green)',
          marginBottom: '20px',
        }}>
          ✓ Successfully imported {importMutation.data.imported} tracks
          {importMutation.data.skipped_no_metadata > 0 && (
            <span style={{ color: 'var(--yellow)' }}>
              {' '}(skipped {importMutation.data.skipped_no_metadata} without metadata)
            </span>
          )}
          {importMutation.data.errors > 0 && (
            <span style={{ color: 'var(--red)' }}>
              {' '}({importMutation.data.errors} errors)
            </span>
          )}
        </div>
      )}

      {/* Candidate list */}
      <div style={{
        background: 'var(--surface0)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px',
          background: 'var(--surface1)',
          fontWeight: 'bold',
          color: 'var(--text)',
        }}>
          Import Candidates ({candidates.length})
        </div>
        <div style={{ maxHeight: '400px', overflow: 'auto' }}>
          {candidates.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--subtext1)' }}>
              No new tracks found in library
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface1)' }}>
                  <th style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    color: 'var(--subtext1)',
                    fontWeight: '500',
                    fontSize: '12px',
                    borderBottom: '1px solid var(--surface2)'
                  }}>Filename</th>
                  <th style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    color: 'var(--subtext1)',
                    fontWeight: '500',
                    fontSize: '12px',
                    borderBottom: '1px solid var(--surface2)'
                  }}>Title</th>
                  <th style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    color: 'var(--subtext1)',
                    fontWeight: '500',
                    fontSize: '12px',
                    borderBottom: '1px solid var(--surface2)'
                  }}>Artist</th>
                  <th style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    color: 'var(--subtext1)',
                    fontWeight: '500',
                    fontSize: '12px',
                    borderBottom: '1px solid var(--surface2)',
                    width: '80px'
                  }}>BPM</th>
                  <th style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    color: 'var(--subtext1)',
                    fontWeight: '500',
                    fontSize: '12px',
                    borderBottom: '1px solid var(--surface2)',
                    width: '80px'
                  }}>Key</th>
                  <th style={{
                    padding: '8px 12px',
                    textAlign: 'center',
                    color: 'var(--subtext1)',
                    fontWeight: '500',
                    fontSize: '12px',
                    borderBottom: '1px solid var(--surface2)',
                    width: '100px'
                  }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr
                    key={candidate.filepath}
                    style={{
                      borderBottom: '1px solid var(--surface1)',
                    }}
                  >
                    <td style={{
                      padding: '8px 12px',
                      color: 'var(--subtext1)',
                      fontSize: '12px',
                      fontFamily: 'monospace'
                    }}>{candidate.filename}</td>
                    <td style={{
                      padding: '8px 12px',
                      color: 'var(--text)',
                      fontWeight: '500'
                    }}>{candidate.title || '-'}</td>
                    <td style={{
                      padding: '8px 12px',
                      color: 'var(--text)'
                    }}>{candidate.artist || '-'}</td>
                    <td style={{
                      padding: '8px 12px',
                      color: 'var(--text)'
                    }}>{candidate.bpm || '-'}</td>
                    <td style={{
                      padding: '8px 12px',
                      color: 'var(--text)'
                    }}>{candidate.key || '-'}</td>
                    <td style={{
                      padding: '8px 12px',
                      textAlign: 'center'
                    }}>
                      {candidate.has_metadata ? (
                        <span style={{
                          padding: '4px 8px',
                          background: 'var(--green)',
                          color: 'var(--base)',
                          fontSize: '12px',
                        }}>
                          Ready
                        </span>
                      ) : (
                        <span style={{
                          padding: '4px 8px',
                          background: 'var(--yellow)',
                          color: 'var(--base)',
                          fontSize: '12px',
                        }}>
                          No Metadata
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
