// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dictationAvailable, startDictation } from './dictate';

afterEach(() => {
  vi.unstubAllGlobals();
});

interface FakeInstance {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  started: number;
  stopped: number;
  emit(results: { isFinal: boolean; transcript: string }[]): void;
}

function stubRecognition(): FakeInstance[] {
  const instances: FakeInstance[] = [];
  class FakeRecognition implements FakeInstance {
    continuous = false;
    interimResults = true;
    lang = '';
    onresult: FakeInstance['onresult'] = null;
    onerror: (() => void) | null = null;
    onend: (() => void) | null = null;
    started = 0;
    stopped = 0;
    constructor() { instances.push(this); }
    start() { this.started += 1; }
    stop() { this.stopped += 1; this.onend?.(); }
    emit(results: { isFinal: boolean; transcript: string }[]) {
      this.onresult?.({
        resultIndex: 0,
        results: results.map((r) => ({ isFinal: r.isFinal, 0: { transcript: r.transcript } })),
      });
    }
  }
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  return instances;
}

describe('dictation', () => {
  it('is unavailable without a SpeechRecognition runtime', () => {
    expect(dictationAvailable()).toBe(false);
    expect(startDictation(() => {}, () => {})).toBeNull();
  });

  it('starts on request, reports the end, and stops explicitly', () => {
    const instances = stubRecognition();
    expect(dictationAvailable()).toBe(true);
    const onEnd = vi.fn();
    const session = startDictation(() => {}, onEnd);
    expect(session).not.toBeNull();
    expect(instances).toHaveLength(1);
    expect(instances[0].started).toBe(1);
    expect(instances[0].continuous).toBe(true);
    expect(instances[0].interimResults).toBe(false);
    session!.stop();
    expect(instances[0].stopped).toBe(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('appends trimmed final transcripts only, never interim results', () => {
    const instances = stubRecognition();
    const texts: string[] = [];
    startDictation((text) => texts.push(text), () => {});
    instances[0].emit([{ isFinal: false, transcript: 'partial' }]);
    instances[0].emit([{ isFinal: true, transcript: '  ' }]);
    instances[0].emit([{ isFinal: true, transcript: ' the bass is late ' }]);
    expect(texts).toEqual(['the bass is late']);
  });

  it('ignores late transcripts after stopping', () => {
    const instances = stubRecognition();
    const onText = vi.fn();
    const session = startDictation(onText, () => {});
    session!.stop();
    instances[0].emit([{ isFinal: true, transcript: 'late' }]);
    expect(onText).not.toHaveBeenCalled();
  });

  it('stops after a recognition error', () => {
    const instances = stubRecognition();
    const onEnd = vi.fn();
    startDictation(() => {}, onEnd);
    instances[0].onerror?.();
    expect(instances[0].stopped).toBe(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
