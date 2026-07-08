let midiActivityVersion = 0;
const listeners = new Set<() => void>();

export function markMidiActivity(): void {
  midiActivityVersion += 1;
  for (const listener of listeners) listener();
}

export function midiActivitySnapshot(): number {
  return midiActivityVersion;
}

export function subscribeMidiActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function _resetMidiActivityForTests(): void {
  midiActivityVersion = 0;
  listeners.clear();
}
