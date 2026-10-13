/**
 * Test tone for the Controller check guide: a short beep on one output
 * (device + optional explicit channel pair), in its own AudioContext so it
 * exercises the chosen device independently of the Mixer. Hands-on-verified
 * glue (ADR 0002).
 */
import type { OutputPair } from '../../playback/routing';

const TONE_SECONDS = 1.2;
const TONE_GAIN = 0.15;

/** sinkId null = system default. Resolves when the tone finishes. */
export async function playTestTone(
  sinkId: string | null,
  pair: OutputPair | null,
  hz = 440
): Promise<void> {
  const ctx = new AudioContext();
  try {
    if (sinkId) await ctx.setSinkId(sinkId);
    if (ctx.state === 'suspended') await ctx.resume();
    const osc = ctx.createOscillator();
    osc.frequency.value = hz;
    const gain = ctx.createGain();
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(TONE_GAIN, t0 + 0.02);
    gain.gain.setValueAtTime(TONE_GAIN, t0 + TONE_SECONDS - 0.05);
    gain.gain.linearRampToValueAtTime(0, t0 + TONE_SECONDS);
    osc.connect(gain);
    if (pair && pair.right >= ctx.destination.maxChannelCount) {
      throw new RangeError(`outputs ${pair.left + 1}/${pair.right + 1} are unavailable on this device`);
    }
    if (pair) {
      ctx.destination.channelCount = pair.right + 1;
      ctx.destination.channelInterpretation = 'discrete';
      const merger = ctx.createChannelMerger(pair.right + 1);
      gain.connect(merger, 0, pair.left);
      gain.connect(merger, 0, pair.right);
      merger.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }
    osc.start(t0);
    osc.stop(t0 + TONE_SECONDS);
    await new Promise<void>((resolve) => {
      osc.onended = () => resolve();
    });
  } finally {
    void ctx.close();
  }
}
