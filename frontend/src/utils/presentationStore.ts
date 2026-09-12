interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

const stores = new WeakMap<object, Store<unknown>>();
const pending = new Set<() => (() => void) | undefined>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** UI-only adapter over immutable authoritative snapshots. Domain observers
 * keep the original store. A task (not a microtask) lets queued input run
 * before React's synchronous external-store flush. Publish all changed
 * snapshots before notifying, so cross-deck reads see one coherent batch. */
export function presentationOf<T>(source: Store<T>): Store<T> {
  const existing = stores.get(source);
  if (existing) return existing as Store<T>;
  let snapshot = source.getSnapshot();
  let unsubscribe: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = () => {
    if (!listeners.size) return;
    const next = source.getSnapshot();
    if (Object.is(snapshot, next)) return;
    snapshot = next;
    return () => { for (const listener of listeners) listener(); };
  };
  const enqueue = () => {
    pending.add(publish);
    timer ??= setTimeout(() => {
      timer = undefined;
      const batch = [...pending];
      pending.clear();
      const notify = batch.map(update => update());
      for (const callback of notify) callback?.();
    }, 0);
  };
  const store: Store<T> = {
    getSnapshot: () => listeners.size ? snapshot : source.getSnapshot(),
    subscribe: listener => {
      if (!listeners.size) {
        snapshot = source.getSnapshot();
        unsubscribe = source.subscribe(enqueue);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          unsubscribe?.();
          unsubscribe = undefined;
          pending.delete(publish);
          if (!pending.size && timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
          }
        }
      };
    },
  };
  stores.set(source, store);
  return store;
}
