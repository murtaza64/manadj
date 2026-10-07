# site/

Static explainer site. No framework; deployable as-is (GitHub Pages: serve `site/`).

    uv run site/build.py                                   # rebuild index.html + assets/tokens.css
    uv run --no-project python -m http.server 8790 --bind 127.0.0.1 --directory site

## Layout

| Path | Role |
|---|---|
| `content/home.md` | hero, loop, intro copy |
| `content/features/NN-<slug>.md` | one chapter per feature; frontmatter + Markdown body |
| `content/glossary.yml` | short user-facing term definitions (canonical: `CONTEXT.md`) |
| `templates/_macros.html` | shared blocks: `chapter`, `shot`, `term_chips`, `visual` |
| `templates/index.html` | pitch page layout |
| `assets/site.css` | shared styles; values only via `var(--…)` |
| `assets/tokens.css` | GENERATED from `frontend/src/theme/*.ts` — never edit |
| `shots/*.webp` | app screenshots (real-library sandbox, 2x) |
| `media/*.mp4` | silent real-app recordings; H.264, 1440×900 |
| `assets/fonts/` | bundled Ubuntu Mono 400/700, license and pinned provenance |
| `index.html` | GENERATED |

## Content contract

Feature frontmatter: `slug` (stable — URL anchor `#<slug>`, future
`help/<slug>`), `order`, `kicker`, `title`, `where`; optional `shot`/`caption`,
`shot2`/`caption2`, `clip` (MP4 basename; `shot` becomes its poster),
`visual` (`energy|decks|cues|controllers|setup`),
`status: coming`, `terms` (glossary slugs; build fails on unknown ones).
Glossary `slug` is stable too (`#term-<slug>`).

Copy rules: user language, `CONTEXT.md` terms, no implementation details.
Visual rules: `DESIGN.md`.

Per-feature help pages (#295) render the same Markdown with the same
macros/CSS; the app can import `content/**/*.md` directly.

## Recording

Requires Node, uv, FFmpeg with libx264, and the lane app's real-Library sandbox.

```sh
uv run scripts/agent/lane_app.py start
npm ci --prefix scripts/site
npm exec --prefix scripts/site -- playwright install chromium
# Use the ports in LANE.md (no default-app fallback).
export SITE_APP_URL=http://localhost:5803 SITE_API_URL=http://localhost:8757
node scripts/site/capture.mjs perform,set,editor
node scripts/site/stills.mjs all
uv run site/build.py
node scripts/site/verify.mjs http://127.0.0.1:8790/
```

- `capture.mjs`: actual keyboard transport, pointer mixer gestures, Conductor
  playback, Mix editor audition. Clips are trimmed at real speed, silent,
  with native play/pause/fullscreen controls; no automatic playback.
- `stills.mjs`: original screenshot scenes; `--help` lists them, `--check`
  renders without replacing assets. `all` also captures settings alternatives.
- Artifacts resolve by names, never fixed IDs. Defaults: Set `relentless groove`,
  Transition `second drop double` into `Last Time`, unnamed seven-Track Routine
  starting with `Runaway Train`. Override via `SITE_SET`, `SITE_TRANSITION`,
  `SITE_TRANSITION_INCOMING`, `SITE_ROUTINE` or `SITE_ROUTINE_START`/`SITE_ROUTINE_SIZE`.
  Sessions resolve by `SITE_SESSION_STARTED_AT` (default: `2026-10-06T19:10:26`).
- Raw video, poster PNGs and timing manifest: `.lane-tmp/site-capture/`.
  Browser review screenshots: `.lane-tmp/site-review/`.
- Review visible names before publishing. Current captures use sandbox-only
  display-name edits (`summer vol 1`, `practice sketches`, `buildup blend`).
  The Routine screenshot crops out the unrelated picker; Acquisition uses
  a shorter viewport. No audio files or real-Library metadata are changed.
- Automated Chromium rejected held-key pointer lock on the capture snapshot.
  The Perform clip uses real D/K transports and on-screen mixer drags; it
  does not pretend to demonstrate a working held-key sweep.

## Publishing

`.github/workflows/explainer-site.yml` builds and deploys on relevant pushes
to `main`, or manual dispatch on `main`. Set repository **Pages → Source →
GitHub Actions** before the first deployment. Generated `index.html` remains
committed for local previews; the Action rebuilds it. The build rejects
missing media, broken anchors and duplicate IDs. No external font requests.

The site-only `--site-font-hero` exception is recorded in `DESIGN.md`.
