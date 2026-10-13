/** Rekordbox import wizard (#275): detect → preview counts → options →
 * run with progress → summary. Guide-shaped (setup-guides PRD): works
 * inside the First-run sequence and standalone (SYNC view). The import
 * runs as a backend task, so the app stays usable — `onBackground` lets
 * the host get out of the way while it runs. Reads a Rekordbox snapshot
 * only; nothing is written to Rekordbox. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { queryClient } from '../api/queryClient';
import { guideStatus, setGuideStatus, setupJourney } from '../setup/guides';
import {
  onboardingApi,
  type ImportProgress,
  type RekordboxImportSummary,
  type RekordboxPreview,
} from './api';
import './onboarding.css';

export interface GuideProps {
  onDone: () => void;
  /** Absent when standalone: no Skip affordance. */
  onSkip?: () => void;
  /** Host can hide itself while the import task runs (defaults to onDone
   * when hosted with a Skip affordance). */
  onBackground?: () => void;
  /** Poll interval for import status (tests shorten it). */
  pollMs?: number;
}

type Step =
  | { kind: 'detecting' }
  | { kind: 'not-found' }
  | { kind: 'previewing'; libraryDir: string }
  | { kind: 'options'; preview: RekordboxPreview }
  | { kind: 'starting' }
  | { kind: 'running'; progress: ImportProgress | null }
  | { kind: 'summary'; summary: RekordboxImportSummary }
  | { kind: 'error'; message: string; connection?: boolean };

const PHASE_LABELS: Record<string, string> = {
  tracks: 'Adding tracks',
  performance: 'Bringing in cues, beatgrids and keys',
  tags: 'Adding your MyTags',
  genre: 'Adding genre Tags',
  playlists: 'Building your playlists',
  finalize: 'Preparing waveforms',
};
const PHASES = Object.keys(PHASE_LABELS);

/** detect → (in-flight import? watch it) → preview. `onIntermediate`
 * reports the previewing step while the snapshot is read. */
async function resolveInitialStep(onIntermediate: (step: Step) => void): Promise<Step> {
  try {
    // An import already in flight (re-opened wizard): resume watching it.
    const status = await onboardingApi.status();
    if (status.state === 'pending' || status.state === 'running') {
      return { kind: 'running', progress: status.progress };
    }
    const journey = setupJourney();
    const awaitingAcknowledgement = journey?.ids[journey.index] === 'rekordbox-import';
    if (status.state === 'done' && status.summary && (awaitingAcknowledgement || guideStatus('rekordbox-import') !== 'done')) {
      return { kind: 'summary', summary: status.summary };
    }
    const found = await onboardingApi.detect();
    if (!found.found || !found.library_dir) return { kind: 'not-found' };
    onIntermediate({ kind: 'previewing', libraryDir: found.library_dir });
    return { kind: 'options', preview: await onboardingApi.preview() };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

function n(value: number): string {
  return value.toLocaleString();
}

export function RekordboxImportGuide({ onDone, onSkip, onBackground, pollMs = 1000 }: GuideProps) {
  const [step, setStep] = useState<Step>({ kind: 'detecting' });
  const [includeGenre, setIncludeGenre] = useState(true);
  // Generation token: only the latest async flow may set the step — a
  // stale detect (StrictMode double-run, a retry) resolving after the user
  // started the import must not drag the wizard back to the options step.
  const generation = useRef(0);
  const starting = useRef(false);
  useEffect(
    () => () => {
      generation.current += 1; // unmount: drop every in-flight result
    },
    [],
  );

  const fail = (gen: number, e: unknown) => {
    if (gen === generation.current) {
      setStep({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  // Detection is a pure async step resolver; results land via callbacks.
  const runDetect = useCallback(() => {
    const gen = ++generation.current;
    void resolveInitialStep((intermediate) => {
      if (gen === generation.current) setStep(intermediate);
    }).then((next) => {
      if (gen === generation.current) setStep(next);
    });
  }, []);

  useEffect(runDetect, [runDetect]);
  useEffect(() => {
    if (step.kind === 'summary') setGuideStatus('rekordbox-import', 'done');
  }, [step.kind]);
  const retry = () => {
    setStep({ kind: 'detecting' });
    runDetect();
  };

  // Poll the task while running; refresh the Library as tracks land.
  const running = step.kind === 'running';
  useEffect(() => {
    if (!running) return;
    let ticks = 0;
    const gen = generation.current;
    let disposed = false;
    let polling = false;
    const id = window.setInterval(async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const status = await onboardingApi.status();
        if (disposed || gen !== generation.current) return;
        ticks += 1;
        if (ticks % 5 === 0) void queryClient.invalidateQueries({ queryKey: ['tracks'] });
        if (status.state === 'done' && status.summary) {
          disposed = true;
          void queryClient.invalidateQueries();
          setStep({ kind: 'summary', summary: status.summary });
        } else if (status.state === 'failed') {
          disposed = true;
          setStep({ kind: 'error', message: status.error || 'Import failed' });
        } else {
          setStep({ kind: 'running', progress: status.progress });
        }
      } catch (e) {
        if (!disposed && gen === generation.current) {
          disposed = true;
          setStep({ kind: 'error', connection: true, message: e instanceof Error ? e.message : String(e) });
        }
      } finally {
        polling = false;
      }
    }, pollMs);
    return () => { disposed = true; window.clearInterval(id); };
  }, [running, pollMs]);

  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    const gen = ++generation.current;
    setStep({ kind: 'starting' });
    try {
      await onboardingApi.startImport(includeGenre);
      if (gen === generation.current) setStep({ kind: 'running', progress: null });
    } catch (e) {
      fail(gen, e);
    } finally {
      starting.current = false;
    }
  };

  const skipButton = onSkip ? (
    <button className="btn btn-secondary" onClick={onSkip}>
      Skip for now
    </button>
  ) : null;

  return (
    <div className="onboarding-guide" data-testid="rekordbox-import-guide">
      <h2 className="onboarding-title">{step.kind === 'summary' ? 'Your music is in.' : 'Bring your Rekordbox library'}</h2>

      {step.kind === 'detecting' && <p className="onboarding-loading" role="status">Looking for Rekordbox on this computer…</p>}

      {step.kind === 'not-found' && (
        <>
          <div className="onboarding-notice">
            <strong>No Rekordbox library was found on this computer.</strong>
            <p>Don’t use Rekordbox? Skip this step and add a music folder next.</p>
            <p>If you do, open Rekordbox once with your collection, then choose Look again.</p>
          </div>
          <div className="onboarding-actions">
            <button className="btn" onClick={retry}>
              Look again
            </button>
            {skipButton}
          </div>
        </>
      )}

      {step.kind === 'previewing' && (
        <p className="onboarding-loading" role="status">
          Reading your collection… Large libraries can take a moment. Nothing has been imported yet.
        </p>
      )}

      {step.kind === 'options' && (
        <>
          <p className="onboarding-muted">
            Your music files stay where they are. Rekordbox stays untouched, and can remain open.
          </p>
          <PreviewCounts preview={step.preview} />
          <label className="onboarding-option">
            <input
              type="checkbox"
              checked={includeGenre}
              onChange={(e) => setIncludeGenre(e.target.checked)}
            />
            <span>Keep my genres<small>Add Rekordbox genres as Tags in a Genre category.</small></span>
          </label>
          <div className="onboarding-actions">
            {skipButton}
            {step.preview.tracks_importable === 0 ? (
              <button className="btn btn-primary" onClick={onDone}>Continue without importing</button>
            ) : <button
              className="btn btn-primary"
              onClick={() => void start()}
            >
              {step.preview.tracks_importable > step.preview.tracks_already_imported
                ? `Import ${n(step.preview.tracks_importable - step.preview.tracks_already_imported)} new tracks`
                : 'Fill in missing library details'}
            </button>
            }
          </div>
        </>
      )}

      {(step.kind === 'starting' || step.kind === 'running') && (
        <>
          <ImportProgressView progress={step.kind === 'running' ? step.progress : null} />
          <p className="onboarding-muted">Large libraries can take a few minutes. Keep manaDJ open while your music is imported.</p>
          {/* Inside First run / a relaunch (onSkip given): move on while the
              import task keeps running — it counts as done for the sequence. */}
          {step.kind === 'running' && (onBackground || onSkip) && (
            <div className="onboarding-actions">
              <button className="btn" onClick={onBackground ?? onDone}>
                Continue setup while importing
              </button>
            </div>
          )}
        </>
      )}

      {step.kind === 'summary' && (
        <>
          <ImportSummaryView summary={step.summary} />
          <div className="onboarding-actions">
            <button className="btn btn-primary" onClick={onDone}>
              Continue
            </button>
          </div>
        </>
      )}

      {step.kind === 'error' && (
        <>
          <div className="onboarding-notice onboarding-error" role="alert">
            <strong>{step.connection ? 'We lost touch with the import.' : 'We couldn’t finish this step.'}</strong>
            <p>{step.connection ? 'The import may still be running. Check its progress before starting again.'
              : 'Check that Rekordbox and your music drive are available, then try again. Any tracks already added are kept.'}</p>
            <details><summary>Technical details</summary><p>{step.message}</p></details>
          </div>
          <div className="onboarding-actions">
            <button className="btn" onClick={retry}>
              {step.connection ? 'Check progress' : 'Try again'}
            </button>
            {skipButton}
          </div>
        </>
      )}
    </div>
  );
}

function PreviewCounts({ preview: p }: { preview: RekordboxPreview }) {
  const rows: [string, string][] = [
    ['Tracks available', n(p.tracks_importable)],
    ['Hot cue points', n(p.hotcues)],
    ['Beatgrids', n(p.grids)],
    ['Keys', n(p.keys)],
    ['MyTags', `${n(p.tags)} in ${n(p.tag_categories)} categories`],
    ['Genres', n(p.genres)],
    ['Playlists', `${n(p.playlists)}${p.smart_playlists ? ` (${n(p.smart_playlists)} smart, as snapshots)` : ''}`],
  ];
  const skipped: [string, number][] = [
    ['Missing on disk', p.tracks_missing_file],
    ['Streaming-only', p.tracks_streaming],
    ['Smart playlists without stored tracks', p.smart_playlists_skipped],
    ['Saved loops', p.saved_loops],
  ];
  return (
    <div className="onboarding-counts">
      <div className="onboarding-stats">
        <div><strong>{n(Math.max(0, p.tracks_importable - p.tracks_already_imported))}</strong><span>new tracks</span></div>
        <div><strong>{n(p.playlists)}</strong><span>playlists found</span></div>
        <div><strong>{n(p.tags)}</strong><span>MyTags found</span></div>
      </div>
      {p.tracks_already_imported > 0 && <p className="onboarding-muted">{n(p.tracks_already_imported)} tracks are already in manaDJ. Missing cues, Tags and playlists can be added; your existing values won’t be replaced.</p>}
      {p.tracks_importable === 0 && <p className="onboarding-notice">No local audio files are available to import. Connect the drive that holds your music, then reopen this guide.</p>}
      <details className="onboarding-details"><summary>What comes across</summary>
      <table>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="onboarding-muted">Hot Cues, beatgrids and keys come across where available. The first memory cue becomes the Main cue; other memory cues and saved loops stay in Rekordbox.</p>
      <p className="onboarding-muted">Smart playlists become regular playlists using their saved tracks.</p>
      <p className="onboarding-source">Library: <code>{p.library_dir}</code></p>
      </details>
      {skipped.some(([, v]) => v > 0) && (
        <div className="onboarding-skipped">
          <details><summary>Some items will stay in Rekordbox</summary>
          {skipped
            .filter(([, v]) => v > 0)
            .map(([label, v]) => (
              <div key={label}>
                {label}: {n(v)}
              </div>
            ))}
          </details>
        </div>
      )}
    </div>
  );
}

function ImportProgressView({ progress }: { progress: ImportProgress | null }) {
  const current = progress ? PHASES.indexOf(progress.phase) : -1;
  const pct = progress && progress.total > 0 ? Math.min(100, Math.round(100 * progress.done / progress.total)) : null;
  return (
    <div className="onboarding-progress" data-testid="import-progress">
      <p className="onboarding-progress-title" role="status">{progress ? PHASE_LABELS[progress.phase] ?? 'Importing your library' : 'Getting ready to import…'}</p>
      <div className="onboarding-bar" role="progressbar" aria-label={progress ? PHASE_LABELS[progress.phase] : 'Preparing import'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
        <span className="onboarding-bar-fill" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="onboarding-muted">{progress && progress.total > 0 ? `${n(progress.done)} / ${n(progress.total)} in this step` : 'Waiting for the import task to start. You can continue setup.'}</p>
    <ol className="onboarding-phases" aria-label="Import stages">
      {PHASES.map((phase, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <li key={phase} className={`onboarding-phase ${state}`}>
            <span>{i + 1}. {({ tracks: 'Tracks', performance: 'Cues & grids', tags: 'Tags', genre: 'Genres', playlists: 'Playlists', finalize: 'Finish' } as Record<string, string>)[phase]}</span>
          </li>
        );
      })}
    </ol>
    </div>
  );
}

function ImportSummaryView({ summary: s }: { summary: RekordboxImportSummary }) {
  const imported: [string, number][] = [
    ['Tracks', s.tracks_imported],
    ['Tracks with Hot Cues added', s.hotcues_applied],
    ['Tracks with beatgrids added', s.beatgrids_applied],
    ['Main cues', s.maincues_applied],
    ['Keys', s.keys_applied],
    ['Tags', s.tags_created + s.genre_tags_created],
    ['Tag assignments', s.tag_assignments_added + s.genre_assignments_added],
    ['Playlists', s.playlists_created],
  ];
  const dropped: [string, number][] = [
    ['Tracks missing on disk', s.tracks_missing_file],
    ['Streaming-only tracks', s.tracks_streaming],
    ['Memory cues beyond the first', s.dropped_memory_cues],
    ['Saved loops', s.dropped_loops],
    ['Smart playlists without stored tracks', s.smart_playlists_skipped],
    ['Kept your existing values (differed in Rekordbox)', s.pending_conflicts],
  ];
  const unchanged = s.tracks_already_imported;
  return (
    <div className="onboarding-summary" data-testid="import-summary">
      <div className="onboarding-stats">
        <div><strong>{n(s.tracks_imported)}</strong><span>tracks added</span></div>
        <div><strong>{n(s.playlists_created)}</strong><span>playlists added</span></div>
      </div>
      <p className="onboarding-muted">Waveforms and analysis may keep processing in the background. Your Library is ready to explore.</p>
      <details className="onboarding-details"><summary>Import details</summary>
      <table>
        <tbody>
          {imported.map(([label, v]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{n(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </details>
      {unchanged > 0 && (
        <p className="onboarding-muted">{n(unchanged)} tracks were already in manaDJ — no duplicate tracks were added.</p>
      )}
      {dropped.some(([, v]) => v > 0) && (
        <div className="onboarding-skipped">
          <details><summary>Items not imported</summary>
          {dropped
            .filter(([, v]) => v > 0)
            .map(([label, v]) => (
              <div key={label}>
                {label}: {n(v)}
              </div>
            ))}
          </details>
        </div>
      )}
    </div>
  );
}
