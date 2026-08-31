/**
 * Mix picker (#205, ADR 0037 phase 2) — the Mix editor's context-aware
 * navigation, a PERSISTENT side panel at the editor's right (design-round
 * redirect: was a popover). It absorbs the EvidenceSwitcher's jobs and is
 * always visible — the panel IS the surface's map of the current move.
 *
 * Three page shapes by chip count (model: mixPickerModel):
 * - 0 chips (COLD): type-to-search; deck-state surfacing + the full
 *   inventory (saved Routines, Routine Takes, miner candidates — the old
 *   <select> tiers, kept whole).
 * - 1 chip: track scouting — everything out of / into / over the Track.
 * - 2 chips: the ordered pair's MOVE PAGE — Transitions (favorite-first,
 *   ★/rename/delete inline), Takes, Cameos, Routines-through-the-pair,
 *   pinned `+ New Transition A → B` (+ `+ New blank mix`, ADR 0039).
 *
 * Opening a pair artifact SYNCS the chips to its move, so the panel always
 * shows the open artifact's siblings (scoped cycling made visible).
 *
 * Keyboard (scoped to the panel's search input): type to filter tracks;
 * Enter picks the highlighted track into the next empty chip (Enter/Enter
 * = a pair in two keystrokes); ↑/↓ move across rows; Enter opens; Esc
 * clears the query, then the chips (the app's staged-Escape habit). Letter
 * keys never leak to the timeline modes (ADR 0038) — the input owns focus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CameoRowWire, RoutineCandidateWire, RoutineRowWire, RoutineTakeRowWire, TakeRowWire } from '../api/client';
import {
  deckSurfacing,
  filterTracks,
  pairCameos,
  pairTakes,
  pairTransitions,
  refKey,
  routinesThroughPair,
  trackLabel,
  trackPage,
  trackTitleShort,
  type MixArtifactRef,
  type TrackLike,
  type TransitionRowLike,
} from './mixPickerModel';

export interface MixPickerProps {
  /** The open pair, if any — chips sync to it (the panel shows the open
   * artifact's move). Null = leave the chips to the user. */
  openPair: { aTrackId: number; bTrackId: number } | null;
  /** The open artifact (row highlight). */
  openRefKey: string | null;
  tracks: TrackLike[];
  transitions: TransitionRowLike[];
  cameos: CameoRowWire[];
  routines: RoutineRowWire[];
  routineTakes: RoutineTakeRowWire[];
  candidates: RoutineCandidateWire[];
  takes: TakeRowWire[];
  /** Track ids loaded on decks right now (cold surfacing). */
  deckTrackIds: number[];
  busy: boolean;
  onOpen: (ref: MixArtifactRef) => void;
  onRenameTransition: (ref: { aTrackId: number; bTrackId: number; uuid: string }, name: string) => void;
  onToggleFavoriteTransition: (ref: { aTrackId: number; bTrackId: number; uuid: string }) => void;
  onDeleteTransition: (ref: { aTrackId: number; bTrackId: number; uuid: string }) => void;
  trackById: (id: number) => TrackLike | undefined;
}

interface Row {
  ref: MixArtifactRef;
  glyph: string;
  label: string;
  meta?: string;
  /** Second line: the involved tracks (redirect 2026-08-31) — transitions
   * "A → B", routines/candidates the whole cast, cameos "host ⟡ guest". */
  tracks?: string;
  favorite?: boolean;
  /** Inline affordances (transitions only in v1). */
  editable?: boolean;
  group: string;
}

/** Dense chrome names tracks by TITLE only, 15 chars max (redirect
 * 2026-08-31) — the typeahead results keep the full artist – title. */
const short = (t: TrackLike | undefined, id: number): string =>
  t ? trackTitleShort(t) : `#${id}`;

export function MixPicker(props: MixPickerProps) {
  const [chipA, setChipA] = useState<number | null>(null);
  const [chipB, setChipB] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null); // refKey
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cold entry (nothing open, no chips): the search takes focus — naming
  // tracks is the first gesture (ADR 0037's cold-open posture, panel form).
  const coldFocusedRef = useRef(false);
  useEffect(() => {
    if (coldFocusedRef.current) return;
    coldFocusedRef.current = true;
    if (!props.openPair && chipA === null && chipB === null) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chips follow the open pair (the panel shows the current move). One
  // sync per pair — the user can still clear/retarget the chips freely.
  const syncedPairRef = useRef<string | null>(null);
  useEffect(() => {
    if (!props.openPair) return;
    const key = `${props.openPair.aTrackId}:${props.openPair.bTrackId}`;
    if (syncedPairRef.current === key) return;
    syncedPairRef.current = key;
    setChipA(props.openPair.aTrackId);
    setChipB(props.openPair.bTrackId);
    setQuery('');
    setHighlight(0);
  }, [props.openPair]);

  const trackMatches = useMemo(
    () => filterTracks(props.tracks, query),
    [props.tracks, query]
  );

  // ── Rows for the current page shape ────────────────────────────────────
  const rows = useMemo((): Row[] => {
    const out: Row[] = [];
    const t = (id: number) => props.trackById(id);
    const pushTransition = (r: TransitionRowLike, group: string) =>
      out.push({
        ref: { kind: 'transition', aTrackId: r.a_track_id, bTrackId: r.b_track_id, uuid: r.uuid },
        glyph: '⇄',
        label: r.name || 'Transition',
        tracks: `${short(t(r.a_track_id), r.a_track_id)} → ${short(t(r.b_track_id), r.b_track_id)}`,
        favorite: r.favorite,
        editable: true,
        group,
      });
    const pushRoutine = (r: RoutineRowWire, group: string) =>
      out.push({
        ref: { kind: 'routine', uuid: r.uuid },
        glyph: '◆',
        label: r.name || `${r.cast.length}-track routine`,
        meta: `${Math.round(r.duration_beats)}b`,
        tracks: r.cast.map((id) => short(t(id), id)).join(' / '),
        group,
      });

    if (chipA !== null && chipB !== null) {
      // MOVE PAGE
      for (const r of pairTransitions(props.transitions, chipA, chipB)) {
        pushTransition(r, 'Transitions');
      }
      out.push({
        ref: { kind: 'new-transition', aTrackId: chipA, bTrackId: chipB },
        glyph: '+',
        label: 'New Transition',
        meta: 'seeded at the outgoing outro · persists on first edit',
        group: 'Transitions',
      });
      for (const tk of pairTakes(props.takes, chipA, chipB)) {
        out.push({
          ref: { kind: 'pair-take', aTrackId: chipA, bTrackId: chipB, uuid: tk.uuid },
          glyph: '●',
          label: `Take ${tk.detected_at?.slice(5, 16).replace('T', ' ') ?? ''}`,
          meta: tk.promoted_transition_uuid ? 'promoted' : 'unpromoted · opens in the pair editor',
          group: 'Takes',
        });
      }
      for (const c of pairCameos(props.cameos, chipA, chipB)) {
        out.push({
          ref: { kind: 'cameo', hostTrackId: c.host_track_id, guestTrackId: c.guest_track_id, uuid: c.uuid },
          glyph: '⟡',
          label: c.name || 'Cameo',
          tracks: `${short(t(c.host_track_id), c.host_track_id)} ⟡ ${short(t(c.guest_track_id), c.guest_track_id)}`,
          favorite: c.favorite,
          group: 'Cameos',
        });
      }
      for (const r of routinesThroughPair(props.routines, chipA, chipB)) {
        pushRoutine(r, 'Routines through the pair');
      }
      out.push({
        ref: { kind: 'new-blank' },
        glyph: '+',
        label: 'New blank mix',
        meta: 'kind-fluid draft (ADR 0039) — lands with #198',
        group: 'New',
      });
      return out;
    }

    if (chipA !== null) {
      // TRACK SCOUTING
      const page = trackPage(chipA, props.transitions, props.cameos, props.routines);
      for (const r of page.outOf) pushTransition(r, `Out of ${short(t(chipA), chipA)}`);
      for (const r of page.into) pushTransition(r, `Into ${short(t(chipA), chipA)}`);
      for (const c of page.over) {
        out.push({
          ref: { kind: 'cameo', hostTrackId: c.host_track_id, guestTrackId: c.guest_track_id, uuid: c.uuid },
          glyph: '⟡',
          label: c.name || 'Cameo',
          tracks: `${short(t(c.host_track_id), c.host_track_id)} ⟡ ${short(t(c.guest_track_id), c.guest_track_id)}`,
          favorite: c.favorite,
          group: 'Cameos over',
        });
      }
      for (const r of page.through) pushRoutine(r, 'Routines through');
      return out;
    }

    // COLD: deck surfacing first, then the full inventory tiers.
    const surf = deckSurfacing(props.deckTrackIds, props.transitions, props.routines);
    for (const r of surf.transitions) pushTransition(r, 'On the decks');
    for (const r of surf.routines) pushRoutine(r, 'On the decks');
    for (const r of props.routines) pushRoutine(r, 'Saved Routines');
    for (const tk of props.routineTakes) {
      if (tk.promoted_routine_uuid) continue;
      out.push({
        ref: { kind: 'routine-take', uuid: tk.uuid },
        glyph: '◇',
        label: `${tk.cast.length}-track Routine Take`,
        meta: `promote on open · confirmed ${tk.confirmed_at?.slice(0, 10) ?? ''}`,
        tracks: tk.cast.map((id) => short(t(id), id)).join(' / '),
        group: 'Routine Takes',
      });
    }
    for (const c of props.candidates) {
      out.push({
        ref: { kind: 'candidate', uuid: c.uuid },
        glyph: '⧉',
        label: `${c.cast.length}-track candidate`,
        meta: `confirm + promote on open · returns ${c.evidence?.returns ?? 0}`,
        tracks: c.cast.map((id) => short(t(id), id)).join(' / '),
        group: 'Miner candidates',
      });
    }
    return out;
  }, [chipA, chipB, props]);

  // Contiguous group runs (#205 bug: a row can legitimately appear in TWO
  // groups — 'On the decks' AND the inventory — so React keys must be
  // group-qualified and headers must live OUTSIDE the keyed row wrappers;
  // duplicate keys made reconciliation interleave headers and break
  // hover).
  const grouped = useMemo(() => {
    const out: { group: string; rows: { row: Row; flat: number }[] }[] = [];
    rows.forEach((row, flat) => {
      const last = out[out.length - 1];
      if (last && last.group === row.group) last.rows.push({ row, flat });
      else out.push({ group: row.group, rows: [{ row, flat }] });
    });
    return out;
  }, [rows]);

  // Track matches present → they own ↑/↓/Enter; otherwise rows do.
  const pickingTracks = query.trim().length > 0;
  const listLength = pickingTracks ? trackMatches.length : rows.length;
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(0, listLength - 1)));
  }, [listLength]);

  const pickTrack = useCallback(
    (id: number) => {
      if (chipA === null) setChipA(id);
      else if (chipB === null) setChipB(id);
      setQuery('');
      setHighlight(0);
      inputRef.current?.focus();
    },
    [chipA, chipB]
  );

  const openRef = useCallback(
    (ref: MixArtifactRef) => {
      if (props.busy) return;
      props.onOpen(ref);
    },
    [props]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(0, listLength - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pickingTracks) {
          const t = trackMatches[highlight];
          if (t) pickTrack(t.id);
        } else {
          const row = rows[highlight];
          if (row) openRef(row.ref);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // Staged: clear query → clear chips. (A persistent panel has
        // nothing to close.)
        if (query) setQuery('');
        else if (chipB !== null) setChipB(null);
        else if (chipA !== null) setChipA(null);
      }
    },
    [listLength, pickingTracks, trackMatches, highlight, pickTrack, rows, openRef, query, chipA, chipB]
  );

  const flip = useCallback(() => {
    setChipA(chipB);
    setChipB(chipA);
  }, [chipA, chipB]);

  // ── Render ─────────────────────────────────────────────────────────────
  const chip = (id: number | null, clear: () => void, placeholder: string) =>
    id !== null ? (
      <span className="mp-chip set">
        {short(props.trackById(id), id)}
        <button className="mp-chipx" onClick={clear} title="Clear">
          ✕
        </button>
      </span>
    ) : (
      <span className="mp-chip empty">{placeholder}</span>
    );

  return (
    <div className="mp-panel" onKeyDown={onKeyDown}>
      <div className="mp-chips">
        {chip(chipA, () => setChipA(null), chipB !== null ? 'outgoing…' : 'track…')}
        <button
          className="btn btn-mini mp-flip"
          onClick={flip}
          disabled={chipA === null && chipB === null}
          title="Flip direction (A ⇄ B)"
        >
          ⇄
        </button>
        {chip(chipB, () => setChipB(null), 'incoming…')}
      </div>
      <input
        ref={inputRef}
        className="input mp-search"
        placeholder={
          chipA === null
            ? 'search tracks…'
            : chipB === null
              ? 'second track… (Enter picks)'
              : 'move page — Esc to widen'
        }
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
        }}
        disabled={chipA !== null && chipB !== null}
      />
      {pickingTracks && (
        <div className="mp-list">
          {trackMatches.map((t, i) => (
            <div
              key={t.id}
              className={`mp-row${i === highlight ? ' hl' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pickTrack(t.id);
              }}
            >
              <span className="mp-glyph">♫</span>
              <span className="mp-label">{trackLabel(t)}</span>
              {t.bpm ? <span className="mp-meta">{Math.round(t.bpm)} BPM</span> : null}
            </div>
          ))}
          {trackMatches.length === 0 && <div className="mp-none">no tracks match</div>}
        </div>
      )}
      {!pickingTracks && (
        <div className="mp-list">
          {grouped.map((g) => (
            <div key={g.group}>
              <div className="mp-group">{g.group}</div>
              {g.rows.map(({ row, flat }) => {
                const key = `${g.group}:${refKey(row.ref)}`;
                const isRenaming = renaming === key;
                const isOpen =
                  props.openRefKey !== null && refKey(row.ref) === props.openRefKey;
                return (
                  <div
                    key={key}
                    className={`mp-row${flat === highlight ? ' hl' : ''}${isOpen ? ' open' : ''}`}
                    onMouseEnter={() => setHighlight(flat)}
                  onMouseDown={(e) => {
                    if (isRenaming) return;
                    e.preventDefault();
                    openRef(row.ref);
                  }}
                >
                  <span className="mp-glyph">{row.glyph}</span>
                  <span className="mp-rowmain">
                    <span className="mp-rowtop">
                      {isRenaming && row.ref.kind === 'transition' ? (
                        <input
                          className="input mp-rename"
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              props.onRenameTransition(row.ref as never, renameDraft);
                              setRenaming(null);
                            } else if (e.key === 'Escape') setRenaming(null);
                          }}
                          onBlur={() => setRenaming(null)}
                        />
                      ) : (
                        <span className="mp-label">
                          {row.favorite ? '★ ' : ''}
                          {row.label}
                        </span>
                      )}
                      {row.meta && <span className="mp-meta">{row.meta}</span>}
                    </span>
                    {row.tracks && <span className="mp-rowtracks">{row.tracks}</span>}
                  </span>
                  {row.editable && row.ref.kind === 'transition' && !isRenaming && (
                    <span className="mp-tools" onMouseDown={(e) => e.stopPropagation()}>
                      <button
                        title={row.favorite ? 'Unfavorite' : 'Favorite'}
                        className={`btn btn-mini${row.favorite ? ' on' : ''}`}
                        onClick={() => props.onToggleFavoriteTransition(row.ref as never)}
                      >
                        ★
                      </button>
                      <button
                        className="btn btn-mini"
                        title="Rename"
                        onClick={() => {
                          setRenaming(key);
                          setRenameDraft(row.label === 'Transition' ? '' : row.label);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        title={confirmDelete === key ? 'Click again to delete' : 'Delete'}
                        className={`btn btn-mini${confirmDelete === key ? ' sure' : ''}`}
                        onClick={() => {
                          if (confirmDelete === key) {
                            props.onDeleteTransition(row.ref as never);
                            setConfirmDelete(null);
                          } else setConfirmDelete(key);
                        }}
                      >
                        {confirmDelete === key ? 'sure?' : '✕'}
                      </button>
                    </span>
                  )}
                  </div>
                );
              })}
            </div>
          ))}
          {rows.length === 0 && (
            <div className="mp-none">
              {chipA !== null ? 'nothing recorded here yet' : 'type to search tracks'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
