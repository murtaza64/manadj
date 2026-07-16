interface MasterRecordingSaveRequest {
  id: string;
  format: 'wav' | 'mp3';
  suggestedName: string;
}

interface MasterRecordingBridge {
  start(meta: { sampleRate: number; channels: 2 }): Promise<{ id: string }>;
  write(id: string, buffer: ArrayBuffer): void;
  stop(id: string): Promise<void>;
  save(request: MasterRecordingSaveRequest): Promise<{ canceled: boolean; path?: string }>;
  discard(id: string): Promise<void>;
}

interface Window {
  manadjRecording?: MasterRecordingBridge;
}
