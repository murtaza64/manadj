/**
 * Audition takeover (gh#186): the Set Conductor's takeover contract,
 * honored by the editor auditions (Transition editor's MixPlayer and the
 * Routine editor's RoutinePlayer share this seam).
 *
 * While an editor holds audibility, the automation overlay owns the lane
 * params — a hand on a mixer control writes BASE state and audibly does
 * NOTHING (mixer.ts gates base application on the overlay). The Conductor
 * answers the same gesture with a takeover: stop conducting, decks keep
 * sounding, the sounding (automation) values land in base state so the
 * disengage reapply is inaudible — sparing the fields the user's own
 * gesture just set. This module is that contract for the editors: a
 * field-level diff of base mixer state (the Conductor's watchMixer,
 * generalized) that fires one takeover per human gesture.
 *
 * The players write only setAutomation (never notifies) and the editor
 * shells never write base mixer state, so any base notify while the
 * editor holds is a human hand — no self-op counter needed; only the
 * takeover's OWN base-sync writes are guarded (the `firing` flag).
 *
 * Deliberately NOT watched: the deck engines. Editor transport-class
 * hardware routes through the surface registration (one mix transport),
 * and the players' own engine writes (per-tick sync, applyPitch on every
 * lane drag) carry no self-op guard — engine watching would read the
 * audition's own driving as a gesture.
 */
import {
  CHANNEL_IDS,
  type ChannelId,
  type Mixer,
} from '../playback/mixer';
import {
  isAudible,
  releaseAudible,
  type AudibleSurfaceId,
} from '../playback/audibleSurface';

export interface AuditionTakeoverOpts {
  mixer: Mixer;
  /** The surface whose audition this watcher guards ('editor' /
   * 'routine-editor'). Gestures while it is NOT the holder are ignored
   * (last-values still track reality, exactly like the Conductor). */
  surface: AudibleSurfaceId;
  /** Stop the audition WITHOUT pausing the decks — they keep sounding as
   * they are (MixPlayer/RoutinePlayer.standDown). Called before release,
   * so the arbiter's release→silence() lands on a stopped transport and
   * pauses nothing. */
  standDown(): void;
  /** Cancel any pending audition arm — a takeover must never let a
   * deferred play fire after the release. */
  cancelArm(): void;
  /** Yield the overlay owner token for the disengage and clear the
   * shell's borrow refs (pitch checkpoint included: the user keeps the
   * sounding decks, rate and all — the Conductor's takeover contract).
   * Null = never engaged (nothing to disengage). */
  takeToken(): symbol | null;
}

/**
 * Watch base mixer state for manual gestures while `surface` holds
 * audibility; on the first touched field, run the takeover. Returns the
 * unsubscribe. Mount alongside the surface registration.
 */
export function watchAuditionTakeover(opts: AuditionTakeoverOpts): () => void {
  const { mixer, surface } = opts;

  /** The takeover's own base-sync writes notify too — gate reentry. */
  let firing = false;

  const takeover = (touched: ReadonlySet<string>): void => {
    firing = true;
    try {
      opts.cancelArm();
      opts.standDown();
      // Sounding (automation) values into base, field by field, skipping
      // what the user's gesture just set — BEFORE the release flips
      // capture's gate (the recorder re-seeds from what the user hears)
      // and before the disengage reapplies base (inaudible by
      // construction).
      const skip = (key: string) => touched.has(key);
      for (const ch of CHANNEL_IDS) {
        const v = mixer.getAutomation(ch);
        if (!v) continue; // never lane-driven — base is already the truth
        if (!skip(`${ch}.fader`)) mixer.setFader(ch, v.fader);
        if (!skip(`${ch}.eqLow`)) mixer.setEq(ch, 'low', v.eq.low);
        if (!skip(`${ch}.eqMid`)) mixer.setEq(ch, 'mid', v.eq.mid);
        if (!skip(`${ch}.eqHigh`)) mixer.setEq(ch, 'high', v.eq.high);
        if (!skip(`${ch}.filter`)) mixer.setFilter(ch, v.filter);
        // A lane WITHOUT trim never owned the node (sessions 15).
        if (v.trim !== undefined && !skip(`${ch}.trim`)) mixer.setTrim(ch, v.trim);
      }
      // The engaged overlay pins the crossfader neutral — land that.
      if (!skip('crossfader')) mixer.setCrossfader(0);
      // Disengage (owner-only; reapplies the base we just synced), then
      // release — the Conductor's teardown order. silence() is a no-op:
      // standDown already stopped the transport, so the decks keep
      // sounding through the release.
      const token = opts.takeToken();
      if (token) mixer.disengageAutomation(token);
      if (isAudible(surface)) releaseAudible(surface);
    } finally {
      firing = false;
    }
  };

  // Primitive last-values updated in place, diffed per notify with the
  // changed-field hint (the Conductor's watchMixer shape). Track reality
  // even while not the holder — only the takeover is gated.
  const readCh = (ch: ChannelId) => {
    const c = mixer.getChannelState(ch);
    return {
      fader: c.fader,
      eqLow: c.eq.low,
      eqMid: c.eq.mid,
      eqHigh: c.eq.high,
      filter: c.filter,
      trim: c.trim,
      pfl: c.pfl,
    };
  };
  const lastCh = new Map(CHANNEL_IDS.map((ch) => [ch, readCh(ch)]));
  const last = {
    crossfader: mixer.getCrossfader(),
    crossfaderEnabled: mixer.getCrossfaderEnabled(),
    master: mixer.getMaster(),
  };
  return mixer.subscribe((changed) => {
    const touched = new Set<string>();
    const diffCh = (ch: ChannelId): void => {
      const c = mixer.getChannelState(ch);
      const l = lastCh.get(ch)!;
      if (c.fader !== l.fader) touched.add(`${ch}.fader`);
      if (c.eq.low !== l.eqLow) touched.add(`${ch}.eqLow`);
      if (c.eq.mid !== l.eqMid) touched.add(`${ch}.eqMid`);
      if (c.eq.high !== l.eqHigh) touched.add(`${ch}.eqHigh`);
      if (c.filter !== l.filter) touched.add(`${ch}.filter`);
      if (c.trim !== l.trim) touched.add(`${ch}.trim`);
      if (c.pfl !== l.pfl) touched.add(`${ch}.pfl`);
      lastCh.set(ch, readCh(ch));
    };
    const all = changed === undefined;
    for (const ch of CHANNEL_IDS) {
      if (all || changed === ch) diffCh(ch);
    }
    if (all || changed === 'crossfader') {
      const xf = mixer.getCrossfader();
      if (xf !== last.crossfader) touched.add('crossfader');
      last.crossfader = xf;
    }
    if (all || changed === 'crossfaderEnabled') {
      const on = mixer.getCrossfaderEnabled();
      if (on !== last.crossfaderEnabled) touched.add('crossfaderEnabled');
      last.crossfaderEnabled = on;
    }
    if (all || changed === 'master') {
      const master = mixer.getMaster();
      if (master !== last.master) touched.add('master');
      last.master = master;
    }
    if (firing || !isAudible(surface)) return;
    if (touched.size > 0) takeover(touched);
  });
}
