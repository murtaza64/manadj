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
import { useMixer, useMixerValue } from '../hooks/useMixer';
import { useTakeoverHint } from '../hooks/useTakeoverHint';
import { takeoverKey } from '../midi/takeoverFeedback';
import { CUE_LEVEL_DEFAULT, MASTER_LEVEL_DEFAULT } from '../playback/mixer';
import { Knob } from './performance/MixerStrip';
import { AutoBlurSelect } from './AutoBlurSelect';

function BusSelect({
  label,
  noneLabel,
  saved,
  missing,
  needsPair,
  options,
  onPick,
}: {
  label: string;
  noneLabel: string;
  saved: SavedDevice | null;
  missing: boolean;
  needsPair: boolean;
  /** The choosable entries; option values are indexes into this list. */
  options: readonly SavedDevice[];
  onPick: (device: SavedDevice | null) => void;
}) {
  const savedIndex =
    saved === null ? -1 : options.findIndex((option) => sameOutputChoice(option, saved));
  return (
    <label
      className={`topbar-routing-bus${missing || needsPair ? ' missing' : ''}`}
      title={
        missing
          ? `${label}: saved device is unplugged — ${label === 'CUE' ? 'cue disabled' : 'using the system default'}`
          : needsPair
            ? `${label}: choose an explicit output pair — this device's physical channel order is not hardware-verified`
          : `${label} output device`
      }
    >
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
            pair unavailable, or pair still needs hardware verification). */}
        {saved !== null && savedIndex < 0 && (
          <option value="saved">{saved.label} ({needsPair ? 'choose output pair' : 'missing'})</option>
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
  // Bus gains (gh#66): MASTER and PHONES moved out of the mixer strip —
  // each bus reads [gain knob][device select], deck-MIX-zone style (label
  // under the dial). Same Mixer subscription as the strip, so hardware
  // knob moves repaint these live (midi-controller 09/18).
  const mixer = useMixer();
  const master = useMixerValue((m) => m.getMaster());
  const cueLevel = useMixerValue((m) => m.getCueLevel());
  const masterTakeover = useTakeoverHint(takeoverKey.master());
  const cueLevelTakeover = useTakeoverHint(takeoverKey.cueLevel());
  return (
    <div className="topbar-routing">
      <div className="topbar-routing-bus-group">
        <Knob
          label="MASTER"
          min={0}
          max={1}
          value={master}
          defaultValue={MASTER_LEVEL_DEFAULT}
          onChange={(v) => mixer.setMaster(v)}
          title="Master volume (double-click = 0 dB; upper half boosts to +6 dB)"
          takeover={masterTakeover}
        />
        <BusSelect
          label="MASTER"
          noneLabel="System default"
          saved={prefs.master}
          missing={resolved.masterMissing}
          needsPair={resolved.masterNeedsPair}
          options={outputPairOptions(devices)}
          onPick={setMasterDevice}
        />
      </div>
      <div className="topbar-routing-bus-group">
        <Knob
          label="CUE"
          min={0}
          max={1}
          value={cueLevel}
          defaultValue={CUE_LEVEL_DEFAULT}
          onChange={(v) => mixer.setCueLevel(v)}
          title="Headphone (cue) level"
          takeover={cueLevelTakeover}
        />
        <BusSelect
          label="CUE"
          noneLabel="Off"
          saved={prefs.cue}
          missing={resolved.cueMissing}
          needsPair={resolved.cueNeedsPair}
          options={outputPairOptions(devices)}
          onPick={setCueDevice}
        />
      </div>
    </div>
  );
}
