import { useSyncExternalStore } from 'react';
import { writeSetting } from '../settings/persistedSettings';
import { COLUMN_CONFIG, type ColumnConfig } from './columnConfig';

const STORAGE_KEY = 'manadj-column-order-v1';
export const COLUMN_DRAG_MIME = 'application/x-manadj-track-column';
const DEFAULT_ORDER = COLUMN_CONFIG.map(column => column.id);

export function normalizeColumnOrder(value: unknown): string[] {
  const known = Array.isArray(value) ? value.filter((id): id is string => DEFAULT_ORDER.includes(id)) : [];
  return [...new Set([...known, ...DEFAULT_ORDER])];
}

export function reorderColumns(order: readonly string[], source: string, target: string, after: boolean): readonly string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return order;
  const next = order.filter(id => id !== source);
  next.splice(next.indexOf(target) + Number(after), 0, source);
  return next.every((id, i) => id === order[i]) ? order : next;
}

/** Freeze positions, not identities, so arbitrary reorders keep one frozen prefix. */
export function getColumnLayout(order: readonly string[], showOrder: boolean): ColumnConfig[] {
  const visible = order.filter(id => showOrder || id !== 'order');
  const frozen = showOrder ? 6 : 5;
  return visible.map((id, index) => ({
    ...COLUMN_CONFIG.find(column => column.id === id)!,
    sticky: index < frozen,
    showShadow: index === frozen - 1,
  }));
}

function load(): string[] {
  try {
    return normalizeColumnOrder(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return [...DEFAULT_ORDER];
  }
}

let order: readonly string[] = load();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => order;

export function setColumnOrder(next: readonly string[]): void {
  const normalized = normalizeColumnOrder(next);
  if (normalized.every((id, i) => id === order[i])) return;
  order = normalized;
  writeSetting(STORAGE_KEY, JSON.stringify(order));
  for (const listener of listeners) listener();
}

export function useColumnOrder(): readonly string[] {
  return useSyncExternalStore(subscribe, snapshot);
}
