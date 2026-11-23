import fields from './fields.json' with { type: 'json' };
import { exact, reject, integer, SCHEMA } from './schema.mjs';
// This is a new bounded wire DTO, not the gzip/offline export. Unknown fields fail
// visibly; no truncation, automatic dropping or whole-app-folder export is allowed.
const nestedKeys = new Set(('t kind control channel value action playhead detail deltaSeconds durationSeconds filter trackDuration audioTime region start end slip trackId bpm selected target on depth beats held settings playheads edge holder outgoingChannel decks crossfader crossfaderEnabled physicalDecks outgoing incoming playing scratching slipLoopActive fader trim eq low mid high pitch assignment stems vocals drums bass other drive rate A B C D beat slot echoFeedback echoSaturation reverbDecay reverbDampingHz reverbStereoWidth flangerDelayMs flangerWidthMs flangerFeedback flangerLengthUnit lowCutEchoHz transDuty transSlopeMs rollFadeMs start_time time_signature_num bar_position time time_signature_den bar audibleGain eqKillBelow filterKillBeyond cutGapMaxS settleHorizonS entryBackdateMaxS padS idleKeepS').split(' '));
const enumValues = new Set(('control transport pitch bend loop load beatFx beatFxSettings tick tenure init trim eqLow eqMid eqHigh filter fader pfl slipMode vinylMode crossfaderAssignment crossfader crossfaderEnabled master stemVocals stemDrums stemBass stemOther A B C D play pause seek jumpBeats hotCue cue previewStart previewEnd scratchBegin scratchMove scratchEnd echo lowCutEcho reverb flanger trans roll sampler start end left thru right bars beats transition conductor session session-replay mix-editor routine').split(' '));
function primitive(value) {
  return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER);
}
function text(value) {
  return typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value) &&
    !/^(?:\/(?:Users|home|Volumes|mnt|tmp)\/|[a-z]:[\\/]|file:\/\/)/i.test(value);
}
function nested(value, budget) {
  const queue = [[value, 0]];
  while (queue.length) {
    const [v, depth] = queue.pop();
    if (++budget.count > 20000 || depth > 16) reject(400, 'structured_metadata_limit');
    if (primitive(v)) continue;
    if (typeof v === 'string') {
      if (!enumValues.has(v)) reject(400, 'structured_metadata_string');
    } else if (Array.isArray(v)) {
      if (v.length > 4096) reject(400, 'structured_metadata_limit');
      for (const item of v) queue.push([item, depth + 1]);
    } else if (v && typeof v === 'object') {
      for (const [key, item] of Object.entries(v)) {
        if (!nestedKeys.has(key)) reject(400, 'structured_metadata_field');
        queue.push([item, depth + 1]);
      }
    } else reject(400, 'structured_metadata_invalid');
  }
}
export function validatePart(value) {
  if (!exact(value, ['schema', 'table', 'rows']) || value.schema !== SCHEMA || !Object.hasOwn(fields, value.table) ||
      !Array.isArray(value.rows) || !integer(value.rows.length, 1, 4096)) reject(400, 'part_schema_invalid');
  const columns = fields[value.table], budget = { count: 0 };
  for (const row of value.rows) {
    if (++budget.count > 20000) reject(400, 'structured_metadata_limit');
    if (!row || typeof row !== 'object' || Array.isArray(row) || !Object.keys(row).length || Object.keys(row).length > columns.length) reject(400, 'row_invalid');
    for (const [column, item] of Object.entries(row)) {
      if (++budget.count > 20000) reject(400, 'structured_metadata_limit');
      if (!columns.includes(column)) reject(400, 'metadata_field_not_allowed');
      if (column.endsWith('_json')) nested(item, budget);
      else if (!primitive(item) && !text(item)) reject(400, 'metadata_value_invalid');
    }
  }
}
