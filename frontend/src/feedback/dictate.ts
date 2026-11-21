/**
 * Dictation (feedback #518): optional speech-to-text into the report
 * fields. Explicitly started/stopped by the reporter; final transcripts
 * are appended as ordinary editable draft text — nothing is sent, filed
 * or stored by manaDJ. The browser's speech service processes the audio;
 * the form says so before the mic can start.
 */
interface DictationResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface DictationRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: DictationResult[] }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type DictationCtor = new () => DictationRecognition;

function ctor(): DictationCtor | null {
  const w = window as unknown as { SpeechRecognition?: DictationCtor; webkitSpeechRecognition?: DictationCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function dictationAvailable(): boolean {
  return typeof window !== 'undefined' && ctor() !== null;
}

export interface Dictation {
  stop(): void;
}

/** Append final transcripts to `onText` until stopped; null when unsupported. */
export function startDictation(onText: (text: string) => void, onEnd: () => void): Dictation | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  const recognition = new Ctor();
  let stopped = false;
  recognition.continuous = true;
  recognition.interimResults = false;
  try {
    recognition.lang = navigator.language || 'en-US';
  } catch {
    // jsdom/headless: leave the service default.
  }
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim();
      if (!stopped && result.isFinal && text) onText(text);
    }
  };
  recognition.onerror = () => {
    if (!stopped) recognition.stop();
  };
  recognition.onend = () => {
    stopped = true;
    onEnd();
  };
  recognition.start();
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      recognition.stop();
    },
  };
}
