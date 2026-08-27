# ADR 0037: TS-first design tokens; variables.css retired

Date: 2026-08-26
Status: accepted

## Decision

Design tokens (colors, type/spacing/z scales, motion durations) have one
source of truth: `frontend/src/theme/tokens.ts`. A single `installTheme()`
call in `main.tsx` projects every token onto `:root` as CSS custom
properties before React mounts. `styles/variables.css` is deleted; the
ad-hoc boot installers (`installDeckColorVars`, `installRoutineColorVars`)
are absorbed. The written design system lives in `DESIGN.md` (repo root).

## Why TS-first, not CSS-first

Half the app paints on 2D canvas or WebGL, which cannot read CSS custom
properties. A CSS-first source forces TS mirrors (the hotcue palette
existed in four places, synced by comment discipline — `palette.ts`,
`variables.css`, GL floats, `backend/hotcue_palette.py`). TS-first makes
every derived form (`-rgb` triplets for alpha washes, GL float triples) a
computation instead of a copy, and CSS consumers keep `var(--…)` unchanged.

## Alternatives rejected

- **variables.css authoritative + build-step codegen to TS**: more
  machinery; a checked-in generated file is one more thing to drift.
- **Status quo (parallel sources + comments)**: measured failure — ~880
  hardcoded color literals across ~84 UI files, a second undeclared
  (Catppuccin) palette outcompeting the declared one, phantom tokens
  (`var(--orange)`, `--pink` defined in a dead component stylesheet).

## Consequences

- Token edits happen in TS (hot reload preserves the edit loop); devtools
  shows tokens as inline `:root` styles rather than a stylesheet rule.
- The unavoidable mirror (`backend/hotcue_palette.py`) is guarded by
  `tests/test_design_token_mirrors.py`, not comments.
- The pre-mount boot splash (`index.html`, `desktop/main.js`) keeps
  literals by design: it renders before `installTheme()` runs.
- Migration to full token adoption is tracked in gh#200–#203; DESIGN.md
  carries the decision ledger (D1–D12).
