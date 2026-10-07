/**
 * Spotify connect guide (#347): create a Spotify app in the developer
 * dashboard, give manaDJ its Client ID, sign in (Authorization Code with
 * PKCE — no client secret). Spotify is a read-only Source: its Feeds are
 * browsed in Acquisition; audio comes from SoundCloud/Soulseek.
 * Works inside the First-run sequence and standalone (Settings → Spotify).
 */
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { queryClient } from '../../api/queryClient';
import type { GuideProps } from '../guides';
import { SPOTIFY_STATUS_KEY, spotifyApi } from './spotifyApi';
import type { SpotifyStatus } from './spotifyApi';
import '../soundcloud/soundcloud.css';
import './spotify.css';

const DASHBOARD_URL = 'https://developer.spotify.com/dashboard';
const POLL_MS = 2000;
const POLL_LIMIT_MS = 5 * 60 * 1000;

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="sp-copy">
      <code aria-label={label}>{value}</code>
      <button type="button" className="btn" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function ClientIdForm({
  busy,
  initial,
  onSubmit,
}: {
  busy: boolean;
  initial: string;
  onSubmit: (clientId: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };
  return (
    <form className="sc-form" onSubmit={submit}>
      <input
        aria-label="Client ID"
        placeholder="Paste Client ID"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn" disabled={busy || !value.trim() || value.trim() === initial}>
        Save
      </button>
    </form>
  );
}

export default function SpotifyGuide({ onDone, onSkip }: GuideProps) {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const pollStarted = useRef(0);

  const apply = (next: SpotifyStatus) => {
    setStatus(next);
    queryClient.setQueryData(SPOTIFY_STATUS_KEY, next);
  };

  useEffect(() => {
    spotifyApi.status().then(apply, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // After Connect: poll until the browser sign-in lands on the callback.
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      spotifyApi.status().then(
        (next) => {
          apply(next);
          if (next.state === 'connected' || Date.now() - pollStarted.current > POLL_LIMIT_MS) {
            setWaiting(false);
          }
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => clearInterval(id);
  }, [waiting]);

  const act = async (request: () => Promise<SpotifyStatus>) => {
    setBusy(true);
    try {
      apply(await request());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const { authorize_url } = await spotifyApi.connect();
      window.open(authorize_url, '_blank');
      pollStarted.current = Date.now();
      setWaiting(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state;
  const connected = state === 'connected';

  return (
    <div className="sc-guide">
      <div className="settings-section-heading">
        <div>
          <h2>Spotify</h2>
          <p>
            Connect Spotify so manaDJ can show your Liked Songs and playlists in Acquisition and
            mark tracks you want. manaDJ only reads from Spotify; audio comes from SoundCloud or
            Soulseek.
          </p>
        </div>
      </div>

      {!status && !error ? <p role="status">Checking…</p> : null}

      {connected ? (
        <section className="sc-section">
          <p className="sc-good" role="status">
            Connected as {status?.account?.display_name ?? 'your Spotify account'}.
          </p>
          {status?.error ? <p className="sc-bad">{status.error}</p> : null}
          <div className="sc-actions">
            <button className="btn" disabled={busy} onClick={() => void act(spotifyApi.disconnect)}>
              Disconnect
            </button>
          </div>
        </section>
      ) : null}

      {state === 'reconnect' ? (
        <section className="sc-section">
          <p className="sc-bad" role="status">
            {status?.error ?? 'Spotify needs you to sign in again.'}
          </p>
          <div className="sc-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => void connect()}>
              Reconnect
            </button>
            <button className="btn" disabled={busy} onClick={() => void act(spotifyApi.disconnect)}>
              Disconnect
            </button>
          </div>
        </section>
      ) : null}

      {status && (state === 'no_client' || state === 'disconnected') ? (
        <ol className="sc-steps">
          <li>
            <span>
              Open the{' '}
              <a href={DASHBOARD_URL} target="_blank" rel="noreferrer">
                Spotify developer dashboard
              </a>{' '}
              and log in with your Spotify account. Development Mode apps need the app owner to
              have Spotify Premium.
            </span>
          </li>
          <li>
            <span>
              Press <b>Create app</b>. Name and description can be anything (e.g. “manaDJ”);
              they're shown on Spotify's sign-in screen.
            </span>
          </li>
          <li>
            <span>
              Under <b>Redirect URIs</b>, paste this and press <b>Add</b>:
            </span>
            <CopyField value={status.redirect_uri} label="Redirect URI" />
            <span className="sp-hint">
              If Spotify later says the redirect URI is invalid, also add{' '}
              <code>{status.redirect_uri_exact}</code>.
            </span>
          </li>
          <li>
            <span>
              Under <b>Which API/SDKs are you planning to use?</b>, check <b>Web API</b>. Accept
              the terms and press <b>Save</b>.
            </span>
          </li>
          <li>
            <span>
              Open the app's <b>Settings</b>, copy the <b>Client ID</b>, and paste it here. No
              client secret is needed.
            </span>
            <ClientIdForm
              key={status.client_id ?? ''}
              busy={busy}
              initial={status.client_id ?? ''}
              onSubmit={(id) => void act(() => spotifyApi.setClientId(id))}
            />
          </li>
          <li>
            <span>Sign in to Spotify and approve read access to your library and playlists.</span>
            <div className="sc-actions">
              <button
                className="btn btn-primary"
                disabled={busy || state === 'no_client'}
                onClick={() => void connect()}
              >
                Connect
              </button>
            </div>
            {waiting ? (
              <p role="status">Waiting for Spotify sign-in… finish it in the window that opened.</p>
            ) : null}
            <span className="sp-hint">
              If Spotify answers 403 later, add your Spotify account under the app's{' '}
              <b>User Management</b>.
            </span>
          </li>
        </ol>
      ) : null}

      {error ? <p className="sc-bad" role="alert">{error}</p> : null}

      <div className="sc-actions sc-footer">
        <button className="btn" onClick={onSkip}>
          Skip
        </button>
        <button className="btn btn-primary" disabled={!connected} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
