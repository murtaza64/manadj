import { useEffect, useReducer, useRef, useState } from 'react';
import { useMixer } from '../hooks/useMixer';
import {
  ActiveMasterRecording,
} from '../recording/masterRecording';
import type { StoppedMasterRecording } from '../recording/masterRecording';
import { reduceRecorder } from '../recording/recorderState';
import type { RecordingFormat } from '../recording/recorderState';
import { formatRecordingElapsed } from '../recording/recordingTime';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function MasterRecorderControl() {
  const mixer = useMixer();
  const [format, setFormat] = useState<RecordingFormat>('wav');
  const [state, dispatch] = useReducer(reduceRecorder, { status: 'idle' });
  const [now, setNow] = useState(0);
  const active = useRef<ActiveMasterRecording | null>(null);
  const stopped = useRef<StoppedMasterRecording | null>(null);

  useEffect(() => {
    if (state.status !== 'recording' && state.status !== 'stopping') return;
    const tick = () => setNow(performance.now());
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const persist = async (recording: StoppedMasterRecording, selected: RecordingFormat) => {
    try {
      const result = await recording.save(selected);
      if (!result.canceled && result.path) console.info(`[recording] saved ${result.path}`);
      stopped.current = null;
      dispatch({ type: 'finished' });
    } catch (error) {
      console.error('[recording] save failed', error);
      dispatch({ type: 'save-failed', message: message(error) });
    }
  };

  const start = async () => {
    dispatch({ type: 'start', format });
    try {
      active.current = await ActiveMasterRecording.start(mixer);
      const startedAt = performance.now();
      setNow(startedAt);
      dispatch({ type: 'started', startedAt });
    } catch (error) {
      console.error('[recording] start failed', error);
      dispatch({ type: 'start-failed', message: message(error) });
    }
  };

  const stop = async () => {
    const recording = active.current;
    if (!recording || state.status !== 'recording') return;
    dispatch({ type: 'stop' });
    try {
      const ready = await recording.stop();
      active.current = null;
      stopped.current = ready;
      dispatch({ type: 'stopped' });
      await persist(ready, state.format);
    } catch (error) {
      active.current = null;
      console.error('[recording] stop failed', error);
      dispatch({ type: 'stop-failed', message: message(error) });
    }
  };

  const retry = async () => {
    if (!stopped.current || state.status !== 'ready') return;
    dispatch({ type: 'save' });
    await persist(stopped.current, format);
  };

  const discard = async () => {
    await stopped.current?.discard();
    stopped.current = null;
    dispatch({ type: 'finished' });
  };

  const busy = state.status === 'starting' || state.status === 'stopping' || state.status === 'saving';
  const duration =
    state.status === 'recording' || state.status === 'stopping'
      ? formatRecordingElapsed(now - state.startedAt)
      : null;
  const error = state.status === 'ready' || state.status === 'idle' ? state.error : undefined;

  return (
    <div className={`topbar-recorder ${state.status}`} title={error}>
      <select
        aria-label="Recording format"
        value={format}
        disabled={state.status !== 'idle' && state.status !== 'ready'}
        onChange={(event) => setFormat(event.target.value as RecordingFormat)}
      >
        <option value="wav">WAV</option>
        <option value="mp3">MP3 320</option>
      </select>
      {state.status === 'recording' ? (
        <button className="topbar-record-stop" onClick={() => void stop()} title="Stop and save recording">
          <span className="topbar-record-square" /> {duration}
        </button>
      ) : state.status === 'ready' ? (
        <>
          <span className="topbar-record-error" title={state.error}>!</span>
          <button className="topbar-record-retry" onClick={() => void retry()}>SAVE</button>
          <button onClick={() => void discard()}>×</button>
        </>
      ) : (
        <button
          className="topbar-record-start"
          disabled={busy}
          onClick={() => void start()}
          title={error ?? 'Record Master output'}
        >
          <span className="topbar-record-dot" /> {busy ? state.status.toUpperCase() : 'REC'}
        </button>
      )}
    </div>
  );
}
