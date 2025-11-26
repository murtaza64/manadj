/**
 * WebGL-based waveform renderer with hardware acceleration.
 *
 * Features:
 * - 3-band frequency visualization (bass/mid/treble)
 * - Adaptive sampling with sub-pixel boundary weighting
 * - High-DPI support
 * - Zoom and drag-to-scrub
 * - Minimap mode
 * - Cue point rendering
 */

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
}

export class WebGLWaveformRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;

  // WebGL resources
  private program: WebGLProgram;
  private vertexBuffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject;

  // Shader locations
  private a_position: number;
  private a_color: number;
  private u_matrix: WebGLUniformLocation;

  // Rendering state
  public waveformData: WaveformDataWebGL | null = null;
  public playPosition: number = 0.0;  // Normalized [0.0, 1.0]
  public zoomFactor: number = 16.0;
  public playMarkerPosition: number;  // Fixed playhead position (0.0-1.0)

  // Display window (normalized positions)
  public firstDisplayedPosition: number = 0.0;
  public lastDisplayedPosition: number = 1.0;

  // Mode flags
  public isMinimapMode: boolean;

  // Manual drag offset (pixels) - applied during drag operations
  public manualDragOffset: number = 0;

  // High DPI support
  private displayWidth: number;
  private displayHeight: number;
  private pixelRatio: number;

  // Animation loop
  private animationFrameId: number | null = null;

  // Zoom limits
  private maxZoom: number;
  private minZoom: number;

  // Cue point (time in seconds)
  public cuePoint: number | null = null;

  constructor(canvas: HTMLCanvasElement, config: WebGLRendererConfig = {}) {
    this.canvas = canvas;

    const gl = canvas.getContext('webgl2');
    if (!gl) {
      throw new Error('WebGL 2 not supported');
    }
    this.gl = gl;

    // Apply configuration
    this.isMinimapMode = config.isMinimapMode ?? false;
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
    this.canvas.width = displayWidth * dpr;
    this.canvas.height = displayHeight * dpr;

    // Store display dimensions for pixel-aligned calculations
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
    this.pixelRatio = dpr;
  }

  public quantizeToPixelBoundary(position: number): number {
    // Quantize a normalized position [0.0, 1.0] to align with exact pixel boundaries
    // This prevents sub-pixel rendering jitter during drag
    if (!this.waveformData) return position;

    const totalDataPoints = this.waveformData.low.length;
    const visibleRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
    const samplesPerPixel = (visibleRange * totalDataPoints) / this.canvas.width;

    // Round to nearest sample that aligns with pixel boundary
    const sampleIndex = Math.round(position * totalDataPoints / samplesPerPixel) * samplesPerPixel;
    return Math.max(0, Math.min(1, sampleIndex / totalDataPoints));
  }

  private initShaders(): void {
    const vertexShaderSource = `#version 300 es
    in vec2 a_position;
    in vec3 a_color;

    uniform mat4 u_matrix;

    out vec3 v_color;

    void main() {
        gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
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
    this.calculateDisplayWindow();
  }

  public setPlayPosition(position: number): void {
    // position in seconds
    if (this.waveformData) {
      this.playPosition = position / this.waveformData.duration;
      this.calculateDisplayWindow();
    }
  }

  public setCuePoint(cueTime: number | null): void {
    this.cuePoint = cueTime;
  }

  public calculateDisplayWindow(): void {
    if (!this.waveformData) return;

    // Minimap always shows full track - don't recalculate
    if (this.isMinimapMode) return;

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

    // Calculate sampling parameters
    const totalDataPoints = this.waveformData.low.length;
    const firstIndex = Math.floor(this.firstDisplayedPosition * totalDataPoints);
    const lastIndex = Math.floor(this.lastDisplayedPosition * totalDataPoints);
    const dataPointsToRender = lastIndex - firstIndex;

    // Calculate pixel offset for waveform scrolling
    let pixelOffset = 0;

    if (this.isMinimapMode) {
      // Minimap: no offset, waveform stays still
      pixelOffset = 0;
    } else {
      // Normal mode: calculate offset so playPosition aligns with fixed playhead
      const displayRange = this.lastDisplayedPosition - this.firstDisplayedPosition;
      const playPositionInRange = (this.playPosition - this.firstDisplayedPosition) / displayRange;
      const playheadPixel = this.canvas.width * this.playMarkerPosition;

      // Calculate pixel offset so playPosition aligns with playhead
      // Round to nearest pixel to prevent sub-pixel rendering glitches
      pixelOffset = Math.round(playheadPixel - (playPositionInRange * canvasWidth));

      // Apply manual drag offset (for smooth dragging without recalculating display window)
      // Scale from display pixels to buffer pixels
      pixelOffset += this.manualDragOffset * this.pixelRatio;
    }

    // Samples per pixel
    const samplesPerPixel = dataPointsToRender / canvasWidth;

    // Vertex array: [x, y, r, g, b] * 6 vertices per pixel * 3 bands
    const vertices: number[] = [];

    // Band colors - RGB for bass/mid/treble
    const colors: Record<string, [number, number, number]> = {
      low: [0.95, 0.38, 0.38],   // Mild red (maroon) - bass
      mid: [0.0, 1.0, 0.0],      // Green - mids
      high: [0.53, 0.87, 0.93]   // Light blue (sky) - highs
    };

    // Band opacity for additive blending
    // Lower opacity prevents oversaturation where bands overlap
    const opacities: Record<string, number> = {
      low: 0.7,    // Red bass
      mid: 0.7,    // Green mids
      high: 0.7    // Blue highs
    };

    // Render each pixel column
    for (let pixelX = 0; pixelX < canvasWidth; pixelX++) {
      // Calculate actual pixel position with offset
      const actualPixelX = pixelX + pixelOffset;

      // Skip if outside canvas bounds
      if (actualPixelX < 0 || actualPixelX >= canvasWidth) continue;

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

        const x1 = actualPixelX;
        const x2 = actualPixelX + 1;

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

  private renderVertices(vertices: Float32Array): void {
    // Upload and render a vertex array
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

    // Render main waveform
    const mainVertices = this.generateGeometry();
    if (mainVertices) {
      this.renderVertices(mainVertices);
    }

    // Render cue point if set
    if (this.cuePoint !== null) {
      this.renderCuePoint(this.cuePoint);
    }

    // Render playhead (fixed vertical line at 25%)
    this.renderPlayhead();
  }

  private renderPlayhead(): void {
    const gl = this.gl;

    // For minimap: playhead moves across width
    // For main view: playhead stays fixed at playMarkerPosition
    const playheadX = this.isMinimapMode
      ? this.playPosition * this.canvas.width
      : this.canvas.width * this.playMarkerPosition;

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
    const triangleHeight = this.isMinimapMode ? this.canvas.height * 0.30 : this.canvas.height * 0.05;
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

    // Upward-pointing triangle at bottom
    const triangleCenterX = cueX + lineWidth / 2;
    const triangleY = this.canvas.height;
    const triangleVertices = new Float32Array([
      // Triangle pointing up from bottom
      triangleCenterX - triangleWidth / 2, triangleY, ...cueColor,
      triangleCenterX + triangleWidth / 2, triangleY, ...cueColor,
      triangleCenterX, triangleY - triangleHeight, ...cueColor
    ]);

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

  // Animation loop
  public startRenderLoop(audioElement: HTMLAudioElement): void {
    const animate = () => {
      if (audioElement && !audioElement.paused) {
        this.setPlayPosition(audioElement.currentTime);
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
  }
}
