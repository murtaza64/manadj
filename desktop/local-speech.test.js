const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { LocalSpeechSession } = require('./local-speech');
function setup(platform = 'darwin') {
  const child = new EventEmitter(); child.stdout = new EventEmitter();
  let killed = 0, destroyed = 0, invocation;
  child.stdin = { destroy() { destroyed++; } };
  child.kill = (signal) => { assert.equal(signal, 'SIGKILL'); killed++; };
  const events = [];
  const session = new LocalSpeechSession({ helperPath: '/fixed/helper', platform,
    spawnHelper(...args) { invocation = args; return child; }, emit: e => events.push(e) });
  return { child, session, events, get killed() { return killed; }, get destroyed() { return destroyed; }, get invocation() { return invocation; },
    line(v) { child.stdout.emit('data', Buffer.from(JSON.stringify(v) + '\n')); } };
}
test('unsupported OS and invalid locale never spawn', () => {
  for (const platform of ['win32', 'linux']) assert.throws(() => setup(platform).session.start('en-US'), /unsupported/);
  for (const locale of ['en;curl', '../secret', '', 'a'.repeat(65)]) assert.throws(() => setup().session.start(locale), /invalid/);
});
test('spawns fixed helper without shell and allows one session', () => {
  const x = setup(); const id = x.session.start('en-US');
  assert.ok(id); assert.deepEqual(x.invocation, ['/fixed/helper', ['--start', 'en-US'], { shell: false, stdio: ['pipe', 'pipe', 'ignore'] }]);
  assert.throws(() => x.session.start('en-US'), /busy/); x.session.stop(id);
  assert.equal(x.killed, 1); assert.equal(x.destroyed, 1);
});
test('bounded transcript-only protocol, Unicode survives chunk boundaries', () => {
  const x = setup(); const id = x.session.start('en-US'); x.line({ type: 'listening' });
  const bytes = Buffer.from(JSON.stringify({ type: 'text', text: 'hello café' }) + '\n');
  const p = bytes.indexOf(Buffer.from('é')) + 1;
  x.child.stdout.emit('data', bytes.subarray(0, p)); x.child.stdout.emit('data', bytes.subarray(p));
  x.line({ type: 'end', code: 'complete' });
  assert.deepEqual(x.events, [{ id, type: 'listening' }, { id, type: 'text', text: 'hello café' }, { id, type: 'end', code: 'complete' }]);
});
test('stop drops late text and stale IDs cannot stop next session', () => {
  const x = setup(); const id = x.session.start('en-US'); x.session.stop('unknown'); assert.equal(x.killed, 0);
  x.session.stop(id); x.line({ type: 'text', text: 'late' }); x.child.emit('exit');
  assert.equal(x.events.length, 1); assert.equal(x.events[0].code, 'stopped');
});
test('malformed, extra fields, raw audio and duplicate transcript fail closed', () => {
  for (const value of [null, [], { type: 'audio', data: 'pcm' }, { type: 'text', text: 'x', secret: 'x' }, { type: 'end', code: 'private/error/path' }, { type: 'text', text: 'a'.repeat(10001) }]) {
    const x = setup(); x.session.start('en-US'); x.line(value); assert.equal(x.events.at(-1).code, 'invalid_helper_output');
  }
  const x = setup(); x.session.start('en-US'); x.line({ type: 'text', text: 'one' }); x.line({ type: 'text', text: 'two' });
  assert.equal(x.events.at(-1).code, 'invalid_helper_output');
});
test('oversized or non-JSON output kills helper and emits no raw details', () => {
  for (const text of ['not json\n', 'x'.repeat(64001)]) {
    const x = setup(); x.session.start('en-US'); x.child.stdout.emit('data', Buffer.from(text));
    assert.equal(x.events.at(-1).code, 'invalid_helper_output'); assert.equal(x.killed, 1);
  }
});
test('error, exit and dispose terminate once without leaking diagnostic content', () => {
  for (const event of ['error', 'exit', 'dispose']) {
    const x = setup(); x.session.start('en-US');
    if (event === 'dispose') x.session.dispose(); else x.child.emit(event, new Error('private detail'));
    x.child.emit('exit'); assert.equal(x.events.length, 1); assert.equal(x.killed, 1); assert.equal(JSON.stringify(x.events).includes('private'), false);
  }
});
test('duplicate listening is idempotent', () => {
  const x = setup(); x.session.start('en-US'); x.line({ type: 'listening' }); x.line({ type: 'listening' });
  assert.equal(x.events.length, 1); x.session.dispose();
});
