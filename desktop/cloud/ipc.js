// IPC exposes verbs and safe summaries, never credentials, URLs or raw data.
const path = require('node:path');
const { authorizeFrame, CloudFailure } = require('./policy');
const { EncryptedTokenStore } = require('./tokenStore');
const { CloudConnection } = require('./connection');
const { ReviewedUpload } = require('./upload');
const { listSnapshots, deleteSnapshot } = require('./snapshots');
const { prepareFromManagedBackend } = require('./source');
const target = require('./target');
const { ContinuousSync, managedSync } = require('./continuous');
function registerCloudIpc({ ipcMain, webContents, app, safeStorage, shell, getBackend,
  getTargetURL, connection: suppliedConnection, upload: suppliedUpload }) {
  const connection = suppliedConnection || new CloudConnection({ config: target,
    store: new EncryptedTokenStore({ directory: path.join(app.getPath('userData'), 'library-cloud'), safeStorage,
      audience: target.resource }), openExternal: value => shell.openExternal(value) });
  const upload = suppliedUpload || new ReviewedUpload({ connection, prepare: options => prepareFromManagedBackend(getBackend(), options) });
  const continuous = new ContinuousSync({ connection, backend: (body, options) => managedSync(getBackend(), body, options), enabled: target.continuousEnabled === true });
  const handlers = [];
  const guard = event => authorizeFrame(event, webContents, getTargetURL());
  const state = () => ({ connection: connection.publicState(), upload: upload.state(), continuous: continuous.state() });
  const register = (name, fn) => {
    const channel = `library-cloud:${name}`; handlers.push(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      try { guard(event); return { ok: true, value: await fn(...args) }; }
      catch (error) { return { ok: false, error: error instanceof CloudFailure ? error.code : 'cloud_operation_failed' }; }
    });
  };
  const none = args => { if (args.length) throw new CloudFailure('cloud_request_invalid'); };
  register('state', (...args) => { none(args); return state(); });
  register('connect', async (...args) => { none(args); continuous.stop(); upload.clear(); await connection.connect(); return state(); });
  register('resume', async (...args) => { none(args); continuous.stop(); upload.clear(); await connection.resume(); return state(); });
  register('disconnect', async (...args) => { none(args); continuous.stop(); upload.clear(); await connection.disconnect(); return state(); });
  register('continuousStart', (...args) => {
    if (args.length !== 1 || typeof args[0] !== 'string') throw new CloudFailure('cloud_request_invalid');
    continuous.start(args[0]); return state();
  });
  register('continuousStop', (...args) => { none(args); continuous.stop(); return state(); });
  register('review', async (...args) => { none(args); await upload.review(); return state(); });
  register('upload', async (...args) => {
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0]) ||
        Object.keys(args[0]).length !== 2 || !/^[a-f0-9]{48}$/.test(args[0].reviewID || '') ||
        !/^[a-f0-9]{64}$/.test(args[0].reviewedSha256 || '')) throw new CloudFailure('cloud_request_invalid');
    await upload.upload(args[0].reviewID, args[0].reviewedSha256); return state();
  });
  register('snapshots', async (...args) => { none(args);
    if (connection.publicState().phase !== 'connected') throw new CloudFailure('cloud_signin_required');
    return listSnapshots(connection); });
  register('deleteSnapshot', async (...args) => {
    if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0]) ||
        Object.keys(args[0]).length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(args[0].snapshotId || ''))
      throw new CloudFailure('cloud_request_invalid');
    upload.clear(); // A cleared local review never claims cloud deletion; this does.
    return deleteSnapshot(connection, args[0].snapshotId); });
  register('cancel', (...args) => { none(args); continuous.stop(); upload.cancel();
    if (connection.publicState().phase === 'connecting') connection.cancel();
    return state(); });
  const cancelWork = () => { continuous.stop(); upload.cancel(); connection.cancel(); };
  // Hash/history routing and child frames do not replace the trusted renderer.
  const navigated = (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame === true && isInPlace === false) cancelWork();
  };
  webContents.on('did-start-navigation', navigated);
  return () => { cancelWork(); webContents.removeListener('did-start-navigation', navigated); for (const channel of handlers) ipcMain.removeHandler(channel); };
}
module.exports = { registerCloudIpc };
