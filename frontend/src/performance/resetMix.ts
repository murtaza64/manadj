import{hasKeyboardOverlay}from'../components/performance/performanceKeys';
import type {ChannelId, Mixer} from '../playback/mixer';
export const RESET_MIX_HOLD_MS=700;
export const resetMixKey=(deck:ChannelId)=>deck==='A'||deck==='C'?"'":'\\';
export const isMixResetBlocked=()=>hasKeyboardOverlay()||!!document.querySelector('[aria-modal="true"],dialog[open],.perf-keyboard-scope[data-library-focus="true"]');
type State={held:boolean;done:boolean};
const idle:State={held:false,done:false};
/** One held reset per physical channel. Callers own release/cancellation. */
export function createMixReset(){
 const states=new Map<ChannelId,State>(),listeners=new Set<()=>void>();
 const timers=new Map<ChannelId,ReturnType<typeof setTimeout>>();
 const notify=()=>listeners.forEach(fn=>fn());
 const cancel=(deck:ChannelId)=>{clearTimeout(timers.get(deck));timers.delete(deck);if(states.has(deck)){states.delete(deck);notify();}};
 return{
  subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};},
  get:(deck:ChannelId)=>states.get(deck)??idle,
  cancel,
  watchGuards:(deck:ChannelId)=>{
   const observer=new MutationObserver(()=>{if(states.has(deck)&&isMixResetBlocked())cancel(deck);});
   observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-modal','open','role','class','style','hidden','inert','aria-hidden','data-library-focus']});
   return()=>observer.disconnect();
  },
  begin:(deck:ChannelId,mixer:Pick<Mixer,'setEq'|'setFilter'|'setTrim'|'setFader'>,valid:()=>boolean=()=>true)=>{
   if(states.has(deck))return;
   states.set(deck,{held:true,done:false});notify();
   timers.set(deck,setTimeout(()=>{timers.delete(deck);if(!valid()){cancel(deck);return;}
    // Never touch pitch, cue routing, FX, stems, or crossfader.
    mixer.setEq(deck,'high',.5);mixer.setEq(deck,'mid',.5);mixer.setEq(deck,'low',.5);
    mixer.setFilter(deck,0);mixer.setTrim(deck,.5);mixer.setFader(deck,1);
    states.set(deck,{held:true,done:true});notify();
   },RESET_MIX_HOLD_MS));
  },
 };
}
export const mixReset=createMixReset();
