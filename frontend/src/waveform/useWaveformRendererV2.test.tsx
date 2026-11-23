// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {useWaveformRendererV2} from './useWaveformRendererV2';
import type {HotCue} from '../types';
import type {DecodedWaveform} from './blob';
const made=vi.hoisted(()=>[] as Record<string,ReturnType<typeof vi.fn>>[]);
vi.mock('./WaveformRendererV2',()=>({WaveformRendererV2:class {
 constructor(){const item:Record<string,ReturnType<typeof vi.fn>>={};for(const name of ['setWaveformData','startRenderLoop','dispose','setActive','setPlaying','setStemWaveforms','setStemMask','markDirty','setStyle','setCuePoint','setHotCues','setBeatgrid','setResetMarks','setRegions','setDropMarks','setBeatjumpGuides']){item[name]=vi.fn();Object.assign(this,{[name]:item[name]});}made.push(item);}
}}));
vi.mock('./styleSlots',()=>({useStyleSlot:()=>style}));
const style={styleId:'test',params:{}};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('restores hotcues and all display inputs when route clock replaces renderer',()=>{
 const waveformData={duration:100} as DecodedWaveform;
 const hotCues=[{id:1,track_id:1,slot_number:1,time_seconds:12,color:'#ff0000',label:null,created_at:'',updated_at:''}] as HotCue[];
 const config={isMinimapMode:true}; const stemMaskAt=()=>[1,1,1,1];
 function Harness({clock}:{clock:{getPlayhead:()=>number}}){const {canvasRef}=useWaveformRendererV2({clock,waveformData,config,hotCues,cuePoint:4,active:false,playing:true,stemMaskAt});return <canvas ref={canvasRef}/>;}
 const host=document.createElement('div');const root=createRoot(host);
 act(()=>root.render(<Harness clock={{getPlayhead:()=>0}}/>));
 const first=made.at(-1)!;expect(first.setHotCues).toHaveBeenCalledWith(hotCues);
 act(()=>root.render(<Harness clock={{getPlayhead:()=>1}}/>));
 const replacement=made.at(-1)!;expect(replacement).not.toBe(first);expect(first.dispose).toHaveBeenCalledOnce();
 expect(replacement.setHotCues).toHaveBeenCalledWith(hotCues);
 expect(replacement.setCuePoint).toHaveBeenCalledWith(4);
 expect(replacement.setActive).toHaveBeenCalledWith(false);
 expect(replacement.setPlaying).toHaveBeenCalledWith(true);
 expect(replacement.setStemMask).toHaveBeenCalledWith(stemMaskAt,true);
 expect(replacement.setStyle).toHaveBeenCalledWith('test',{});
 act(()=>root.unmount());
});
