import type { MidiAction } from './actions';
import { controllerAttached, controllerDetached } from './connectionStore';
import { allOffMessages } from './feedback';
import type { Mapping } from './mapping';
import { controllerOutputAttached, controllerOutputDetached } from './outputStore';
import { initialDecoderState, translateMidiMessage } from './translator';
import type { DecoderState } from './translator';

/**
 * The thin Web MIDI adapter (PRD layering): permission request, port
 * discovery, matching each connected port to a Mapping by port-name
 * substring, hot-plug reconnect via statechange. All translation lives
 * behind the tested translator seam; this file stays hands-on-hardware
 * verified per house style (ADR 0002 — no Web MIDI mocking).
 *
 * Decoder state is per port and reset on (re)connect, so a replug never
 * resumes a stale held-button picture.
 *
 * Output side (midi-pad-leds 01): output ports match Mappings by the same
 * name substring; each match publishes a send capability to the output
 * store for the feedback bridge. All-off is sent on detach and on dispose
 * so stale light state never lingers on the hardware.
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
    attached.set(input, () => {
      input.removeEventListener('midimessage', onMessage);
      controllerDetached(input.id);
    });
    controllerAttached(input.id, input.name ?? 'MIDI controller');
  };

  const detachPort = (input: MIDIInput) => {
    attached.get(input)?.();
    attached.delete(input);
  };

  const attachedOutputs = new Map<MIDIOutput, () => void>();

  const attachOutput = (output: MIDIOutput) => {
    if (attachedOutputs.has(output)) return;
    const mapping = mappings.find((m) => (output.name ?? '').includes(m.portNameMatch));
    if (!mapping) return;

    controllerOutputAttached(output.id, {
      mapping,
      send: (message) => output.send([...message]),
    });
    attachedOutputs.set(output, () => {
      controllerOutputDetached(output.id);
      // Darken every mapped light; best-effort (the port may already be
      // gone on unplug — only dispose/release is guaranteed deliverable).
      if (mapping.feedback && output.state === 'connected') {
        try {
          for (const message of allOffMessages(mapping.feedback)) {
            output.send([...message]);
          }
        } catch {
          // Port vanished mid-send: nothing left to darken.
        }
      }
    });
  };

  const detachOutput = (output: MIDIOutput) => {
    attachedOutputs.get(output)?.();
    attachedOutputs.delete(output);
  };

  // React effect cleanups never run on tab close/reload, so the dispose
  // path alone can't satisfy "lights go dark when the app releases the
  // device" — pagehide is the last moment a send can still flush.
  const onPageHide = () => {
    for (const detach of attachedOutputs.values()) detach();
    attachedOutputs.clear();
  };
  window.addEventListener('pagehide', onPageHide);

  const scan = () => {
    if (!access) return;
    for (const input of access.inputs.values()) {
      if (input.state === 'connected') attachPort(input);
    }
    for (const output of access.outputs.values()) {
      if (output.state === 'connected') attachOutput(output);
    }
  };

  const onStateChange = (event: Event) => {
    const port = (event as MIDIConnectionEvent).port;
    if (!port) return;
    if (port.type === 'input') {
      const input = port as MIDIInput;
      if (input.state === 'disconnected') detachPort(input);
      else attachPort(input);
    } else {
      const output = port as MIDIOutput;
      if (output.state === 'disconnected') detachOutput(output);
      else attachOutput(output);
    }
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
    window.removeEventListener('pagehide', onPageHide);
    for (const detach of attached.values()) detach();
    attached.clear();
    for (const detach of attachedOutputs.values()) detach();
    attachedOutputs.clear();
  };
}
