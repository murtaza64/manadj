// Run from frontend: npx vitest run --config ../prototypes/android-session/fixture.config.ts
// Expected values come from the shipping desktop reducer/planner, not the Kotlin port.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CaptureEvent } from '../../frontend/src/capture/events';
import { stateAt, deriveTimeline } from '../../frontend/src/sessions/timelineModel';
import { planReplay } from '../../frontend/src/sessions/replayPlanner';
import { test, expect } from '../../frontend/node_modules/vitest/dist/index.js';

const events: CaptureEvent[] = [];
const add = (e: CaptureEvent) => events.push(e);
const load = (t: number, channel: 'A'|'B'|'C'|'D', trackId: number | null, bpm = 128) => add({t, kind:'load', channel, trackId, bpm});
const transport = (t: number, channel: 'A'|'B'|'C'|'D', action: 'play'|'pause'|'hotCue'|'jumpBeats'|'cue'|'previewStart'|'previewEnd', playhead: number, detail?: number) => add({t, kind:'transport', channel, action, playhead, ...(detail === undefined ? {} : {detail})});
// Nonzero capture origin, equal-time ordering, real load/transport separation.
load(100, 'A', 101); transport(100, 'A', 'play', 32);
load(100, 'B', 102); load(100, 'C', 103); load(100, 'D', 104);
add({t:100, kind:'pitch', channel:'A', value:4});
transport(108,'B','play',16); transport(116,'C','play',8); transport(124,'D','play',0);
transport(128,'A','jumpBeats',80,32);
add({t:132,kind:'loop',channel:'C',playhead:24,region:{start:24,end:28}});
add({t:136,kind:'control',channel:'B',control:'fader',value:.3});
transport(140,'D','hotCue',64,3);
add({t:144,kind:'control',channel:'B',control:'fader',value:1});
add({t:148,kind:'loop',channel:'C',playhead:40,region:null});
transport(152,'A','pause',104.96);
transport(154,'A','previewStart',20); transport(156,'A','previewEnd',20);
transport(160,'B','cue',16);
add({t:164,kind:'control',channel:null,control:'crossfader',value:1});
add({t:168,kind:'control',channel:null,control:'crossfader',value:0});
transport(172,'C','pause',64); transport(176,'D','pause',100);
add({t:178,kind:'tenure',edge:'start',holder:'conductor'});
add({t:184,kind:'tenure',edge:'end',holder:'conductor'});
// Reload on the same physical deck must be a separate list occurrence.
load(184,'A',105); transport(184,'A','play',0);
load(188,'B',106); transport(188,'B','play',0);
load(192,'C',107); transport(192,'C','play',0);
load(196,'D',108); transport(196,'D','play',0);
add({t:200,kind:'tick',playheads:{A:16.64,B:12,C:8,D:4}});
transport(204,'B','pause',16); load(204,'B',null);
add({t:208,kind:'control',channel:'D',control:'filter',value:1});
add({t:212,kind:'control',channel:'D',control:'filter',value:0});
add({t:220,kind:'tick',playheads:{A:37.44,C:28,D:24}});

const session = {uuid:'session-native-four-deck-fixture',started_at:'2026-10-13T00:00:00',ended_at:'2026-10-13T00:02:00',take_count:0,events};
const titles = ['Night signal','Parallel lines','Glass rhythm','Fourth floor','After hours','Copper sky','Low orbit','First light'];
const items = titles.map((title,i) => ({id:101+i,filename:`fixture-${i+1}.wav`,title,artist:'Session lab',bpm:128,key:i,duration_secs:240,created_at:'2026-10-13T00:00:00',updated_at:'2026-10-13T00:00:00'}));
const tracks = {items,total:8,library_total:8,page:1,per_page:8,total_pages:1};
const times = [100,104,124,128,130,133,137,140,148,153,155,157,164,178,184,200,204,208,212,220];
const expected = times.map(t => ({t,state:stateAt(events,t),plan:planReplay(events,t)}));
const dir = resolve(process.cwd(), '../prototypes/android-session/app/src/main/assets') + '/';
mkdirSync(dir,{recursive:true});
for (const [name,value] of Object.entries({session,tracks,expected,timeline:deriveTimeline(events)})) writeFileSync(`${dir}${name}.json`,JSON.stringify(value,null,2)+'\n');
test('four physical decks overlap and replay has discontinuity cues', () => {
  expect(Object.values(stateAt(events, 130).decks).every(d => d.playing)).toBe(true);
  const plan = planReplay(events, 124);
  expect(plan.ok).toBe(true);
  if (plan.ok) expect(plan.plan.cues.some(c => c.kind === 'seek' && c.playhead === 80)).toBe(true);
});
