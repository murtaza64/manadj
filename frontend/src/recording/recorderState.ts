export type RecordingFormat = 'wav' | 'mp3';

export type RecorderState =
  | { status: 'idle'; error?: string }
  | { status: 'starting'; format: RecordingFormat }
  | { status: 'recording'; format: RecordingFormat; startedAt: number }
  | { status: 'stopping'; format: RecordingFormat; startedAt: number }
  | { status: 'saving'; format: RecordingFormat }
  | { status: 'ready'; format: RecordingFormat; error: string };

export type RecorderEvent =
  | { type: 'start'; format: RecordingFormat }
  | { type: 'started'; startedAt: number }
  | { type: 'start-failed'; message: string }
  | { type: 'stop' }
  | { type: 'stop-failed'; message: string }
  | { type: 'stopped' }
  | { type: 'save' }
  | { type: 'save-failed'; message: string }
  | { type: 'finished' };

export function reduceRecorder(state: RecorderState, event: RecorderEvent): RecorderState {
  switch (event.type) {
    case 'start':
      return state.status === 'idle' ? { status: 'starting', format: event.format } : state;
    case 'started':
      return state.status === 'starting'
        ? { status: 'recording', format: state.format, startedAt: event.startedAt }
        : state;
    case 'start-failed':
      return { status: 'idle', error: event.message };
    case 'stop':
      return state.status === 'recording'
        ? { status: 'stopping', format: state.format, startedAt: state.startedAt }
        : state;
    case 'stop-failed':
      return { status: 'idle', error: event.message };
    case 'stopped':
    case 'save':
      return state.status === 'stopping' || state.status === 'ready'
        ? { status: 'saving', format: state.format }
        : state;
    case 'save-failed':
      return state.status === 'saving'
        ? { status: 'ready', format: state.format, error: event.message }
        : state;
    case 'finished':
      return { status: 'idle' };
  }
}
