# 07 — Follow `bpmCenter` and the MATCH gate read the track cache

Status: ready-for-agent
Type: task

ADR 0027 §7. `loadedTrack` is a load-time snapshot; only two consumers
do tempo MATH from it:

- Follow mode: `Library.tsx:130-136` builds references from
  `decks.A/B.loadedTrack`; `follow/model.ts:179-181` sets
  `query.bpmCenter = reference.bpm`. After a re-tempo 87→174 the
  candidate list keeps filtering around 87 until a re-Load
  (`FollowParamsModal.tsx:134` displays the stale value too).
- MATCH button enable gate: `DeckPanel.tsx:398` (`other.loadedTrack?.bpm`)
  — `useMatchAction` itself already reads
  `getQueryData(['track', id]) ?? snapshot` (`useMatchAction.ts:27`).

## Change

Both readers adopt the `useMatchAction` pattern: `['track', id]` cache
value, snapshot fallback. `loadedTrack` remains identity + display
convenience. No id-only context refactor (grill decision).

## Testing decisions

- Follow model: reference built from a cache row with edited BPM centers
  the query on the new tempo (pure-model test; the reference-building
  seam in Library may need a small extraction to be testable).
- Vitest suite green; manual spot-check optional (edit BPM with Follow
  open → candidate BPMs re-center).
