/** A resource owned by a React effect. */
export class RemountStableResource<T> {
  private resource: T | null = null;
  private generation = 0;
  private readonly create: () => T;
  private readonly destroy: (resource: T) => void;

  constructor(create: () => T, destroy: (resource: T) => void) {
    this.create = create;
    this.destroy = destroy;
  }

  mount(): T {
    this.generation += 1;
    this.resource ??= this.create();
    return this.resource;
  }

  unmount(): void {
    const generation = this.generation;
    queueMicrotask(() => {
      // StrictMode immediately mounts the same effect again. The newer
      // generation keeps the resource alive; a real unmount has no successor.
      if (generation !== this.generation || this.resource === null) return;
      this.destroy(this.resource);
      this.resource = null;
    });
  }
}
