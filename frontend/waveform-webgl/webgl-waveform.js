export class WebGLWaveformRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2');

        if (!this.gl) {
            throw new Error('WebGL 2 not supported');
        }

        // Rendering state
        this.waveformData = null;
        this.playPosition = 0.0;  // Normalized [0.0, 1.0]
        this.zoomFactor = 1.0;
        this.playMarkerPosition = 0.25;  // Fixed at 25% of viewport

        // Display window (normalized)
        this.firstDisplayedPosition = 0.0;
        this.lastDisplayedPosition = 1.0;

        // Minimap mode (different playhead behavior and rendering)
        this.isMinimapMode = false;

        // Manual drag offset (pixels) - applied during drag operations
        this.manualDragOffset = 0;

        // Set up high DPI rendering
        this.setupHighDPI();

        // Initialize WebGL
        this.initShaders();
        this.initBuffers();
    }

    setupHighDPI() {
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

    quantizeToPixelBoundary(position) {
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

    initShaders() {
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
        this.u_matrix = this.gl.getUniformLocation(this.program, 'u_matrix');
    }

    createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;

        // Compile vertex shader
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexSource);
        gl.compileShader(vertexShader);

        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            console.error('Vertex shader compile error:', gl.getShaderInfoLog(vertexShader));
            gl.deleteShader(vertexShader);
            throw new Error('Vertex shader compilation failed');
        }

        // Compile fragment shader
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentSource);
        gl.compileShader(fragmentShader);

        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            console.error('Fragment shader compile error:', gl.getShaderInfoLog(fragmentShader));
            gl.deleteShader(fragmentShader);
            throw new Error('Fragment shader compilation failed');
        }

        // Link program
        const program = gl.createProgram();
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

    initBuffers() {
        const gl = this.gl;

        // Create vertex buffer
        this.vertexBuffer = gl.createBuffer();

        // Create VAO
        this.vao = gl.createVertexArray();
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

    setWaveformData(data) {
        // data = { low: Float32Array, mid: Float32Array, high: Float32Array, duration: float }
        this.waveformData = data;
        this.calculateDisplayWindow();
    }

    setPlayPosition(position) {
        // position in seconds
        if (this.waveformData) {
            this.playPosition = position / this.waveformData.duration;
            this.calculateDisplayWindow();
        }
    }

    calculateDisplayWindow() {
        if (!this.waveformData) return;

        // Minimap always shows full track - don't recalculate
        if (this.isMinimapMode) return;

        const totalDataPoints = this.waveformData.low.length;

        // At zoom 1.0, show entire track
        // At zoom 2.0, show half the track, etc.
        const visibleFraction = 1.0 / this.zoomFactor;

        // Split display window by play marker
        const leftFraction = this.playMarkerPosition;  // 0.25
        const rightFraction = 1.0 - this.playMarkerPosition;  // 0.75

        const displayedLengthLeft = visibleFraction * leftFraction;
        const displayedLengthRight = visibleFraction * rightFraction;

        // Calculate window bounds without clamping to maintain constant scale
        // This allows empty space at start and end of track
        this.firstDisplayedPosition = this.playPosition - displayedLengthLeft;
        this.lastDisplayedPosition = this.playPosition + displayedLengthRight;
    }

    generateGeometry(opacityMultiplier = 1.0) {
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
        const vertices = [];

        // Band colors - RGB for bass/mid/treble
        const colors = {
            low: [1.0, 0.0, 0.0],      // Red - bass
            mid: [0.0, 1.0, 0.0],      // Green - mids
            high: [0.0, 0.0, 1.0]      // Blue - highs
        };

        // Band opacity for additive blending
        // Lower opacity prevents oversaturation where bands overlap
        const opacities = {
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
                ['low', low],
                ['mid', mid],
                ['high', high]
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
                const y1 = halfHeight - amplitude;  // Top
                const y2 = halfHeight + amplitude;  // Bottom

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

    generateGeometryAtZoom(targetZoom, opacityMultiplier = 1.0) {
        // Temporarily override zoom settings to generate geometry at a different zoom level
        // Used for rendering context waveform at zoom=1.0 while main view is zoomed in
        const savedZoom = this.zoomFactor;
        const savedFirst = this.firstDisplayedPosition;
        const savedLast = this.lastDisplayedPosition;

        // Set target zoom and recalculate display window
        this.zoomFactor = targetZoom;
        this.calculateDisplayWindow();

        // Generate geometry with specified opacity
        const vertices = this.generateGeometry(opacityMultiplier);

        // Restore original zoom settings
        this.zoomFactor = savedZoom;
        this.firstDisplayedPosition = savedFirst;
        this.lastDisplayedPosition = savedLast;

        return vertices;
    }

    renderVertices(vertices) {
        // Upload and render a vertex array
        // Used for both context waveform and main waveform rendering
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

    render() {
        const gl = this.gl;

        // Set viewport to match canvas size (important for high DPI)
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);

        // Clear canvas
        gl.clearColor(0.067, 0.067, 0.067, 1.0);  // var(--crust) #111111
        gl.clear(gl.COLOR_BUFFER_BIT);

        if (!this.waveformData) return;

        // Render main waveform
        const mainVertices = this.generateGeometry();
        this.renderVertices(mainVertices);

        // Render playhead (fixed vertical line at 25%)
        this.renderPlayhead();
    }

    renderPlayhead() {
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

    renderViewportIndicator(firstPos, lastPos) {
        // Render a rectangle showing the viewport bounds (for minimap)
        // firstPos, lastPos are normalized positions [0.0, 1.0]
        const gl = this.gl;
        const indicatorColor = [0.96, 0.76, 0.91];  // var(--pink)
        const alpha = 0.3;  // Semi-transparent

        const x1 = firstPos * this.canvas.width;
        const x2 = lastPos * this.canvas.width;
        const y1 = 0;
        const y2 = this.canvas.height;

        // Filled rectangle with border
        const vertices = [];

        // Fill (2 triangles for filled rectangle at low opacity)
        const fillColor = indicatorColor.map(c => c * alpha);
        vertices.push(
            // Triangle 1
            x1, y1, ...fillColor,
            x2, y1, ...fillColor,
            x1, y2, ...fillColor,
            // Triangle 2
            x2, y1, ...fillColor,
            x2, y2, ...fillColor,
            x1, y2, ...fillColor
        );

        // Border (4 thin rectangles forming outline)
        const borderWidth = 2;
        const borderColor = indicatorColor;

        // Top border
        vertices.push(
            x1, y1, ...borderColor,
            x2, y1, ...borderColor,
            x1, y1 + borderWidth, ...borderColor,

            x2, y1, ...borderColor,
            x2, y1 + borderWidth, ...borderColor,
            x1, y1 + borderWidth, ...borderColor
        );

        // Bottom border
        vertices.push(
            x1, y2 - borderWidth, ...borderColor,
            x2, y2 - borderWidth, ...borderColor,
            x1, y2, ...borderColor,

            x2, y2 - borderWidth, ...borderColor,
            x2, y2, ...borderColor,
            x1, y2, ...borderColor
        );

        // Left border
        vertices.push(
            x1, y1, ...borderColor,
            x1 + borderWidth, y1, ...borderColor,
            x1, y2, ...borderColor,

            x1 + borderWidth, y1, ...borderColor,
            x1 + borderWidth, y2, ...borderColor,
            x1, y2, ...borderColor
        );

        // Right border
        vertices.push(
            x2 - borderWidth, y1, ...borderColor,
            x2, y1, ...borderColor,
            x2 - borderWidth, y2, ...borderColor,

            x2, y1, ...borderColor,
            x2, y2, ...borderColor,
            x2 - borderWidth, y2, ...borderColor
        );

        const verticesArray = new Float32Array(vertices);

        // Rebind VAO for rendering
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, verticesArray, gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, verticesArray.length / 5);
        gl.bindVertexArray(null);
    }

    createOrthoMatrix(left, right, bottom, top, near, far) {
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
    startRenderLoop(audioElement) {
        const animate = () => {
            if (audioElement && !audioElement.paused) {
                this.setPlayPosition(audioElement.currentTime);
            }
            this.render();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        animate();
    }

    stopRenderLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    // Zoom controls
    setZoom(newZoom) {
        this.zoomFactor = Math.max(0.5, Math.min(50.0, newZoom));
        this.calculateDisplayWindow();
    }

    zoomIn() {
        this.setZoom(this.zoomFactor * 1.2);
    }

    zoomOut() {
        this.setZoom(this.zoomFactor / 1.2);
    }

    handleWheel(event) {
        event.preventDefault();
        if (event.deltaY < 0) {
            this.zoomIn();
        } else {
            this.zoomOut();
        }
    }

    // Click-to-seek
    handleClick(event) {
        if (!this.waveformData) return;

        const rect = this.canvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        // Use display width, not canvas buffer width (which may be scaled for high DPI)
        const clickProgress = clickX / rect.width;

        let trackPosition;

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
}
