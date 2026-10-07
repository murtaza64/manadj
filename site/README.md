# site/

Static explainer site. Preview `site/`; deploy only `.site-dist/`.

    uv run site/build.py                                   # rebuild pitch + install + help + assets
    uv run site/build.py --app-help                        # also copy frontend/public/manual/
    uv run site/build.py --output .site-dist                # deployable-only Pages artifact
    uv run site/test_build.py                             # isolated integration tests
    uv run site/test_install.py                           # install links and tour structure
    uv run --no-project python -m http.server 8790 --bind 127.0.0.1 --directory site

Browser checks (with `scripts/site` dependencies installed):

    node site/test_browser.mjs http://127.0.0.1:8790/

## Layout

| Path | Role |
|---|---|
| `content/home.md` | hero, loop, intro copy |
| `content/features/NN-<slug>.md` | one chapter per feature; frontmatter + Markdown body |
| `content/install.md` | install and setup guide |
| `content/help/<slug>.md` | detailed help articles |
| `templates/_macros.html` | shared blocks: `chapter`, `shot`, `clip`, `visual` |
| `templates/index.html` | pitch page layout |
| `templates/help.html` | help index and article layout |
| `assets/help.css`, `assets/help.js` | manual layout and mobile navigation |
| `assets/site.css` | shared styles; values only via `var(--…)` |
| `assets/tokens.css` | GENERATED from `frontend/src/theme/*.ts` — never edit |
| `shots/*.webp` | app screenshots (real-library sandbox, 2x) |
| `media/*.mp4` | silent real-app recordings; H.264, 1440×900 |
| `assets/fonts/` | bundled Ubuntu Mono 400/700, license and pinned provenance |
| `index.html`, `install.html` | GENERATED |
| `CNAME` | public site domain |
| `help/index.html`, `help/<slug>/index.html` | GENERATED standalone manual |
| `help/manifest.json` | GENERATED, tracked `{slug,title,anchors}` array for the app |

## Content contract

Feature frontmatter: `slug` (stable — URL anchor `#<slug>`, future
`help/<slug>`), `order`, `kicker`, `title`, `where`; optional `shot`/`caption`,
`shot2`/`caption2`, `clip` (MP4 basename; `shot` becomes its poster),
`visual` (`energy|decks|cues|controllers|setup`),
`status: coming`.

Copy rules: user language, `CONTEXT.md` terms, no implementation details.
Visual rules: `DESIGN.md`.

## Help manual

- Required frontmatter: `slug`, `title`, `summary`, `order`, `related` (list of
  article slugs). Optional: `draft: true`, `shot`, `caption`, `clip`; media names omit extensions.
- Drafts are excluded from generated pages, navigation and the manifest.
  Interim articles: `start`, `curate`, `perform`, `editor`, in that order.
  Navigation follows the tour workflow after `start`.
- Explicit heading IDs: `## Heading {#anchor}`. Markdown uses `extra` and `toc`
  (tables, fenced code, attribute lists). Heading IDs appear in the manifest.
- Links resolve from the generated article directory:
  `../perform/index.html#keyboard`, `../../install.html#welcome`,
  `../../shots/perform.webp`. Avoid leading `/` URLs; builds reject them.
- Unavailable related articles are omitted. Missing content directories produce an empty
  index and manifest. No placeholder articles are generated.
- Build validation checks all generated pages together: local targets,
  cross-page fragments, duplicate IDs, media and CSS assets.
  Validation uses a fresh temporary output before publishing.
- `--app-help` replaces only `frontend/public/manual/` with the same deployable
  bytes: `index.html`, `install.html`, `CNAME`, `help/`, `assets/`, `shots/`, `media/`. This directory is
  ignored. Other public paths are preserved. A normal build only writes `site/`.
- `frontend`'s `gen:help` runs in `predev` and `prebuild`; Vite copies the manual
   into `dist/manual/`. Fonts, images and clips are bundled for offline use.
- macOS and Windows releases explicitly run `uv run site/build.py --app-help`
  before `npm run build --ignore-scripts` in the shared release helper.
- App iframe URLs: `${BASE_URL}manual/help/<slug>/index.html#anchor`; index:
  `${BASE_URL}manual/help/index.html`. The parent app owns Escape handling;
  help JavaScript only collapses mobile article navigation.

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
committed for local previews. The Action runs `--output .site-dist` and uploads
only that directory: `index.html`, `install.html`, `CNAME`, `help/`, `assets/`,
`shots/`, `media/`. Content sources (including drafts), templates and tests are excluded.
The build rejects
missing media, broken anchors and duplicate IDs. No external font requests.

`--output` leaves source previews intact and replaces its generated staging tree
on rebuild, removing stale pages and assets. A sibling `<output>.site-build`
marker identifies the generated directory; keep it for subsequent builds.
Nonempty unmarked directories, source-overlapping paths and symlinks are refused.
Normal builds still regenerate the preview pages in `site/`.

The site-only `--site-font-hero` exception is recorded in `DESIGN.md`.
