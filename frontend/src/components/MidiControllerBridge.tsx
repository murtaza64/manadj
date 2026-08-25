import { useEffect } from 'react';
import { attachMidiController } from '../midi/adapter';
import { markMidiActivity } from '../midi/activity';
import { dispatchMidiAction, forgetHardwareState } from '../midi/dispatch';
import { INPULSE_300_MK2 } from '../midi/mappings/inpulse300mk2';
import { DDJ_GRV6 } from '../midi/mappings/ddjGrv6';

/**
 * Mounts the Controller layer once, above the view switch (PRD scope):
 * deck actions work in every view, and a mid-mix flip to the library never
 * detaches the hardware. Dispatch routes through the audible-surface
 * arbiter (ADR 0013), so the bridge needs no deck plumbing and never
 * re-attaches (re-attaching would re-request MIDI access).
 */
export function MidiControllerBridge() {
  useEffect(
    () =>
      attachMidiController({
        mappings: [INPULSE_300_MK2, DDJ_GRV6],
        onActivity: markMidiActivity,
        onAction: dispatchMidiAction,
        // Unplug forgets the physical-hardware picture (midi-controller
        // 20): software values survive; a replug re-latches via pickup.
        onPortDetached: forgetHardwareState,
      }),
    []
  );

  return null;
}
