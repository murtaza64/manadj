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
  | { kind: 'error'; message: string; current: string };

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
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const load = useCallback(() => {
    const gen = ++generation.current;
    void (async (): Promise<Step> => {
      try {
        const status = await tracksDirectoryApi.status();
        if (status.state === 'pending' || status.state === 'running') {
          return { kind: 'running', progress: status.progress };
        }
        const config = await api.appConfig.get();
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
  useEffect(load, [load]);

  const running = step.kind === 'running';
  useEffect(() => {
    if (!running) return;
    const gen = generation.current;
    let ticks = 0;
    const id = window.setInterval(async () => {
      try {
        const status = await tracksDirectoryApi.status();
        if (gen !== generation.current) return;
        ticks += 1;
        if (ticks % 5 === 0) void queryClient.invalidateQueries({ queryKey: ['tracks'] });
        if (status.state === 'done' && status.summary) {
          void queryClient.invalidateQueries({ queryKey: ['tracks'] });
          setStep({ kind: 'summary', summary: status.summary });
        } else if (status.state === 'failed') {
          setStep({ kind: 'error', message: status.error || 'Scan failed', current: draft });
        } else {
          setStep({ kind: 'running', progress: status.progress });
        }
      } catch (e) {
        if (gen === generation.current) setStep({ kind: 'error', message: message(e), current: draft });
      }
    }, pollMs);
    return () => window.clearInterval(id);
  }, [running, pollMs, draft]);

  const current = step.kind === 'choose' || step.kind === 'error' ? step.current : '';
  const save = async (path: string): Promise<boolean> => {
    setSaving(true);
    try {
      const config = await api.appConfig.update({ tracks_directory: path });
      queryClient.setQueryData(APP_CONFIG_QUERY_KEY, config);
      setDraft(config.tracks_directory ?? '');
      setStep({ kind: 'choose', current: config.tracks_directory ?? '' });
      return true;
    } catch (e) {
      setStep({ kind: 'error', message: message(e), current });
      return false;
    } finally {
      setSaving(false);
    }
  };
  const pick = async () => {
    const picked = await window.manadjSettings?.pickFolder({
      title: 'Choose your tracks folder',
      defaultPath: draft || undefined,
    });
    if (picked) await save(picked);
  };
  const scan = async () => {
    // Commit an edited path first, so the Scan reads what the user sees.
    if (draft.trim() !== current && !(await save(draft.trim()))) return;
    const gen = ++generation.current;
    try {
      await tracksDirectoryApi.startScan();
      if (gen === generation.current) setStep({ kind: 'running', progress: null });
    } catch (e) {
      if (gen === generation.current) setStep({ kind: 'error', message: message(e), current: draft });
    }
  };

  const skipButton = onSkip ? (
    <button className="btn" onClick={onSkip}>
      Skip
    </button>
  ) : null;
  const dirty = draft.trim() !== current;

  return (
    <div className="onboarding-guide" data-testid="tracks-directory-guide">
      <h2 className="onboarding-title">Add a tracks directory</h2>

      {step.kind === 'loading' && <p className="onboarding-muted">Loading…</p>}

      {(step.kind === 'choose' || step.kind === 'error') && (
        <>
          <p className="onboarding-muted">
            One folder for your music: manadj scans it (subfolders included) and downloads new tracks
            into it. Files stay where they are.
          </p>
          <div className="onboarding-path">
            <input
              type="text"
              aria-label="Tracks directory"
              value={draft}
              placeholder="/Users/you/Music/Tracks"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
            />
            {window.manadjSettings ? (
              <button className="btn" onClick={() => void pick()} disabled={saving}>
                Choose…
              </button>
            ) : null}
          </div>
          {step.kind === 'error' && <p className="onboarding-error">{step.message}</p>}
          <div className="onboarding-actions">
            {dirty && (
              <button className="btn" onClick={() => void save(draft.trim())} disabled={saving}>
                Save
              </button>
            )}
            <button className="btn btn-primary" onClick={() => void scan()} disabled={saving || !draft.trim()}>
              Scan now
            </button>
            {current && !dirty && (
              <button className="btn" onClick={onDone}>
                Save without scanning
              </button>
            )}
            {skipButton}
          </div>
        </>
      )}

      {step.kind === 'running' && (
        <>
          <ScanProgress progress={step.progress} />
          <p className="onboarding-muted">You can keep using manadj while this runs.</p>
          {onSkip && (
            <div className="onboarding-actions">
              <button className="btn" onClick={onDone}>
                Continue in background
              </button>
            </div>
          )}
        </>
      )}

      {step.kind === 'summary' && (
        <>
          <div className="onboarding-summary" data-testid="scan-summary">
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
                  <th>Already in manadj</th>
                  <td>{n(step.summary.already_in_library)}</td>
                </tr>
              </tbody>
            </table>
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
            <button className="btn btn-primary" onClick={onDone}>
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ScanProgress({ progress }: { progress: ImportProgress | null }) {
  const phases: [string, string][] = [
    ['scanning', 'Reading files'],
    ['importing', 'Adding to Library'],
  ];
  const current = progress ? phases.findIndex(([id]) => id === progress.phase) : 0;
  return (
    <ol className="onboarding-phases" data-testid="scan-progress">
      {phases.map(([id, label], i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        const pct =
          state === 'done' ? 100 : state === 'active' && progress && progress.total > 0
            ? Math.round((100 * progress.done) / progress.total)
            : 0;
        return (
          <li key={id} className={`onboarding-phase ${state}`}>
            <span className="onboarding-phase-label">{label}</span>
            <span className="onboarding-bar">
              <span className="onboarding-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            {state === 'active' && progress && progress.total > 0 && (
              <span className="onboarding-phase-count">
                {n(progress.done)} / {n(progress.total)}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
