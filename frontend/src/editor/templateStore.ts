/**
 * Transition-template store (mix-editor issue 03): the saved templates,
 * persisted through the CRUD API behind the same snapshot interface as the
 * pair store (ADR 0011 pattern) — async `init()` at boot, sync snapshot
 * reads, optimistic write-through, subscribe. Identity is the client-
 * generated `uuid`; create-vs-update is decided against the snapshot.
 * Write failures warn and log only (single-user local app; the client
 * snapshot is legitimately the working truth between flushes).
 */
import { api } from '../api/client';
import type { TransitionTemplateWire } from '../api/client';
import type { Lanes } from './mixModel';
import type { AnchorBase, TransitionTemplate } from './templateModel';

let snapshot: TransitionTemplate[] = [];
let initPromise: Promise<void> | null = null;

function fromWire(w: TransitionTemplateWire): TransitionTemplate {
  return {
    uuid: w.uuid,
    name: w.name,
    alignABase: w.align_a_base as AnchorBase,
    deltaBeats: w.align_delta_beats,
    alignBBase: w.align_b_base as AnchorBase,
    beforeBeats: w.before_beats,
    afterBeats: w.after_beats,
    scalable: w.scalable,
    lanes: w.lanes as Lanes,
  };
}

function toWire(t: TransitionTemplate): TransitionTemplateWire {
  return {
    uuid: t.uuid,
    name: t.name,
    align_a_base: t.alignABase,
    align_delta_beats: t.deltaBeats,
    align_b_base: t.alignBBase,
    before_beats: t.beforeBeats,
    after_beats: t.afterBeats,
    scalable: t.scalable,
    lanes: t.lanes as Record<string, unknown>,
  };
}

/** Boot the store (idempotent). Never rejects — a dead backend degrades
 * to an empty snapshot with a logged error. */
export function initTemplateStore(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  try {
    snapshot = (await api.transitionTemplates.list()).map(fromWire);
  } catch (err) {
    console.error('template store: boot load failed — starting empty', err);
    snapshot = [];
  }
  notify();
}

export function snapshotTemplates(): TransitionTemplate[] {
  return snapshot;
}

/** Create or update (decided by uuid presence in the snapshot). The
 * snapshot updates and listeners fire synchronously; the request rides
 * behind. */
export function saveTemplate(template: TransitionTemplate): void {
  const exists = snapshot.some((t) => t.uuid === template.uuid);
  snapshot = exists
    ? snapshot.map((t) => (t.uuid === template.uuid ? template : t))
    : [...snapshot, template];
  notify();
  const push = exists
    ? api.transitionTemplates.update(toWire(template))
    : api.transitionTemplates.create(toWire(template));
  push.catch((err) =>
    console.error(`template store: save failed for template ${template.uuid}`, err)
  );
}

export function deleteTemplate(uuid: string): void {
  snapshot = snapshot.filter((t) => t.uuid !== uuid);
  notify();
  api.transitionTemplates
    .delete(uuid)
    .catch((err) => console.error(`template store: delete failed for template ${uuid}`, err));
}

// ── Change events (same-tab) ───────────────────────────────────────────

type Listener = (templates: TransitionTemplate[]) => void;
const listeners = new Set<Listener>();

export function subscribeTemplates(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn(snapshot);
}

/** Reset module state (tests only). */
export function _resetTemplateStoreForTests(): void {
  snapshot = [];
  initPromise = null;
  listeners.clear();
}
