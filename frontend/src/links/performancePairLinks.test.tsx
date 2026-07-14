// @vitest-environment jsdom
// Six-pair Link toggles (four-deck-performance 19) at the chip seam: a
// chip toggles exactly its own unordered pair, disables without a
// distinct loaded pair, and the diagonal mini-map names its corners.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { PairDiagonalChip, PairEdgeChip } from './PerformancePairLinks';
import { _resetLinkStoreForTests, applyLinkRows, isLinked, snapshotLinks } from './linkStore';
import type { Track } from '../types';

// The linkable hint reads the transition index; its store boots against
// the backend and localStorage — fake it empty at the hook seam so the
// chip tests exercise only Link state.
vi.mock('../editor/transitionIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../editor/transitionIndex')>()),
  useTransitionIndex: () => ({ from: new Map(), into: new Map() }),
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeTrack(id: number, title: string): Track {
  return {
    id,
    filename: `/tracks/${id}.mp3`,
    title,
    created_at: '2026-07-13T00:00:00Z',
    updated_at: '2026-07-13T00:00:00Z',
    tags: [],
  } as unknown as Track;
}

const offender = makeTrack(1, 'Offender');
const wicked = makeTrack(2, 'Wicked & Dark');

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  _resetLinkStoreForTests();
  // Fake at the network seam (linkStore.test.ts idiom): optimistic UI is
  // under test; writes and the boot GETs never reach a real backend.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200 }))
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(el: ReactElement): HTMLButtonElement {
  act(() => root.render(el));
  return container.querySelector('button')!;
}

describe('PairEdgeChip', () => {
  it('disables without two distinct loaded Tracks', () => {
    const empty = render(<PairEdgeChip a="A" b="B" ta={offender} tb={null} />);
    expect(empty.disabled).toBe(true);

    const self = render(<PairEdgeChip a="A" b="B" ta={offender} tb={offender} />);
    expect(self.disabled).toBe(true);
    expect(self.title).toContain('same Track');
  });

  it('renders the stored Linked fact and names the pair', () => {
    applyLinkRows([{ low_track_id: 1, high_track_id: 2 }]);
    const chip = render(<PairEdgeChip a="A" b="B" ta={offender} tb={wicked} />);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(chip.className).toContain('linked');
    expect(chip.title).toContain('Unlink A (Offender) ↔ B (Wicked & Dark)');
  });

  it('toggles exactly its own unordered pair, optimistically', () => {
    const chip = render(<PairEdgeChip a="C" b="D" ta={offender} tb={wicked} />);
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    act(() => chip.click());
    expect(isLinked(snapshotLinks(), 1, 2)).toBe(true);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(snapshotLinks().size).toBe(1);

    act(() => chip.click());
    expect(isLinked(snapshotLinks(), 1, 2)).toBe(false);
  });
});

describe('PairDiagonalChip', () => {
  it('maps its Deck letters to the corners the stroke joins', () => {
    const ad = render(<PairDiagonalChip a="A" b="D" ta={offender} tb={wicked} />);
    const adLetters = ad.querySelectorAll('.pairlink-diag-letter');
    expect(adLetters[0].className).toContain('pos-tl');
    expect(adLetters[1].className).toContain('pos-br');

    const bc = render(<PairDiagonalChip a="B" b="C" ta={offender} tb={wicked} />);
    const bcLetters = bc.querySelectorAll('.pairlink-diag-letter');
    expect(bcLetters[0].className).toContain('pos-tr');
    expect(bcLetters[1].className).toContain('pos-bl');
  });

  it('toggles its pair like any other Link surface', () => {
    const chip = render(<PairDiagonalChip a="A" b="D" ta={offender} tb={wicked} />);
    act(() => chip.click());
    expect(isLinked(snapshotLinks(), 1, 2)).toBe(true);
    expect(chip.className).toContain('linked');
  });
});
