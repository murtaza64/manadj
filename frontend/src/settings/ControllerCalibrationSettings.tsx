import { useSyncExternalStore } from 'react';
import { connectedControllers, subscribeControllers } from '../midi/connectionStore';
import JogTuningPage from '../midi/JogTuningPage';

/** Jog calibration per known controller (#328). Only the DDJ-GRV6 has
 * tunable values (stored as manadj.grv6JogCalibration); the DDJ-SB3 runs a
 * fixed factory calibration (SB3_JOG_CALIBRATION) and the Inpulse 300 MK2
 * the default — both say so instead of offering dead sliders. */
const CONTROLLERS = [
  {
    id: 'grv6',
    name: 'Pioneer DDJ-GRV6',
    portNameMatch: 'DDJ-GRV6',
    calibration: 'adjustable',
  },
  {
    id: 'ddj-sb3',
    name: 'Pioneer DDJ-SB3',
    portNameMatch: 'DDJ-SB3',
    calibration: 'Fixed factory calibration — nothing to tune.',
  },
  {
    id: 'inpulse300mk2',
    name: 'Hercules DJControl Inpulse 300 MK2',
    portNameMatch: 'DJControl Inpulse 300',
    calibration: 'No jog calibration needed.',
  },
] as const;

export default function ControllerCalibrationSettings() {
  const connected = useSyncExternalStore(subscribeControllers, connectedControllers);
  const isConnected = (match: string) => connected.some((name) => name.includes(match));
  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Jog calibration</h2>
          <p>Jog response per controller. Only the DDJ-GRV6 has adjustable calibration.</p>
        </div>
      </div>
      <div className="settings-controller-list" role="list" aria-label="Controllers">
        {CONTROLLERS.map((c) => (
          <div className="settings-controller-row" role="listitem" key={c.id}>
            <strong>{c.name}</strong>
            <span className={`settings-controller-status${isConnected(c.portNameMatch) ? ' on' : ''}`}>
              {isConnected(c.portNameMatch) ? 'Connected' : 'Not connected'}
            </span>
            <span className="settings-controller-calibration">
              {c.calibration === 'adjustable' ? 'Adjustable — see below.' : c.calibration}
            </span>
          </div>
        ))}
      </div>
      <JogTuningPage />
    </>
  );
}
