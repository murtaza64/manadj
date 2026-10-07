/** Rekordbox import wizard (#275): detect → preview counts → options →
 * run with progress → summary. Guide-shaped (setup-guides PRD): works
 * inside the First-run sequence and standalone (SYNC view). The import
 * runs as a backend task, so the app stays usable — `onBackground` lets
 * the host get out of the way while it runs. Reads a Rekordbox snapshot
 * only; nothing is written to Rekordbox. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { queryClient } from '../api/queryClient';
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
  | { kind: 'running'; progress: ImportProgress | null }
  | { kind: 'summary'; summary: RekordboxImportSummary }
  | { kind: 'error'; message: string };

const PHASE_LABELS: Record<string, string> = {
  tracks: 'Adding tracks',
  performance: 'Hot cues, grids, keys',
  tags: 'MyTags',
  genre: 'Genres',
  playlists: 'Playlists',
  finalize: 'Queueing waveforms & analysis',
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
    const id = window.setInterval(async () => {
      try {
        const status = await onboardingApi.status();
        if (gen !== generation.current) return;
        ticks += 1;
        if (ticks % 5 === 0) void queryClient.invalidateQueries({ queryKey: ['tracks'] });
        if (status.state === 'done' && status.summary) {
          void queryClient.invalidateQueries();
          setStep({ kind: 'summary', summary: status.summary });
        } else if (status.state === 'failed') {
          setStep({ kind: 'error', message: status.error || 'Import failed' });
        } else {
          setStep({ kind: 'running', progress: status.progress });
        }
      } catch (e) {
        fail(gen, e);
      }
    }, pollMs);
    return () => window.clearInterval(id);
  }, [running, pollMs]);

  const start = async () => {
    const gen = ++generation.current;
    try {
      await onboardingApi.startImport(includeGenre);
      if (gen === generation.current) setStep({ kind: 'running', progress: null });
    } catch (e) {
      fail(gen, e);
    }
  };

  const skipButton = onSkip ? (
    <button className="btn" onClick={onSkip}>
      Skip
    </button>
  ) : null;

  return (
    <div className="onboarding-guide" data-testid="rekordbox-import-guide">
      <h2 className="onboarding-title">Import from Rekordbox</h2>

      {step.kind === 'detecting' && <p className="onboarding-muted">Looking for your Rekordbox library…</p>}

      {step.kind === 'not-found' && (
        <>
          <p>No Rekordbox library was found on this machine.</p>
          <div className="onboarding-actions">
            <button className="btn" onClick={retry}>
              Look again
            </button>
            {skipButton}
          </div>
        </>
      )}

      {step.kind === 'previewing' && (
        <p className="onboarding-muted">
          Reading a snapshot of <code>{step.libraryDir}</code>…
        </p>
      )}

      {step.kind === 'options' && (
        <>
          <p className="onboarding-muted">
            From <code>{step.preview.library_dir}</code>. Rekordbox can stay open — nothing is written to it.
            Files stay where they are.
          </p>
          <PreviewCounts preview={step.preview} />
          <label className="onboarding-option">
            <input
              type="checkbox"
              checked={includeGenre}
              onChange={(e) => setIncludeGenre(e.target.checked)}
            />
            Import Genres as Tags (in a “Genre” category)
          </label>
          <div className="onboarding-actions">
            <button
              className="btn btn-primary"
              onClick={() => void start()}
              disabled={step.preview.tracks_importable === 0}
            >
              Import {n(step.preview.tracks_importable - step.preview.tracks_already_imported)} new tracks
            </button>
            {skipButton}
          </div>
        </>
      )}

      {step.kind === 'running' && (
        <>
          <ImportProgressView progress={step.progress} />
          <p className="onboarding-muted">You can keep using manadj while this runs.</p>
          {/* Inside First run / a relaunch (onSkip given): move on while the
              import task keeps running — it counts as done for the sequence. */}
          {(onBackground || onSkip) && (
            <div className="onboarding-actions">
              <button className="btn" onClick={onBackground ?? onDone}>
                Continue in background
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
              Done
            </button>
          </div>
        </>
      )}

      {step.kind === 'error' && (
        <>
          <p className="onboarding-error">{step.message}</p>
          <div className="onboarding-actions">
            <button className="btn" onClick={retry}>
              Retry
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
    ['Tracks', `${n(p.tracks_importable)}${p.tracks_already_imported ? ` (${n(p.tracks_already_imported)} already in manadj)` : ''}`],
    ['Hot cues', n(p.hotcues)],
    ['Beatgrids', n(p.grids)],
    ['Keys', n(p.keys)],
    ['MyTags', `${n(p.tags)} in ${n(p.tag_categories)} categories · ${n(p.tag_assignments)} assignments`],
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
      {skipped.some(([, v]) => v > 0) && (
        <div className="onboarding-skipped">
          <div className="onboarding-subhead">Won’t be imported</div>
          {skipped
            .filter(([, v]) => v > 0)
            .map(([label, v]) => (
              <div key={label}>
                {label}: {n(v)}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ImportProgressView({ progress }: { progress: ImportProgress | null }) {
  const current = progress ? PHASES.indexOf(progress.phase) : -1;
  return (
    <ol className="onboarding-phases" data-testid="import-progress">
      {PHASES.map((phase, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        const pct =
          state === 'done' ? 100 : state === 'active' && progress && progress.total > 0
            ? Math.round((100 * progress.done) / progress.total)
            : 0;
        return (
          <li key={phase} className={`onboarding-phase ${state}`}>
            <span className="onboarding-phase-label">{PHASE_LABELS[phase]}</span>
            <span className="onboarding-bar">
              <span className="onboarding-bar-fill" style={{ width: `${pct}%` }} />
            </span>
            {state === 'active' && progress && progress.total > 1 && (
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

function ImportSummaryView({ summary: s }: { summary: RekordboxImportSummary }) {
  const imported: [string, number][] = [
    ['Tracks', s.tracks_imported],
    ['Hot cue sets', s.hotcues_applied],
    ['Beatgrids', s.beatgrids_applied],
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
      <div className="onboarding-subhead">Imported</div>
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
      {unchanged > 0 && (
        <p className="onboarding-muted">{n(unchanged)} tracks were already in manadj — left as they are.</p>
      )}
      {dropped.some(([, v]) => v > 0) && (
        <div className="onboarding-skipped">
          <div className="onboarding-subhead">Not imported</div>
          {dropped
            .filter(([, v]) => v > 0)
            .map(([label, v]) => (
              <div key={label}>
                {label}: {n(v)}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

