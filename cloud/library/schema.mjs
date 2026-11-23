// Pure schema vocabulary shared by native main process and Worker. No auth/network imports.
export const SCHEMA = 'manadj-library-snapshot/v1';
const encoder = new TextEncoder();
export const bytes = value => encoder.encode(JSON.stringify(value));
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export class Failure extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function reject(status, code) { throw new Failure(status, code); }
export const validID = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
export function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
