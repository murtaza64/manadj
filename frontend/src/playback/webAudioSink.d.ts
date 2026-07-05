/**
 * AudioContext.setSinkId / sinkId (Chrome 110+, the whole reason ADR 0017
 * works) are not in TypeScript 5.9's lib.dom yet. Global-scope interface
 * merge; delete when lib.dom catches up.
 */
interface AudioContext {
  readonly sinkId: string | { readonly type: 'none' };
  setSinkId(sinkId: string | { type: 'none' }): Promise<void>;
}
