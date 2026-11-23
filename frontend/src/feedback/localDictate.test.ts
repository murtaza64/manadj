import{describe,it,expect}from'vitest';import{startLocalDictation,type LocalSpeechBridge}from'./localDictate';
describe('local-only native transcript adapter',()=>{
 it('OFF never starts or subscribes and never uses browser recognition',async()=>{let starts=0;const errors:string[]=[];let ended=0;const bridge={capability:async()=>({available:false,code:'local_speech_not_enabled'}),start:async()=>{starts++;return{id:'one'}},stop:async()=>{},subscribe:()=>{throw Error('unexpected')}} as LocalSpeechBridge;expect(await startLocalDictation(bridge,()=>{},()=>ended++,e=>errors.push(e))).toBeNull();expect(starts).toBe(0);expect(errors).toEqual(['local_speech_not_enabled']);expect(ended).toBe(1);});
 it('accepts only active session text and suppresses late events after cancellation',async()=>{let listener:Parameters<LocalSpeechBridge['subscribe']>[0]=()=>{},stops=0,removed=0,ended=0;const text:string[]=[];const bridge:LocalSpeechBridge={capability:async()=>({available:true,code:'local_supported'}),start:async()=>({id:'one'}),stop:async()=>{stops++},subscribe:cb=>{listener=cb;return()=>{removed++}}};const session=await startLocalDictation(bridge,s=>text.push(s),()=>ended++,()=>{});listener({id:'other',type:'text',text:'wrong'});listener({id:'one',type:'text',text:' editable '});session!.stop();listener({id:'one',type:'text',text:'late'});expect(text).toEqual(['editable']);expect(stops).toBe(1);expect(ended).toBe(1);expect(removed).toBeGreaterThan(0);});
});

it('cancels an in-flight start without accepting its late result',async()=>{
 let resolveStart:(value:{id:string})=>void=()=>{},stops=0,ended=0;const abort=new AbortController();
 const bridge:LocalSpeechBridge={capability:async()=>({available:true,code:'local_supported'}),start:()=>new Promise(resolve=>{resolveStart=resolve}),stop:async()=>{stops++},subscribe:()=>()=>{}};
 const pending=startLocalDictation(bridge,()=>{throw Error('late')},()=>ended++,()=>{},abort.signal);
 await Promise.resolve();await Promise.resolve();await Promise.resolve();abort.abort();resolveStart({id:'one'});expect(await pending).toBeNull();expect(stops).toBeGreaterThan(0);expect(ended).toBe(1);
});
