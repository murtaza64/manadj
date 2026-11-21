// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { DesktopSourceBrowser } from './DesktopSourceBrowser';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('./FieldReviewInspector', () => ({ FieldReviewInspector: ({initialSurface, initialDirection}: {initialSurface: string;initialDirection: string}) => <div data-testid="review">{initialSurface}:{initialDirection}</div> }));
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });
const tracks = [
  {id:'0', title:'Playlist track', artist:'A', path:'/music/a.mp3',library_track_id:1,library_title:'Clean title',match:'same-path'},
  {id:'1', title:'Outside playlists', artist:'B', path:'/music/b.mp3',library_track_id:null,library_title:null,match:'not-in-library'},
];
const tick = () => new Promise(r => setTimeout(r, 15));
async function mount(source: 'engine' | 'rekordbox', status='read') {
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async () => new Response(JSON.stringify({source,status,tracks:status==='read'?tracks:[]})));
  vi.spyOn(api.playlistSync,'getCoverage').mockResolvedValue({sources:{engine:{status:'read'},rekordbox:{status:'read'}},playlists:[{name:'Set',path:['Set'],entries:{manadj:[],engine:[{id:'1',tracks:[{filename:'/music/a.mp3',track_id:1}],skipped:0}],rekordbox:[{id:'1',tracks:[{filename:'/music/a.mp3',track_id:1}],skipped:0}]}}]} as never);
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);
  await act(async()=>{root.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><DesktopSourceBrowser source={source}/></QueryClientProvider>);await tick();await tick();});
  await act(async()=>{await tick();});
  return {host,fetch};
}
const button=(host:HTMLElement,text:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;
it.each(['engine','rekordbox'] as const)('%s All tracks reads its independent source inventory, not a union of playlists',async source=>{
  const {host,fetch}=await mount(source);
  expect(host.textContent).toContain('Outside playlists');
  expect(fetch.mock.calls[0][0]).toContain(`/sync/sources/${source}/tracks`);
  await act(async()=>{button(host,'Set1').click();});
  expect(host.textContent).not.toContain('Outside playlists');
  await act(async()=>{button(host,'All tracks 2').click();});
  expect(host.textContent).toContain('Outside playlists');
});
it('mixed selected set excludes unmatched records; expansion does not select',async()=>{
  const {host}=await mount('engine');
  await act(async()=>{button(host,'▸ Playlist track').click();});
  expect(host.querySelector('.pg-selection-bar')).toBeNull();
  expect(host.textContent).toContain('audio unverified');
  await act(async()=>{host.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach(input=>input.click());});
  expect(host.querySelector('.pg-selection-bar')!.textContent).toContain('2 selected1 same-path matches · 1 excluded');
  await act(async()=>{button(host,'Review Engine DJ → Library fields').click();});
  expect(host.querySelector('[data-testid=review]')!.textContent).toBe('engine:import');
  await act(async()=>{button(host,'Set1').click();});
  expect(host.querySelector('[data-testid=review]')).toBeNull();
});
it.each(['not_configured','failed'])('keeps %s distinct from an empty source',async status=>{
  const {host}=await mount('rekordbox',status);
  expect(host.textContent).toContain(status==='failed'?'Could not read':'not configured');
  expect(host.textContent).not.toContain('No source tracks in this view');
});
