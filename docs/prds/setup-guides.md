# PRD: Setup guides

Feature slug: `setup-guides`. Decided 2026-10-06 (grill with Murtaza).
Extends `rekordbox-onboarding-import.md` (First run) and `packaged-app.md`.

## Solution

First run chains Setup guides, each skippable, then starts the Tour:
Welcome → Rekordbox import → tracks directory → Cue mode → SoundCloud →
Soulseek → Controller check → Tour. Settings gains a **Setup** section listing
every guide with status (done / skipped / not started) and a launch button.

## Guides

- **Rekordbox import**: #274/#275.
- **Tracks directory**: one folder = Scan root (recursive) and Acquisition
  download destination; offers an immediate Scan. #276.
- **Cue mode**: Gated (default) / Trigger (new). Hot Cues on a paused Deck
  only; Main cue unchanged. Global preference.
- **SoundCloud**: guided paste of the `oauth_token` cookie from
  soundcloud.com (screenshots), validated by fetching the likes count; stored
  in the settings file.
- **Soulseek**: manadj bundles and supervises slskd (AGPL; unmodified binary,
  separate process, source offer in about/licences). User enters Soulseek
  username/password; manadj generates slskd config + API key. Packaged app
  ships the arm64 slskd binary (#280 follow-up). Optional.
- **Controller check**: audio (Master/Cue output pick, test tone each); MIDI
  (detect devices, Mapping present?, live "press anything" highlight for
  mapped devices, unsupported message otherwise); jog calibration where the
  Mapping has one.

## Implementation Decisions

- Registry contract: `frontend/src/setup/guides.ts` — each guide registers
  `{ id, title, order, status(): 'done'|'skipped'|'not-started', Component }`;
  `Component` receives `{ onDone, onSkip }` and works both inside the
  sequence and standalone. Guide status persisted in a persisted setting
  `manadj-setup-state`.
- Framework (sequence host, Setup section, First-run trigger, Tour handoff)
  is owned by the onboarding lane; each guide lands in its own lane and
  registers itself. A guide may land before the framework (registered but
  unhosted).

## Shipped defaults

Snapshot of Murtaza's current preference settings into a committed defaults
file applied when a key is unset. Excluded: `manadj-audio-routing` device
IDs, paths, tokens, Export enablement, session-only localStorage keys.
Included: GRV6 jog calibration (as that model's default), column
order/widths, filters, waveform styles, keylock, quantize, soft takeover,
crossfader, follow flags/params, perf deck count/sections, playlist filter,
track list sort, visualizer preset/params/cycle/hud/quality, perf keyboard
hints, plus non-path `config.toml` values (classification, cleanup, download
delay). Overrides (shipped regardless of the snapshot): perf deck count = 2
(#301). `scripts/settings/snapshot_defaults.py` re-snapshots on demand
(reads the real DB read-only; human-run).

Fresh installs open in PERFORM (#301); EXPORT lives in the ⋯ menu.

## Testing Decisions

Vitest per guide (status transitions, skip, standalone mount). Cue mode:
transport tests for both modes. Demo: empty-DB lane app running the whole
sequence.
