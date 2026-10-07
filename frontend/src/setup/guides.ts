/**
 * Setup guide registry (setup-guides PRD, Implementation Decisions).
 *
 * Each Setup guide registers `{ id, title, order, status, Component }`;
 * `Component` receives `{ onDone, onSkip }` and works both inside the
 * First-run sequence and standalone. Status persists in the persisted
 * setting `manadj-setup-state` (JSON: `{ [guideId]: 'done' | 'skipped' }`).
 *
 * Minimal contract module: the framework (sequence host, Settings Setup
 * section, First-run trigger) is owned by the onboarding lane and builds on
 * this. Guides may register before the framework hosts them.
 */
import type { ComponentType } from 'react';
import { writeSetting } from '../settings/persistedSettings';

export type GuideStatus = 'done' | 'skipped' | 'not-started';

export interface GuideProps {
  onDone: () => void;
  onSkip: () => void;
}

export interface SetupGuide {
  id: string;
  title: string;
  /** Position in the First-run sequence (ascending). */
  order: number;
  status: () => GuideStatus;
  Component: ComponentType<GuideProps>;
}

export const SETUP_STATE_KEY = 'manadj-setup-state';

type SetupState = Record<string, unknown>;

function readState(): SetupState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SETUP_STATE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as SetupState;
  } catch {
    return {};
  }
}

const stateListeners = new Set<() => void>();

/** Persisted status of a guide (not-started when never finished/skipped). */
export function guideStatus(id: string): GuideStatus {
  const value = readState()[id];
  return value === 'done' || value === 'skipped' ? value : 'not-started';
}

export function setGuideStatus(id: string, status: GuideStatus): void {
  const state = readState();
  if (status === 'not-started') delete state[id];
  else state[id] = status;
  writeSetting(SETUP_STATE_KEY, JSON.stringify(state));
  for (const listener of stateListeners) listener();
}

export function subscribeSetupState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

const registry = new Map<string, SetupGuide>();

/** Register (or replace, e.g. on HMR) a guide. */
export function registerGuide(guide: SetupGuide): void {
  registry.set(guide.id, guide);
}

/** Registered guides in sequence order. */
export function listGuides(): SetupGuide[] {
  return [...registry.values()].sort((a, b) => a.order - b.order);
}

export function getGuide(id: string): SetupGuide | undefined {
  return registry.get(id);
}

/** Checkpoint shares the existing persisted setting, not a browser-only key. */
export interface SetupJourney {
  ids: string[];
  index: number;
}

export function setupJourney(): SetupJourney | null {
  const value = readState().__journey as Partial<SetupJourney> | undefined;
  if (!value || !Array.isArray(value.ids) || !value.ids.every((id) => typeof id === 'string') ||
      !Number.isInteger(value.index) || value.index! < 0 || value.index! > value.ids.length) return null;
  return value as SetupJourney;
}

export function saveSetupJourney(journey: SetupJourney | null): void {
  const state = readState();
  if (journey) state.__journey = journey;
  else delete state.__journey;
  writeSetting(SETUP_STATE_KEY, JSON.stringify(state));
  for (const listener of stateListeners) listener();
}
