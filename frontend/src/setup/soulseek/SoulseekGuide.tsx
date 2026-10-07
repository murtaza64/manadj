/**
 * Soulseek Setup guide (setup-guides PRD #291). manadj bundles slskd and
 * runs it as a separate process; the user only enters a Soulseek username
 * and password, manadj generates slskd's config + API key and reports the
 * connection. Optional — skipping leaves the Soulseek Supplier absent.
 * Works inside the First-run sequence and standalone (Settings → Soulseek).
 */
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { queryClient } from '../../api/queryClient';
import type { GuideProps } from '../guides';
import { connectionOf, soulseekApi } from './soulseekApi';
import type { Connection, SoulseekStatus } from './soulseekApi';
import './soulseek.css';

/** Poll fast while slskd starts/logs in, slowly once settled. */
const FAST_POLL_MS = 1000;
const SLOW_POLL_MS = 5000;
const SETTLED: readonly Connection[] = ['external', 'off', 'unavailable', 'connected', 'failed'];

function ConnectionLine({ status }: { status: SoulseekStatus }) {
  const connection = connectionOf(status);
  switch (connection) {
    case 'external':
      return <p className="sk-good" role="status">Using your own slskd at {status.web_url}.</p>;
    case 'starting':
      return <p className="sk-busy" role="status">Starting slskd…</p>;
    case 'connecting':
      return <p className="sk-busy" role="status">Logging in to Soulseek as {status.username}…</p>;
    case 'connected':
      return <p className="sk-good" role="status">Connected to Soulseek as {status.username}.</p>;
    case 'failed':
      return (
        <p className="sk-bad" role="status">
          {status.process === 'crashed'
            ? 'slskd keeps stopping.'
            : status.process === 'stopped'
              ? 'slskd is not running.'
              : `Couldn't log in as ${status.username}.`}
          {status.issue ? ` slskd says: ${status.issue}` : ''}
        </p>
      );
    default:
      return null;
  }
}

function CredentialsForm({
  initialUsername,
  busy,
  onSubmit,
  onCancel,
}: {
  initialUsername: string;
  busy: boolean;
  onSubmit: (username: string, password: string) => void;
  onCancel?: () => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (username.trim() && password) onSubmit(username.trim(), password);
  };
  return (
    <form className="sk-form" onSubmit={submit}>
      <label>
        <span>Username</span>
        <input
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={64}
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={128}
        />
      </label>
      <p className="sk-note">
        No account? Choose a new username and password — Soulseek creates the account the first
        time you log in. Use a password you don't use anywhere else.
      </p>
      <div className="sk-actions">
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || !password}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </form>
  );
}

export default function SoulseekGuide({ onDone, onSkip }: GuideProps) {
  const [status, setStatus] = useState<SoulseekStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await soulseekApi.status());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const connection = status ? connectionOf(status) : null;

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!connection) return;
    const delay = SETTLED.includes(connection) ? SLOW_POLL_MS : FAST_POLL_MS;
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [connection, status, refresh]);

  const act = async (request: () => Promise<SoulseekStatus>) => {
    setBusy(true);
    try {
      setStatus(await request());
      setError(null);
      setEditing(false);
      // The Acquisition view decides whether to show Soulseek from this list.
      void queryClient.invalidateQueries({ queryKey: ['acquisitionSuppliers'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const showForm = status && (connection === 'off' || editing);
  const managed = status?.mode === 'managed';

  return (
    <div className="sk-guide">
      <div className="settings-section-heading">
        <div>
          <h2>Soulseek</h2>
          <p>
            When a track can't be downloaded from SoundCloud, manaDJ can search Soulseek for it.
            Optional — skip if you don't use Soulseek.
          </p>
        </div>
      </div>

      <section className="sk-section">
        {!status && !error ? <p role="status">Checking…</p> : null}
        {status ? <ConnectionLine status={status} /> : null}
        {connection === 'unavailable' ? (
          <p className="sk-warn">
            slskd isn't included in this build, so Soulseek isn't available. (Developers: run{' '}
            <code>uv run scripts/slskd/fetch_slskd.py</code> and restart.)
          </p>
        ) : null}
        {showForm ? (
          <CredentialsForm
            initialUsername={status?.username ?? ''}
            busy={busy}
            onSubmit={(u, p) => void act(() => soulseekApi.connect(u, p))}
            onCancel={editing ? () => setEditing(false) : undefined}
          />
        ) : null}
        {managed && !editing ? (
          <div className="sk-actions">
            <button className="btn" disabled={busy} onClick={() => setEditing(true)}>
              {connection === 'failed' ? 'Re-enter account' : 'Change account'}
            </button>
            {connection === 'failed' ? (
              <button className="btn" disabled={busy} onClick={() => void act(soulseekApi.restart)}>
                Restart slskd
              </button>
            ) : null}
            <button className="btn" disabled={busy} onClick={() => void act(soulseekApi.disconnect)}>
              Disconnect
            </button>
          </div>
        ) : null}
        {error ? <p className="sk-bad" role="alert">{error}</p> : null}
      </section>

      {status ? (
        <p className="sk-licence">
          Soulseek runs through {status.licence.name} {status.licence.version}, bundled unmodified as
          a separate program under the {status.licence.license} licence.{' '}
          <a href={status.licence.source_url} target="_blank" rel="noreferrer">
            Source code
          </a>
        </p>
      ) : null}

      <div className="sk-actions">
        <button className="btn" onClick={onSkip}>
          Skip
        </button>
        <button
          className="btn btn-primary"
          disabled={connection !== 'connected' && connection !== 'external'}
          onClick={onDone}
        >
          Done
        </button>
      </div>
    </div>
  );
}
