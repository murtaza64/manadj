// Electron 37 main process adapter. Never expose this object through contextBridge.
// No plaintext fallback, .env, settings IPC or renderer-accessible token fields.
const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const crypto = require('node:crypto');
const { CloudFailure, nonempty } = require('./policy');
const LINUX_BACKENDS = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);
class EncryptedTokenStore {
  constructor({ directory, safeStorage, platform = process.platform, audience }) {
    if (!path.isAbsolute(directory) || !nonempty(audience, 2048)) throw new CloudFailure('cloud_storage_invalid');
    this.directory = directory; this.file = path.join(directory, 'connection.enc');
    this.safeStorage = safeStorage; this.platform = platform;
    this.binding = crypto.createHash('sha256').update(audience).digest('hex');
  }
  assertEncryption() {
    try {
      const s = this.safeStorage;
      if (!s || typeof s.isEncryptionAvailable !== 'function' || !s.isEncryptionAvailable() ||
          typeof s.encryptString !== 'function' || typeof s.decryptString !== 'function' ||
          (this.platform === 'linux' && !LINUX_BACKENDS.has(s.getSelectedStorageBackend?.()))) throw new Error();
    } catch { throw new CloudFailure('cloud_os_encryption_unavailable'); }
  }
  validate(value) {
    if (!value || value.version !== 1 || value.binding !== this.binding || !nonempty(value.clientID, 2048) ||
        !nonempty(value.refreshToken, 32768) || Object.keys(value).some(k => !['version', 'binding', 'clientID', 'refreshToken'].includes(k))) {
      throw new CloudFailure('cloud_saved_connection_invalid');
    }
    return { clientID: value.clientID, refreshToken: value.refreshToken };
  }
  async checkDirectory(create) {
    if (create) await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const st = await fs.lstat(this.directory);
    if (!st.isDirectory() || st.isSymbolicLink() || (this.platform !== 'win32' && (st.mode & 0o077))) throw new CloudFailure('cloud_storage_invalid');
  }
  async save(tokens) {
    this.assertEncryption();
    const value = { version: 1, binding: this.binding, clientID: tokens?.clientID, refreshToken: tokens?.refreshToken };
    this.validate(value);
    let encrypted;
    try { encrypted = this.safeStorage.encryptString(JSON.stringify(value)); }
    catch { throw new CloudFailure('cloud_os_encryption_failed'); }
    if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > 65536) throw new CloudFailure('cloud_os_encryption_failed');
    await this.checkDirectory(true);
    const temporary = path.join(this.directory, `.${crypto.randomUUID()}.pending`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(encrypted); await handle.sync(); await handle.close(); handle = null;
      await fs.rename(temporary, this.file);
    } finally {
      if (handle) await handle.close();
      await fs.unlink(temporary).catch(err => { if (err.code !== 'ENOENT') throw err; });
    }
  }
  async load() {
    this.assertEncryption();
    let handle;
    try {
      await this.checkDirectory(false);
      const before = await fs.lstat(this.file);
      if (before.isSymbolicLink() || !before.isFile()) throw new CloudFailure('cloud_saved_connection_unavailable');
      handle = await fs.open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const st = await handle.stat();
      if (st.dev !== before.dev || st.ino !== before.ino) throw new CloudFailure('cloud_saved_connection_unavailable');
      if (!st.isFile() || st.size < 1 || st.size > 65536 || (this.platform !== 'win32' && (st.mode & 0o077))) throw new CloudFailure('cloud_saved_connection_invalid');
      const encrypted = await handle.readFile();
      let decoded;
      try { decoded = JSON.parse(this.safeStorage.decryptString(encrypted)); }
      catch { throw new CloudFailure('cloud_saved_connection_invalid'); }
      return this.validate(decoded);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      if (err instanceof CloudFailure) throw err;
      throw new CloudFailure('cloud_saved_connection_unavailable');
    } finally { if (handle) await handle.close(); }
  }
  // Local sign-out only. Does not claim remote revocation or delete cloud datasets.
  async clear() {
    try { await this.checkDirectory(false); await fs.unlink(this.file); }
    catch (err) { if (err.code !== 'ENOENT') throw new CloudFailure('cloud_storage_invalid'); }
  }
}
module.exports = { EncryptedTokenStore };
