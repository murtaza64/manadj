// Generated local tests only. This file must never be included in deployment.
import{SyncGroup as Reference,createHandler}from'../sync.mjs';
import{authorizeOwner}from'../contracts.mjs';
import{importJWK}from'jose';
export class SyncGroup extends Reference{
 async verify(key,sig,input,origin){const valid=await super.verify(key,sig,input,origin);if(this.raceOrigin===origin){this.revoke(origin);this.raceOrigin=null}return valid}

 async fetch(req){if(new URL(req.url).pathname==='/fixture-clear-byte-accounting'){this.sql.exec('UPDATE op SET bytes=0');return new Response('done')}if(new URL(req.url).pathname==='/fixture-race'){this.raceOrigin=req.headers.get('fixture-origin');return new Response('armed')}if(new URL(req.url).pathname==='/fixture-revoke'){this.revoke(req.headers.get('fixture-origin'));return new Response('done')}return super.fetch(req)}
}
const handle=createHandler(async(req,env)=>authorizeOwner(req,env,{keyResolver:await importJWK(JSON.parse(env.FIXTURE_RSA),'RS256')}));
export default{async fetch(req,env){if(['/fixture-revoke','/fixture-race','/fixture-clear-byte-accounting'].includes(new URL(req.url).pathname)){const s=env.SYNC_GROUPS.get(env.SYNC_GROUPS.idFromName(env.SYNC_GROUP));return s.fetch(req)}return handle(req,env)}};
