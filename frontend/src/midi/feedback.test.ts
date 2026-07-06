/**
 * Feedback seam (midi-pad-leds 01): pure state-in/messages-out — synthetic
 * deck state and the real Inpulse Mapping's feedback section, no Web MIDI,
 * no engine (ADR 0002). Byte expectations follow Mixxx's Inpulse 300
 * mapping (the LED ground truth cited in mappings/inpulse300mk2.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  BLINK_INTERVAL_MS,
  CUE_FLASH_INTERVAL_MS,
  allOffMessages,
  audibleTransportOverride,
  blinkPhase,
  encodeDeckLeds,
  ledStates,
} from './feedback';
import { INPULSE_300_MK2 } from './mappings/inpulse300mk2';

const feedback = INPULSE_300_MK2.feedback!;

const idle = {
  playing: false,
  pendingPlay: false,
  previewing: false,
  hasCuePoint: false,
  atCuePoint: false,
  assignedPads: new Set<number>(),
  pfl: false,
  hasBeatgrid: false,
};

const lit = { pending: true, cueFlash: true };
const dim = { pending: false, cueFlash: false };

describe('ledStates', () => {
  it('PLAY is solid while playing', () => {
    expect(ledStates({ ...idle, playing: true }).play).toBe(true);
  });

  it('PLAY is off while paused', () => {
    expect(ledStates({ ...idle, playing: false }).play).toBe(false);
  });

  it('PLAY follows the pending phase while play is latched during a load', () => {
    expect(ledStates({ ...idle, pendingPlay: true }, lit).play).toBe(true);
    expect(ledStates({ ...idle, pendingPlay: true }, dim).play).toBe(false);
  });

  it('PLAY ignores the phases while actually playing', () => {
    expect(ledStates({ ...idle, playing: true }, dim).play).toBe(true);
  });

  it('CUE is solid when paused at the cue point (stab armed), any phase', () => {
    const armed = { ...idle, hasCuePoint: true, atCuePoint: true };
    expect(ledStates(armed, lit).cue).toBe(true);
    expect(ledStates(armed, dim).cue).toBe(true);
  });

  it('CUE is lit during hold-to-preview, any phase', () => {
    expect(ledStates({ ...idle, previewing: true }, dim).cue).toBe(true);
  });

  it('CUE flashes while paused away from the cue point (mirrors the screen)', () => {
    const away = { ...idle, hasCuePoint: true, atCuePoint: false };
    expect(ledStates(away, lit).cue).toBe(true);
    expect(ledStates(away, dim).cue).toBe(false);
  });

  it('CUE is off while paused with no cue point set', () => {
    expect(ledStates(idle, lit).cue).toBe(false);
  });

  it('CUE is off while playing, even over the cue point', () => {
    expect(ledStates({ ...idle, playing: true, hasCuePoint: true, atCuePoint: true }).cue).toBe(
      false
    );
    expect(ledStates({ ...idle, playing: true, hasCuePoint: true }, lit).cue).toBe(false);
  });

  it('lights exactly the assigned pad slots', () => {
    const states = ledStates({ ...idle, assignedPads: new Set([1, 3, 8]) });
    expect(states.pads).toEqual([true, false, true, false, false, false, false, true]);
  });

  it('all eight pads are dark with nothing assigned (empty deck)', () => {
    expect(ledStates(idle).pads).toEqual(new Array(8).fill(false));
  });

  it('ignores slot numbers outside the pad grid', () => {
    const states = ledStates({ ...idle, assignedPads: new Set([0, 9, 42]) });
    expect(states.pads).toEqual(new Array(8).fill(false));
  });

  it('PFL mirrors the mixer channel state, any phase (headphone-cue 05)', () => {
    expect(ledStates({ ...idle, pfl: true }, lit).pfl).toBe(true);
    expect(ledStates({ ...idle, pfl: true }, dim).pfl).toBe(true);
    expect(ledStates(idle).pfl).toBe(false);
  });

  it('PFL is independent of transport state', () => {
    expect(ledStates({ ...idle, playing: true, pfl: true }).pfl).toBe(true);
    expect(ledStates({ ...idle, playing: true, pfl: false }).pfl).toBe(false);
  });

  it('grid pads light steadily iff the Track has a Beatgrid, pad 3 dark always (midi-performance-ops 05)', () => {
    expect(ledStates({ ...idle, hasBeatgrid: true }).gridPads).toEqual([
      true, // 1: nudge earlier
      true, // 2: anchor
      false, // 3: unbound — dark always
      true, // 4: nudge later
      true, // 5: shrink
      true, // 6: grow
      true, // 7: halve
      true, // 8: double
    ]);
    expect(ledStates({ ...idle, hasBeatgrid: false }).gridPads).toEqual(
      new Array(8).fill(false)
    );
  });

  it('grid pads are steady — independent of transport state and phases', () => {
    const gridded = { ...idle, hasBeatgrid: true, playing: true, pendingPlay: true };
    expect(ledStates(gridded, lit).gridPads[0]).toBe(true);
    expect(ledStates(gridded, dim).gridPads[0]).toBe(true);
  });
});

describe('audibleTransportOverride (editor-midi 05)', () => {
  const busy = {
    playing: false,
    pendingPlay: true,
    previewing: true,
    hasCuePoint: true,
    atCuePoint: true,
    assignedPads: new Set([1, 4]),
    pfl: true,
    hasBeatgrid: true,
  };

  it('PLAY follows the audible holder (both decks report the one mix transport)', () => {
    expect(ledStates(audibleTransportOverride(idle, true)).play).toBe(true);
    expect(ledStates(audibleTransportOverride({ ...idle, playing: true }, false)).play).toBe(false);
  });

  it('CUE goes dark regardless of the shared deck cue state — no editor meaning', () => {
    expect(ledStates(audibleTransportOverride(busy, true), lit).cue).toBe(false);
    expect(ledStates(audibleTransportOverride(busy, false), dim).cue).toBe(false);
  });

  it('shared-surface blinks are suppressed (pending-play PLAY never blinks)', () => {
    expect(ledStates(audibleTransportOverride(busy, false), lit).play).toBe(false);
    expect(ledStates(audibleTransportOverride(busy, false), dim).play).toBe(false);
  });

  it('pads and PFL pass through untouched (pair mirroring keeps them true)', () => {
    const states = ledStates(audibleTransportOverride(busy, true));
    expect(states.pads[0]).toBe(true);
    expect(states.pads[3]).toBe(true);
    expect(states.pads[1]).toBe(false);
    expect(states.pfl).toBe(true);
  });

  it('grid pads pass through untouched (stored-data lamps ignore audibility)', () => {
    expect(ledStates(audibleTransportOverride(busy, false)).gridPads[0]).toBe(true);
  });
});

const dark = ledStates(idle);

describe('encodeDeckLeds', () => {
  it('encodes deck A PLAY on as a note-on at the mapped address', () => {
    const messages = encodeDeckLeds(feedback, 'A', { ...dark, play: true });
    expect(messages).toContainEqual([0x91, 0x07, 0x7f]);
  });

  it('encodes deck B PLAY off as velocity zero on its own channel', () => {
    const messages = encodeDeckLeds(feedback, 'B', { ...dark, play: false });
    expect(messages).toContainEqual([0x92, 0x07, 0x00]);
  });

  it('encodes CUE at its mapped address per deck', () => {
    expect(encodeDeckLeds(feedback, 'A', { ...dark, cue: true })).toContainEqual([
      0x91, 0x06, 0x7f,
    ]);
    expect(encodeDeckLeds(feedback, 'B', { ...dark, cue: false })).toContainEqual([
      0x92, 0x06, 0x00,
    ]);
  });

  it('encodes pads on the HOTCUE base-layer addresses (Mixxx ground truth)', () => {
    const states = ledStates({ ...idle, assignedPads: new Set([1, 8]) });
    const messagesA = encodeDeckLeds(feedback, 'A', states);
    expect(messagesA).toContainEqual([0x96, 0x00, 0x7e]); // pad 1 lit
    expect(messagesA).toContainEqual([0x96, 0x07, 0x7e]); // pad 8 lit
    expect(messagesA).toContainEqual([0x96, 0x03, 0x00]); // pad 4 dark
    const messagesB = encodeDeckLeds(feedback, 'B', states);
    expect(messagesB).toContainEqual([0x97, 0x00, 0x7e]); // deck B channel
  });

  it('mirrors pad states onto the SHIFT-layer addresses (notes +8)', () => {
    const states = ledStates({ ...idle, assignedPads: new Set([1, 8]) });
    const messagesA = encodeDeckLeds(feedback, 'A', states);
    expect(messagesA).toContainEqual([0x96, 0x08, 0x7e]); // shifted pad 1 lit
    expect(messagesA).toContainEqual([0x96, 0x0f, 0x7e]); // shifted pad 8 lit
    expect(messagesA).toContainEqual([0x96, 0x0b, 0x00]); // shifted pad 4 dark
    const messagesB = encodeDeckLeds(feedback, 'B', states);
    expect(messagesB).toContainEqual([0x97, 0x08, 0x7e]); // deck B shifted layer
  });

  it('encodes grid pads on the SAMPLER-layer addresses (midi-performance-ops 05)', () => {
    const gridded = ledStates({ ...idle, hasBeatgrid: true });
    const messagesA = encodeDeckLeds(feedback, 'A', gridded);
    expect(messagesA).toContainEqual([0x96, 0x30, 0x7e]); // pad 1 lit
    expect(messagesA).toContainEqual([0x96, 0x32, 0x00]); // pad 3 dark always
    expect(messagesA).toContainEqual([0x96, 0x37, 0x7e]); // pad 8 lit
    const messagesB = encodeDeckLeds(feedback, 'B', gridded);
    expect(messagesB).toContainEqual([0x97, 0x30, 0x7e]); // deck B channel

    const gridless = encodeDeckLeds(feedback, 'A', ledStates(idle));
    expect(gridless).toContainEqual([0x96, 0x30, 0x00]);
    expect(gridless).toContainEqual([0x96, 0x37, 0x00]);
  });

  it('encodes PFL at its button note per deck (headphone-cue 05)', () => {
    expect(encodeDeckLeds(feedback, 'A', { ...dark, pfl: true })).toContainEqual([
      0x91, 0x0c, 0x7f,
    ]);
    expect(encodeDeckLeds(feedback, 'B', { ...dark, pfl: false })).toContainEqual([
      0x92, 0x0c, 0x00,
    ]);
  });

  it('covers every light of the deck exactly once', () => {
    const messages = encodeDeckLeds(feedback, 'A', dark);
    const addresses = messages.map(([status, number]) => `${status}:${number}`);
    expect(new Set(addresses).size).toBe(addresses.length);
    // PLAY + CUE + PFL + 2×8 hot-cue pads + 8 grid pads
    expect(addresses.length).toBeGreaterThanOrEqual(27);
  });
});

describe('blinkPhase', () => {
  it('alternates every interval under a fed clock (~2 Hz default)', () => {
    expect(blinkPhase(0)).toBe(true);
    expect(blinkPhase(BLINK_INTERVAL_MS - 1)).toBe(true);
    expect(blinkPhase(BLINK_INTERVAL_MS)).toBe(false);
    expect(blinkPhase(2 * BLINK_INTERVAL_MS)).toBe(true);
    expect(blinkPhase(3 * BLINK_INTERVAL_MS)).toBe(false);
  });

  it('completes a full on/off cycle in 2×interval (2 Hz at 250ms)', () => {
    const t = 1234567; // arbitrary epoch offset — phase is clock-derived
    expect(blinkPhase(t + 2 * BLINK_INTERVAL_MS)).toBe(blinkPhase(t));
    expect(blinkPhase(t + BLINK_INTERVAL_MS)).toBe(!blinkPhase(t));
  });

  it('cue flash runs a 1s cycle (the on-screen CUE flash period)', () => {
    const t = 424242;
    expect(blinkPhase(t + CUE_FLASH_INTERVAL_MS, CUE_FLASH_INTERVAL_MS)).toBe(
      !blinkPhase(t, CUE_FLASH_INTERVAL_MS)
    );
    expect(blinkPhase(t + 1000, CUE_FLASH_INTERVAL_MS)).toBe(blinkPhase(t, CUE_FLASH_INTERVAL_MS));
  });
});

describe('allOffMessages', () => {
  it('darkens every mapped light on both decks', () => {
    const messages = allOffMessages(feedback);
    // Every message is a velocity-zero note-on.
    for (const [status, , velocity] of messages) {
      expect(status >> 4).toBe(0x9);
      expect(velocity).toBe(0x00);
    }
    // Both decks' PLAY + CUE + PFL LEDs and pad grids (both layers) are covered.
    expect(messages).toContainEqual([0x91, 0x07, 0x00]);
    expect(messages).toContainEqual([0x92, 0x07, 0x00]);
    expect(messages).toContainEqual([0x91, 0x06, 0x00]);
    expect(messages).toContainEqual([0x92, 0x06, 0x00]);
    expect(messages).toContainEqual([0x91, 0x0c, 0x00]);
    expect(messages).toContainEqual([0x92, 0x0c, 0x00]);
    expect(messages).toContainEqual([0x96, 0x05, 0x00]);
    expect(messages).toContainEqual([0x97, 0x02, 0x00]);
    expect(messages).toContainEqual([0x96, 0x0d, 0x00]);
    expect(messages).toContainEqual([0x97, 0x0a, 0x00]);
    // Grid-edit (SAMPLER) pad lamps are covered too.
    expect(messages).toContainEqual([0x96, 0x30, 0x00]);
    expect(messages).toContainEqual([0x97, 0x37, 0x00]);
  });
});
