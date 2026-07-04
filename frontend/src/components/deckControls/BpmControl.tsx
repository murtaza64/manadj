/**
 * The one BPM control (deck-controls PRD, curation class — bit-identical
 * semantics in every mode, ONE implementation). Shows the PROJECTED BPM
 * (ADR 0016): the grid's dominant tempo when a beatgrid exists, else
 * track.bpm; variable grids render a read-only `~N (var)` readout.
 *
 * Edits commit through one serialized chain (bpmCommit.ts) → the tracks
 * PATCH (which re-tempos/regenerates the grid server-side) → beatgrid +
 * track query invalidation. A 409 (grid went variable under us) reverts
 * the draft.
 *
 * Density-parameterized feature union: the full variant carries the
 * library's suggestion/octave dropdown; `dense` (PERF/editor) drops the
 * dropdown. Both keep the ±0.03 micro-nudges (grid compress/spread icons)
 * and the `1/2` / `x2` shortcuts. The effective-BPM readout stays a
 * per-surface concern beside the control.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useBeatgridData } from '../../hooks/useBeatgridData';
import { BpmCompressIcon, BpmSpreadIcon } from '../icons/BpmIcons';
import {
  createBpmCommitter,
  formatBpm,
  nudgeBpm,
  projectBpm,
  type BpmCommitter,
} from './bpmCommit';
import type { Track } from '../../types';
import './deckControls.css';

export interface BpmControlProps {
  track: Track | null;
  /** Dense (PERF/editor): input + micro-nudges + 1/2 x2, no dropdown. */
  dense?: boolean;
  disabled?: boolean;
  /** Full variant: analysis suggestions offered in the dropdown. */
  recommendedBpms?: number[];
  /** The PATCH. Defaults to api.tracks.update(track.id, { bpm }). */
  onSave?: (bpm: number) => void | Promise<unknown>;
  /** After each successful commit (e.g. player.setBpm + onBpmSaved). */
  onCommitted?: (bpm: number) => void;
}

export function BpmControl({
  track,
  dense = false,
  disabled = false,
  recommendedBpms,
  onSave,
  onCommitted,
}: BpmControlProps) {
  const queryClient = useQueryClient();
  const { data: grid, error: gridError } = useBeatgridData(track?.id ?? null);

  const projection = useMemo(
    () =>
      projectBpm(
        gridError ? null : grid?.data ?? null,
        track?.bpm ?? null,
        track?.duration_secs ?? null
      ),
    [grid, gridError, track?.bpm, track?.duration_secs]
  );
  const projected =
    projection.kind === 'none' ? null : projection.bpm;

  /** Last committed-but-not-yet-refetched value (nudges accumulate on it). */
  const [optimistic, setOptimistic] = useState<number | null>(null);
  const base = optimistic ?? projected;

  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  // Server truth arrived and matches what we committed — hand display back.
  useEffect(() => {
    setOptimistic((prev) =>
      prev !== null && projected !== null && Math.abs(prev - projected) < 0.005
        ? null
        : prev
    );
  }, [projected]);

  // Track switched under the control — drop any stale optimistic value.
  useEffect(() => {
    setOptimistic(null);
  }, [track?.id]);

  // The commit chain survives re-renders; prop reads go through a ref
  // (updated post-render, read only from the chain's async handlers).
  const latest = useRef({ track, onSave, onCommitted });
  useEffect(() => {
    latest.current = { track, onSave, onCommitted };
  });
  const committerRef = useRef<BpmCommitter | null>(null);
  const getCommitter = () => {
    committerRef.current ??= createBpmCommitter({
      save: async (bpm) => {
        const { track: t, onSave: save } = latest.current;
        if (!t) return;
        if (save) await save(bpm);
        else await api.tracks.update(t.id, { bpm });
      },
      onCommitted: (bpm) => {
        const { track: t, onCommitted: committed } = latest.current;
        if (t) {
          void queryClient.invalidateQueries({ queryKey: ['beatgrid', t.id] });
          void queryClient.invalidateQueries({ queryKey: ['track', t.id] });
        }
        committed?.(bpm);
      },
      onConflict: () => {
        // Toast-level for now: the console.warn happened in the chain;
        // revert the draft to server truth.
        setOptimistic(null);
      },
    });
    return committerRef.current;
  };

  const commit = (bpm: number) => {
    if (!track || !isFinite(bpm) || bpm <= 0) return;
    const rounded = Math.round(bpm * 100) / 100;
    if (base !== null && Math.abs(rounded - base) < 0.0005) return;
    setOptimistic(rounded);
    void getCommitter().commit(rounded);
  };

  const step = (direction: 1 | -1) => {
    if (base === null) return;
    commit(nudgeBpm(base, direction));
  };

  const scale = (factor: number) => {
    if (base === null) return;
    commit(base * factor);
  };

  // ── Variable grid: readout only, in all modes ──────────────────────────
  if (projection.kind === 'variable') {
    return (
      <span className={`deck-bpm${dense ? ' dense' : ''}`}>
        <span
          className="deck-bpm-var"
          title="variable beatgrid — edit the grid"
        >
          ~{Math.round(projection.bpm)} (var)
        </span>
      </span>
    );
  }

  const displayValue = isFocused ? draft : base !== null ? formatBpm(base) : '';
  const inputDisabled = disabled || !track;
  const buttonsDisabled = inputDisabled || base === null;

  // ── Suggestion/octave dropdown (full variant) ──────────────────────────
  const octaveOptions =
    base !== null
      ? [
          { bpm: Math.round(base * 2), label: '×2' },
          { bpm: Math.round(base * 1.5), label: '×3/2' },
          { bpm: Math.round(base * (2 / 3)), label: '×2/3' },
          { bpm: Math.round(base / 2), label: '×1/2' },
        ]
      : [];
  const uniqueOptions = Array.from(
    new Set([...(recommendedBpms ?? []), ...octaveOptions.map((o) => o.bpm)])
  ).sort((a, b) => b - a);
  const displayItems = uniqueOptions.map((bpm) => {
    const octave = octaveOptions.find((o) => o.bpm === bpm);
    return {
      bpm,
      label: octave ? `${bpm} BPM (${octave.label})` : `${bpm} BPM`,
      isRecommended: recommendedBpms?.includes(bpm) ?? false,
    };
  });
  const showDropdown = !dense && isFocused && displayItems.length > 0;

  const openDropdown = () => {
    if (dense || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownPosition({ top: rect.bottom + 2, left: rect.left });
    setSelectedIndex(-1);
  };

  const handleSelect = (bpm: number) => {
    setDraft(bpm.toString());
    commit(bpm);
    setIsFocused(false);
    inputRef.current?.blur();
  };

  const commitDraft = () => {
    const value = parseFloat(draft);
    if (!isNaN(value)) commit(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // keep typed digits away from keyboard hubs
    if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(base !== null ? formatBpm(base) : '');
      setIsFocused(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showDropdown && selectedIndex >= 0) {
        handleSelect(displayItems[selectedIndex].bpm);
      } else {
        commitDraft();
        setIsFocused(false);
        inputRef.current?.blur();
      }
      return;
    }
    if (!showDropdown || displayItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < displayItems.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
    }
  };

  return (
    <span className={`deck-bpm${dense ? ' dense' : ''}`}>
      <input
        ref={inputRef}
        type="text"
        className="deck-bpm-input"
        value={displayValue}
        placeholder="-"
        disabled={inputDisabled}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '' || next.match(/^\d*\.?\d*$/)) setDraft(next);
        }}
        onFocus={() => {
          setDraft(base !== null ? formatBpm(base) : '');
          setIsFocused(true);
          openDropdown();
          inputRef.current?.select();
        }}
        onBlur={() => {
          commitDraft();
          setIsFocused(false);
        }}
        onKeyDown={handleKeyDown}
      />
      <span className="deck-bpm-steps">
        <button
          className="player-button"
          disabled={buttonsDisabled}
          onClick={() => step(1)}
          title="Increase BPM by 0.03 (compress the grid)"
        >
          <BpmCompressIcon />
        </button>
        <button
          className="player-button"
          disabled={buttonsDisabled}
          onClick={() => step(-1)}
          title="Decrease BPM by 0.03 (spread the grid)"
        >
          <BpmSpreadIcon />
        </button>
      </span>
      <button
        className="player-button deck-bpm-scale"
        disabled={buttonsDisabled}
        onClick={() => scale(0.5)}
        title="Halve BPM"
      >
        1/2
      </button>
      <button
        className="player-button deck-bpm-scale"
        disabled={buttonsDisabled}
        onClick={() => scale(2)}
        title="Double BPM"
      >
        x2
      </button>
      {showDropdown && (
        <div
          className="deck-bpm-dropdown"
          style={{ top: dropdownPosition.top, left: dropdownPosition.left }}
        >
          {displayItems.map((item, index) => (
            <div
              key={item.bpm}
              className={
                'deck-bpm-option' +
                (selectedIndex === index ? ' active' : '') +
                (base !== null && item.bpm === Math.round(base) ? ' current' : '') +
                (item.isRecommended ? ' recommended' : '')
              }
              // preventDefault keeps the input focused so blur doesn't
              // commit a half-typed draft before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(item.bpm)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
