export const MASTER_RECORDER_PROCESSOR = 'master-recorder-processor';

export type MasterRecorderCommand = { type: 'flush' };

export type MasterRecorderEvent =
  | { type: 'chunk'; buffer: ArrayBuffer }
  | { type: 'flushed' };
