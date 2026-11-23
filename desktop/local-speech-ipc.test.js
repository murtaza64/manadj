const test=require('node:test');const assert=require('node:assert/strict');const{EventEmitter}=require('node:events');
const{registerLocalSpeechIpc}=require('./local-speech-ipc');
function setup(options={}){
 const handlers=new Map(),wc=new EventEmitter();wc.mainFrame={url:'http://127.0.0.1:8080/'};wc.getURL=()=>wc.mainFrame.url;wc.isDestroyed=()=>false;const sent=[];wc.send=(...args)=>sent.push(args);
 let spawns=0,disposed=0,emit;const ipcMain={handle:(c,f)=>handlers.set(c,f),removeHandler:c=>handlers.delete(c)};
 const off=registerLocalSpeechIpc({ipcMain,webContents:wc,app:{isPackaged:true},getTargetURL:()=> 'http://127.0.0.1:8080/',platform:'darwin',enabled:true,
 sessionFactory:options=>{emit=options.emit;return{start(){spawns++;return'fixed-session'},dispose(){disposed++}}},...options});
 const event={sender:wc,senderFrame:wc.mainFrame};return{handlers,wc,sent,off,event,emit:(v)=>emit(v),get spawns(){return spawns},get disposed(){return disposed},call:(name,...args)=>handlers.get('local-speech:'+name)(event,...args)};
}
test('compiled OFF performs no probe or capture',async()=>{
 const x=setup({enabled:false,probeHelper:()=>assert.fail('probe')});assert.deepEqual(await x.call('capability'),{available:false,code:'local_speech_not_enabled'});await x.call('start');assert.equal(x.spawns,0);x.off();
});
test('start accepts no renderer-selected locale or path; main-frame origin required',async()=>{
 const x=setup();await assert.rejects(x.call('start','en-US'),/invalid/);x.event.senderFrame={url:x.wc.mainFrame.url};await assert.rejects(x.call('start'),/forbidden/);x.event.senderFrame=x.wc.mainFrame;x.wc.mainFrame.url='https://evil.example/';await assert.rejects(x.call('start'),/forbidden/);assert.equal(x.spawns,0);x.off();
});
test('session events bind to one current ID, terminal event permits new capture',async()=>{
 const x=setup();assert.deepEqual(await x.call('start'),{id:'fixed-session'});await assert.rejects(x.call('start'),/busy/);x.emit({id:'stale',type:'text',text:'discard'});assert.equal(x.sent.length,0);x.emit({id:'fixed-session',type:'text',text:'editable'});assert.equal(x.sent.length,1);x.emit({id:'fixed-session',type:'end',code:'complete'});await x.call('start');assert.equal(x.spawns,2);x.off();
});
test('top-level navigation cancels, hash/subframe navigation does not; teardown removes handlers',async()=>{
 const x=setup();await x.call('start');x.wc.emit('did-start-navigation',{},'',true,true);x.wc.emit('did-start-navigation',{},'',false,false);assert.equal(x.disposed,0);x.wc.emit('did-start-navigation',{},'',false,true);assert.equal(x.disposed,1);x.emit({id:'fixed-session',type:'text',text:'late'});assert.equal(x.sent.length,0);x.off();assert.equal(x.handlers.size,0);assert.equal(x.wc.listenerCount('did-start-navigation'),0);
});

test('nonprompt capability is bounded and stale probe is cancelled on navigation',async()=>{
 let callback,killed=0;const x=setup({probeHelper:(file,args,options,done)=>{assert.deepEqual(args,['--probe','en-US']);assert.equal(options.timeout,5000);callback=done;return{kill(){killed++}}}});
 const pending=x.call('capability');x.wc.emit('did-start-navigation',{},'',false,true);assert.equal(killed,1);
 callback(null,JSON.stringify({type:'capability',available:true,code:'local_supported'}));assert.deepEqual(await pending,{available:false,code:'local_speech_cancelled'});x.off();
});
test('capability rejects private extra fields and malformed output',async()=>{
 const x=setup({probeHelper:(_f,_a,_o,done)=>done(null,JSON.stringify({type:'capability',available:true,code:'local_supported',audio:'no'}))});assert.deepEqual(await x.call('capability'),{available:false,code:'local_speech_unavailable'});x.off();
});
