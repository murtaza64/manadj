const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ContinuousSync, managedSync } = require('./continuous');
const group = '11111111-1111-4111-8111-111111111111';
const a = '22222222-2222-4222-8222-222222222222', b = '33333333-3333-4333-8333-333333333333';
test('disabled default cannot invoke backend or network', () => {
 const sync = new ContinuousSync({ connection: {}, backend: () => assert.fail() });
 assert.throws(() => sync.start(group), /continuous_test_disabled/);
 assert.equal(sync.state().running, false);
});
test('managed bridge rejects attach and nonloopback before fetch', async () => {
 await assert.rejects(managedSync({url:'https://example.invalid',token:'a'.repeat(48)}, {}, {fetch:()=>assert.fail()}));
});
test('real delivery verbs validate own prefix, publish then receive only through ORM', async () => {
 const packet = {body:{sequence:1,origin_id:a,group_id:group},signature:'generated'};
 let remote = [], received = [], captures = 0;
 const connection = { publicState: () => ({phase:'connected'}), async syncAuthenticated(g,o,verb,opts) {
  assert.equal(g,group);
  if(verb==='head') return {sequence:remote.length};
  if(verb==='publish') {remote.push(opts.packet);return {sequence:1,stored:true};}
  return {operations:o===a?remote.slice(opts.after, opts.after+1):[],nextAfter:o===a?Math.min(remote.length,opts.after+1):opts.after,more:false};
 }};
 const sync = new ContinuousSync({connection,enabled:true,backend:async body=>{
  if(body.action==='capture') {captures++;return {};}
  if(body.action==='plan')return {local:a,origins:[a,b],cursors:{[b]:0},latest:1};
  if(body.action==='packets') return {packets:body.after===0?[packet]:[]};
  if(body.action==='receive')received.push(body.packet);
 }});
 // Tick directly under an explicit bounded session avoids a test timer race.
 sync.running=true;sync.controller=new AbortController();sync.group=group;sync.expires=Date.now()+10000;
 await sync.tick(); assert.deepEqual(remote,[packet]);
 await sync.tick(); assert.equal(sync.sent,1);assert.equal(captures,2);assert.deepEqual(received,[]);
 remote[0]={...packet,signature:'tampered'};
 await assert.rejects(sync.tick(),/continuous_history_mismatch/);sync.stop();
});
