/**
 * CLIP mode entry (#377 r3): the clip editor is an app mode (?view=clip);
 * anything can open a source in it with `openClipEditor`. The source rides
 * the URL (`?clip=<kind>:<uuid>[:<start>-<end>]`) so deep links, reloads
 * and the headless driver land on it.
 */
import type { ClipSource } from './clipSpec';

export const OPEN_CLIP_EVENT = 'manadj:open-clip';

export function parseClipSource(raw: string | null): ClipSource | null {
  if (!raw) return null;
  const [kind, uuid, span] = raw.split(':');
  if (!uuid) return null;
  if (kind === 'session') {
    const [a, b] = (span ?? '').split('-').map(Number);
    if (!(a >= 0) || !(b > a)) return null;
    return { kind, uuid, startS: a, endS: b };
  }
  if (kind === 'routine' || kind === 'transition' || kind === 'candidate' || kind === 'routine-take') return { kind, uuid };
  return null;
}

export function clipSourceString(source: ClipSource): string {
  return source.kind === 'session'
    ? `session:${source.uuid}:${source.startS}-${source.endS}`
    : `${source.kind}:${source.uuid}`;
}

let pending: ClipSource | null = null;

/** Switch the app to CLIP mode on `source`. Durable half for a first
 * mount (the mode mounts after the event fires), live half for a mounted
 * editor. */
export function openClipEditor(source: ClipSource): void {
  pending = source;
  window.dispatchEvent(new CustomEvent<ClipSource>(OPEN_CLIP_EVENT, { detail: source }));
}

/** The source an open request left for a not-yet-mounted editor (one-shot). */
export function takePendingClipSource(): ClipSource | null {
  const p = pending;
  pending = null;
  return p;
}
