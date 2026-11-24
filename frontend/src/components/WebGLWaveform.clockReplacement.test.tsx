// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import WebGLWaveform from './WebGLWaveform';
const f=vi.hoisted(()=>({ref:{current:null as null|Record<string,ReturnType<typeof vi.fn>>},data:{duration:100}}));
vi.mock('../waveform/useWaveformBlob',()=>({useWaveformBlob:()=>({data:f.data})}));
vi.mock('../hooks/useBeatgridData',()=>({useBeatgridData:()=>({data:null})}));
vi.mock('../hooks/useMetricLadderData',()=>({useMetricLadderData:()=>({data:null})}));
vi.mock('../hooks/useHotCues',()=>({useHotCues:()=>({data:[]})}));
vi.mock('../hooks/useDrops',()=>({useDrops:()=>({data:[]})}));
vi.mock('../contexts/viewActive',()=>({useViewActive:()=>true}));
vi.mock('../waveform/useWaveformRendererV2',()=>({useWaveformRendererV2:()=>({canvasRef:{current:null},rendererRef:f.ref,initError:null})}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it('reinstalls modulation, slip, zoom and state after same-data clock replacement',()=>{
 const methods=()=>Object.fromEntries(['setPlayheadState','setVisibleSeconds','setModulation','setModulationSplit','setSlipReturnPlayhead'].map(k=>[k,vi.fn()]));
 const root=createRoot(document.createElement('div'));
 const modulation=()=>({gain:1,low:0,mid:1,high:1,fader:1});const slip=()=>null;
 const transport={isPlaying:()=>false,pause:()=>{},play:()=>{},seek:()=>{}};
 const render=(clock:{getPlayhead:()=>number})=>act(()=>root.render(<WebGLWaveform trackId={1} clock={clock} cuePoint={0} transport={transport} modulation={modulation} modulationSplit getSlipReturnPlayhead={slip} visibleSeconds={8} playheadState="held"/>));
 f.ref.current=methods();render({getPlayhead:()=>0});
 const fresh=methods();f.ref.current=fresh;render({getPlayhead:()=>0});
 expect(fresh.setModulation).toHaveBeenCalledWith(modulation);expect(fresh.setModulationSplit).toHaveBeenCalledWith(true);expect(fresh.setSlipReturnPlayhead).toHaveBeenCalledWith(slip);expect(fresh.setVisibleSeconds).toHaveBeenCalledWith(8);expect(fresh.setPlayheadState).toHaveBeenCalledWith('held');
 act(()=>root.unmount());
});
