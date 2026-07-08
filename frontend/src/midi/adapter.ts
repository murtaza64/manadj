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
 * The boot-time access request retries with backoff (midi-boot-retry 01):
 * a failed requestMIDIAccess at startup (an Electron/Chromium MIDI-service
 * race — observed both rejecting and HANGING unsettled) must not
 * permanently brick the Controller layer — without a statechange listener,
 * even a replug is a no-op. A watchdog times out hung attempts; the
 * failure is sticky per-renderer, so after a few dead attempts the adapter
 * reloads the page once (loop-guarded via sessionStorage) — the
 * known-good recovery. The bridge mounts once by design, so the adapter
 * owns all of this. Final failure degrades as before: warn, layer inert,
 * keyboard and pointer unaffected.
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
  onActivity?: () => void;
  onAction: (action: MidiAction) => void;
}

/** Attach once at the app provider level; returns a detach function. */
export function attachMidiController({ mappings, onActivity, onAction }: AttachMidiOptions): () => void {
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
      onActivity?.();
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

  // Backoff schedule for boot-time access retries: 6 attempts over ~30s.
  const retryDelaysMs = [1_000, 2_000, 4_000, 8_000, 15_000];
  // A boot request can also HANG (observed 2026-07-05: no settle, no logs,
  // badge dark, reload fixed it) — a watchdog treats an unsettled attempt
  // as failed and moves on. The dangling promise is left racing: if it
  // settles later, first success still wins.
  const attemptTimeoutMs = 4_000;
  // The failure is sticky per-renderer (in-page retries all die while a
  // plain reload recovers), so after this many dead attempts the adapter
  // reloads the page ONCE — early enough (~3-17s after mount) that nothing
  // is audibly playing yet. The sessionStorage flag survives the reload
  // and blocks a loop; the post-reload boot runs the full schedule and
  // then degrades as before.
  const reloadAfterAttempts = 3;
  const reloadFlag = 'manadj-midi-boot-reloaded';
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  // DOMException flattens to "[object DOMException]" through the desktop
  // shell's console forwarding — spell out name/message so the rejection
  // reason survives the pipe (the whole point of logging each attempt).
  const describeError = (error: unknown): string =>
    error instanceof DOMException || error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);

  const requestAccess = (attempt: number) => {
    // One failure handling per attempt, whether the watchdog fires first
    // or the promise rejects first (both can happen for one attempt).
    let failureHandled = false;
    const failAttempt = (reason: string) => {
      if (disposed || access || failureHandled) return;
      failureHandled = true;
      const attemptsMade = attempt + 1;
      if (attemptsMade >= reloadAfterAttempts && sessionStorage.getItem(reloadFlag) === null) {
        sessionStorage.setItem(reloadFlag, '1');
        console.warn(
          `MIDI access dead after ${attemptsMade} attempts (${reason}) — reloading once (a fresh renderer is the known-good recovery)`
        );
        window.location.reload();
        return;
      }
      const delay = retryDelaysMs[attempt];
      if (delay === undefined) {
        // Denied or unavailable after all retries (and a reload, if this
        // boot follows one): the Controller layer stays inert; keyboard
        // and pointer are unaffected.
        console.warn(`MIDI access unavailable after ${attemptsMade} attempts: ${reason}`);
        return;
      }
      // Log every failure: the underlying boot race has never been
      // captured (lost to console scrollback in the 2026-07-05 diagnosis).
      console.warn(
        `MIDI access request failed (attempt ${attemptsMade} of ${retryDelaysMs.length + 1}), retrying in ${delay}ms: ${reason}`
      );
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!disposed) requestAccess(attempt + 1);
      }, delay);
    };

    const watchdog = setTimeout(
      () => failAttempt(`request did not settle within ${attemptTimeoutMs}ms`),
      attemptTimeoutMs
    );
    watchdogTimer = watchdog;

    navigator.requestMIDIAccess().then(
      (midiAccess) => {
        clearTimeout(watchdog);
        // First success wins — even a watchdogged attempt that settles
        // late — but never after dispose or a prior win.
        if (disposed || access) return;
        access = midiAccess;
        access.addEventListener('statechange', onStateChange);
        scan();
        sessionStorage.removeItem(reloadFlag);
        const names = [...midiAccess.inputs.values()]
          .map((input) => input.name ?? '(unnamed)')
          .join(', ');
        // Success is logged too: the hung-boot failure produced NO output,
        // and "granted but no matching port" is otherwise indistinguishable.
        console.info(
          `MIDI access granted (attempt ${attempt + 1}): ${midiAccess.inputs.size} inputs, ${midiAccess.outputs.size} outputs${names ? ` — ${names}` : ''}`
        );
      },
      (error: unknown) => {
        clearTimeout(watchdog);
        failAttempt(describeError(error));
      }
    );
  };

  if ('requestMIDIAccess' in navigator) {
    requestAccess(0);
  } else {
    console.warn('Web MIDI unsupported in this environment — Controller layer inert');
  }

  return () => {
    disposed = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (watchdogTimer !== null) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    access?.removeEventListener('statechange', onStateChange);
    window.removeEventListener('pagehide', onPageHide);
    for (const detach of attached.values()) detach();
    attached.clear();
    for (const detach of attachedOutputs.values()) detach();
    attachedOutputs.clear();
  };
}
