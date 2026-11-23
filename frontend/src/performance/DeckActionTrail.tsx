/** Display-only feedback. No reducer calls, clock changes or input interception. */
import {useEffect, useRef, useState} from 'react';
import {machineControlFeedback} from '../playback/controlFeedbackOrigin';
import {audibleHolder,subscribeAudible} from '../playback/audibleSurface';
import type {DeckEngine} from '../playback/DeckEngine';
import type {Mixer,ChannelId} from '../playback/mixer';
import {subscribeLoadBlocked} from './deckActionFeedback';
import './deckActionTrail.css';
export type PlaybackVisualState = 'held' | 'playing' | 'paused';
export function playbackVisualState(s: {playing:boolean;previewing:boolean;hotCuePreviewSlot:number|null}): PlaybackVisualState {
  return s.playing ? 'playing' : s.previewing || s.hotCuePreviewSlot !== null ? 'held' : 'paused';
}
type Action = {id:number;kind:'play'|'pause'|'cue'|'hotCue'|'loop'|'loopExit'|'jump'|'seek'|'eq'|'filter'|'fader'|'trim'|'blocked'|'pending';value?:number};
export function DeckActionTrail({engine, mixer, deck, active, trackId}: {engine:DeckEngine;mixer?:Mixer;deck?:ChannelId;active:boolean;trackId:number|null}) {
  const [actions,setActions]=useState<Action[]>([]),next=useRef(0);
  useEffect(()=>{
    setActions([]);
    if(!active||trackId===null)return;
    const timers=new Set<ReturnType<typeof setTimeout>>();
    const add=(kind:Action['kind'],value?:number)=>{
      const id=++next.current;
      setActions(old=>[...old.slice(-2),{id,kind,value}]);
      const timer=setTimeout(()=>{timers.delete(timer);setActions(old=>old.filter(a=>a.id!==id));},1100);timers.add(timer);
    };
    let disposed=false;
    // Listeners may run before the takeover watcher. Capture machine origin
    // now, then inspect tenure after all synchronous watchers have completed.
    const accepted=(kind:Action['kind'],value?:number)=>{
      if(machineControlFeedback())return;
      if(audibleHolder()==='shared'){add(kind,value);return;}
      queueMicrotask(()=>{if(!disposed&&audibleHolder()==='shared')add(kind,value);});
    };
    const surface=subscribeAudible(()=>setActions([]));
    const blocked=subscribeLoadBlocked(d=>{if(d===deck)add('blocked');});
    let previous=mixer&&deck?mixer.getChannelState(deck):undefined;
    const mixerLast=new Map<string,number>();
    const mix=mixer&&deck?mixer.subscribe(changed=>{
      const state=mixer.getChannelState(deck),old=previous;previous=state;
      if(changed!==deck||!old||machineControlFeedback())return;
      const kinds:Action['kind'][]=[];
      if(state.fader!==old.fader)kinds.push('fader');
      if(state.filter!==old.filter)kinds.push('filter');
      if(state.trim!==old.trim)kinds.push('trim');
      if(state.eq.low!==old.eq.low||state.eq.mid!==old.eq.mid||state.eq.high!==old.eq.high)kinds.push('eq');
      for(const kind of kinds){const now=performance.now();if(now-(mixerLast.get(kind)??-Infinity)>=350){mixerLast.set(kind,now);accepted(kind);}}
    }):()=>{};
    let lastSeek = -Infinity;
    const stop=engine.addControlFeedbackListener(e=>{
      accepted(e.kind,e.value);
    });
    const gesture=engine.addTransportEventListener(e=>{
      if(machineControlFeedback())return;
      if(e.action==='jumpBeats')accepted('jump',e.detail);
      else if(e.action==='seek' && performance.now()-lastSeek>=500){lastSeek=performance.now();accepted('seek');}
    });
    return()=>{disposed=true;stop();gesture();surface();blocked();mix();timers.forEach(clearTimeout);};
  },[engine,mixer,deck,active,trackId]);
  return <div className="deck-action-trail" aria-hidden="true">{actions.map(a=><span key={a.id} className="deck-action-symbol" data-action={a.kind}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      {a.kind==='pending'?<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/></>:
       a.kind==='blocked'?<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>:
       a.kind==='eq'?<><path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 10h6" strokeWidth="2.5"/></>:
       a.kind==='filter'?<path d="M3 4h18l-7 9v7l-4-2v-5z"/>:
       (a.kind==='fader'||a.kind==='trim')?<><path d="M12 2v20M6 7h12v6H6z"/></>:
       a.kind==='play'?<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>:
       a.kind==='pause'?<path d="M8 4v16M16 4v16" strokeWidth="4"/>:
       (a.kind==='loop'||a.kind==='loopExit')?<><path d="M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3"/><path d="M14 5h6v6M10 19H4v-6"/>{a.kind==='loopExit'&&<path d="M3 3l18 18" strokeWidth="3"/>}</>:
       a.kind==='jump'?<><path d="m5 5 7 7-7 7m7-14 7 7-7 7"/></>:
       <><path d="M20 8a8 8 0 1 0 0 8M20 3v6h-6"/></>}
    </svg>{a.value!==undefined&&<small>{a.value}</small>}
  </span>)}</div>;
}
