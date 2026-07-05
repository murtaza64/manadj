/**
 * Output routing picker (headphone-cue 04): app-chrome popover routing the
 * Master and Cue buses to any enumerated output device. Master's "none" is
 * the system default (audio never dies); Cue's is Off (the bus is optional).
 * A missing saved device stays listed as "(missing)" so the choice survives
 * replugging — resolution handles the fallback live (routingStore).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
    <label className="topbar-routing-row">
      <span className="topbar-routing-label">{label}</span>
      <select
        value={saved?.deviceId ?? ''}
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Enumerate on open (this is the moment labels may get unlocked) and
  // close on any outside pointer press, dropdown-idiom.
  useEffect(() => {
    if (!open) return;
    void refreshRouting();
    const onPress = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPress);
    return () => window.removeEventListener('pointerdown', onPress);
  }, [open]);

  const degraded = resolved.masterMissing || resolved.cueMissing;
  const routed = prefs.master !== null || prefs.cue !== null;

  return (
    <div className="topbar-routing" ref={rootRef}>
      <button
        className={`topbar-routing-btn${routed ? ' routed' : ''}${degraded ? ' degraded' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Audio output routing (Master / Cue)"
      >
        OUT
      </button>
      {open && (
        <div className="topbar-routing-panel">
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
          {resolved.masterMissing && (
            <div className="topbar-routing-note">master device missing — using default</div>
          )}
          {resolved.cueMissing && (
            <div className="topbar-routing-note">cue device missing — cue disabled</div>
          )}
        </div>
      )}
    </div>
  );
}
