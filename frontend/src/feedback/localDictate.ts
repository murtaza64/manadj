import type {Dictation} from './dictate';
type SpeechEvent = {id:string;type:'listening'|'text'|'end';text?:string;code?:string};
export interface LocalSpeechBridge {
 capability():Promise<{available:boolean;code:string}>;
 start():Promise<{id?:string;available?:boolean;code?:string}>;
 stop():Promise<unknown>;
 subscribe(listener:(event:SpeechEvent)=>void):()=>void;
}
declare global {interface Window {manadjLocalSpeech?:LocalSpeechBridge}}
/** A native bridge is authoritative on desktop, including OFF/denied state.
 * Never fall back to a browser service after local capability fails. */
export async function startLocalDictation(bridge:LocalSpeechBridge,onText:(text:string)=>void,onEnd:()=>void,onError:(code:string)=>void, signal?:AbortSignal):Promise<Dictation|null>{
 const capability=await bridge.capability().catch(()=>({available:false,code:'local_speech_unavailable'}));
 if(signal?.aborted)return null;
 if(!capability.available){onError(capability.code);onEnd();return null;}
 let id:string|undefined,stopped=false,ended=false;const pending:SpeechEvent[]=[];
 const finish=()=>{if(ended)return;ended=true;off();signal?.removeEventListener('abort',cancel);onEnd();};
 const receive=(event:SpeechEvent)=>{
  if(stopped||ended)return;
  if(!id){if(pending.length<4)pending.push(event);return;}
  if(event.id!==id)return;
  if(event.type==='text'&&typeof event.text==='string'&&event.text.trim())onText(event.text.trim());
  if(event.type==='end'){if(!['complete','stopped'].includes(event.code??''))onError(event.code??'local_speech_unavailable');finish();}
 };
 const off=bridge.subscribe(receive);
 const cancel=()=>{stopped=true;off();void bridge.stop().catch(()=>{});finish();};
 signal?.addEventListener('abort',cancel,{once:true});
 try{const result=await bridge.start();id=result.id;if(signal?.aborted){void bridge.stop().catch(()=>{});finish();return null;}if(!id){void bridge.stop().catch(()=>{});throw new Error();}for(const event of pending)receive(event);}
 catch{onError('local_speech_unavailable');finish();return null;}
 return{stop(){if(stopped||ended)return;stopped=true;off();void bridge.stop().catch(()=>{});finish();}};
}
