import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from './worker.mjs';
import {Failure} from './contracts.mjs';
import {HTML,JS} from './sync_check_ui.mjs';
test('generated sync check is owner-only, independent of snapshot gate, no storage on GET',async()=>{
 const env={LIBRARY_ORIGIN:'https://sync.test',SNAPSHOTS_ENABLED:'false',SYNC_ENABLED:'false'};
 const handle=createHandler({authorize:async()=>({sub:'verified-generated-owner'})});
 const identity=await handle(new Request('https://sync.test/v1/sync-check/identity'),env);
 assert.deepEqual(await identity.json(),{authenticated:true,subject:'verified-generated-owner'});
 const page=await handle(new Request('https://sync.test/v1/sync-check'),env);assert.equal(page.status,200);assert.match(await page.text(),/Prepare generated public bootstrap/);
 const script=await handle(new Request('https://sync.test/v1/sync-check/app.js'),env);assert.equal(script.status,200);new Function(JS);
 assert.equal((await handle(new Request('https://sync.test/v1/sync-check',{method:'POST'}),env)).status,404);
 const denied=createHandler({authorize:async()=>{throw new Failure(401,'denied')}});
 assert.equal((await denied(new Request('https://sync.test/v1/sync-check'),env)).status,401);
 assert(!HTML.includes('eval('));assert(!JS.includes('exportKey(\'pkcs8\''));
});
