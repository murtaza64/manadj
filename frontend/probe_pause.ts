/** Probe (throwaway): slot 3's trace + draw runs around the recorded
 * pause, from the live sandbox API — diagnosing the wave render around
 * holds (gh#190). Run: npx vite-node probe_pause.ts */
import { buildPlannedRoutine } from './src/sets/routinePlan';
import { wireRoutineToPlanInput, recordedPauses } from './src/routines/routineEditorModel';
import { parseEdits } from './src/routines/routineDraft';
import { traceDrawRuns } from './src/routines/routineWaveRuns';

const UUID = 'f3e8cdff-5c3d-4696-9b08-01b34db39a3f';

async function main() {
  const d = await (await fetch(`http://localhost:8297/api/routines/${UUID}`)).json();
  const input = wireRoutineToPlanInput(d, d.edits ? parseEdits(d.edits) : null);
  const { routine } = buildPlannedRoutine(input, {
    startEntryIndex: 0,
    mixStartSec: 0,
    targetBpm: 174,
    adoptedDeck: 'A',
    busy: [],
    trackBpms: [174, 174, 174, 174],
  });
  console.log('edits:', JSON.stringify(d.edits));
  const slot = routine.slots[3];
  const pauses = recordedPauses(slot.trace);
  console.log('slot3 recorded pauses:', pauses);
  const lo = 505, hi = 537;
  console.log('trace points in window:');
  for (const p of slot.trace) {
    if (p.beat >= lo && p.beat <= hi)
      console.log(
        `  beat=${p.beat.toFixed(2)} pos=${p.pos.toFixed(3)} moving=${p.moving} rate=${p.ratePerBeat.toFixed(4)} jump=${p.jump}`
      );
  }
  const runs = traceDrawRuns(slot.trace, input.durationBeats);
  console.log('runs overlapping window:');
  for (const r of runs) {
    if (r.b1 >= lo && r.b0 <= hi)
      console.log(
        `  b:[${r.b0.toFixed(2)}..${r.b1.toFixed(2)}] ph:[${r.ph0.toFixed(3)}..${r.ph1.toFixed(3)}]`
      );
  }
}
main();
