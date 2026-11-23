// @vitest-environment jsdom
import{act}from'react';import{createRoot}from'react-dom/client';import{afterEach,expect,it,vi}from'vitest';
import{OutputDelayCue}from'./OutputDelayCue';import type{DeckEngine}from'../playback/DeckEngine';
vi.mock('../playback/heardStore',()=>({subscribeHeard:()=>()=>{},heardRoute:()=>route}));
const route={on:true,seconds:.2,reportedSeconds:.1,key:'test'};globalThis.IS_REACT_ACT_ENVIRONMENT=true;
afterEach(()=>vi.useRealTimers());
it('names output latency, expires when display catches up, cleans subscription and timer',()=>{
 vi.useFakeTimers();let remaining=.2,notify=()=>{};const off=vi.fn();
 const engine={getHeardDisplayWaitSeconds:()=>remaining,subscribe:(cb:()=>void)=>{notify=cb;return off;}}as unknown as DeckEngine;
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<OutputDelayCue engine={engine} active/>));expect(host.textContent).toBe('Output delay · 200 ms');expect(host.textContent).not.toContain('loading');
 act(()=>{remaining=0;vi.advanceTimersByTime(210);});expect(host.textContent).toBe('');
 act(()=>{remaining=.2;notify();});expect(host.textContent).not.toBe('');
 act(()=>root.render(<OutputDelayCue engine={engine} active={false}/>));expect(host.textContent).toBe('');expect(off).toHaveBeenCalled();
 act(()=>root.unmount());host.remove();expect(vi.getTimerCount()).toBe(0);
});
