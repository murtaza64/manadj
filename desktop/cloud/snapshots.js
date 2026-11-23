// Main-process-only stored snapshot listing and explicit owner deletion.
// Responses are validated against the fixed contract; renderer gets summaries.
const { CloudFailure } = require('./policy');
const fail = code => { throw new CloudFailure(code); };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
function entry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !ID.test(value.snapshotId || '') || !['committed', 'incomplete', 'deleting'].includes(value.state) ||
      !integer(value.bytes, 1, 64 * 1024 * 1024) || !integer(value.parts, 1, 256) ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) fail('cloud_response_invalid');
  return { snapshotId: value.snapshotId, state: value.state, bytes: value.bytes, parts: value.parts, createdAt: value.createdAt };
}
async function listSnapshots(connection) {
  const value = await connection.authenticated('/v1/snapshots');
  if (!value || typeof value !== 'object' || !Array.isArray(value.snapshots) || value.snapshots.length > 10) fail('cloud_response_invalid');
  return value.snapshots.map(entry);
}
async function deleteSnapshot(connection, snapshotId) {
  if (!ID.test(snapshotId || '')) fail('cloud_request_invalid');
  const value = await connection.authenticated(`/v1/snapshots/${snapshotId}`, { method: 'DELETE' });
  if (!value || typeof value !== 'object' || value.snapshotId !== snapshotId || value.deleted !== true ||
      !integer(value.parts, 0, 256) || !integer(value.bytes, 0, 64 * 1024 * 1024)) fail('cloud_response_invalid');
  // Independent readback: the deleted snapshot must be absent from the
  // owner-only listing before any "deleted" state reaches the renderer.
  const snapshots = await listSnapshots(connection);
  if (snapshots.some(x => x.snapshotId === snapshotId)) fail('cloud_delete_readback_failed');
  return { deleted: { snapshotId, parts: value.parts, bytes: value.bytes }, snapshots };
}
module.exports = { listSnapshots, deleteSnapshot };
