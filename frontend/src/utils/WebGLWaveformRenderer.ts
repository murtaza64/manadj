/**
 * WebGL-based waveform renderer with hardware acceleration.
 *
 * Driven by a PlaybackClock (see playback/clock.ts): the render loop reads the
 * playhead once per frame and draws. The clock is sample-accurate and
 * monotonic, so there is no interpolation, smoothing, or startup-prediction
 * machinery here (ADR 0008 — the element-clock compensation code was deleted
 * with the `<audio>` stack consolidation).
 *
 * Features:
 * - 3-band frequency visualization (bass/mid/treble)
 * - Adaptive sampling with sub-pixel boundary weighting
 * - High-DPI support
 * - Zoom and drag-to-scrub (via setDragOffset/commitDrag)
 * - Minimap mode
 * - Cue point, hot cue, and beatgrid rendering
 */

import type { PlaybackClock } from '../playback/clock';
import { zoomFactorForVisibleSeconds } from './waveformZoom';

/** m:ss.t with tenths — matches DJ-deck display convention. */
function formatReadoutTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

export interface WaveformDataWebGL {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  duration: number;
}

export interface WebGLRendererConfig {
  isMinimapMode?: boolean;
  playMarkerPosition?: number;  // Position of fixed playhead (0.0-1.0)
  maxZoom?: number;
  minZoom?: number;
  /** Draw a time/bar readout on the overlay canvas (main waveform only).
   * Canvas, not DOM: clock-driven text in the DOM forces style/layout work
   * that scales with document size (the library table), throttling the
   * render loop. Canvas contents are a single compositor layer. */
  showTimeReadout?: boolean;
}

export class WebGLWaveformRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  // WebGL resources
  private program!: WebGLProgram;
  private vertexBuffer!: WebGLBuffer;
  private vao!: WebGLVertexArrayObject;

  // Shader locations
  private a_position!: number;
  private a_color!: number;
  private u_matrix!: WebGLUniformLocation;
  private u_pixelOffset!: WebGLUniformLocation;

  // Rendering state
  private waveformData: WaveformDataWebGL | null = null;
  private playPosition: number = 0.0;  // Normalized [0.0, 1.0]
  private zoomFactor: number = 16.0;
  private playMarkerPosition: number;  // Fixed playhead position (0.0-1.0)

  // Display window (normalized positions)
  private firstDisplayedPosition: number = 0.0;
  private lastDisplayedPosition: number = 1.0;

  // Mode flags
  private isMinimapMode: boolean;
  private showTimeReadout: boolean;

  // Manual drag offset (CSS pixels) - applied during drag operations
  private manualDragOffset: number = 0;

  // When true, the display window is set externally (setDisplayWindow) and
  // does not follow the playhead — e.g. DAW-style scrolled/zoomed views.
  private externalWindow: boolean = false;

  // High DPI support
  private pixelRatio: number = 1;

  // Animation loop
  private animationFrameId: number | null = null;

  // Zoom limits
  private maxZoom: number;
  private minZoom: number;

  // Cue point (time in seconds)
  private cuePoint: number | null = null;

  // Hot cues (slot number -> time in seconds)
  private hotCues: Map<number, { time: number; color?: string }> = new Map();

  // Beatgrid data
  private beatTimes: Float32Array | null = null;
  private downbeatIndices: Set<number> = new Set();
  private downbeatTimes: Float32Array | null = null;

  // Geometry caching for performance
  private cachedWaveformGeometry: Float32Array | null = null;
  private cacheValidation: {
    firstDisplayedPosition: number;
    lastDisplayedPosition: number;
    canvasWidth: number;
    canvasHeight: number;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, config: WebGLRendererConfig = {}) {
    this.canvas = canvas;

    const gl = canvas.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL 2 not supported');
    }
    this.gl = gl;

    // Apply configuration
    this.isMinimapMode = config.isMinimapMode ?? false;
    this.showTimeReadout = (config.showTimeReadout ?? false) && !this.isMinimapMode;
    this.playMarkerPosition = config.playMarkerPosition ?? 0.25;
    this.maxZoom = config.maxZoom ?? 50.0;
    this.minZoom = config.minZoom ?? 0.5;

    // Set up high DPI rendering
    this.setupHighDPI();

    // Initialize WebGL
    this.initShaders();
    this.initBuffers();
  }

  private setupHighDPI(): void {
    // Get device pixel ratio for high DPI displays
    const dpr = window.devicePixelRatio || 1;

    // Get display size from CSS
    const rect = this.canvas.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;

    // Set canvas buffer size to actual display size * DPR
    const newWidth = displayWidth * dpr;
    const newHeight = displayHeight * dpr;

    // Invalidate cache if dimensions changed
    if (this.canvas.width !== newWidth || this.canvas.height !== newHeight) {
      this.invalidateWaveformCache();
    }

    this.canvas.width = newWidth;
    this.canvas.height = newHeight;

    // Store display dimensions for pixel-aligned calculations
    this.pixelRatio = dpr;
  }

  private initShaders(): void {
    const vertexShaderSource = `#version 300 es
    in vec2 a_position;
    in vec3 a_color;

    uniform mat4 u_matrix;
    uniform float u_pixelOffset;

    out vec3 v_color;

    void main() {
        // Apply horizontal pixel offset translation in shader
        vec2 translatedPosition = vec2(a_position.x + u_pixelOffset, a_position.y);
        gl_Position = u_matrix * vec4(translatedPosition, 0.0, 1.0);
        v_color = a_color;
    }
    `;

    const fragmentShaderSource = `#version 300 es
    precision mediump float;

    in vec3 v_color;
    out vec4 outColor;

    void main() {
        outColor = vec4(v_color, 1.0);
    }
    `;

    // Compile shaders
    this.program = this.createProgram(vertexShaderSource, fragmentShaderSource);

    // Get attribute/uniform locations
    this.a_position = this.gl.getAttribLocation(this.program, 'a_position');
    this.a_color = this.gl.getAttribLocation(this.program, 'a_color');

    const u_matrix = this.gl.getUniformLocation(this.program, 'u_matrix');
    if (u_matrix === null) {
      throw new Error('Failed to get u_matrix uniform location');
    }
    this.u_matrix = u_matrix;

    const u_pixelOffset = this.gl.getUniformLocation(this.program, 'u_pixelOffset');
    if (u_pixelOffset === null) {
      throw new Error('Failed to get u_pixelOffset uniform location');
    }
    this.u_pixelOffset = u_pixelOffset;
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;

    // Compile vertex shader
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) throw new Error('Failed to create vertex shader');

    gl.shaderSource(vertexShader, vertexSource);
    gl.compileShader(vertexShader);

    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      console.error('Vertex shader compile error:', gl.getShaderInfoLog(vertexShader));
      gl.deleteShader(vertexShader);
      throw new Error('Vertex shader compilation failed');
    }

    // Compile fragment shader
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) throw new Error('Failed to create fragment shader');

    gl.shaderSource(fragmentShader, fragmentSource);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      console.error('Fragment shader compile error:', gl.getShaderInfoLog(fragmentShader));
      gl.deleteShader(fragmentShader);
      throw new Error('Fragment shader compilation failed');
    }

    // Link program
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create program');

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      throw new Error('Program linking failed');
    }

    return program;
  }

  private initBuffers(): void {
    const gl = this.gl;

    // Create vertex buffer
    const vertexBuffer = gl.createBuffer();
    if (!vertexBuffer) throw new Error('Failed to create vertex buffer');
    this.vertexBuffer = vertexBuffer;

    // Create VAO
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;

    gl.bindVertexArray(this.vao);

    // Set up vertex attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);

    // Position attribute (2 floats)
    gl.enableVertexAttribArray(this.a_position);
    gl.vertexAttribPointer(this.a_position, 2, gl.FLOAT, false, 20, 0);

    // Color attribute (3 floats)
    gl.enableVertexAttribArray(this.a_color);
    gl.vertexAttribPointer(this.a_color, 3, gl.FLOAT, false, 20, 8);

    gl.bindVertexArray(null);
  }

  public setWaveformData(data: WaveformDataWebGL): void {
    this.waveformData = data;
    this.invalidateWaveformCache();
    this.calculateDisplayWindow();
  }

  public setCuePoint(cueTime: number | null): void {
    this.cuePoint = cueTime;
  }

  public setHotCues(hotCues: Array<{ slot_number: number; time_seconds: number; color?: string }>): void {
    this.hotCues.clear();
    for (const hc of hotCues) {
      this.hotCues.set(hc.slot_number, { time: hc.time_seconds, color: hc.color });
    }
  }

  public setBeatgrid(beatTimes: number[], downbeatTimes: number[]): void {
    this.beatTimes = new Float32Array(beatTimes);
    this.downbeatTimes = new Float32Array(downbeatTimes);

    // Convert downbeat times to indices for reliable lookup
    this.downbeatIndices = new Set();
    const downbeatSet = new Set(downbeatTimes);
    for (let i = 0; i < beatTimes.length; i++) {
      if (downbeatSet.has(beatTimes[i])) {
        this.downbeatIndices.add(i);
      }
    }
  }

  /**
   * Check if cached waveform geometry is still valid
   * Cache is valid as long as zoom level and canvas dimensions haven't changed
   * Position changes are handled by shader translation (u_pixelOffset)
   */
  private isCacheValid(): boolean {
    if (!this.cachedWaveformGeometry || !this.cacheValidation) return false;

    const cache = this.cacheValidation;

    // Check canvas dimensions (exact match required)
    if (cache.canvasWidth !== this.canvas.width || cache.canvasHeight !== this.canvas.height) {
      return false;
    }

    // Check that zoom level hasn't changed significantly (which changes the display range)
    // Compare the width of the display window rather than absolute positions
    const cachedRange = cache.lastDisplayedPosition - cache.firstDisplayedPosition;
    const currentRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
    const rangeDiff = Math.abs(cachedRange - currentRange);

    // If range changed by more than 0.1%, zoom changed - invalidate cache
    const rangeEpsilon = currentRange * 0.001;

    return rangeDiff < rangeEpsilon;
  }

  /**
   * Update cache validation parameters to current state
   */
  private updateCacheValidation(): void {
    this.cacheValidation = {
      firstDisplayedPosition: this.firstDisplayedPosition,
      lastDisplayedPosition: this.lastDisplayedPosition,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
    };
  }

  /**
   * Invalidate cached waveform geometry
   */
  private invalidateWaveformCache(): void {
    this.cachedWaveformGeometry = null;
    this.cacheValidation = null;
  }

  /**
   * Calculate the pixel offset for shader-based translation
   * Maps the entire cached waveform geometry to show the current view window
   */
  private calculatePixelOffset(): number {
    if (!this.waveformData || this.isMinimapMode) return 0;

    // Use buffer width (includes DPI scaling) to match geometry coordinates
    const canvasWidth = this.canvas.width;
    const totalDataPoints = this.waveformData.low.length;

    // Get the zoom level (display range) used when geometry was cached
    const cachedRange = this.cacheValidation
      ? this.cacheValidation.lastDisplayedPosition - this.cacheValidation.firstDisplayedPosition
      : this.lastDisplayedPosition - this.firstDisplayedPosition;
    const samplesPerPixel = (cachedRange * totalDataPoints) / canvasWidth;

    // Calculate pixel position of firstDisplayedPosition in the entire waveform geometry
    // (This is the left edge of what should be visible)
    const firstDisplayedPixel = (this.firstDisplayedPosition * totalDataPoints) / samplesPerPixel;

    // We want firstDisplayedPosition to appear at pixel 0 on the left edge of screen
    // So offset = 0 - firstDisplayedPixel = -firstDisplayedPixel
    let pixelOffset = -firstDisplayedPixel;

    // Apply manual drag offset (for smooth dragging without recalculating display window)
    pixelOffset += this.manualDragOffset * this.pixelRatio;

    return pixelOffset;
  }

  /**
   * Externally control the visible window as normalized track positions
   * (values may extend past [0, 1]; blank space renders outside the track).
   * Disables playhead-following: the render loop keeps reading the clock,
   * but only to draw the playhead marker inside the window.
   */
  public setDisplayWindow(first: number, last: number): void {
    this.externalWindow = true;
    this.firstDisplayedPosition = first;
    this.lastDisplayedPosition = last;
  }

  private calculateDisplayWindow(): void {
    if (!this.waveformData) return;

    // Minimap always shows full track - don't recalculate
    if (this.isMinimapMode) return;

    // Externally-windowed views position themselves.
    if (this.externalWindow) return;

    // At zoom 1.0, show entire track
    // At zoom 2.0, show half the track, etc.
    const visibleFraction = 1.0 / this.zoomFactor;

    // Split display window by play marker
    const leftFraction = this.playMarkerPosition;
    const rightFraction = 1.0 - this.playMarkerPosition;

    const displayedLengthLeft = visibleFraction * leftFraction;
    const displayedLengthRight = visibleFraction * rightFraction;

    // Calculate window bounds without clamping to maintain constant scale
    // This allows empty space at start and end of track
    this.firstDisplayedPosition = this.playPosition - displayedLengthLeft;
    this.lastDisplayedPosition = this.playPosition + displayedLengthRight;
  }

  private generateGeometry(opacityMultiplier: number = 1.0): Float32Array | null {
    if (!this.waveformData) return null;

    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    const halfHeight = canvasHeight / 2.0;

    // For minimap: render entire track
    // For normal mode: also render entire track, use shader to translate visible portion
    // This allows infinite scrolling without regenerating geometry (only on zoom)
    const totalDataPoints = this.waveformData.low.length;
    const firstIndex = 0;
    const dataPointsToRender = totalDataPoints;

    // Calculate samples per pixel based on current zoom level
    const visibleRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
    const samplesPerPixel = (visibleRange * totalDataPoints) / canvasWidth;

    // Render the entire waveform at current zoom resolution
    const renderWidth = dataPointsToRender / samplesPerPixel;

    // Vertex array: [x, y, r, g, b] * 6 vertices per pixel * 3 bands
    const vertices: number[] = [];

    // Band colors - RGB for bass/mid/treble
    // Darker colors for minimap mode to make markers more visible
    const colorScale = this.isMinimapMode ? 0.5 : 1.0;
    const colors: Record<string, [number, number, number]> = {
      low: [0.95 * colorScale, 0.38 * colorScale, 0.38 * colorScale],   // Mild red (maroon) - bass
      mid: [0.0, 1.0 * colorScale, 0.0],      // Green - mids
      high: [0.53 * colorScale, 0.87 * colorScale, 0.93 * colorScale]   // Light blue (sky) - highs
    };

    // Band opacity for additive blending
    // Lower opacity prevents oversaturation where bands overlap
    // Reduce opacity further for minimap
    const opacityScale = this.isMinimapMode ? 0.5 : 1.0;
    const opacities: Record<string, number> = {
      low: 0.7 * opacityScale,    // Red bass
      mid: 0.7 * opacityScale,    // Green mids
      high: 0.7 * opacityScale    // Blue highs
    };

    // Render each pixel column for the entire waveform
    // Shader will translate to show only the visible portion
    for (let pixelX = 0; pixelX < renderWidth; pixelX++) {
      // Calculate center position and sampling radius for this pixel (Mixxx approach)
      // Use center ± radius instead of discrete edges for better anti-aliasing
      const centerDataIndex = firstIndex + (pixelX + 0.5) * samplesPerPixel;
      const samplingRadius = Math.max(samplesPerPixel / 2.0, 0.5);

      const startDataIndex = Math.floor(centerDataIndex - samplingRadius);
      const endDataIndex = Math.ceil(centerDataIndex + samplingRadius);

      // Aggregate samples with sub-pixel boundary weighting
      // This prevents aliasing/flickering when multiple samples map to one pixel
      let low = 0, mid = 0, high = 0;

      for (let i = startDataIndex; i < endDataIndex; i++) {
        if (i >= 0 && i < totalDataPoints) {
          // Weight samples at window boundaries by fractional overlap
          // This provides smooth transitions as samples enter/exit the window
          let weight = 1.0;

          const windowStart = centerDataIndex - samplingRadius;
          const windowEnd = centerDataIndex + samplingRadius;

          if (i < windowStart) {
            // Sample before window start - weight by fraction inside
            weight = Math.max(0, 1.0 - (windowStart - i));
          } else if (i >= windowEnd) {
            // Sample after window end - weight by fraction inside
            weight = Math.max(0, 1.0 - (i - windowEnd));
          }

          low = Math.max(low, this.waveformData.low[i] * weight);
          mid = Math.max(mid, this.waveformData.mid[i] * weight);
          high = Math.max(high, this.waveformData.high[i] * weight);
        }
      }

      // Render bands (overlayed, back to front)
      for (const [bandName, bandValue] of [
        ['low', low] as const,
        ['mid', mid] as const,
        ['high', high] as const
      ]) {
        const amplitude = bandValue * halfHeight;
        const color = colors[bandName];
        const opacity = opacities[bandName];

        // Apply opacity to color (band opacity * global opacity multiplier)
        const finalColor = color.map(c => c * opacity * opacityMultiplier);

        // Two triangles forming a vertical bar
        // Triangle 1: top-left, top-right, bottom-left
        // Triangle 2: top-right, bottom-right, bottom-left

        const x1 = pixelX;
        const x2 = pixelX + 1;

        // For minimap mode, only render top half (amplitude upward from bottom)
        // For normal mode, render full waveform (centered)
        let y1: number, y2: number;
        if (this.isMinimapMode) {
          y1 = canvasHeight - amplitude * 2;  // Top (amplitude doubled to fill half height)
          y2 = canvasHeight;                   // Bottom (fixed at canvas bottom)
        } else {
          y1 = halfHeight - amplitude;  // Top (centered)
          y2 = halfHeight + amplitude;  // Bottom (centered)
        }

        // Triangle 1
        vertices.push(
          x1, y1, ...finalColor,  // Top-left
          x2, y1, ...finalColor,  // Top-right
          x1, y2, ...finalColor   // Bottom-left
        );

        // Triangle 2
        vertices.push(
          x2, y1, ...finalColor,  // Top-right
          x2, y2, ...finalColor,  // Bottom-right
          x1, y2, ...finalColor   // Bottom-left
        );
      }
    }

    return new Float32Array(vertices);
  }

  private renderVertices(vertices: Float32Array, pixelOffset: number = 0): void {
    // Upload and render a vertex array with optional pixel offset for translation
    if (!vertices || vertices.length === 0) return;

    const gl = this.gl;

    // Upload to GPU
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

    // Set up orthographic projection matrix
    // Maps canvas pixels to clip space [-1, 1]
    const matrix = this.createOrthoMatrix(
      0, this.canvas.width,    // left, right
      this.canvas.height, 0,   // bottom, top (flipped for canvas coords)
      -1, 1                    // near, far
    );

    // Render
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(this.u_matrix, false, matrix);
    gl.uniform1f(this.u_pixelOffset, pixelOffset);

    // Enable additive blending for proper RGB compositing
    // Red + Green = Yellow, Red + Blue = Magenta, Green + Blue = Cyan
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    const vertexCount = vertices.length / 5;  // 5 floats per vertex
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

    gl.bindVertexArray(null);
  }

  public render(): void {
    const gl = this.gl;

    // Set viewport to match canvas size (important for high DPI)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Clear canvas
    gl.clearColor(0.067, 0.067, 0.067, 1.0);  // var(--crust) #111111
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!this.waveformData) return;

    // Calculate pixel offset for shader-based translation
    const pixelOffset = this.calculatePixelOffset();

    // Render main waveform (with caching)
    let mainVertices: Float32Array | null;
    if (this.isCacheValid()) {
      mainVertices = this.cachedWaveformGeometry;
    } else {
      mainVertices = this.generateGeometry();
      this.cachedWaveformGeometry = mainVertices;
      this.updateCacheValidation();
    }

    if (mainVertices) {
      this.renderVertices(mainVertices, pixelOffset);
    }

    // Reset pixel offset to 0 for other elements (they calculate their own positions)
    gl.useProgram(this.program);
    gl.uniform1f(this.u_pixelOffset, 0);

    // Render beatgrid
    this.renderBeatgrid();

    // Render cue point if set
    if (this.cuePoint !== null) {
      this.renderCuePoint(this.cuePoint);
    }

    // Render hot cues
    this.renderHotCues();

    // Render playhead (fixed vertical line for main view, moving for minimap)
    this.renderPlayhead();

    // Text overlay (2D canvas): hot cue badges + time/bar readout.
    // Cleared and redrawn every frame — canvas text is a compositor-layer
    // update, unlike DOM text which forces document-scaled layout work.
    const overlayCtx = this.ensureOverlayContext();
    if (overlayCtx) {
      overlayCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.renderHotCueNumbers(overlayCtx);
      if (this.showTimeReadout) {
        this.renderTimeReadout(overlayCtx);
      }
    }
  }

  private renderBeatgrid(): void {
    if (!this.beatTimes || !this.waveformData) return;

    const gl = this.gl;
    const duration = this.waveformData.duration;
    const canvasHeight = this.canvas.height;

    // Filter beats to visible window and build geometry
    const vertices: number[] = [];
    const lineWidth = 1 * this.pixelRatio;
    const downbeatWidth = 2 * this.pixelRatio;

    // Density culling: hide non-downbeats when beats are closer than ~12px
    // (they read as noise at distant zooms), and everything below ~2.5px.
    const visibleFraction = this.isMinimapMode
      ? 1
      : Math.max(this.lastDisplayedPosition - this.firstDisplayedPosition, 1e-6);
    const secPerBeat =
      this.beatTimes.length > 1 ? this.beatTimes[1] - this.beatTimes[0] : duration;
    const pxPerBeat = (secPerBeat / (visibleFraction * duration)) * this.canvas.width;
    const showWeakBeats = pxPerBeat >= 12 * this.pixelRatio;
    if (pxPerBeat * 4 < 2.5 * this.pixelRatio) return;

    for (let i = 0; i < this.beatTimes.length; i++) {
      if (!showWeakBeats && !this.downbeatIndices.has(i)) continue;
      const beatTime = this.beatTimes[i];
      const beatProgress = beatTime / duration;

      // Calculate x position based on mode
      let beatX: number;

      if (this.isMinimapMode) {
        // Minimap: direct mapping
        beatX = beatProgress * this.canvas.width;
      } else {
        // Main waveform: check if in visible window
        if (beatProgress < this.firstDisplayedPosition ||
            beatProgress > this.lastDisplayedPosition) {
          continue;  // Skip beat outside visible range
        }

        const visibleRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
        const positionInWindow = (beatProgress - this.firstDisplayedPosition) / visibleRange;
        beatX = positionInWindow * this.canvas.width;

        // Apply manual drag offset
        beatX += this.manualDragOffset * this.pixelRatio;
      }

      // Skip if outside canvas bounds
      if (beatX < 0 || beatX >= this.canvas.width) continue;

      // Determine if downbeat using index
      const isDownbeat = this.downbeatIndices.has(i);
      const width = isDownbeat ? downbeatWidth : lineWidth;

      // Color: Very light transparent grey for beats, slightly lighter for downbeats
      // Using white with low alpha for transparency
      const r = 1.0;
      const g = 1.0;
      const b = 1.0;
      const alpha = isDownbeat ? 0.3 : 0.15;  // Downbeats slightly more visible

      // Create vertical line (two triangles)
      // Note: We're using RGB without alpha in vertices since blending is handled by WebGL
      // The alpha will be applied via the color values (r*alpha, g*alpha, b*alpha)
      const rFinal = r * alpha;
      const gFinal = g * alpha;
      const bFinal = b * alpha;

      vertices.push(
        // Triangle 1
        beatX, 0, rFinal, gFinal, bFinal,
        beatX + width, 0, rFinal, gFinal, bFinal,
        beatX, canvasHeight, rFinal, gFinal, bFinal,
        // Triangle 2
        beatX + width, 0, rFinal, gFinal, bFinal,
        beatX + width, canvasHeight, rFinal, gFinal, bFinal,
        beatX, canvasHeight, rFinal, gFinal, bFinal
      );
    }

    if (vertices.length === 0) return;

    // Render all beat lines in single draw call
    const vertexArray = new Float32Array(vertices);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexArray, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 5);
    gl.bindVertexArray(null);
  }

  private renderPlayhead(): void {
    const gl = this.gl;

    // Minimap: playhead moves across width. External window: playhead at its
    // actual position within the window. Main view: fixed at playMarkerPosition.
    let playheadX: number;
    if (this.isMinimapMode) {
      playheadX = this.playPosition * this.canvas.width;
    } else if (this.externalWindow) {
      const range = this.lastDisplayedPosition - this.firstDisplayedPosition;
      if (range <= 0) return;
      playheadX =
        ((this.playPosition - this.firstDisplayedPosition) / range) * this.canvas.width;
      if (playheadX < 0 || playheadX >= this.canvas.width) return;
    } else {
      playheadX = this.canvas.width * this.playMarkerPosition;
    }

    const playheadColor = [0.96, 0.76, 0.91];  // var(--pink)

    // Vertical line: 2 triangles forming thin rectangle
    const lineWidth = 3;
    const vertices = new Float32Array([
      // Triangle 1
      playheadX, 0, ...playheadColor,
      playheadX + lineWidth, 0, ...playheadColor,
      playheadX, this.canvas.height, ...playheadColor,

      // Triangle 2
      playheadX + lineWidth, 0, ...playheadColor,
      playheadX + lineWidth, this.canvas.height, ...playheadColor,
      playheadX, this.canvas.height, ...playheadColor
    ]);

    // Rebind VAO for rendering
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private renderCuePoint(cueTime: number): void {
    if (!this.waveformData) return;

    const gl = this.gl;

    // Convert cue time to normalized position
    const cuePosition = cueTime / this.waveformData.duration;

    // Calculate pixel position based on mode
    let cueX: number;

    if (this.isMinimapMode) {
      // Minimap: direct mapping
      cueX = cuePosition * this.canvas.width;
    } else {
      // Main waveform: account for display window
      const visibleRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
      const positionInWindow = (cuePosition - this.firstDisplayedPosition) / visibleRange;
      cueX = positionInWindow * this.canvas.width;

      // Apply manual drag offset
      cueX += this.manualDragOffset * this.pixelRatio;
    }

    // Skip if outside visible area
    if (cueX < 0 || cueX >= this.canvas.width) return;

    const cueColor = [0.79, 0.86, 0.26];  // var(--yellow) - yellowish for cue

    // Triangle size based on mode
    const triangleHeight = this.isMinimapMode ? 12 * this.pixelRatio : this.canvas.height * 0.05;
    const triangleWidth = triangleHeight; // Make it equilateral-ish

    // Vertical line: 2 triangles forming thin rectangle
    const lineWidth = 2;
    const lineVertices = new Float32Array([
      // Triangle 1
      cueX, 0, ...cueColor,
      cueX + lineWidth, 0, ...cueColor,
      cueX, this.canvas.height, ...cueColor,

      // Triangle 2
      cueX + lineWidth, 0, ...cueColor,
      cueX + lineWidth, this.canvas.height, ...cueColor,
      cueX, this.canvas.height, ...cueColor
    ]);

    // Triangle position based on mode
    const triangleCenterX = cueX + lineWidth / 2;
    let triangleVertices: Float32Array;

    if (this.isMinimapMode) {
      // Downward-pointing triangle at top for minimap
      triangleVertices = new Float32Array([
        triangleCenterX - triangleWidth / 2, 0, ...cueColor,
        triangleCenterX + triangleWidth / 2, 0, ...cueColor,
        triangleCenterX, triangleHeight, ...cueColor
      ]);
    } else {
      // Upward-pointing triangle at bottom for main waveform
      const triangleY = this.canvas.height;
      triangleVertices = new Float32Array([
        triangleCenterX - triangleWidth / 2, triangleY, ...cueColor,
        triangleCenterX + triangleWidth / 2, triangleY, ...cueColor,
        triangleCenterX, triangleY - triangleHeight, ...cueColor
      ]);
    }

    // Combine vertices
    const vertices = new Float32Array(lineVertices.length + triangleVertices.length);
    vertices.set(lineVertices, 0);
    vertices.set(triangleVertices, lineVertices.length);

    // Rebind VAO for rendering
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 9); // 6 vertices for line + 3 for triangle
    gl.bindVertexArray(null);
  }

  private renderHotCues(): void {
    if (!this.waveformData || this.hotCues.size === 0) return;

    const gl = this.gl;

    // Hot cue colors (default if no custom color)
    const HOT_CUE_COLORS: Record<number, [number, number, number]> = {
      1: [0.54, 0.71, 0.98],  // blue
      2: [0.98, 0.89, 0.69],  // yellow
      3: [0.98, 0.70, 0.53],  // peach (orange)
      4: [0.95, 0.54, 0.66],  // red
      5: [0.65, 0.89, 0.63],  // green
      6: [0.96, 0.76, 0.91],  // pink
      7: [0.80, 0.65, 0.97],  // mauve
      8: [0.58, 0.89, 0.84],  // teal
    };

    const allVertices: number[] = [];

    for (const [slotNumber, hotCue] of this.hotCues.entries()) {
      const cueTime = hotCue.time;
      const cuePosition = cueTime / this.waveformData.duration;

      // Calculate pixel position based on mode
      let cueX: number;

      if (this.isMinimapMode) {
        // Minimap: direct mapping
        cueX = cuePosition * this.canvas.width;
      } else {
        // Main waveform: account for display window
        const visibleRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
        const positionInWindow = (cuePosition - this.firstDisplayedPosition) / visibleRange;
        cueX = positionInWindow * this.canvas.width;

        // Apply manual drag offset
        cueX += this.manualDragOffset * this.pixelRatio;
      }

      // Skip if outside visible area
      if (cueX < 0 || cueX >= this.canvas.width) continue;

      // Get color (default or custom)
      const color = HOT_CUE_COLORS[slotNumber] || [1.0, 1.0, 1.0];

      if (this.isMinimapMode) {
        // Minimap mode: render full-height vertical bar
        const barWidth = 2 * this.pixelRatio;
        allVertices.push(
          // Triangle 1
          cueX, 0, ...color,
          cueX + barWidth, 0, ...color,
          cueX, this.canvas.height, ...color,

          // Triangle 2
          cueX + barWidth, 0, ...color,
          cueX + barWidth, this.canvas.height, ...color,
          cueX, this.canvas.height, ...color
        );
      } else {
        // Main waveform mode: render wider vertical line
        const lineWidth = 3 * this.pixelRatio;
        allVertices.push(
          // Triangle 1
          cueX, 0, ...color,
          cueX + lineWidth, 0, ...color,
          cueX, this.canvas.height, ...color,

          // Triangle 2
          cueX + lineWidth, 0, ...color,
          cueX + lineWidth, this.canvas.height, ...color,
          cueX, this.canvas.height, ...color
        );
      }
    }

    // Render all hot cues in one draw call (only if there are vertices to render)
    if (allVertices.length > 0) {
      const vertices = new Float32Array(allVertices);

      // Use standard alpha blending for hot cues (not additive) for accurate colors
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, allVertices.length / 5); // 5 values per vertex (x, y, r, g, b)
      gl.bindVertexArray(null);

      // Restore additive blending for other elements
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    }
  }

  /**
   * Get (lazily creating) the 2D text-overlay canvas context. The overlay
   * sits absolutely over the WebGL canvas; main waveform only.
   */
  private ensureOverlayContext(): CanvasRenderingContext2D | null {
    if (this.isMinimapMode || !this.waveformData) return null;

    // Preserve WebGL state before 2D drawing
    this.gl.flush();

    const overlayId = `waveform-text-overlay-${this.canvas.id || 'default'}`;
    let overlayCanvas = document.getElementById(overlayId) as HTMLCanvasElement;
    if (!overlayCanvas) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.id = overlayId;
      overlayCanvas.style.position = 'absolute';
      overlayCanvas.style.top = '0';
      overlayCanvas.style.left = '0';
      overlayCanvas.style.pointerEvents = 'none';
      overlayCanvas.style.zIndex = '1';
      this.canvas.parentElement?.appendChild(overlayCanvas);
    }

    // Match canvas size
    if (overlayCanvas.width !== this.canvas.width || overlayCanvas.height !== this.canvas.height) {
      overlayCanvas.width = this.canvas.width;
      overlayCanvas.height = this.canvas.height;
      overlayCanvas.style.width = this.canvas.style.width;
      overlayCanvas.style.height = this.canvas.style.height;
    }

    return overlayCanvas.getContext('2d');
  }

  private renderHotCueNumbers(ctx: CanvasRenderingContext2D): void {
    if (!this.waveformData || this.hotCues.size === 0) return;

    const squareSize = 16 * this.pixelRatio;
    const squareY = this.canvas.height - squareSize - (4 * this.pixelRatio);

    ctx.font = `bold ${12 * this.pixelRatio}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Hot cue colors (RGB -> CSS, matching WebGL colors)
    const HOT_CUE_CSS_COLORS: Record<number, string> = {
      1: 'rgb(137, 180, 250)',  // blue
      2: 'rgb(249, 226, 175)',  // yellow
      3: 'rgb(250, 179, 135)',  // peach (orange)
      4: 'rgb(243, 139, 168)',  // red
      5: 'rgb(166, 227, 161)',  // green
      6: 'rgb(245, 194, 231)',  // pink
      7: 'rgb(203, 166, 247)',  // mauve
      8: 'rgb(148, 226, 213)',  // teal
    };

    for (const [slotNumber, hotCue] of this.hotCues.entries()) {
      const cueTime = hotCue.time;
      const cuePosition = cueTime / this.waveformData.duration;

      // Calculate pixel position based on mode
      let cueX: number;

      if (this.isMinimapMode) {
        cueX = cuePosition * this.canvas.width;
      } else {
        const visibleRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
        const positionInWindow = (cuePosition - this.firstDisplayedPosition) / visibleRange;
        cueX = positionInWindow * this.canvas.width;
        cueX += this.manualDragOffset * this.pixelRatio;
      }

      // Skip if outside visible area
      if (cueX < 0 || cueX >= this.canvas.width) continue;

      const lineWidth = 3 * this.pixelRatio;
      const squareX = cueX + lineWidth + (2 * this.pixelRatio);
      const textX = squareX + squareSize / 2;
      const textY = squareY + squareSize / 2;

      // Get color for this hot cue
      const color = HOT_CUE_CSS_COLORS[slotNumber] || 'rgb(255, 255, 255)';

      // Draw dark background (matching --crust)
      ctx.fillStyle = 'rgb(17, 17, 17)';
      ctx.fillRect(squareX, squareY, squareSize, squareSize);

      // Draw colored border (1px)
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(squareX + 0.5, squareY + 0.5, squareSize - 1, squareSize - 1);

      // Draw number with colored text
      ctx.fillStyle = color;
      ctx.fillText(slotNumber.toString(), textX, textY);
    }
  }

  /** Time (elapsed / total) and bar-number readout, bottom-right of the overlay. */
  private renderTimeReadout(ctx: CanvasRenderingContext2D): void {
    if (!this.waveformData) return;

    const duration = this.waveformData.duration;
    const playhead = this.playPosition * duration;
    const bar = this.barNumberAt(playhead);
    const text =
      `${formatReadoutTime(playhead)} / ${formatReadoutTime(duration)}` +
      (bar !== null ? `  bar ${bar}` : '');

    const pad = 6 * this.pixelRatio;
    ctx.font = `bold ${12 * this.pixelRatio}px monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';

    // Translucent backing for legibility over the waveform
    const metrics = ctx.measureText(text);
    const textHeight = 14 * this.pixelRatio;
    ctx.fillStyle = 'rgba(17, 17, 17, 0.7)';
    ctx.fillRect(
      this.canvas.width - pad * 2 - metrics.width,
      this.canvas.height - pad * 1.5 - textHeight,
      metrics.width + pad * 2,
      textHeight + pad
    );

    ctx.fillStyle = 'rgb(205, 214, 244)';  // var(--text)
    ctx.fillText(text, this.canvas.width - pad, this.canvas.height - pad);
  }

  /** 1-based bar number at `time`, or null before the first downbeat / without a grid. */
  private barNumberAt(time: number): number | null {
    const downbeats = this.downbeatTimes;
    if (!downbeats || downbeats.length === 0 || time < downbeats[0]) return null;
    // Binary search: count of downbeats <= time.
    let lo = 0;
    let hi = downbeats.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (downbeats[mid] <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private createOrthoMatrix(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number
  ): Float32Array {
    // Standard orthographic projection matrix
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);

    return new Float32Array([
      -2 * lr, 0, 0, 0,
      0, -2 * bt, 0, 0,
      0, 0, 2 * nf, 0,
      (left + right) * lr, (top + bottom) * bt, (far + near) * nf, 1
    ]);
  }

  /**
   * Drive the renderer from a playback clock: one playhead read + one draw
   * per animation frame. The clock is authoritative — no interpolation.
   */
  public startRenderLoop(clock: PlaybackClock): void {
    const animate = () => {
      // Track CSS size changes (e.g. zoomable containers): resize the buffer
      // and invalidate cached geometry when the element is resized.
      const dpr = window.devicePixelRatio || 1;
      if (
        Math.abs(this.canvas.width - this.canvas.clientWidth * dpr) >= 1 ||
        Math.abs(this.canvas.height - this.canvas.clientHeight * dpr) >= 1
      ) {
        this.setupHighDPI();
        this.calculateDisplayWindow();
      }
      if (this.waveformData) {
        const position = clock.getPlayhead() / this.waveformData.duration;
        this.playPosition = Math.max(0, Math.min(1, position));
        this.calculateDisplayWindow();
      }
      this.render();
      this.animationFrameId = requestAnimationFrame(animate);
    };
    animate();
  }

  public stopRenderLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  // Zoom controls
  public setZoom(newZoom: number): void {
    this.zoomFactor = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    this.invalidateWaveformCache();
    this.calculateDisplayWindow();
  }

  /**
   * Time-based zoom: make `seconds` of track fill the canvas regardless of
   * duration (linked cross-deck zoom, performance-mode issue 05). Clamped in
   * seconds by the pure conversion; deliberately bypasses the track-relative
   * min/max factor clamps, which would reintroduce the duration dependence
   * this operation exists to remove.
   */
  public setVisibleSeconds(seconds: number): void {
    if (!this.waveformData) return;
    this.zoomFactor = zoomFactorForVisibleSeconds(this.waveformData.duration, seconds);
    this.invalidateWaveformCache();
    this.calculateDisplayWindow();
  }

  public zoomIn(): void {
    this.setZoom(this.zoomFactor * 1.2);
  }

  public zoomOut(): void {
    this.setZoom(this.zoomFactor / 1.2);
  }

  public handleWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY < 0) {
      this.zoomIn();
    } else {
      this.zoomOut();
    }
  }

  // Drag-to-scrub
  //
  // During a drag the component feeds pixel offsets in; the visible content
  // shifts via the shader without touching the playhead. On commit the offset
  // converts to a seek time for the transport — the renderer never seeks.

  /** Shift the visible content by a pixel delta (CSS pixels) during a drag. */
  public setDragOffset(pixels: number): void {
    this.manualDragOffset = pixels;
  }

  /**
   * End a drag: fold the offset into the play position and return the
   * corresponding seek time in seconds (undefined if no data).
   */
  public commitDrag(): number | undefined {
    if (!this.waveformData) return undefined;

    const rect = this.canvas.getBoundingClientRect();
    const visibleRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
    const positionDelta = (this.manualDragOffset / rect.width) * visibleRange;

    // Drag right = move backward in time (natural scroll)
    const newPosition = Math.max(0, Math.min(1, this.playPosition - positionDelta));
    this.manualDragOffset = 0;
    this.playPosition = newPosition;
    this.calculateDisplayWindow();

    return newPosition * this.waveformData.duration;
  }

  // Click-to-seek
  public handleClick(event: MouseEvent): number | undefined {
    if (!this.waveformData) return undefined;

    const rect = this.canvas.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    // Use display width, not canvas buffer width (which may be scaled for high DPI)
    const clickProgress = clickX / rect.width;

    let trackPosition: number;

    if (this.isMinimapMode) {
      // Minimap: direct mapping from click position to track position
      trackPosition = clickProgress;
    } else {
      // Main waveform: account for display window and scrolling
      // The visible range maps to the canvas width
      const visibleRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
      trackPosition = this.firstDisplayedPosition + (clickProgress * visibleRange);
    }

    const seekTime = trackPosition * this.waveformData.duration;
    return Math.max(0, Math.min(this.waveformData.duration, seekTime));
  }

  // Cleanup
  public dispose(): void {
    this.stopRenderLoop();

    const gl = this.gl;
    if (this.program) gl.deleteProgram(this.program);
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);

    // Clean up cached geometry
    this.invalidateWaveformCache();

    // Remove overlay canvas (use unique ID)
    const overlayId = `waveform-text-overlay-${this.canvas.id || 'default'}`;
    const overlayCanvas = document.getElementById(overlayId);
    if (overlayCanvas) {
      overlayCanvas.remove();
    }
  }
}
