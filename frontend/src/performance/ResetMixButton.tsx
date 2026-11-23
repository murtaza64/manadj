import{useEffect,useSyncExternalStore}from'react';
import{useDeck}from'../hooks/useDeck';import{useMixer}from'../hooks/useMixer';
import{useViewActive}from'../contexts/viewActive';
import{subscribeControlFocus}from'./controlFocus';
import{mixReset,resetMixKey,isMixResetBlocked}from'./resetMix';
import'./resetMix.css';
export function ResetMixButton(){
 const{deck}=useDeck(),mixer=useMixer(),active=useViewActive();
 const state=useSyncExternalStore(mixReset.subscribe,()=>mixReset.get(deck));
 useEffect(()=>{const cancel=()=>mixReset.cancel(deck);const visibility=()=>{if(document.hidden)cancel();};
 window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',visibility);
 const offGuard=mixReset.watchGuards(deck);const off=subscribeControlFocus(cancel);if(!active)cancel();return()=>{offGuard();off();cancel();window.removeEventListener('blur',cancel);document.removeEventListener('visibilitychange',visibility);};},[deck,active]);
 return <button type="button" className={`player-button perf-reset-mix${state.held?' holding':''}${state.done?' done':''}`}
 aria-label={`Hold to reset ${deck} mix`} title={`Hold ${resetMixKey(deck)} or this button for 0.7s: EQ flat, filter off, trim 0 dB, volume full. Can raise volume. Release early to cancel. Pitch/PFL/FX/stems/crossfader unchanged.`}
 onPointerDown={event=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||!active||isMixResetBlocked())return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);mixReset.begin(deck,mixer,()=>active&&!isMixResetBlocked()&&!document.hidden);}}
 onPointerUp={()=>mixReset.cancel(deck)} onPointerCancel={()=>mixReset.cancel(deck)} onLostPointerCapture={()=>mixReset.cancel(deck)} onBlur={()=>mixReset.cancel(deck)}
 onKeyDown={event=>{if(event.key!==' '&&event.key!=='Enter')return;event.preventDefault();if(event.repeat||!active||isMixResetBlocked()||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;mixReset.begin(deck,mixer,()=>active&&!isMixResetBlocked()&&!document.hidden);}}
 onKeyUp={event=>{if(event.key===' '||event.key==='Enter')mixReset.cancel(deck);}}>
 <svg viewBox="0 0 20 20" aria-hidden="true"><circle className="reset-progress" cx="10" cy="10" r="8"/><path d="M14 6a5 5 0 1 0 1 7M14 3v4h-4"/></svg>
 </button>;
}
