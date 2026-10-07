/** Tracks directory guide (#276, setup-guides PRD): pick one folder — the
 * Scan root (subfolders included) and the Acquisition download
 * destination — saved to the settings file (/api/config, #277), then offer
 * an immediate Scan that Disk Imports every new audio file in place, as a
 * task with progress. Guide-shaped: {onDone, onSkip}. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { queryClient } from '../api/queryClient';
import { APP_CONFIG_QUERY_KEY } from '../settings/useAppConfig';
import { tracksDirectoryApi, type ImportProgress, type TracksDirectorySummary } from './api';
import './onboarding.css';

export interface TracksDirectoryGuideProps {
  onDone: () => void;
  onSkip?: () => void;
  pollMs?: number;
}

type Step =
  | { kind: 'loading' }
  | { kind: 'choose'; current: string }
  | { kind: 'running'; progress: ImportProgress | null }
  | { kind: 'summary'; summary: TracksDirectorySummary }
  | { kind: 'error'; message: string; current: string; connection?: boolean };

function n(value: number): string {
  return value.toLocaleString();
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function TracksDirectoryGuide({ onDone, onSkip, pollMs = 1000 }: TracksDirectoryGuideProps) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const load = useCallback((recover = false) => {
    const gen = ++generation.current;
    void (async (): Promise<Step> => {
      try {
        const status = await tracksDirectoryApi.status();
        if (status.state === 'pending' || status.state === 'running') {
          return { kind: 'running', progress: status.progress };
        }
        if (recover && status.state === 'done' && status.summary) {
          return { kind: 'summary', summary: status.summary };
        }
        const config = await api.appConfig.get();
        if (recover && status.state === 'failed') {
          return { kind: 'error', message: status.error || 'Scan failed', current: config.tracks_directory ?? '' };
        }
        return { kind: 'choose', current: config.tracks_directory ?? '' };
      } catch (e) {
        return { kind: 'error', message: message(e), current: '' };
      }
    })().then((next) => {
      if (gen !== generation.current) return;
      if (next.kind === 'choose') setDraft(next.current);
      setStep(next);
    });
  }, []);
  useEffect(() => load(), [load]);

  const running = step.kind === 'running';
  useEffect(() => {
    if (!running) return;
    const gen = generation.current;
    let ticks = 0;
    let disposed = false;
    let polling = false;
    const id = window.setInterval(async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const status = await tracksDirectoryApi.status();
        if (disposed || gen !== generation.current) return;
        ticks += 1;
        if (ticks % 5 === 0) void queryClient.invalidateQueries({ queryKey: ['tracks'] });
        if (status.state === 'done' && status.summary) {
          disposed = true;
          void queryClient.invalidateQueries({ queryKey: ['tracks'] });
          setStep({ kind: 'summary', summary: status.summary });
        } else if (status.state === 'failed') {
          disposed = true;
          setStep({ kind: 'error', message: status.error || 'Scan failed', current: draft });
        } else {
          setStep({ kind: 'running', progress: status.progress });
        }
      } catch (e) {
        if (!disposed && gen === generation.current) {
          disposed = true;
          setStep({ kind: 'error', message: message(e), current: draft, connection: true });
        }
      } finally {
        polling = false;
      }
    }, pollMs);
    return () => { disposed = true; window.clearInterval(id); };
  }, [running, pollMs, draft]);

  const current = step.kind === 'choose' || step.kind === 'error' ? step.current : '';
  const save = async (path: string): Promise<boolean> => {
    const gen = generation.current;
    try {
      const config = await api.appConfig.update({ tracks_directory: path });
      if (gen !== generation.current) return false;
      queryClient.setQueryData(APP_CONFIG_QUERY_KEY, config);
      setDraft(config.tracks_directory ?? '');
      setStep({ kind: 'choose', current: config.tracks_directory ?? '' });
      return true;
    } catch (e) {
      if (gen === generation.current) setStep({ kind: 'error', message: message(e), current });
      return false;
    }
  };
  const pick = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    const gen = generation.current;
    try {
      const picked = await window.manadjSettings?.pickFolder({
        title: 'Choose your music folder', defaultPath: draft || undefined,
      });
      if (picked && gen === generation.current) setDraft(picked);
    } catch (e) {
      if (gen === generation.current) setStep({ kind: 'error', message: message(e), current });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const commit = async (scan: boolean) => {
    if (busy.current || !draft.trim()) return;
    busy.current = true;
    setSaving(true);
    const gen = generation.current;
    try {
      if (draft.trim() !== current && !(await save(draft.trim()))) return;
      if (gen !== generation.current) return;
      if (!scan) { onDone(); return; }
      await tracksDirectoryApi.startScan();
      if (gen === generation.current) setStep({ kind: 'running', progress: null });
    } catch (e) {
      if (gen === generation.current) setStep({ kind: 'error', message: message(e), current: draft });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const skipButton = onSkip ? (
    <button className="btn btn-secondary" onClick={onSkip} disabled={saving}>
      Skip for now
    </button>
  ) : null;

  return (
    <div className="onboarding-guide" data-testid="tracks-directory-guide">
      <h2 className="onboarding-title">{step.kind === 'summary' ? 'Your folder has been scanned.' : 'Give your music a home'}</h2>

      {step.kind === 'loading' && <p className="onboarding-loading" role="status">Checking your music folder…</p>}

      {(step.kind === 'choose' || step.kind === 'error') && (
        <>
          <p className="onboarding-muted">
            Choose the folder where you keep your tracks. A Scan adds audio files from this folder and
            all its subfolders to your Library, without moving them.
          </p>
          <p className="onboarding-muted">Already imported from Rekordbox? This is optional. Tracks already in your Library won’t be added twice.</p>
          <label htmlFor="setup-tracks-folder">Music folder <span className="onboarding-muted">(tracks directory)</span></label>
          <div className="onboarding-path">
            <input
              type="text"
              id="setup-tracks-folder"
              aria-label="Tracks directory"
              value={draft}
              placeholder="Full path to your music folder"
              disabled={saving}
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
            {window.manadjSettings ? (
              <button className="btn" onClick={() => void pick()} disabled={saving}>
                Choose folder…
              </button>
            ) : null}
          </div>
          {!window.manadjSettings && <p className="onboarding-muted">In the browser, paste a folder path. The desktop app has a folder picker.</p>}
          <p className="onboarding-muted">New downloads will also be saved here if you connect an account later.</p>
          {step.kind === 'error' && <div className="onboarding-notice onboarding-error" role="alert">
            <strong>{step.connection ? 'We lost touch with the Scan.' : 'We couldn’t use this folder.'}</strong>
            <p>{step.connection ? 'The Scan may still be running. Check progress before starting another.' : 'Check that the folder exists and its drive is connected. Any tracks already added are kept.'}</p>
            <details><summary>Technical details</summary><p>{step.message}</p></details>
          </div>}
          <div className="onboarding-actions">
            {skipButton}
            {step.kind === 'error' && step.connection ? <button className="btn btn-primary" onClick={() => load(true)}>Check progress</button> : <>
              {draft.trim() && <button className="btn btn-secondary" onClick={() => void commit(false)} disabled={saving}>Use folder without scanning</button>}
              <button className="btn btn-primary" onClick={() => void commit(true)} disabled={saving || !draft.trim()}>
                {saving ? 'Preparing Scan…' : 'Save & scan folder'}
              </button>
            </>}
          </div>
        </>
      )}

      {step.kind === 'running' && (
        <>
          <ScanProgress progress={step.progress} />
          <p className="onboarding-muted">Keep manaDJ open. You can continue setup while the Scan runs.</p>
          {onSkip && (
            <div className="onboarding-actions">
              <button className="btn" onClick={onDone}>
                Continue setup while scanning
              </button>
            </div>
          )}
        </>
      )}

      {step.kind === 'summary' && (
        <>
          <div className="onboarding-summary" data-testid="scan-summary">
            <div className="onboarding-stats">
              <div><strong>{n(step.summary.imported)}</strong><span>tracks added</span></div>
              <div><strong>{n(step.summary.already_in_library)}</strong><span>already in your Library</span></div>
            </div>
            {step.summary.files_scanned === 0 && <p className="onboarding-notice">No audio files were found. Choose a different folder, or add music here and Scan again later.</p>}
            <p className="onboarding-source">Folder: <code>{step.summary.directory}</code></p>
            <details className="onboarding-details"><summary>Scan details</summary>
            <table>
              <tbody>
                <tr>
                  <th>Audio files found</th>
                  <td>{n(step.summary.files_scanned)}</td>
                </tr>
                <tr>
                  <th>Imported</th>
                  <td>{n(step.summary.imported)}</td>
                </tr>
                <tr>
                  <th>Already in manaDJ</th>
                  <td>{n(step.summary.already_in_library)}</td>
                </tr>
              </tbody>
            </table>
            </details>
            {step.summary.errors > 0 && (
              <div className="onboarding-skipped">
                <div className="onboarding-subhead">Couldn’t import {n(step.summary.errors)}</div>
                {step.summary.error_messages.map((m) => (
                  <div key={m}>{m}</div>
                ))}
              </div>
            )}
          </div>
          <div className="onboarding-actions">
            <button className="btn btn-secondary" onClick={() => load()}>Choose another folder</button>
            <button className="btn btn-primary" onClick={onDone}>
              Continue
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ScanProgress({ progress }: { progress: ImportProgress | null }) {
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round(100 * progress.done / progress.total)) : undefined;
  return (
    <div className="onboarding-progress" data-testid="scan-progress">
      <p className="onboarding-progress-title" role="status">{!progress ? 'Your Scan is queued' : progress.phase === 'importing' ? 'Adding tracks to your Library' : 'Looking through your music folder'}</p>
      <div className="onboarding-bar" role="progressbar" aria-label="Folder Scan" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className="onboarding-bar-fill" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="onboarding-muted">{progress && progress.total > 0 ? `${n(progress.done)} / ${n(progress.total)} files` : 'This may wait while other Library tasks finish. There’s no need to start it again.'}</p>
    </div>
  );
}
