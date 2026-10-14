import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type DeviceListenerStatus } from '../api/client';
import { DeviceChangeLog } from './DeviceChangeLog';

/** Settings → Library → Phone sync (#373): the opt-in LAN listener the
 * Android app pulls the Library from. Exposes only device sync, behind the
 * pairing code shown here. */
export default function PhoneSyncSettings() {
  const client = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ['device-listener'], queryFn: api.deviceListener.get });
  const set = (next: DeviceListenerStatus) => client.setQueryData(['device-listener'], next);
  const update = useMutation({ mutationFn: api.deviceListener.update, onSuccess: set });
  const rotate = useMutation({ mutationFn: api.deviceListener.rotate, onSuccess: set });
  const devices = useQuery({
    queryKey: ['device-listener', 'devices'],
    queryFn: api.deviceListener.devices,
    refetchInterval: 5_000,
  });
  const revoke = useMutation({
    mutationFn: api.deviceListener.revoke,
    onSettled: () => client.invalidateQueries({ queryKey: ['device-listener', 'devices'] }),
  });
  const [port, setPort] = useState('');
  useEffect(() => setPort(data ? String(data.port) : ''), [data]);

  if (isLoading) return <p role="status">Loading phone sync...</p>;
  if (isError || !data) return <p role="alert">Could not load phone sync.</p>;

  const commitPort = () => {
    const value = Number(port);
    if (Number.isInteger(value) && value >= 1024 && value <= 65535 && value !== data.port) update.mutate({ port: value });
    else setPort(String(data.port));
  };
  const failure = update.error ?? rotate.error ?? revoke.error;

  return (
    <>
      <div className="settings-section-heading">
        <div>
          <h2>Phone sync</h2>
          <p>Let the manaDJ Android app pull your Library over the local network.</p>
        </div>
      </div>
      <div className="settings-fields">
        <div className="settings-field">
          <div>
            <span className="settings-field-label">Allow phones on this network</span>
            <p>
              Opens a second port on all network interfaces that serves only
              the phone-sync endpoints, only to phones you paired, and
              announces this computer on the network so phones find it.
              Traffic is unencrypted: use trusted networks.
            </p>
          </div>
          <div className="settings-library-inputs">
            <label className="settings-library-toggle">
              <input
                type="checkbox"
                aria-label="Phone sync enabled"
                checked={data.enabled}
                onChange={(e) => update.mutate({ enabled: e.target.checked })}
              />
              <span>{data.enabled ? (data.running ? 'Listening' : 'Not listening') : 'Off'}</span>
            </label>
          </div>
        </div>
        <div className="settings-field">
          <div>
            <span className="settings-field-label">Port</span>
            <p>Change it if another program already uses this port.</p>
          </div>
          <div className="settings-library-inputs">
            <input
              type="text"
              inputMode="numeric"
              aria-label="Phone sync port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              onBlur={commitPort}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </div>
        {data.enabled ? (
          <div className="settings-field">
            <div>
              <span className="settings-field-label">Pair a phone</span>
              <p>
                In the app, pick this computer from the list of found
                desktops. manaDJ asks you here to approve it after checking
                that the codes match. Fallback: type one address and this
                code. A new code only affects phones paired by code.
              </p>
            </div>
            <div className="settings-phone-pairing">
              {data.addresses.length ? (
                data.addresses.map((a) => <code key={a}>{`http://${a}:${data.port}`}</code>)
              ) : (
                <span>No network address found</span>
              )}
              <code aria-label="Pairing code" className="settings-phone-code">{data.pair_code}</code>
              <button className="btn btn-secondary" onClick={() => rotate.mutate()}>
                New code
              </button>
            </div>
          </div>
        ) : null}
        {data.enabled || (devices.data?.length ?? 0) > 0 ? (
          <div className="settings-field">
            <div>
              <span className="settings-field-label">Paired phones</span>
              <p>Unpair a phone to stop it syncing. It has to ask again.</p>
            </div>
            <div className="settings-phone-pairing">
              {devices.data?.length ? (
                devices.data.map((d) => (
                  <div key={d.device_id} className="settings-phone-device">
                    <span>
                      {d.name}
                      <small>{d.last_seen ? ` · last sync ${new Date(d.last_seen).toLocaleString()}` : ' · never synced'}</small>
                    </span>
                    <button className="btn btn-secondary" onClick={() => revoke.mutate(d.device_id)}>
                      Unpair
                    </button>
                  </div>
                ))
              ) : (
                <span>None yet</span>
              )}
            </div>
          </div>
        ) : null}
      </div>
      {data.enabled || (devices.data?.length ?? 0) > 0 ? (
        <div className="settings-field device-change-log-field">
          <div>
            <span className="settings-field-label">Change log</span>
            <p>
              Every change a phone sync made, in both directions. Newest edit
              wins; Revert puts the old value back (and on the phone at its
              next sync).
            </p>
          </div>
          <DeviceChangeLog />
        </div>
      ) : null}
      {data.error ? (
        <p role="alert" className="settings-hint">{data.error}</p>
      ) : null}
      {failure ? (
        <p role="alert" className="settings-hint">
          Could not save: {failure instanceof Error ? failure.message : 'unknown error'}
        </p>
      ) : null}
    </>
  );
}
