// Standalone throwaway phone engine. No desktop audio, DB, or Session integration.
export type Side = 'A' | 'B';
export type CaptureStart = { decks: Record<Side, { playing: boolean; position: number; tempo: number }>; cross: number; volume: number };
export type Deck = { title: string; bpm: number; tempo: number; position: number; playing: boolean; cue: number; hot: (number | null)[]; loop: number; loopStart: number; gain: number; eq: number[]; filter: number; echo: number; buffer: AudioBuffer | null; source: AudioBufferSourceNode | null; started: number; anchor: number };
const deck = (title: string, bpm: number): Deck => ({ title, bpm, tempo: bpm, position: 0, playing: false, cue: 0, hot: [0, null, null, 16 * 60 / bpm], loop: 0, loopStart: 0, gain: .8, eq: [0, 0, 0], filter: 0, echo: 0, buffer: null, source: null, started: 0, anchor: 0 });
export class PhoneAudio {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  channels: Record<Side, { gain: GainNode; low: BiquadFilterNode; mid: BiquadFilterNode; high: BiquadFilterNode; filter: BiquadFilterNode; wet: GainNode }> | null = null;
  decks: Record<Side, Deck> = { A: deck('NEON DRIVE · demo', 120), B: deck('AFTER HOURS · demo', 126) };
  cross = .5;
  volume = .8;

  async ready() {
    if (!this.ctx) {
      const ctx = new AudioContext(), master = ctx.createGain();
      master.connect(ctx.destination); this.ctx = ctx; this.master = master;
      this.channels = Object.fromEntries((['A', 'B'] as Side[]).map(side => {
        const gain = ctx.createGain(), low = ctx.createBiquadFilter(), mid = ctx.createBiquadFilter(), high = ctx.createBiquadFilter(), filter = ctx.createBiquadFilter();
        low.type = 'lowshelf'; low.frequency.value = 180;
        mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = .8;
        high.type = 'highshelf'; high.frequency.value = 4500;
        filter.type = 'lowpass';
        const delay = ctx.createDelay(1), feedback = ctx.createGain(), wet = ctx.createGain();
        delay.delayTime.value = 60 / this.decks[side].bpm / 2;
        feedback.gain.value = .32; wet.gain.value = 0;
        gain.connect(low).connect(mid).connect(high).connect(filter).connect(master);
        filter.connect(delay).connect(wet).connect(master);
        delay.connect(feedback).connect(delay);
        return [side, { gain, low, mid, high, filter, wet }];
      })) as PhoneAudio['channels'];
      this.decks.A.buffer = this.demo(120, 0);
      this.decks.B.buffer = this.demo(126, 1);
      this.mix();
    }
    await this.ctx!.resume();
  }

  demo(bpm: number, color: number) {
    const ctx = this.ctx!, rate = ctx.sampleRate, duration = 32 * 60 / bpm, count = Math.ceil(rate * duration);
    const buffer = ctx.createBuffer(1, count, rate), samples = buffer.getChannelData(0);
    // Eight bars of deterministic local synthesis; no downloaded music.
    for (let beat = 0; beat < 32; beat++) {
      const start = Math.floor(beat * 60 / bpm * rate);
      for (let j = 0; j < Math.min(rate * .23, count - start); j++) {
        const t = j / rate;
        const kick = Math.sin(2 * Math.PI * (52 * t + 95 * t * Math.exp(-t * 32))) * Math.exp(-t * 24) * .55;
        const snare = beat % 2 ? Math.sin(j * 14.13) * Math.sin(j * 4.17) * Math.exp(-t * 30) * .14 : 0;
        const hat = Math.sin(j * 8.13) * Math.sin(j * 18.7) * Math.exp(-t * 90) * .075;
        samples[start + j] += kick + snare + hat;
      }
      const note = [55, 65.4, 73.4, 49][Math.floor(beat / 4) % 4] * (color ? 1.122 : 1);
      for (let j = 0; j < Math.min(rate * .34, count - start); j++) {
        const t = j / rate;
        samples[start + j] += (Math.sin(2 * Math.PI * note * t) + .25 * Math.sin(2 * Math.PI * note * 2 * t)) * Math.exp(-t * 9) * .13;
      }
    }
    return buffer;
  }

  position(side: Side) {
    const d = this.decks[side];
    if (!d.playing || !this.ctx) return d.position;
    const raw = d.anchor + (this.ctx.currentTime - d.started) * d.tempo / d.bpm;
    if (d.loop) return d.loopStart + ((raw - d.loopStart) % d.loop + d.loop) % d.loop;
    return raw % (d.buffer?.duration || 1);
  }

  apply(kind: string, side?: Side, value?: number) {
    if (kind === 'cross') this.cross = value!;
    if (kind === 'master') this.volume = value!;
    if (side) {
      const d = this.decks[side], beat = 60 / d.bpm;
      if (kind === 'play') { const pos = this.position(side); d.playing = !d.playing; this.restart(side, pos); }
      if (kind === 'cueDown') { d.playing = !d.playing; this.restart(side, d.cue); }
      if (kind === 'cueUp') { d.playing = false; this.restart(side, d.cue); }
      if (kind === 'seek') this.restart(side, value!);
      if (kind === 'tempo') { const pos = this.position(side); d.tempo = value!; this.restart(side, pos); }
      if (kind === 'match') { const pos = this.position(side); d.tempo = this.decks[side === 'A' ? 'B' : 'A'].tempo; this.restart(side, pos); }
      if (kind === 'jump') this.restart(side, this.position(side) + value! * beat);
      if (kind === 'hot') { const index = value!; if (d.hot[index] === null) d.hot[index] = this.position(side); else this.restart(side, d.hot[index]); }
      if (kind === 'clearHot') d.hot[value!] = null;
      if (kind === 'loop') { const pos = this.position(side), length = value! * 4 * beat; d.loop = d.loop === length ? 0 : length; d.loopStart = d.loop ? Math.min(Math.floor(pos / length) * length, Math.max(0, (d.buffer?.duration || 0) - length)) : 0; this.restart(side, pos); }
      if (kind === 'gain') d.gain = value!;
      if (kind === 'filter') d.filter = value!;
      if (kind === 'echo') d.echo = value!;
      if (kind.startsWith('eq')) d.eq[Number(kind.slice(2))] = value!;
    }
    this.mix();
  }

  snapshot(): CaptureStart {
    return { decks: {
      A: { playing: this.decks.A.playing, position: this.position('A'), tempo: this.decks.A.tempo },
      B: { playing: this.decks.B.playing, position: this.position('B'), tempo: this.decks.B.tempo },
    }, cross: this.cross, volume: this.volume };
  }

  restore(saved: CaptureStart) {
    for (const side of ['A', 'B'] as Side[]) {
      const d = this.decks[side];
      d.playing = saved.decks[side].playing;
      d.tempo = saved.decks[side].tempo;
      this.restart(side, saved.decks[side].position);
    }
    this.cross = saved.cross; this.volume = saved.volume; this.mix();
  }

  setFile(side: Side, title: string, buffer: AudioBuffer) {
    const d = this.decks[side];
    d.playing = false; this.restart(side, 0);
    d.buffer = buffer; d.position = 0; d.cue = 0;
    d.hot = [0, null, null, null]; d.loop = 0; d.title = title;
  }

  restart(side: Side, at = this.position(side)) {
    const d = this.decks[side];
    d.source?.stop(); d.source?.disconnect(); d.source = null;
    d.position = Math.max(0, Math.min(at, Math.max(0, (d.buffer?.duration || 0) - .001)));
    if (!d.playing || !d.buffer || !this.ctx || !this.channels) return;
    const source = this.ctx.createBufferSource(); source.buffer = d.buffer;
    source.loop = true;
    source.loopStart = d.loop ? d.loopStart : 0;
    source.loopEnd = d.loop ? Math.min(d.buffer.duration, d.loopStart + d.loop) : d.buffer.duration;
    source.playbackRate.value = d.tempo / d.bpm;
    source.connect(this.channels[side].gain);
    d.started = this.ctx.currentTime; d.anchor = d.position; d.source = source;
    source.start(0, d.position);
  }

  mix() {
    if (!this.channels || !this.master || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, .01);
    for (const side of ['A', 'B'] as Side[]) {
      const d = this.decks[side], ch = this.channels[side];
      const fraction = side === 'A' ? 1 - this.cross : this.cross;
      ch.gain.gain.setTargetAtTime(d.gain * Math.sin(fraction * Math.PI / 2), this.ctx.currentTime, .01);
      ch.wet.gain.setTargetAtTime(d.echo, this.ctx.currentTime, .01);
      [ch.low, ch.mid, ch.high].forEach((node, i) => { node.gain.value = d.eq[i]; });
      ch.filter.type = 'lowpass'; ch.filter.frequency.value = d.filter === 0 ? 20000 : d.filter < 0 ? 20000 * Math.pow(.01, -d.filter) : 20 * Math.pow(500, d.filter);
      if (d.filter > 0) ch.filter.type = 'highpass';
    }
  }

  dispose() { for (const side of ['A', 'B'] as Side[]) this.decks[side].source?.stop(); void this.ctx?.close(); }
}
