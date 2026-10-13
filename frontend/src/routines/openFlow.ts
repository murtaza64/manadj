/**
 * Detected-routine open flows (gh#170 pass 2, directive 3): every trust
 * tier opens on the Routine editor surface —
 *
 *   saved Routine        → open (it IS the artifact)
 *   Routine Take         → promote mechanically (or reuse its promoted
 *                          Routine), then open
 *   miner candidate      → CONFIRM into a Routine Take (the human act the
 *                          suggestion-first doctrine requires — choosing
 *                          it in a picker/region button is that act),
 *                          promote, open
 *
 * Suggestion-first stays intact: nothing here runs unattended; each call
 * sits behind a deliberate click. Errors surface to the caller (422s
 * carry the doctrine messages — n≥3, gone Session, missing BPM).
 */
import { api, type RoutineCandidateWire } from '../api/client';
import { requestRoutineEdit } from './openRoutine';

/** Promote-if-needed, then open. Returns the Routine uuid. */
export async function openRoutineTakeInEditor(take: {
  uuid: string;
  promoted_routine_uuid: string | null;
}): Promise<string> {
  const routineUuid =
    take.promoted_routine_uuid ?? (await api.routineTakes.promote(take.uuid)).uuid;
  requestRoutineEdit({ routineUuid });
  return routineUuid;
}

/** Confirm-then-open: mint the Routine Take from the candidate's own
 * window (untrimmed — trim later on the editor surface or the Session
 * timeline), promote, open. Returns the Routine uuid. */
export async function openCandidateInEditor(c: RoutineCandidateWire): Promise<string> {
  const takeUuid = crypto.randomUUID();
  await api.routineTakes.create({
    uuid: takeUuid,
    session_uuid: c.session_uuid,
    window_start_s: c.window_start_s,
    window_end_s: c.window_end_s,
    cast: c.cast,
    entry_offsets: c.entry_offsets,
    origin_candidate_uuid: c.uuid,
  });
  const routine = await api.routineTakes.promote(takeUuid);
  requestRoutineEdit({ routineUuid: routine.uuid });
  return routine.uuid;
}
