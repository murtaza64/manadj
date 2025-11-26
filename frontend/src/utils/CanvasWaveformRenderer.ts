interface WaveformBands {
  low: number[];
  mid: number[];
  high: number[];
}

interface WaveformData {
  duration: number;
  cue_point_time: number | null;
  bands: WaveformBands;
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
  lowColor: string;
  midColor: string;
  highColor: string;
}

const DEFAULT_CONFIG: RenderConfig = {
  barWidth: 2,
  barGap: 1,
  barRadius: 0,
  height: 60,
  waveColor: '#45454f',
  progressColor: '#b4befe',
  playheadColor: '#f5c2e7',
  cuePointColor: '#fab387',
  backgroundColor: '#111111',
  playheadPosition: 0.25,
  lowColor: '#0055e2',
  midColor: 'rgba(242, 170, 60, 0.6)',  // Translucent orange
  highColor: 'rgba(255, 255, 255, 0.4)',  // Translucent white
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
  private zoomLevel: number = 1.0;
  private minZoom: number = 1.0;
  private maxZoom: number = 16.0;
  private audioElement: HTMLAudioElement | null = null;

  constructor(canvas: HTMLCanvasElement, config: Partial<RenderConfig> = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupCanvas();
    this.canvas.addEventListener('click', this.handleClick.bind(this));
    this.canvas.addEventListener('wheel', this.handleWheel.bind(this), { passive: false });
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

  setAudioElement(audioElement: HTMLAudioElement | null) {
    this.audioElement = audioElement;
  }

  setCurrentTime(time: number) {
    this.currentTime = time;
    if (!this.isPlaying) {
      // If not playing, render immediately to update position
      this.render();
    }
    // If playing, animation loop will handle rendering
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

  private calculateWaveformPosition(): number {
    if (!this.waveformData) return 0;

    // When playing, read time directly from audio element for smooth 60fps updates
    // When paused, use stored currentTime which is set by events
    const time = (this.isPlaying && this.audioElement)
      ? this.audioElement.currentTime
      : this.currentTime;

    const { duration } = this.waveformData;
    const progress = time / duration;
    const totalPoints = this.waveformData.bands.low.length / 2;
    return progress * totalPoints;
  }

  private interpolate(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  private render() {
    if (!this.waveformData) return;

    const canvasWidth = this.canvas.clientWidth;
    const height = this.config.height;

    // Clear canvas
    this.ctx.fillStyle = this.config.backgroundColor;
    this.ctx.fillRect(0, 0, canvasWidth, height);

    // Calculate exact waveform position (current playback position in data points)
    const totalPoints = this.waveformData.bands.low.length / 2;
    const exactPosition = this.calculateWaveformPosition();

    // Calculate visible range based on zoom
    const visiblePointCount = totalPoints / this.zoomLevel;
    const pointsBeforePlayhead = visiblePointCount * this.config.playheadPosition;
    const pointsAfterPlayhead = visiblePointCount - pointsBeforePlayhead;

    // Calculate visible range
    // Don't go below 0 - this creates blank space at the start
    const visibleStart = exactPosition - pointsBeforePlayhead;
    const visibleEnd = exactPosition + pointsAfterPlayhead;

    // Only render if there's actual waveform data to show
    if (visibleEnd > 0 && visibleStart < totalPoints) {
      // Clamp to actual data bounds for rendering
      const renderStart = Math.max(0, visibleStart);
      const renderEnd = Math.min(totalPoints, visibleEnd);

      // Render waveform directly to main canvas
      this.renderWaveform(renderStart, renderEnd, exactPosition, visibleStart, canvasWidth, height);
    }

    // Draw playhead
    this.drawPlayhead(canvasWidth, height);

    // Draw cue point if visible
    this.drawCuePoint(visibleStart, visibleEnd, canvasWidth, height);
  }

  private renderWaveform(
    renderStart: number,
    renderEnd: number,
    currentPos: number,
    visibleStart: number,
    width: number,
    height: number
  ) {
    if (!this.waveformData) return;

    const { low, mid, high } = this.waveformData.bands;
    const { lowColor, midColor, highColor } = this.config;
    const centerY = height / 2;

    // Calculate total visible range (constant viewport width in data points)
    const totalPoints = this.waveformData.bands.low.length / 2;
    const visiblePointCount = totalPoints / this.zoomLevel;
    const pixelsPerPoint = width / visiblePointCount;

    // Calculate pixel offset so currentPos aligns with playhead
    const playheadX = width * this.config.playheadPosition;
    const currentPosInRange = currentPos - visibleStart;
    const currentPosX = currentPosInRange * pixelsPerPoint;
    const scrollOffset = currentPosX - playheadX;

    // Render each band
    const bands = [
      { peaks: low, color: lowColor },
      { peaks: mid, color: midColor },
      { peaks: high, color: highColor }
    ];

    for (const band of bands) {
      this.ctx.beginPath();

      // Draw top edge (max values) with interpolation
      let firstPoint = true;
      for (let pos = renderStart; pos <= renderEnd; pos += 1) {
        const idx = Math.floor(pos);
        const fraction = pos - idx;
        const maxIdx = idx * 2;

        if (maxIdx >= band.peaks.length - 2) break;

        // Interpolate between current and next point
        const maxValue = this.interpolate(
          band.peaks[maxIdx],
          band.peaks[maxIdx + 2],
          fraction
        );

        const x = (pos - visibleStart) * pixelsPerPoint - scrollOffset;
        const y = centerY - (maxValue * height / 2);

        if (firstPoint) {
          this.ctx.moveTo(x, y);
          firstPoint = false;
        } else {
          this.ctx.lineTo(x, y);
        }
      }

      // Draw bottom edge (min values) in reverse with interpolation
      for (let pos = renderEnd; pos >= renderStart; pos -= 1) {
        const idx = Math.floor(pos);
        const fraction = pos - idx;
        const minIdx = idx * 2 + 1;

        if (minIdx >= band.peaks.length - 2) continue;

        // Interpolate between current and next point
        const minValue = this.interpolate(
          band.peaks[minIdx],
          band.peaks[minIdx + 2],
          fraction
        );

        const x = (pos - visibleStart) * pixelsPerPoint - scrollOffset;
        const y = centerY - (minValue * height / 2);

        this.ctx.lineTo(x, y);
      }

      this.ctx.closePath();
      this.ctx.fillStyle = band.color;
      this.ctx.fill();
    }
  }

  private drawPlayhead(width: number, height: number) {
    const playheadX = width * this.config.playheadPosition;
    this.ctx.strokeStyle = this.config.playheadColor;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(playheadX, 0);
    this.ctx.lineTo(playheadX, height);
    this.ctx.stroke();
  }

  private drawCuePoint(
    visibleStart: number,
    visibleEnd: number,
    width: number,
    height: number
  ) {
    if (!this.waveformData || !this.waveformData.cue_point_time) return;

    const totalPoints = this.waveformData.bands.low.length / 2;
    const cueProgress = this.waveformData.cue_point_time / this.waveformData.duration;
    const cuePoint = cueProgress * totalPoints;

    if (cuePoint < visibleStart || cuePoint > visibleEnd) return;

    const pointInViewport = cuePoint - visibleStart;
    const pixelsPerPoint = width / (visibleEnd - visibleStart);
    const cueX = pointInViewport * pixelsPerPoint;
    const triangleSize = 6;

    // Draw vertical line
    this.ctx.strokeStyle = this.config.cuePointColor;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(cueX, 0);
    this.ctx.lineTo(cueX, height);
    this.ctx.stroke();

    // Draw triangle at bottom
    this.ctx.fillStyle = this.config.cuePointColor;
    this.ctx.beginPath();
    this.ctx.moveTo(cueX, height - triangleSize);
    this.ctx.lineTo(cueX - triangleSize, height);
    this.ctx.lineTo(cueX + triangleSize, height);
    this.ctx.closePath();
    this.ctx.fill();
  }

  private handleClick(event: MouseEvent) {
    if (!this.waveformData || !this.onSeekCallback) return;

    const rect = this.canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const canvasWidth = rect.width;
    const { duration } = this.waveformData;
    const totalPoints = this.waveformData.bands.low.length / 2;

    // Calculate visible range based on zoom
    const progress = duration > 0 ? this.currentTime / duration : 0;
    const currentPoint = progress * totalPoints;
    const visiblePointCount = totalPoints / this.zoomLevel;
    const pointsBeforePlayhead = visiblePointCount * this.config.playheadPosition;

    const visibleStart = Math.max(0, currentPoint - pointsBeforePlayhead);
    const visibleEnd = Math.min(totalPoints, currentPoint + (visiblePointCount - pointsBeforePlayhead));

    // Map click position to data point
    const clickProgress = clickX / canvasWidth;
    const clickedPoint = visibleStart + clickProgress * (visibleEnd - visibleStart);
    const seekTime = (clickedPoint / totalPoints) * duration;

    this.onSeekCallback(seekTime);
  }

  private handleWheel(event: WheelEvent) {
    event.preventDefault();

    const zoomDelta = event.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel * zoomDelta));

    if (newZoom !== this.zoomLevel) {
      this.zoomLevel = newZoom;
      this.render();
    }
  }

  destroy() {
    this.stopAnimation();
    this.canvas.removeEventListener('click', this.handleClick);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }

  resize() {
    this.setupCanvas();
    this.render();
  }
}
