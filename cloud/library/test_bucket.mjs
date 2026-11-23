// Shared in-memory R2 model for worker/service-check tests. Not deployed.
import assert from 'node:assert/strict';
export class Bucket {
  constructor() { this.objects = new Map(); this.serial = 0; this.calls = []; this.hook = null; }
  async get(key) {
    this.calls.push(['get', key]); await Promise.resolve();
    const x = this.objects.get(key); if (!x) return null;
    const copy = new Uint8Array(x.raw);
    return { size: copy.length, etag: x.etag, customMetadata: x.customMetadata,
      text: async () => new TextDecoder().decode(copy), arrayBuffer: async () => copy.buffer };
  }
  async delete(key) {
    this.calls.push(['delete', key]); await Promise.resolve();
    if (this.hook) await this.hook(key, undefined, { delete: true });
    this.objects.delete(key);
  }
  async put(key, value, options = {}) {
    this.calls.push(['put', key]); await Promise.resolve();
    if (this.hook) await this.hook(key, value, options);
    const current = this.objects.get(key), condition = options.onlyIf;
    assert.ok(condition instanceof Headers, 'all writes are conditional');
    if (condition.get('if-none-match') === '*' && current) return null;
    if (condition.has('if-match') && (!current || condition.get('if-match') !== `"${current.etag}"`)) return null;
    const raw = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    const object = { raw: new Uint8Array(raw), etag: String(++this.serial), customMetadata: options.customMetadata };
    this.objects.set(key, object); return { etag: object.etag };
  }
}
