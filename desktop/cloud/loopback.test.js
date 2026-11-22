const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { configuration, AuthorizationAttempt } = require('./policy');
const { authorizeInBrowser } = require('./loopback');

async function sparePort() {
  // Test fixture only. Production never selects an alternate/ephemeral port.
  const s = http.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port;
}
function makeAttempt(port, options) {
  const c = configuration({ enabled: true, resource: 'https://synthetic-library.example', issuer: 'https://synthetic-access.example',
    redirect: `http://127.0.0.1:${port}/oauth/library/callback` });
  const m = { issuer: c.issuer, authorization_endpoint: `${c.issuer}/cdn-cgi/access/oauth/authorization`,
    token_endpoint: `${c.issuer}/cdn-cgi/access/oauth/token`, registration_endpoint: `${c.issuer}/cdn-cgi/access/oauth/registration`,
    revocation_endpoint: `${c.issuer}/cdn-cgi/access/oauth/revoke`, code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code', 'refresh_token'] };
  return new AuthorizationAttempt(c, m, 'synthetic-client', options);
}
function request(port, pathname, { method = 'GET', host } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: '127.0.0.1', port, path: pathname, method,
      headers: { Host: host || `127.0.0.1:${port}` }, agent: false }, res => {
      const parts=[]; res.on('data', x=>parts.push(x)); res.on('end',()=>resolve({ status:res.statusCode, headers:res.headers, body:Buffer.concat(parts).toString() }));
    }); r.on('error', reject); r.end();
  });
}
async function canBind(port) {
  const s=http.createServer(); s.listen({ host:'127.0.0.1', port, exclusive:true });
  await once(s,'listening'); await new Promise(resolve=>s.close(resolve));
}
function capture(promise) { return promise.then(value=>({value}),error=>({error})); }

test('binds before browser opens, rejects unrelated requests and resolves valid callback once', async t => {
  const port=await sparePort(), a=makeAttempt(port); const verifier=a.verifier;
  const abort=new AbortController(); t.after(()=>abort.abort());
  let launch; const launched=new Promise(resolve=>{launch=resolve});
  const result=capture(authorizeInBrowser({attempt:a,signal:abort.signal,openExternal:async url=>{launch(url)}}));
  const u=new URL(await launched); assert.equal(u.origin,'https://synthetic-access.example');
  assert.equal((await request(port,'/unrelated')).status,400);
  assert.equal((await request(port,'/oauth/library/callback',{method:'POST'})).status,405);
  assert.equal((await request(port,'/oauth/library/callback',{host:'untrusted.example'})).status,400);
  assert.equal((await request(port,'/oauth/library/callback?state=wrong&code=private')).status,400);
  const state=u.searchParams.get('state');
  const response=await request(port,`/oauth/library/callback?state=${state}&code=synthetic-code`);
  assert.equal(response.status,200); assert.equal(response.headers['cache-control'],'no-store');
  assert.ok(!response.body.includes(state)); assert.ok(!response.body.includes('synthetic-code'));
  const {value,error}=await result; assert.equal(error,undefined);
  const form=new URLSearchParams(value); assert.equal(form.get('code_verifier'),verifier); assert.equal(form.get('code'),'synthetic-code');
  assert.equal(a.finished,true);
  await assert.rejects(request(port,'/oauth/library/callback')); await canBind(port);
});
test('occupied exact port fails closed without launching browser or touching existing listener', async () => {
  const occupied=http.createServer((req,res)=>res.end('existing'));
  occupied.listen(0,'127.0.0.1'); await once(occupied,'listening'); const port=occupied.address().port;
  try {
    const a=makeAttempt(port); let launches=0;
    await assert.rejects(authorizeInBrowser({attempt:a,openExternal:async()=>{launches++}}),{code:'cloud_callback_port_unavailable'});
    assert.equal(launches,0); assert.equal(a.finished,true); assert.equal((await request(port,'/')).body,'existing');
  } finally { await new Promise(resolve=>occupied.close(resolve)); }
});
test('timeout cancels attempt and releases exact callback port', async () => {
  const port=await sparePort(), a=makeAttempt(port,{lifetimeMs:40}); let launches=0;
  await assert.rejects(authorizeInBrowser({attempt:a,openExternal:async()=>{launches++}}),{code:'cloud_signin_expired'});
  assert.equal(launches,1); assert.equal(a.finished,true); await canBind(port);
});
test('abort before start never opens browser; abort while waiting releases port', async () => {
  const port=await sparePort(); let launches=0; const prior=new AbortController(); prior.abort();
  await assert.rejects(authorizeInBrowser({attempt:makeAttempt(port),signal:prior.signal,openExternal:async()=>{launches++}}),{code:'cloud_signin_cancelled'});
  assert.equal(launches,0); await canBind(port);
  const current=new AbortController();
  await assert.rejects(authorizeInBrowser({attempt:makeAttempt(port),signal:current.signal,openExternal:async()=>{launches++;current.abort()}}),{code:'cloud_signin_cancelled'});
  assert.equal(launches,1); await canBind(port);
});
test('browser launch failure is sanitized and releases port', async () => {
  const port=await sparePort(), a=makeAttempt(port);
  await assert.rejects(authorizeInBrowser({attempt:a,openExternal:async()=>{throw new Error('untrusted sensitive detail')}}),{code:'cloud_browser_unavailable',message:'cloud_browser_unavailable'});
  await canBind(port);
});
test('matched provider denial fails one-shot without reflecting provider text', async () => {
  const port=await sparePort(), a=makeAttempt(port); let response;
  let finishResponse; const responded=new Promise(resolve=>{finishResponse=resolve});
  const result=capture(authorizeInBrowser({attempt:a,openExternal:async url=>{
    response=await request(port,`/oauth/library/callback?state=${new URL(url).searchParams.get('state')}&error=untrusted-private-detail`);
    finishResponse();
  }}));
  const {error}=await result; assert.equal(error.code,'cloud_signin_declined'); await responded;
  assert.equal(response.status,403); assert.ok(!response.body.includes('untrusted-private-detail')); assert.equal(a.finished,true); await canBind(port);
});
