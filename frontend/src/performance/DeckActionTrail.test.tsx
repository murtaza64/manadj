// @vitest-environment jsdom
import {act} from 'react';import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {DeckActionTrail,playbackVisualState} from './DeckActionTrail';
import {claimAudible,registerSurface,unregisterSurface} from '../playback/audibleSurface';
import {withoutControlFeedback} from '../playback/controlFeedbackOrigin';
import {showLoadBlocked} from './deckActionFeedback';
import type {Mixer,ChannelId} from '../playback/mixer';
import type {DeckEngine,DeckTransportGesture,DeckControlFeedback} from '../playback/DeckEngine';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>vi.useRealTimers());
it('PLAY takes priority over preview until cue release, including hotcue hold',()=>{
 expect(playbackVisualState({playing:true,previewing:true,hotCuePreviewSlot:1})).toBe('playing');
 expect(playbackVisualState({playing:false,previewing:false,hotCuePreviewSlot:1})).toBe('held');
 expect(playbackVisualState({playing:false,previewing:false,hotCuePreviewSlot:null})).toBe('paused');
});
it('bounds short-lived symbols and removes subscriptions/timers when hidden',async()=>{
 vi.useFakeTimers();let control=(_e:DeckControlFeedback)=>{},gesture=(_e:DeckTransportGesture)=>{};
 const snapshot={playing:false,previewing:false,loop:null};const stop=vi.fn(),off=vi.fn();
 const engine={getSnapshot:()=>snapshot,addControlFeedbackListener:(cb:typeof control)=>{control=cb;return stop;},addTransportEventListener:(cb:typeof gesture)=>{gesture=cb;return off;}} as unknown as DeckEngine;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<DeckActionTrail engine={engine} active trackId={1}/>));
 act(()=>{control({kind:'cue'});});expect(host.querySelector('[data-action=cue]')).not.toBeNull();
 act(()=>{control({kind:'play'});});expect(host.querySelector('[data-action=play]')).not.toBeNull();
 act(()=>{for(let i=0;i<9;i++)gesture({action:'jumpBeats',playhead:0,detail:4});});
 expect(host.querySelectorAll('.deck-action-symbol')).toHaveLength(3);
 act(()=>{registerSurface('replay',{transport:{togglePlay:()=>{}},silence:()=>{}});claimAudible('replay');});
 expect(host.querySelectorAll('.deck-action-symbol')).toHaveLength(0);
 await act(async()=>{withoutControlFeedback(()=>{control({kind:'play'});gesture({action:'seek',playhead:0});});await Promise.resolve();});expect(host.querySelectorAll('.deck-action-symbol')).toHaveLength(0);
 act(()=>unregisterSurface('replay'));
 act(()=>{control({kind:'hotCue',value:2});gesture({action:'hotCue',playhead:0,detail:1});});expect(host.querySelectorAll('.deck-action-symbol')).toHaveLength(1);
 act(()=>{for(let i=0;i<30;i++)gesture({action:'seek',playhead:i});});expect(host.querySelectorAll('[data-action=seek]')).toHaveLength(1);
 act(()=>{control({kind:'loopExit'});});expect(host.querySelector('[data-action=loopExit]')).not.toBeNull();
 act(()=>vi.advanceTimersByTime(1101));expect(host.querySelectorAll('.deck-action-symbol')).toHaveLength(0);
 act(()=>root.render(<DeckActionTrail engine={engine} active={false} trackId={1}/>));expect(stop).toHaveBeenCalled();expect(off).toHaveBeenCalled();
 act(()=>root.unmount());host.remove();
});

it('mixer displays only changed base controls and bounded load refusals with teardown',()=>{
 vi.useFakeTimers();let mix=(_d?:ChannelId)=>{};
 let state={fader:1,filter:0,trim:0,eq:{low:.5,mid:.5,high:.5}};
 const off=vi.fn();const mixer={getChannelState:()=>state,subscribe:(cb:typeof mix)=>{mix=cb;return off;}}as unknown as Mixer;
 const engine={addControlFeedbackListener:()=>()=>{},addTransportEventListener:()=>()=>{}}as unknown as DeckEngine;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<DeckActionTrail engine={engine} mixer={mixer} deck="A" active trackId={1}/>));
 act(()=>{mix('A');});expect(host.querySelectorAll('.deck-action-symbol')).toHaveLength(0);
 act(()=>{state={...state,fader:.3};mix('A');});expect(host.querySelector('[data-action=fader]')).not.toBeNull();
 act(()=>{state={...state,eq:{...state.eq,low:0}};mix('A');});expect(host.querySelector('[data-action=eq]')).not.toBeNull();
 act(()=>{showLoadBlocked('B');});expect(host.querySelector('[data-action=blocked]')).toBeNull();
 act(()=>{showLoadBlocked('A');});expect(host.querySelector('[data-action=blocked]')).not.toBeNull();
 act(()=>root.render(<DeckActionTrail engine={engine} mixer={mixer} deck="A" active={false} trackId={1}/>));expect(off).toHaveBeenCalled();
 act(()=>{showLoadBlocked('A');});expect(host.querySelectorAll('.deck-action-symbol')).toHaveLength(0);
 act(()=>root.unmount());host.remove();
});

it('preserves a human gesture delivered before synchronous takeover and drops machine syncs',async()=>{
 let control=(_e:DeckControlFeedback)=>{};const engine={addControlFeedbackListener:(cb:typeof control)=>{control=cb;return()=>{}},addTransportEventListener:()=>()=>{}}as unknown as DeckEngine;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<DeckActionTrail engine={engine} active trackId={1}/>));
 act(()=>{registerSurface('replay',{transport:{togglePlay:()=>{}},silence:()=>{}});claimAudible('replay');});
 await act(async()=>{withoutControlFeedback(()=>control({kind:'pause'}));control({kind:'play'});unregisterSurface('replay');await Promise.resolve();});
 expect(host.querySelector('[data-action=play]')).not.toBeNull();expect(host.querySelector('[data-action=pause]')).toBeNull();
 act(()=>root.unmount());host.remove();
});

it('anchors the mobile cue glyph throughout hold and cleans up on release or hide',()=>{
 vi.useFakeTimers();let notify=()=>{};let snapshot={playing:false,previewing:true,hotCuePreviewSlot:null as number|null};
 const engine={getSnapshot:()=>snapshot,subscribe:(cb:()=>void)=>{notify=cb;return()=>{}},addControlFeedbackListener:()=>()=>{},addTransportEventListener:()=>()=>{}} as unknown as DeckEngine;
 const host=document.createElement('div');const root=createRoot(host);
 act(()=>root.render(<DeckActionTrail engine={engine} active trackId={1}/>));
 expect(host.querySelector('[data-held] rect')?.getAttribute('x')).toBe('3.36');
 act(()=>vi.advanceTimersByTime(5000));expect(host.querySelectorAll('[data-held]')).toHaveLength(1);
 act(()=>{snapshot={...snapshot,previewing:false};notify();});expect(host.querySelector('[data-held]')).toBeNull();
 act(()=>{snapshot={...snapshot,hotCuePreviewSlot:2};notify();});expect(host.querySelector('[data-held]')).not.toBeNull();
 act(()=>root.render(<DeckActionTrail engine={engine} active={false} trackId={1}/>));expect(host.querySelector('[data-held]')).toBeNull();
 act(()=>root.unmount());
});
