import {expect,it} from 'vitest';import{WaveformRendererV2}from'./WaveformRendererV2';
it('held cursor uses separated yellow dashes while playback retains solid pink',()=>{
 const r:any=Object.create(WaveformRendererV2.prototype);Object.assign(r,{config:{playMarkerPosition:.25},isMinimap:false,externalWindow:false,markDirty:()=>{}});
 const view={w:100,h:52,dpr:1,playhead:0};let verts:number[]=[];
 r.setPlayheadState('held');r.pushPlayhead(view,verts);expect(verts.length).toBeGreaterThan(36);
 expect(verts[0]).toBe(25);expect(verts[2]).toBe(1);expect(verts[3]).toBeCloseTo(.8);
 const heldCount=verts.length;verts=[];r.setPlayheadState('playing');r.pushPlayhead(view,verts);expect(verts.length).toBeLessThan(heldCount);
});

it('held and solid cursor stay the same device-pixel width at DPR2',()=>{
 const r:any=Object.create(WaveformRendererV2.prototype);Object.assign(r,{config:{playMarkerPosition:.25},isMinimap:false,externalWindow:false,markDirty:()=>{}});
 const view={w:200,h:104,dpr:2,playhead:0};const widths=[];for(const state of ['held','playing']as const){const v:number[]=[];r.setPlayheadState(state);r.pushPlayhead(view,v);widths.push(Math.max(...v.filter((_,i)=>i%5===0))-Math.min(...v.filter((_,i)=>i%5===0)));}expect(widths).toEqual([3,3]);
});
