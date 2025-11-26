interface WaveformData {
  peaks: number[];
  duration: number;
  cue_point_time: number | null;
}

interface RenderConfig {
  barWidth: number;
  barGap: number;
  barRadius: number;
  height: number;
  waveColor: string;
  progressColor: string;
  playheadColor: string;
  cuePointColor: string;
  backgroundColor: string;
  playheadPosition: number;
}

const DEFAULT_CONFIG: RenderConfig = {
  barWidth: 2,
  barGap: 1,
  barRadius: 0,
  height: 60,
  waveColor: '#45454f',
  progressColor: '#b4befe',
  playheadColor: '#cdd6f4',
  cuePointColor: '#fab387',
  backgroundColor: '#111111',
  playheadPosition: 0.25,
};

export class CanvasWaveformRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private waveformData: WaveformData | null = null;
  private config: RenderConfig;
  private animationFrameId: number | null = null;
  private currentTime: number = 0;
  private isPlaying: boolean = false;
  private onSeekCallback: ((time: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, config: Partial<RenderConfig> = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupCanvas();
    this.canvas.addEventListener('click', this.handleClick.bind(this));
  }

  private setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = this.config.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${this.config.height}px`;
    this.ctx.scale(dpr, dpr);
  }

  load(waveformData: WaveformData) {
    this.waveformData = waveformData;
    this.currentTime = 0;
    this.render();
  }

  setCurrentTime(time: number) {
    this.currentTime = time;
    if (this.isPlaying) this.render();
  }

  setPlaying(playing: boolean) {
    this.isPlaying = playing;
    if (playing) {
      this.startAnimation();
    } else {
      this.stopAnimation();
      this.render();
    }
  }

  onSeek(callback: (time: number) => void) {
    this.onSeekCallback = callback;
  }

  setCuePoint(time: number | null) {
    if (this.waveformData) {
      this.waveformData.cue_point_time = time;
      this.render();
    }
  }

  private startAnimation() {
    if (this.animationFrameId !== null) return;
    const animate = () => {
      this.render();
      this.animationFrameId = requestAnimationFrame(animate);
    };
    this.animationFrameId = requestAnimationFrame(animate);
  }

  private stopAnimation() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private render() {
    if (!this.waveformData) return;

    const { peaks, duration } = this.waveformData;
    const { barWidth, barGap, height, playheadPosition } = this.config;
    const canvasWidth = this.canvas.clientWidth;

    // Clear
    this.ctx.fillStyle = this.config.backgroundColor;
    this.ctx.fillRect(0, 0, canvasWidth, height);

    // Calculate scroll to keep playhead at 25%
    const barPlusGap = barWidth + barGap;
    const totalBars = peaks.length / 2;
    const progress = duration > 0 ? this.currentTime / duration : 0;
    const currentBar = Math.floor(progress * totalBars);
    const playheadX = canvasWidth * playheadPosition;
    const scrollOffset = currentBar * barPlusGap - playheadX;

    // Render visible bars with overscan
    const overscan = 50;
    const visibleStart = Math.max(0, Math.floor(scrollOffset / barPlusGap) - overscan);
    const visibleEnd = Math.min(totalBars, Math.ceil((scrollOffset + canvasWidth) / barPlusGap) + overscan);

    for (let i = visibleStart; i < visibleEnd; i++) {
      const maxIdx = i * 2;
      const minIdx = i * 2 + 1;
      if (maxIdx >= peaks.length || minIdx >= peaks.length) break;

      const max = peaks[maxIdx];
      const min = peaks[minIdx];
      const avg = (max - min) / 2;
      const barHeight = Math.abs(avg) * height;
      const x = i * barPlusGap - scrollOffset;
      const y = (height - barHeight) / 2;

      this.ctx.fillStyle = i <= currentBar ? this.config.progressColor : this.config.waveColor;
      this.ctx.fillRect(x, y, barWidth, barHeight);
    }

    // Draw CUE point
    if (this.waveformData.cue_point_time !== null) {
      const cueProgress = this.waveformData.cue_point_time / duration;
      const cueBar = Math.floor(cueProgress * totalBars);
      const cueX = cueBar * barPlusGap - scrollOffset;

      if (cueX >= 0 && cueX <= canvasWidth) {
        this.ctx.strokeStyle = this.config.cuePointColor;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(cueX, 0);
        this.ctx.lineTo(cueX, height);
        this.ctx.stroke();
      }
    }

    // Draw playhead
    this.ctx.strokeStyle = this.config.playheadColor;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(playheadX, 0);
    this.ctx.lineTo(playheadX, height);
    this.ctx.stroke();
  }

  private handleClick(event: MouseEvent) {
    if (!this.waveformData || !this.onSeekCallback) return;

    const rect = this.canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const canvasWidth = rect.width;
    const { barWidth, barGap, playheadPosition } = this.config;
    const { duration } = this.waveformData;
    const barPlusGap = barWidth + barGap;
    const totalBars = this.waveformData.peaks.length / 2;

    const progress = duration > 0 ? this.currentTime / duration : 0;
    const currentBar = Math.floor(progress * totalBars);
    const playheadX = canvasWidth * playheadPosition;
    const scrollOffset = currentBar * barPlusGap - playheadX;

    const clickedBar = Math.floor((clickX + scrollOffset) / barPlusGap);
    const seekTime = (clickedBar / totalBars) * duration;
    this.onSeekCallback(seekTime);
  }

  destroy() {
    this.stopAnimation();
    this.canvas.removeEventListener('click', this.handleClick);
  }

  resize() {
    this.setupCanvas();
    this.render();
  }
}
