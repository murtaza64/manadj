import type { Mixer, MasterRecordingTap } from '../playback/mixer';
import { MasterRecorderNode } from '../playback/worklet/masterRecorderNode';
import type { RecordingFormat } from './recorderState';
import { encodeFloatWav } from './wav';

function suggestedRecordingName(date = new Date()): string {
  const timestamp = date.toISOString().slice(0, 19).replace('T', ' ').replaceAll(':', '-');
  return `manaDJ ${timestamp}`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export class StoppedMasterRecording {
  private consumed = false;
  private readonly bridge: MasterRecordingBridge | undefined;
  private readonly id: string | null;
  private readonly chunks: readonly Float32Array[];
  private readonly sampleRate: number;

  constructor(
    bridge: MasterRecordingBridge | undefined,
    id: string | null,
    chunks: readonly Float32Array[],
    sampleRate: number
  ) {
    this.bridge = bridge;
    this.id = id;
    this.chunks = chunks;
    this.sampleRate = sampleRate;
  }

  async save(format: RecordingFormat): Promise<{ canceled: boolean; path?: string }> {
    if (this.consumed) throw new Error('recording has already been saved or discarded');
    const suggestedName = suggestedRecordingName();
    if (this.bridge && this.id) {
      const result = await this.bridge.save({ id: this.id, format, suggestedName });
      this.consumed = true;
      return result;
    }
    if (format === 'mp3') {
      throw new Error('MP3 export requires the Electron app; choose WAV in a browser');
    }
    const filename = window.prompt('Save recording as', `${suggestedName}.wav`);
    if (!filename) {
      this.consumed = true;
      return { canceled: true };
    }
    download(encodeFloatWav(this.chunks, this.sampleRate), filename.toLowerCase().endsWith('.wav') ? filename : `${filename}.wav`);
    this.consumed = true;
    return { canceled: false, path: filename };
  }

  async discard(): Promise<void> {
    if (this.consumed) return;
    this.consumed = true;
    if (this.bridge && this.id) await this.bridge.discard(this.id);
  }
}

export class ActiveMasterRecording {
  static async start(mixer: Mixer): Promise<ActiveMasterRecording> {
    if (navigator.userAgent.includes('Electron') && !window.manadjRecording) {
      throw new Error('Electron recording bridge unavailable; relaunch the desktop shell');
    }
    const tap = mixer.createMasterRecordingTap();
    const bridge = window.manadjRecording;
    let id: string | null = null;
    const chunks: Float32Array[] = [];
    try {
      await tap.ctx.resume();
      if (bridge) id = (await bridge.start({ sampleRate: tap.ctx.sampleRate, channels: 2 })).id;
      const node = await MasterRecorderNode.create(tap.ctx, (buffer) => {
        if (bridge && id) bridge.write(id, buffer);
        else chunks.push(new Float32Array(buffer));
      });
      tap.input.connect(node.input);
      return new ActiveMasterRecording(tap, node, bridge, id, chunks);
    } catch (error) {
      tap.disconnect();
      if (bridge && id) await bridge.discard(id).catch(() => undefined);
      throw error;
    }
  }

  private readonly tap: MasterRecordingTap;
  private readonly node: MasterRecorderNode;
  private readonly bridge: MasterRecordingBridge | undefined;
  private readonly id: string | null;
  private readonly chunks: Float32Array[];

  private constructor(
    tap: MasterRecordingTap,
    node: MasterRecorderNode,
    bridge: MasterRecordingBridge | undefined,
    id: string | null,
    chunks: Float32Array[]
  ) {
    this.tap = tap;
    this.node = node;
    this.bridge = bridge;
    this.id = id;
    this.chunks = chunks;
  }

  async stop(): Promise<StoppedMasterRecording> {
    // Stop new input first, then flush the processor's final partial batch.
    // Leaving the tap connected during flush lets process() accumulate a new
    // tail after the acknowledgement, which would be discarded on dispose.
    this.tap.disconnect();
    try {
      await this.node.flush();
      if (this.bridge && this.id) {
        const result = await this.bridge.stop(this.id);
        if (result.bytes === 0) throw new Error('recording captured no audio');
        console.info(
          `[recording] captured ${result.bytes} PCM bytes (${result.durationSeconds.toFixed(1)}s)`
        );
      } else if (this.chunks.every((chunk) => chunk.length === 0)) {
        throw new Error('recording captured no audio');
      }
      return new StoppedMasterRecording(
        this.bridge,
        this.id,
        this.chunks,
        this.tap.ctx.sampleRate
      );
    } catch (error) {
      if (this.bridge && this.id) await this.bridge.discard(this.id).catch(() => undefined);
      throw error;
    } finally {
      this.node.dispose();
    }
  }
}

export { suggestedRecordingName };
