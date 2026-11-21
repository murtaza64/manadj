// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalLiveControl } from './LocalLiveControl';

const fake = vi.hoisted(() => ({
  snap: { trackId: 1, playing: true, pitchPercent: 0, bendPercent: 0, loadState: 'ready', keyLock: false, loop: null as object | null, scratching: false, slipLoopActive: false, previewing: false, stemsLoaded: false, audioSourceKey: undefined },
  strip: { fader: .8, trim: .5, eq: { low: .5, mid: .5, high: .5 }, filter: 0 },
}));
vi.mock('../hooks/useDeck', () => ({ useDecks: () => Object.fromEntries(['A','B','C','D'].map(id=>[id,{engine:{getSnapshot:()=>fake.snap,getPlayhead:()=>10}}])) }));
const mixer = { isAutomationEngaged:()=>false, getBeatFxSection:()=>({on:false}), getMaster:()=>.5, getChannelState:()=>fake.strip, getCrossfaderEnabled:()=>true, getCrossfaderAssignment:()=> 'left', getCrossfader:()=>.5 };
vi.mock('../hooks/useMixer', () => ({ useMixer: () => mixer }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true}));fake.snap.loop=null;});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('publishes only after opt-in, folds crossfader gain and stops on unmount', async()=>{
  await act(async()=>root.render(<LocalLiveControl/>));expect(fetch).not.toHaveBeenCalled();
  await act(async()=>host.querySelector('button')!.click());
  expect(fetch).toHaveBeenCalledTimes(1);
  const body=JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
  expect(body.decks).toHaveLength(4);expect(body.decks[0].fader).toBeCloseTo(.8*Math.sqrt(.5));
  expect(body.decks[0].position).toBe(10);expect(body.unsupported).toEqual([]);
  await act(async()=>host.querySelector('button')!.click());
  expect(vi.mocked(fetch).mock.calls.at(-1)![1]?.method).toBe('DELETE');
});
it('flags unsupported source loops without claiming equivalent playback', async()=>{
  fake.snap.loop={start:1,end:2};
  await act(async()=>root.render(<LocalLiveControl/>));await act(async()=>host.querySelector('button')!.click());
  const body=JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
  expect(body.decks[0].unsupported).toContain('Loop');
});

it('does not overlap slow source requests', async()=>{
  vi.useFakeTimers();
  let finish!: (value: {ok:boolean})=>void;
  vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve as typeof finish;}));
  try {
    await act(async()=>root.render(<LocalLiveControl/>));
    await act(async()=>host.querySelector('button')!.click());
    await act(async()=>vi.advanceTimersByTime(1200));expect(fetch).toHaveBeenCalledTimes(1);
    await act(async()=>finish({ok:true}));
    await act(async()=>vi.advanceTimersByTime(200));expect(fetch).toHaveBeenCalledTimes(2);
    await act(async()=>host.querySelector('button')!.click());
  } finally {vi.useRealTimers();}
});
