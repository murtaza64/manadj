import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useMixer, useMixerValue } from '../hooks/useMixer';
import { TOUR_SECTIONS } from '../tour/steps';
import { TutorialSettings } from '../tutorials/TutorialSettings';
import {
  allToursSkipped,
  isSectionSeen,
  resetTourProgress,
  subscribeTour,
  tourVersion,
} from '../tour/tourState';
import {
  DEFAULT_FILTER_SETTINGS,
  FILTER_MODELS,
  FILTER_PARAMETER_RANGES,
  type FilterSettings,
} from '../playback/filterSettings';
import { FilterResponse } from './FilterResponse';
import './settings.css';
import { CommittedNumberInput } from '../components/CommittedNumberInput';
import { HFader } from '../components/performance/MixerStrip';
import {
  BEAT_FX_PARAMETER_RANGES,
  DEFAULT_BEAT_FX_SETTINGS,
  type BeatFxSettings,
} from '../playback/beatFxSettings';
import { APP_VERSION } from '../version';

const WaveformSettings = lazy(() => import('../waveform/StyleTuningPage'));
const ControllerCalibrationSettings = lazy(() => import('./ControllerCalibrationSettings'));
const MouseJogSettings = lazy(() => import('./MouseJogSettings'));
const LibrarySettings = lazy(() => import('./LibrarySettings'));
const PARAMS = [
  {
    key: 'resonance',
    label: 'Resonance',
    unit: 'dB',
    note: "Added Q above the model's base alignment. Higher values ring more.",
  },
  {
    key: 'compensation',
    label: 'Peak compensation',
    unit: '%',
    note: 'Subtract this fraction of the measured resonant peak. 100% holds the peak at the dry level; 0% leaves it raw.',
  },
  {
    key: 'curve',
    label: 'Sweep curve',
    unit: 'x',
    note: 'Below 1 moves earlier; above 1 gives more travel near the open end.',
  },
  {
    key: 'deadzone',
    label: 'Center deadzone',
    unit: '%',
    note: 'Dry at center, then a 7% crossfade into the filter.',
  },
  {
    key: 'drive',
    label: 'Drive',
    unit: 'dB',
    note: 'Gain-compensated saturation after the filter. Zero leaves the signal clean.',
  },
  {
    key: 'trim',
    label: 'Filter output trim',
    unit: 'dB',
    note: 'Global filter level adjustment. Also applies at center; separate from channel trim.',
  },
  {
    key: 'lpMin',
    label: 'Low-pass endpoint',
    unit: 'Hz',
    note: 'Cutoff at the left end of the filter knob.',
  },
  {
    key: 'hpMax',
    label: 'High-pass endpoint',
    unit: 'Hz',
    note: "Cutoff at the right end, capped below the audio sample rate's Nyquist limit.",
  },
  {
    key: 'spread',
    label: 'Peak spread',
    unit: 'oct',
    note: 'Cutoff separation, used only by Twin peak.',
  },
  {
    key: 'smoothing',
    label: 'Smoothing',
    unit: 'ms',
    note: 'Frequency and resonance time constant; not time to reach the target.',
  },
] as const;

function FilterSettingsPanel() {
  const mixer = useMixer();
  const [resetKey, setResetKey] = useState(0);
  const settings = useMixerValue((m) => m.getFilterSettings());
  const shown =
    settings.model === 'current'
      ? {
          ...settings,
          resonance: 6.0103,
          compensation: 0,
          curve: 1,
          deadzone: 0.05,
          drive: 0,
          lpMin: 80,
          hpMax: 8000,
          smoothing: 15,
        }
      : settings;
  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Filters</h2>
          <p>
            One sound for all four decks, including headphone cue and automated
            mixes.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setResetKey(key => key + 1);
            mixer.setFilterSettings(DEFAULT_FILTER_SETTINGS);
          }}
        >
          Reset filter defaults
        </button>
      </div>
      <div className="settings-models" role="group" aria-label="Filter model">
        {FILTER_MODELS.map((model) => (
          <button
            key={model.id}
            className={`btn settings-model${settings.model === model.id ? ' btn-selected' : ''}`}
            aria-pressed={settings.model === model.id}
            onClick={() => mixer.setFilterSettings({ model: model.id })}
          >
            <strong>{model.name}</strong>
            <span>{model.description}</span>
          </button>
        ))}
      </div>
      <div className="settings-filter-layout">
        <div className="settings-fields">
          {PARAMS.map(({ key, label, unit, note }) => {
            const [min, max, step] = FILTER_PARAMETER_RANGES[key];
            const scale = unit === '%' ? 100 : 1;
            const value = Number((shown[key] * scale).toFixed(4));
            const disabled =
              (settings.model === 'current' && key !== 'trim') ||
              (key === 'spread' && settings.model !== 'dual');
            const set = (v: number) =>
              mixer.setFilterSettings({
                [key]: v / scale,
              } as Partial<FilterSettings>);
            return (
              <div
                className="settings-field"
                key={key}
                data-signal={disabled ? undefined :
                  ((key === 'resonance' || key === 'drive' || key === 'trim') && shown[key] > 0) ? 'boost' :
                  ((key === 'compensation' && shown[key] > 0) || (key === 'trim' && shown[key] < 0)) ? 'trim' : undefined}
              >
                <div>
                  <span className="settings-field-label">{label}</span>
                  <p>
                    {settings.model === 'current' && key === 'resonance'
                      ? 'Original mode uses fixed +3 dB Q outside center.'
                      : note}
                  </p>
                </div>
                <div className="settings-field-inputs">
                  <HFader
                    id={`filter-${key}`}
                    ariaLabel={label}
                    label={Number(value.toPrecision(6)).toString()}
                    accent
                    fill
                    fillColor="var(--accent)"
                    detent={min === -max}
                    min={min * scale}
                    max={max * scale}
                    step={step * scale}
                    value={value}
                    defaultValue={DEFAULT_FILTER_SETTINGS[key] * scale}
                    disabled={disabled}
                    onChange={set}
                  />
                  <CommittedNumberInput
                    key={`${settings.model}:${resetKey}`}
                    aria-label={`${label} value`}
                    min={min * scale}
                    max={max * scale}
                    step={step * scale}
                    value={value}
                    disabled={disabled}
                    onCommit={set}
                  />
                  <span>{unit}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <FilterResponse />
          <p className="settings-hint">
            Settings apply live and persist across launches. Changing them also
            changes the sound of existing transitions and session replays. The
            output ceiling is unchanged.
          </p>
        </div>
      </div>
    </>
  );
}

/** Tour reset (feature-tour #282, story 7): forget seen sections and the
 * skip-all flag, so every section's coach marks fire again on first entry.
 * Also the demo hook. Replays of single sections live in the TopBar ?. */
function TourSettingsPanel() {
  useSyncExternalStore(subscribeTour, tourVersion);
  const seenCount = TOUR_SECTIONS.filter((s) => isSectionSeen(s.id)).length;
  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Tour</h2>
          <p>
            Each area shows a short guided walkthrough the first time you enter
            it. Replay any section from the ? button in the top bar.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={resetTourProgress}>
          Reset tour progress
        </button>
      </div>
      <p className="settings-hint">
        {allToursSkipped()
          ? 'Tours are currently skipped — resetting turns them back on.'
          : `${seenCount} of ${TOUR_SECTIONS.length} section tours seen. Resetting replays them on next visit.`}
      </p>
    </>
  );
}

const EFFECT_GROUPS = [
  {
    name: 'Echo',
    detail: 'Full-band beat delay. LEVEL/DEPTH remains on the mixer.',
    fields: [
      ['echoFeedback', 'Feedback', '%', 'Repeat regeneration. Higher values produce longer tails.'],
      ['echoSaturation', 'Saturation', 'x', 'Safety soft clipping in the feedback path. Zero is linear.'],
    ],
  },
  {
    name: 'Reverb',
    detail: 'Synthesized stereo convolution impulse.',
    fields: [
      ['reverbDecay', 'Decay', 's', 'Impulse length and exponential decay time.'],
      ['reverbDampingHz', 'Damping', 'Hz', 'Low-pass cutoff applied while synthesizing the impulse.'],
      ['reverbStereoWidth', 'Stereo width', '%', 'Zero is mono-correlated; 100% decorrelates both sides.'],
    ],
  },
  {
    name: 'Flanger',
    detail: 'One sine-LFO cycle per selected Beat FX span.',
    fields: [
      ['flangerDelayMs', 'Center delay', 'ms', 'Center of the comb-filter delay sweep.'],
      ['flangerWidthMs', 'Sweep width', 'ms', 'Peak-to-peak delay modulation range.'],
      ['flangerFeedback', 'Feedback', '%', 'Regeneration around the short delay.'],
    ],
  },
] as const;

function BeatFxSettingsPanel() {
  const mixer = useMixer();
  const settings = useMixerValue((m) => m.getBeatFxSettings());
  const [resetKey, setResetKey] = useState(0);
  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Beat FX</h2>
          <p>Sound tuning for the shared post-fader Beat FX section.</p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setResetKey((key) => key + 1);
            mixer.setBeatFxSettings(DEFAULT_BEAT_FX_SETTINGS);
          }}
        >
          Reset effect defaults
        </button>
      </div>
      <div className="settings-effect-groups">
        {EFFECT_GROUPS.map((group) => (
          <section className="settings-effect-card" key={group.name}>
            <h3>{group.name}</h3>
            <p>{group.detail}</p>
            {group.fields.map(([key, label, unit, note]) => {
              const [min, max, step] = BEAT_FX_PARAMETER_RANGES[key];
              const scale = unit === '%' ? 100 : 1;
              const value = Number((settings[key] * scale).toFixed(4));
              const set = (raw: number) => mixer.setBeatFxSettings({ [key]: raw / scale } as Partial<BeatFxSettings>);
              return (
                <div className="settings-field" key={key}>
                  <span className="settings-field-label">{label}</span>
                  <p>{note}</p>
                  <div className="settings-field-inputs">
                    <HFader
                      id={`beat-fx-${key}`}
                      ariaLabel={label}
                      label={Number(value.toPrecision(6)).toString()}
                      accent
                      fill
                      fillColor="var(--accent)"
                      min={min * scale}
                      max={max * scale}
                      step={step * scale}
                      value={value}
                      defaultValue={DEFAULT_BEAT_FX_SETTINGS[key] * scale}
                      onChange={set}
                    />
                    <CommittedNumberInput
                      key={`${key}:${resetKey}`}
                      aria-label={`${label} value`}
                      min={min * scale}
                      max={max * scale}
                      step={step * scale}
                      value={value}
                      onCommit={set}
                    />
                    <span>{unit}</span>
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <p className="settings-hint">Settings apply live and persist across launches.</p>
    </>
  );
}

// ── Settings groups (#328) ─────────────────────────────────────────────
// The nav lists GROUPS; each group renders its sections as headed blocks in
// one scroll. To add a section, append ONE entry to its group's `sections`
// (slots for parked work are noted per group). Section ids double as deep
// links (?section=<id>, anchor #settings-section-<id>); ?section=<group id>
// opens a group at the top. Groups with no sections are hidden.

export interface SettingsSection {
  id: string;
  title: string;
  render: (ctx: { performance: boolean }) => ReactNode;
}

export interface SettingsGroup {
  id: string;
  title: string;
  detail: string;
  sections: SettingsSection[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'library',
    title: 'Library',
    detail: 'Folders, DJ software, export',
    sections: [{ id: 'library', title: 'Library', render: () => <LibrarySettings /> }],
  },
  {
    id: 'performance',
    title: 'Performance',
    detail: 'Filters, Beat FX, cue mode',
    sections: [
      { id: 'filters', title: 'Filters', render: () => <FilterSettingsPanel /> },
      { id: 'effects', title: 'Beat FX', render: () => <BeatFxSettingsPanel /> },
      // slot: Cue mode (#289)
    ],
  },
  {
    id: 'display',
    title: 'Display',
    detail: 'Waveforms and visuals',
    sections: [{ id: 'waveforms', title: 'Waveforms', render: () => <WaveformSettings /> }],
  },
  {
    id: 'controllers',
    title: 'Controllers',
    detail: 'Controller check, jog calibration',
    sections: [
      // slot: Controller check (#292) — goes first
      { id: 'jog', title: 'Jog calibration', render: () => <ControllerCalibrationSettings /> },
    ],
  },
  {
    id: 'keyboard-mouse',
    title: 'Keyboard + mouse',
    detail: 'Mouse jog, shortcuts',
    sections: [
      {
        id: 'mouse-jog',
        title: 'Mouse jog',
        render: ({ performance }) => <MouseJogSettings performance={performance} />,
      },
      // slot: keyboard shortcut map (#285)
    ],
  },
  {
    id: 'accounts',
    title: 'Accounts',
    detail: 'SoundCloud, Soulseek',
    sections: [
      // slot: SoundCloud (#290)
      // slot: Soulseek (#291)
    ],
  },
  {
    id: 'help',
    title: 'Help',
    detail: 'Setup guides, tour, about',
    sections: [
      // slot: Setup guides status/relaunch (#288) — goes first
      { id: 'tour', title: 'Tour', render: () => <TourSettingsPanel /> },
      { id: 'tutorials', title: 'Tutorials', render: () => <TutorialSettings /> },
      // slot: version/licenses/about
    ],
  },
];

const VISIBLE_GROUPS = SETTINGS_GROUPS.filter((g) => g.sections.length > 0);

/** Resolve ?section= (group id or section id) to a group + optional anchor. */
function resolveSection(requested: string | null): { group: SettingsGroup; anchor: string | null } {
  const byGroup = VISIBLE_GROUPS.find((g) => g.id === requested);
  if (byGroup) return { group: byGroup, anchor: null };
  const owner = VISIBLE_GROUPS.find((g) => g.sections.some((s) => s.id === requested));
  if (owner) return { group: owner, anchor: requested };
  const fallback = VISIBLE_GROUPS.find((g) => g.id === 'performance') ?? VISIBLE_GROUPS[0];
  return { group: fallback, anchor: null };
}

export default function SettingsPage({ performance = false }: { performance?: boolean }) {
  const [initial] = useState(() =>
    resolveSection(new URLSearchParams(location.search).get('section')),
  );
  const [groupId, setGroupId] = useState(initial.group.id);
  const group = VISIBLE_GROUPS.find((g) => g.id === groupId)!;
  // Old per-section deep links scroll to their block once it has rendered
  // (lazy panels may land a frame later).
  useEffect(() => {
    if (!initial.anchor) return;
    const timer = setTimeout(() => {
      document.getElementById(`settings-section-${initial.anchor}`)?.scrollIntoView?.({ block: 'start' });
    }, 50);
    return () => clearTimeout(timer);
  }, [initial.anchor]);
  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <span className="settings-eyebrow">Preferences</span>
          <h1>Settings</h1>
        </div>
        <p>
          Changes apply immediately. Preferences are stored with your library.
          <span className="settings-version">manaDJ v{APP_VERSION}</span>
        </p>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" data-tour="settings.nav" aria-label="Settings sections">
          {VISIBLE_GROUPS.map((g) => (
            <button
              key={g.id}
              className={`btn${groupId === g.id ? ' btn-selected' : ''}`}
              aria-current={groupId === g.id ? 'page' : undefined}
              onClick={() => {
                setGroupId(g.id);
                const url = new URL(location.href);
                url.searchParams.set('section', g.id);
                history.replaceState(null, '', url);
              }}
            >
              <strong>{g.title}</strong>
              <span>{g.detail}</span>
            </button>
          ))}
        </nav>
        <section
          className="settings-content"
          data-tour="settings.content"
          aria-label={group.title}
        >
          {group.sections.map((s) => (
            <section
              key={s.id}
              id={`settings-section-${s.id}`}
              className="settings-subsection"
              aria-label={s.title}
            >
              <Suspense fallback={<p role="status">Loading settings...</p>}>
                {s.render({ performance })}
              </Suspense>
            </section>
          ))}
        </section>
      </div>
    </div>
  );
}
