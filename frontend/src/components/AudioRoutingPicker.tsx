/**
 * Output routing (headphone-cue 04, inlined at the smoke test): MASTER and
 * CUE device selects sit directly in the top bar — no popover. Master's
 * "none" is the system default (audio never dies); Cue's is Off (the bus is
 * optional). A missing saved device stays listed as "(missing)" and paints
 * the select red, so the choice survives replugging — resolution handles
 * the fallback live (routingStore).
 *
 * Devices are (re-)enumerated when a select is pressed — the moment labels
 * may get unlocked — never at boot for unrouted setups (permission prompt
 * hygiene, see routingStore). A freshly plugged device can need two clicks:
 * the first refresh lands after the native dropdown opened.
 */
import { useSyncExternalStore } from 'react';
import {
  getRoutingSnapshot,
  refreshRouting,
  setCueDevice,
  setMasterDevice,
  subscribeRouting,
} from '../playback/routingStore';
import type { SavedDevice } from '../playback/routing';

function BusSelect({
  label,
  noneLabel,
  saved,
  missing,
  onPick,
}: {
  label: string;
  noneLabel: string;
  saved: SavedDevice | null;
  missing: boolean;
  onPick: (device: SavedDevice | null) => void;
}) {
  const { devices } = useSyncExternalStore(subscribeRouting, getRoutingSnapshot);
  return (
    <label
      className={`topbar-routing-bus${missing ? ' missing' : ''}`}
      title={
        missing
          ? `${label}: saved device is unplugged — ${label === 'CUE' ? 'cue disabled' : 'using the system default'}`
          : `${label} output device`
      }
    >
      <span className="topbar-routing-label">{label}</span>
      <select
        value={saved?.deviceId ?? ''}
        onPointerDown={() => void refreshRouting()}
        onChange={(e) => {
          const id = e.target.value;
          if (id === '') return onPick(null);
          const device = devices.find((d) => d.deviceId === id);
          if (device) onPick({ deviceId: device.deviceId, label: device.label });
        }}
      >
        <option value="">{noneLabel}</option>
        {saved && missing && (
          <option value={saved.deviceId}>{saved.label} (missing)</option>
        )}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AudioRoutingPicker() {
  const { prefs, resolved } = useSyncExternalStore(subscribeRouting, getRoutingSnapshot);
  return (
    <div className="topbar-routing">
      <BusSelect
        label="MASTER"
        noneLabel="System default"
        saved={prefs.master}
        missing={resolved.masterMissing}
        onPick={setMasterDevice}
      />
      <BusSelect
        label="CUE"
        noneLabel="Off"
        saved={prefs.cue}
        missing={resolved.cueMissing}
        onPick={setCueDevice}
      />
    </div>
  );
}
