import type { MidiAction } from './actions';
import type { Mapping } from './mapping';
import { initialDecoderState, translateMidiMessage } from './translator';
import type { DecoderState } from './translator';

/**
 * The thin Web MIDI adapter (PRD layering): permission request, input-port
 * discovery, matching each connected port to a Mapping by port-name
 * substring, hot-plug reconnect via statechange. All translation lives
 * behind the tested translator seam; this file stays hands-on-hardware
 * verified per house style (ADR 0002 — no Web MIDI mocking).
 *
 * Decoder state is per port and reset on (re)connect, so a replug never
 * resumes a stale held-button picture.
 */

export interface AttachMidiOptions {
  mappings: readonly Mapping[];
  onAction: (action: MidiAction) => void;
}

/** Attach once at the app provider level; returns a detach function. */
export function attachMidiController({ mappings, onAction }: AttachMidiOptions): () => void {
  let disposed = false;
  let access: MIDIAccess | null = null;
  const attached = new Map<MIDIInput, () => void>();

  const attachPort = (input: MIDIInput) => {
    if (attached.has(input)) return;
    const mapping = mappings.find((m) => (input.name ?? '').includes(m.portNameMatch));
    if (!mapping) return;

    let state: DecoderState = initialDecoderState();
    const onMessage = (event: MIDIMessageEvent) => {
      if (!event.data) return;
      const result = translateMidiMessage(event.data, state, mapping);
      state = result.state;
      for (const action of result.actions) onAction(action);
    };
    input.addEventListener('midimessage', onMessage);
    attached.set(input, () => input.removeEventListener('midimessage', onMessage));
  };

  const detachPort = (input: MIDIInput) => {
    attached.get(input)?.();
    attached.delete(input);
  };

  const scan = () => {
    if (!access) return;
    for (const input of access.inputs.values()) {
      if (input.state === 'connected') attachPort(input);
    }
  };

  const onStateChange = (event: Event) => {
    const port = (event as MIDIConnectionEvent).port;
    if (!port || port.type !== 'input') return;
    const input = port as MIDIInput;
    if (input.state === 'disconnected') detachPort(input);
    else attachPort(input);
  };

  if ('requestMIDIAccess' in navigator) {
    navigator.requestMIDIAccess().then(
      (midiAccess) => {
        if (disposed) return;
        access = midiAccess;
        access.addEventListener('statechange', onStateChange);
        scan();
      },
      (error: unknown) => {
        // Denied or unavailable: the Controller layer stays inert; keyboard
        // and pointer are unaffected.
        console.warn('MIDI access unavailable:', error);
      }
    );
  }

  return () => {
    disposed = true;
    access?.removeEventListener('statechange', onStateChange);
    for (const detach of attached.values()) detach();
    attached.clear();
  };
}
