/**
 * Output routing (headphone-cue 04, inlined at the smoke test): MASTER and
 * CUE device selects sit directly in the top bar — no popover. Master's
 * "none" is the system default (audio never dies); Cue's is Off (the bus is
 * optional). A missing saved device stays listed as "(missing)" and paints
 * the select red, so the choice survives replugging — resolution handles
 * the fallback live (routingStore).
 *
 * Multichannel interfaces split into explicit stereo pairs (the Inpulse:
 * "(outs 1/2)" rear RCA, "(outs 3/4)" front headphone jack) for both buses.
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
import { outputPairOptions, sameOutputChoice } from '../playback/routing';
import type { SavedDevice } from '../playback/routing';
import { AutoBlurSelect } from './AutoBlurSelect';

function BusSelect({
  label,
  noneLabel,
  saved,
  missing,
  options,
  onPick,
}: {
  label: string;
  noneLabel: string;
  saved: SavedDevice | null;
  missing: boolean;
  /** The choosable entries; option values are indexes into this list. */
  options: readonly SavedDevice[];
  onPick: (device: SavedDevice | null) => void;
}) {
  const savedIndex =
    saved === null ? -1 : options.findIndex((option) => sameOutputChoice(option, saved));
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
      <AutoBlurSelect
        value={saved === null ? '' : savedIndex >= 0 ? String(savedIndex) : 'saved'}
        onPointerDown={() => void refreshRouting()}
        onChange={(e) => {
          const value = e.target.value;
          if (value === '') return onPick(null);
          const option = options[Number(value)];
          if (option) onPick(option);
        }}
      >
        <option value="">{noneLabel}</option>
        {/* The saved choice when it matches nothing enumerable (unplugged,
            or a pair the device no longer has) — kept so it survives. */}
        {saved !== null && savedIndex < 0 && (
          <option value="saved">{saved.label} (missing)</option>
        )}
        {options.map((option, i) => (
          <option key={`${option.deviceId}:${option.pair?.left ?? 'd'}`} value={String(i)}>
            {option.label || option.deviceId}
          </option>
        ))}
      </AutoBlurSelect>
    </label>
  );
}

export function AudioRoutingPicker() {
  const { prefs, resolved, devices } = useSyncExternalStore(
    subscribeRouting,
    getRoutingSnapshot
  );
  return (
    <div className="topbar-routing">
      <BusSelect
        label="MASTER"
        noneLabel="System default"
        saved={prefs.master}
        missing={resolved.masterMissing}
        options={outputPairOptions(devices)}
        onPick={setMasterDevice}
      />
      <BusSelect
        label="CUE"
        noneLabel="Off"
        saved={prefs.cue}
        missing={resolved.cueMissing}
        options={outputPairOptions(devices)}
        onPick={setCueDevice}
      />
    </div>
  );
}
