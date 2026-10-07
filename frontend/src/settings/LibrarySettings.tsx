import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAppConfig, useUpdateAppConfig } from './useAppConfig';

/** Settings → Library (packaged-app #277): edits the settings file
 * (config.toml in the data root) through /api/config. Hand edits are
 * equivalent — the backend round-trips the TOML. */

function PathField({
  label,
  note,
  value,
  placeholder,
  pickerTitle,
  onCommit,
}: {
  label: string;
  note: string;
  value: string;
  placeholder?: string;
  pickerTitle: string;
  onCommit: (path: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onCommit(next);
  };
  const pick = async () => {
    const picked = await window.manadjSettings?.pickFolder({
      title: pickerTitle,
      defaultPath: value || undefined,
    });
    if (picked) {
      setDraft(picked);
      onCommit(picked);
    }
  };
  return (
    <div className="settings-field">
      <div>
        <span className="settings-field-label">{label}</span>
        <p>{note}</p>
      </div>
      <div className="settings-library-inputs">
        <input
          type="text"
          aria-label={label}
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {window.manadjSettings ? (
          <button className="btn btn-secondary" onClick={pick}>
            Choose…
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function LibrarySettings() {
  const { data: config, isLoading, isError } = useAppConfig();
  const update = useUpdateAppConfig();
  const [revealed, setRevealed] = useState(false);

  if (isLoading) return <p role="status">Loading library settings...</p>;
  if (isError || !config) return <p role="alert">Could not load library settings.</p>;

  const reveal = async () => {
    await api.appConfig.reveal();
    setRevealed(true);
  };

  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Library</h2>
          <p>Where your music lives and which DJ software manaDJ talks to.</p>
        </div>
        <div className="settings-library-actions">
          <button className="btn btn-secondary" onClick={reveal}>
            Reveal settings file
          </button>
          <button className="btn btn-secondary" onClick={() => api.appConfig.revealLogs()}>
            Reveal logs
          </button>
        </div>
      </div>
      <div className="settings-fields">
        <PathField
          label="Tracks directory"
          note="Folder manaDJ imports tracks from (and downloads into)."
          value={config.tracks_directory ?? ''}
          placeholder="Not set"
          pickerTitle="Choose your tracks folder"
          onCommit={(path) => update.mutate({ tracks_directory: path })}
        />
        <PathField
          label="Rekordbox location"
          note={
            config.rekordbox_autodetected
              ? 'Auto-detected. Set a path to override; clear it to auto-detect again.'
              : 'Rekordbox database folder. Leave empty to auto-detect.'
          }
          value={config.rekordbox_autodetected ? '' : (config.rekordbox_path ?? '')}
          placeholder={
            config.rekordbox_detected_path
              ? `${config.rekordbox_detected_path} (auto-detected)`
              : 'Not found — set a path if Rekordbox is installed'
          }
          pickerTitle="Choose your Rekordbox database folder"
          onCommit={(path) => update.mutate({ rekordbox_path: path })}
        />
        <PathField
          label="Engine DJ location"
          note="Engine DJ Database2 folder. Leave empty if you don't use Engine DJ."
          value={config.engine_dj_path ?? ''}
          placeholder="Not set"
          pickerTitle="Choose your Engine DJ Database2 folder"
          onCommit={(path) => update.mutate({ engine_dj_path: path })}
        />
        <div className="settings-field">
          <div>
            <span className="settings-field-label">Export to Rekordbox / Engine DJ</span>
            <p>
              Allow manaDJ to write into your Rekordbox and Engine DJ libraries
              (tracks, playlists, cues, grids, tags). Importing from them is
              always available. Off by default — manaDJ never touches your
              other libraries until you opt in.
            </p>
          </div>
          <div className="settings-library-inputs">
            <label className="settings-library-toggle">
              <input
                type="checkbox"
                aria-label="Export enabled"
                checked={config.export_enabled}
                onChange={(e) => update.mutate({ export_enabled: e.target.checked })}
              />
              <span>{config.export_enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>
        </div>
      </div>
      <p className="settings-hint">
        Stored in <code>{config.settings_file}</code>
        {revealed ? ' (revealed in Finder)' : ''}. Editing that file by hand is
        equivalent to editing here.
      </p>
      {update.isError ? (
        <p role="alert" className="settings-hint">
          Could not save: {update.error instanceof Error ? update.error.message : 'unknown error'}
        </p>
      ) : null}
    </>
  );
}
