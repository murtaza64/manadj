import type { Mapping } from '../mapping';

/**
 * Hercules DJControl Inpulse 300 MK2 (glossary: Controller, Mapping).
 *
 * The device's exact MIDI implementation is established empirically against
 * the hardware; this file is the single place that knowledge lives (PRD
 * further notes). Every number below is a placeholder taken from the Mixxx
 * mapping for the (MK1) DJControl Inpulse 300
 * (mixxxdj/mixxx res/controllers/Hercules_DJControl_Inpulse_300.midi.xml:
 * deck A play/cue = status 0x91 notes 0x07/0x06, deck B = status 0x92 same
 * notes — i.e. MIDI channels 1 and 2, not 0 and 1) and must be confirmed
 * against the physical MK2.
 *
 * Port name: Mixxx identifies the MK1 as "DJControl Inpulse 300"; the MK2
 * is expected to enumerate as "DJControl Inpulse 300 MK2" (possibly with an
 * OS-specific prefix/suffix), so we match the common substring. Casing is
 * assumed to match Hercules' branding — verify against
 * navigator.requestMIDIAccess() port names on the real device.
 */
export const INPULSE_300_MK2: Mapping = {
  portNameMatch: 'DJControl Inpulse 300',
  bindings: [
    // Deck A: notes on channel 1 (status 0x91/0x81, per Mixxx).
    {
      // TODO(hardware-verify): deck A PLAY, note 0x07 on ch 1.
      match: { message: 'note', channel: 1, number: 0x07 },
      controlType: 'button',
      target: { control: 'transport', deck: 'A' },
    },
    {
      // TODO(hardware-verify): deck A CUE, note 0x06 on ch 1.
      match: { message: 'note', channel: 1, number: 0x06 },
      controlType: 'button',
      target: { control: 'cue', deck: 'A' },
    },
    // Deck B: same note numbers on channel 2 (status 0x92/0x82, per Mixxx).
    {
      // TODO(hardware-verify): deck B PLAY, note 0x07 on ch 2.
      match: { message: 'note', channel: 2, number: 0x07 },
      controlType: 'button',
      target: { control: 'transport', deck: 'B' },
    },
    {
      // TODO(hardware-verify): deck B CUE, note 0x06 on ch 2.
      match: { message: 'note', channel: 2, number: 0x06 },
      controlType: 'button',
      target: { control: 'cue', deck: 'B' },
    },
  ],
};
