import { describe, expect, it } from 'vitest';
import { reduceRecorder } from './recorderState';
import type { RecorderState } from './recorderState';

describe('master recorder state', () => {
  it('runs start -> record -> stop -> save -> idle', () => {
    let state: RecorderState = { status: 'idle' };
    state = reduceRecorder(state, { type: 'start', format: 'mp3' });
    state = reduceRecorder(state, { type: 'started', startedAt: 100 });
    state = reduceRecorder(state, { type: 'stop' });
    state = reduceRecorder(state, { type: 'stopped' });
    expect(state).toEqual({ status: 'saving', format: 'mp3' });
    expect(reduceRecorder(state, { type: 'finished' })).toEqual({ status: 'idle' });
  });

  it('retains a stopped recording after save failure for retry', () => {
    const ready = reduceRecorder(
      { status: 'saving', format: 'wav' },
      { type: 'save-failed', message: 'disk full' }
    );
    expect(ready).toEqual({ status: 'ready', format: 'wav', error: 'disk full' });
    expect(reduceRecorder(ready, { type: 'save' })).toEqual({ status: 'saving', format: 'wav' });
  });

  it('surfaces a stop failure without leaving the state machine busy', () => {
    expect(
      reduceRecorder(
        { status: 'stopping', format: 'wav', startedAt: 10 },
        { type: 'stop-failed', message: 'flush failed' }
      )
    ).toEqual({ status: 'idle', error: 'flush failed' });
  });
});
