/** Last path segment, splitting on both separators (Windows paths use '\'). */
export function fileBasename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
