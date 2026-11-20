import { useSyncExternalStore } from 'react';

import { heardRoute, setHeard, subscribeHeard } from '../playback/heardStore';

/** Heard mode (#382 desktop port; Android parity: SettingsPanel's "Heard
 * (lag compensation)" toggle). The mixer strip's HEARD cluster owns the
 * per-route latency nudge; this panel is the discoverable home. */
export default function HeardSettings() {
  const route = useSyncExternalStore(subscribeHeard, heardRoute);
  const ms = Math.round(route.seconds * 1000);
  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Heard</h2>
          <p>Line launches, hot cues and loops up with what you hear.</p>
        </div>
      </div>
      <div className="settings-fields">
        <label>
          <input
            type="checkbox"
            checked={route.on}
            onChange={(e) => setHeard(e.target.checked)}
          />{' '}
          Heard (lag compensation)
        </label>
        <p className="settings-hint">
          For Bluetooth speakers and headphones: alignment gestures are read
          at the heard instant, offset by the output latency, so they land
          in phase at the speaker. Works with Quantize on or off. Offset on{' '}
          {route.label}: {ms} ms{route.overridden ? ' (yours)' : ' (reported)'}
          — nudge it from the mixer strip while practicing.
        </p>
      </div>
    </>
  );
}
