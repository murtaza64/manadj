import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../api/client';
import './releaseNotes.css';

const OPEN = 'manadj:release-notes';
const LOADED_ID: string = import.meta.env.VITE_MANADJ_RELEASE_ID ?? '';

export interface Release {
  schema: 1;
  release_id: string;
  version: string;
  source_revision: string;
  notes_sha256: string;
  body: string;
  seen: boolean;
}

export function ReleaseNotesButton() {
  return <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN))}>Release notes</button>;
}

/** One startup request, never a background poll. Interaction ends the launch window. */
export function ReleaseNotes({ loadedId = LOADED_ID }: { loadedId?: string }) {
  const [release, setRelease] = useState<Release | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    let launch = true;
    let current: Release | null = null;
    const deadline = window.setTimeout(() => { launch = false; }, 1500);
    const interact = () => { launch = false; };
    window.addEventListener('pointerdown', interact, true);
    window.addEventListener('keydown', interact, true);
    const request = loadedId ? fetch(`${API_BASE}/release?release_id=${encodeURIComponent(loadedId)}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Release metadata unavailable.');
        const data = await response.json() as { release: Release | null };
        // Refuse a different backend release even if an intermediary ignores the query.
        current = data.release?.release_id === loadedId ? data.release : null;
        if (!active) return;
        setRelease(current);
        if (current && !current.seen && launch && !document.querySelector('[role="dialog"], dialog[open]')) setOpen(true);
      }).catch(() => { current = null; }) : Promise.resolve();
    const manual = () => {
      launch = false;
      void request.then(() => {
        if (!active) return;
        setError(current ? '' : 'No release notes for this loaded build.');
        setOpen(true);
      });
    };
    window.addEventListener(OPEN, manual);
    return () => {
      active = false;
      window.clearTimeout(deadline);
      window.removeEventListener('pointerdown', interact, true);
      window.removeEventListener('keydown', interact, true);
      window.removeEventListener(OPEN, manual);
    };
  }, [loadedId]);

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  const dismiss = async () => {
    if (saving) return;
    if (!release) { setOpen(false); return; }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/release/seen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ release_id: release.release_id }),
      });
      if (!response.ok) throw new Error(response.status === 409
        ? 'This page is from another release. Reopen the app; nothing was marked seen.'
        : 'Could not save acknowledgement. Try again.');
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save acknowledgement.');
    } finally { setSaving(false); }
  };

  if (!open) return null;
  return <dialog ref={dialog} className="release-notes" aria-labelledby="release-notes-title"
    onCancel={(event) => { event.preventDefault(); void dismiss(); }}>
    <h2 id="release-notes-title">{release ? `What’s new in manaDJ ${release.version}` : 'Release notes'}</h2>
    {release && <>
      <p className="release-notes-source">Loaded source: <code>{release.source_revision}</code></p>
      <div className="release-notes-body">{release.body}</div>
    </>}
    {error && <p role="alert">{error}</p>}
    <footer>
      {error && release && <button type="button" onClick={() => setOpen(false)}>Close without marking seen</button>}
      <button type="button" disabled={saving} onClick={() => void dismiss()}>{saving ? 'Saving…' : 'Done'}</button>
    </footer>
  </dialog>;
}
