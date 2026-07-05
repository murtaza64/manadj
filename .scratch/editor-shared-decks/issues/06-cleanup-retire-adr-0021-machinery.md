# Cleanup: retire ADR 0021 machinery and dead clock code

Status: ready-for-agent

## Parent

`.scratch/editor-shared-decks/PRD.md` (ADR 0022)

## What to build

Post-swap deletions and doc truing — everything that existed only to
police or route around the private mixer:

- The routing store's secondary-mixer registry (`registerRoutedMixer`,
  the secondary set, its recompute loop) and its registry-specific tests
  (ADR 0021, now retired). The primary master-sink application stays.
- Mixer `suspend()`/`resume()` if now callerless (the arbiter no longer
  suspends contexts).
- Stale comments and docs: deck-provider "mirrors its loads onto them"
  note, MixPlayer's private-mixer header, ADR references to the private
  surface that survived the swap slice, `.scratch/key-lock/` issue 05
  pointer (resolved by ADR 0022).
- Anything else the swap orphaned: editor-only pitch-range plumbing,
  unused arbiter handle fields, dead exports (let the compiler and grep
  find them).

Verify the wins the PRD promises and note them in the landing message:
one context, registry gone, second engine pair/worklets/limiter chain
gone.

## Acceptance criteria

- [ ] `registerRoutedMixer` and the secondary-mixer set no longer exist;
      routing tests cover only the primary path
- [ ] No callerless suspend/resume or arbiter clock machinery remains
- [ ] Repo-wide grep for "private mixer" / "secondary mixer" / mirror
      comments returns only historical docs (ADRs, issue archives)
- [ ] Full gate green

## Blocked by

- `05-swap-editor-conducts-shared-machinery.md`

## Comments

**Done (lane editorshared, change yolvpmrz).** Deleted: the ADR 0021
registry (`registerRoutedMixer`, secondary set, recompute loop) + its
registry tests (one primary-path routing test kept); `Mixer.suspend()/
resume()` (callerless — no surface suspends the one clock). Trued:
controlRegistry's ADR 0013 tripwire comment, routingStore header,
key-lock issue 05 (status → done, resolved by ADR 0022). Wins verified
in-tree: one Mixer construction site (DeckProvider), no "private mixer"
references left in source, second engine pair/worklets/limiter chain gone
with the swap. Repo-wide grep for private/secondary mixer now hits only
historical docs.
