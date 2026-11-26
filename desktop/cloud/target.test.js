const { test } = require('node:test');
const assert = require('node:assert/strict');
const target = require('./target');
const { configuration } = require('./policy');
const { ContinuousSync } = require('./continuous');
test('snapshot-only target retains fixed owner resource and no continuous activation', () => {
 assert.ok(Object.isFrozen(target));
 assert.equal(target.enabled, true);
 assert.equal(target.continuousEnabled, false);
 assert.equal(configuration(target).resource, 'https://manadj-private-library.murtaza-javaid.workers.dev');
 const sync = new ContinuousSync({ connection: {}, backend: () => assert.fail(), enabled: target.continuousEnabled === true });
 assert.equal(sync.state().enabled, false);
 assert.throws(() => sync.start('11111111-1111-4111-8111-111111111111'), /continuous_test_disabled/);
});
