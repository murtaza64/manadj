/**
 * SoundCloud connect guide (setup-guides PRD #290): walk the user through
 * copying soundcloud.com's `oauth_token` cookie, validate it (account name +
 * likes count), store it. Connected => the Acquisition tab appears in Sync.
 * Works inside the First-run sequence and standalone (Settings → SoundCloud).
 */
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { queryClient } from '../../api/queryClient';
import type { GuideProps } from '../guides';
import { SOUNDCLOUD_STATUS_KEY, soundcloudApi } from './soundcloudApi';
import type { SoundCloudStatus } from './soundcloudApi';
import './soundcloud.css';

const SOURCE_LABEL = {
  env: "manaDJ's environment (SOUNDCLOUD_OAUTH_TOKEN)",
  config: 'the settings file (config.toml)',
} as const;

/** Illustration of the browser's cookie table with oauth_token picked out. */
function CookieIllustration() {
  return (
    <figure className="sc-shot" aria-label="Developer tools: Application → Cookies → oauth_token">
      <div className="sc-shot-tabs">
        <span>Elements</span>
        <span>Console</span>
        <span>Network</span>
        <span className="sc-shot-on">Application</span>
      </div>
      <div className="sc-shot-body">
        <ul className="sc-shot-tree">
          <li>Storage</li>
          <li className="sc-shot-indent">▾ Cookies</li>
          <li className="sc-shot-indent2 sc-shot-on">https://soundcloud.com</li>
        </ul>
        <table className="sc-shot-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>sc_anonymous_id</td>
              <td>123456-789012-…</td>
            </tr>
            <tr className="sc-shot-hit">
              <td>oauth_token</td>
              <td>2-290000-12345678-AbCdEfGhIjKl</td>
            </tr>
            <tr>
              <td>datadome</td>
              <td>Xy0…</td>
            </tr>
          </tbody>
        </table>
      </div>
      <figcaption>Copy the Value of the oauth_token row.</figcaption>
    </figure>
  );
}

function TokenForm({ busy, onSubmit }: { busy: boolean; onSubmit: (token: string) => void }) {
  const [token, setToken] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (token.trim()) onSubmit(token.trim());
  };
  return (
    <form className="sc-form" onSubmit={submit}>
      <input
        type="password"
        aria-label="oauth_token"
        placeholder="Paste oauth_token value"
        autoComplete="off"
        spellCheck={false}
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <button type="submit" className="btn btn-primary" disabled={busy || !token.trim()}>
        {busy ? 'Checking…' : 'Connect'}
      </button>
    </form>
  );
}

export default function SoundCloudGuide({ onDone, onSkip }: GuideProps) {
  const [status, setStatus] = useState<SoundCloudStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    soundcloudApi.status().then(setStatus, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const act = async (request: () => Promise<SoundCloudStatus>) => {
    setBusy(true);
    try {
      const next = await request();
      setStatus(next);
      setError(null);
      queryClient.setQueryData(SOUNDCLOUD_STATUS_KEY, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // A process-environment token can't be replaced from here; a settings-file
  // token can (the guide's .env entry takes precedence over it).
  const external = status?.token_source === 'env';
  const showSteps = status !== null && !status.connected && !external;
  const sourceLabel =
    status?.token_source === 'env' || status?.token_source === 'config' ? SOURCE_LABEL[status.token_source] : null;

  return (
    <div className="sc-guide">
      <div className="settings-section-heading">
        <div>
          <h2>SoundCloud</h2>
          <p>
            Connect your SoundCloud account so manaDJ can list your likes and download them into
            your library (Sync → Acquisition).
          </p>
        </div>
      </div>

      {!status && !error ? <p role="status">Checking…</p> : null}

      {status?.connected && status.account ? (
        <section className="sc-section">
          <p className="sc-good" role="status">
            Connected as {status.account.username} · {status.account.likes_count.toLocaleString()} likes.
          </p>
          {sourceLabel ? (
            <p>Using the token from {sourceLabel}.</p>
          ) : (
            <p>Your likes are in Sync → Acquisition.</p>
          )}
          {status.token_source === 'secrets' ? (
            <div className="sc-actions">
              <button className="btn" disabled={busy} onClick={() => void act(soundcloudApi.disconnect)}>
                Disconnect
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {status && !status.connected && status.error ? (
        <p className="sc-bad" role="status">
          {sourceLabel ? `The token from ${sourceLabel} doesn't work: ` : ''}
          {status.error}
        </p>
      ) : null}

      {showSteps ? (
        <ol className="sc-steps">
          <li>
            <span>
              Log in at{' '}
              <a href="https://soundcloud.com" target="_blank" rel="noreferrer">
                soundcloud.com
              </a>{' '}
              in your web browser.
            </span>
          </li>
          <li>
            <span>
              Open the developer tools with <kbd>⌥</kbd>
              <kbd>⌘</kbd>
              <kbd>I</kbd>. Chrome, Edge, Brave, Arc: open the <b>Application</b> tab. Firefox and
              Safari: the <b>Storage</b> tab (Safari first needs Settings → Advanced → “Show
              features for web developers”).
            </span>
          </li>
          <li>
            <span>
              Under <b>Cookies</b>, select <b>https://soundcloud.com</b>, find <b>oauth_token</b>,
              and copy its value (double-click it, then <kbd>⌘</kbd>
              <kbd>C</kbd>). It starts with <code>2-</code>.
            </span>
            <CookieIllustration />
          </li>
          <li>
            <span>Paste it here. The token stays on this computer.</span>
            <TokenForm busy={busy} onSubmit={(token) => void act(() => soundcloudApi.connect(token))} />
          </li>
        </ol>
      ) : null}

      {error ? <p className="sc-bad" role="alert">{error}</p> : null}

      <div className="sc-actions sc-footer">
        <button className="btn" onClick={onSkip}>
          Skip
        </button>
        <button className="btn btn-primary" disabled={!status?.connected} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
