/** Display-only feedback. No reducer calls, clock changes or input interception. */
import {useEffect, useRef, useState} from 'react';
import {PLAY_MARKER_FRACTION} from '../utils/waveformZoom';
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
type Action = {id:number;kind:'play'|'pause'|'cue'|'hotCue'|'loop'|'loopExit'|'jump'|'seek'|'blocked'|'pending';value?:number};
export function DeckActionTrail({engine, mixer, deck, active, trackId}: {engine:DeckEngine;mixer?:Mixer;deck?:ChannelId;active:boolean;trackId:number|null}) {
  const [actions,setActions]=useState<Action[]>([]),next=useRef(0);
  const [held,setHeld]=useState(false);
  const releaseCue=useRef<(()=>void)|null>(null);
  useEffect(()=>{
    let wasHeld=false;
    const update=()=>{
      const snapshot=engine.getSnapshot();
      const nowHeld=active && trackId!==null && playbackVisualState(snapshot)==='held';
      setHeld(nowHeld);
      if(wasHeld && !nowHeld && !snapshot.playing)releaseCue.current?.();
      wasHeld=nowHeld;
    };
    if(!engine.subscribe)return;
    update();return engine.subscribe(update);
  },[engine,active,trackId]);
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
    // Continuous mixer moves change the audio/waveform, not discrete action trails.
    let lastSeek = -Infinity;
    releaseCue.current=()=>accepted('cue');
    const stop=engine.addControlFeedbackListener(e=>{
      if(e.kind==='cue' && playbackVisualState(engine.getSnapshot())==='held')return;
      accepted(e.kind,e.value);
    });
    const gesture=engine.addTransportEventListener(e=>{
      if(machineControlFeedback())return;
      if(e.action==='jumpBeats')accepted('jump',e.detail);
      else if(e.action==='seek' && performance.now()-lastSeek>=500){lastSeek=performance.now();accepted('seek');}
    });
    return()=>{disposed=true;stop();gesture();surface();blocked();releaseCue.current=null;timers.forEach(clearTimeout);};
  },[engine,mixer,deck,active,trackId]);
  return <div className="deck-action-trail" aria-hidden="true" style={{left:`${(1-PLAY_MARKER_FRACTION)*100}%`}}>{[...(held ? [{id:-1,kind:'cue' as const}] : []),...actions.filter(a=>!held || (a.kind!=='cue' && a.kind!=='hotCue'))].map(a=><span key={a.id} className="deck-action-symbol" data-action={a.kind} data-held={a.id===-1 || undefined} data-direction={a.kind==='jump' && (a.value??0)<0 ? 'backward' : undefined}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      {a.kind==='pending'?<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/></>:
       a.kind==='blocked'?<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>:
       a.kind==='play'?<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>:
       a.kind==='pause'?<path d="M8 4v16M16 4v16" strokeWidth="4"/>:
       (a.kind==='loop'||a.kind==='loopExit')?<><path d="M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3"/><path d="M14 5h6v6M10 19H4v-6"/>{a.kind==='loopExit'&&<path d="M3 3l18 18" strokeWidth="3"/>}</>:
       (a.kind==='cue'||a.kind==='hotCue')?<><rect x="3.36" y="3.84" width="3.36" height="16.32" fill="currentColor" stroke="none"/><path d="M9.6 3.6 21.6 12 9.6 20.4z" fill="currentColor" stroke="none"/></>:
       a.kind==='jump'?<><path d="m5 5 7 7-7 7m7-14 7 7-7 7"/></>:
       <><path d="M20 8a8 8 0 1 0 0 8M20 3v6h-6"/></>}
    </svg>{a.value!==undefined&&<small>{a.value}</small>}
  </span>)}</div>;
}
