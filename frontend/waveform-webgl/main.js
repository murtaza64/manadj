import { WebGLWaveformRenderer } from './webgl-waveform.js';
import { loadWaveformData } from './waveform-data-loader.js';

const canvas = document.getElementById('waveform');
const minimapCanvas = document.getElementById('minimap');
const audio = document.getElementById('audio');
const status = document.getElementById('status');

const renderer = new WebGLWaveformRenderer(canvas);
const minimapRenderer = new WebGLWaveformRenderer(minimapCanvas);

document.getElementById('load-track').addEventListener('click', async () => {
    status.textContent = 'Loading...';

    try {
        // Get track ID from input
        const trackId = parseInt(document.getElementById('track-id').value);
        if (!trackId || trackId < 1) {
            status.textContent = 'Invalid track ID';
            return;
        }

        // Load waveform data
        const waveformData = await loadWaveformData(trackId);
        renderer.setWaveformData(waveformData);
        minimapRenderer.setWaveformData(waveformData);

        // Configure minimap: always show full track, moving playhead
        minimapRenderer.isMinimapMode = true;  // Different playhead and rendering behavior
        minimapRenderer.setZoom(1.0);

        // Set display window to always show full track (0.0 to 1.0)
        // isMinimapMode prevents this from being recalculated
        minimapRenderer.firstDisplayedPosition = 0.0;
        minimapRenderer.lastDisplayedPosition = 1.0;

        // Load audio
        audio.src = `http://localhost:8000/api/tracks/${trackId}/audio`;

        // Start main waveform render loop
        renderer.startRenderLoop(audio);

        // Start minimap render loop (tracks audio position)
        minimapRenderer.startRenderLoop(audio);

        status.textContent = 'Ready';
    } catch (error) {
        status.textContent = `Error: ${error.message}`;
        console.error('Error loading track:', error);
    }
});

document.getElementById('play-pause').addEventListener('click', () => {
    if (audio.paused) {
        audio.play();
    } else {
        audio.pause();
    }
});

// Drag-to-scrub on main waveform
let isDragging = false;
let dragStartX = 0;
let wasPlaying = false;

canvas.addEventListener('mousedown', (event) => {
    if (!renderer.waveformData) return;

    isDragging = true;
    dragStartX = event.clientX;
    canvas.style.cursor = 'grabbing';

    // Pause playback during drag if playing
    wasPlaying = !audio.paused;
    if (wasPlaying) {
        audio.pause();
    }
});

canvas.addEventListener('mousemove', (event) => {
    if (!isDragging || !renderer.waveformData) return;

    const deltaX = event.clientX - dragStartX;

    // Apply drag offset directly (natural scroll: drag right = move forward in time)
    renderer.manualDragOffset = deltaX;
});

canvas.addEventListener('mouseup', () => {
    if (!isDragging) return;

    isDragging = false;
    canvas.style.cursor = 'grab';

    // Calculate new playPosition based on drag offset
    if (renderer.waveformData && audio.duration) {
        // Convert pixel offset to position delta (use display width, not buffer width)
        const rect = canvas.getBoundingClientRect();
        const visibleRange = renderer.lastDisplayedPosition - renderer.firstDisplayedPosition;
        const pixelDelta = renderer.manualDragOffset;
        const positionDelta = (pixelDelta / rect.width) * visibleRange;

        // Update playPosition
        renderer.playPosition -= positionDelta;

        // Clear manual offset (now baked into playPosition and display window)
        renderer.manualDragOffset = 0;

        // Recalculate display window for the new playPosition
        renderer.calculateDisplayWindow();

        // Seek audio
        const seekTime = renderer.playPosition * renderer.waveformData.duration;
        audio.currentTime = Math.max(0, Math.min(audio.duration, seekTime));
        console.log('Scrubbed to:', seekTime);

        // Resume playback if it was playing before drag
        if (wasPlaying) {
            audio.play();
        }
    }
});

canvas.addEventListener('mouseleave', () => {
    if (!isDragging) return;

    isDragging = false;
    canvas.style.cursor = 'grab';

    // Calculate new playPosition based on drag offset
    if (renderer.waveformData && audio.duration) {
        // Convert pixel offset to position delta (use display width, not buffer width)
        const rect = canvas.getBoundingClientRect();
        const visibleRange = renderer.lastDisplayedPosition - renderer.firstDisplayedPosition;
        const pixelDelta = renderer.manualDragOffset;
        const positionDelta = (pixelDelta / rect.width) * visibleRange;

        // Update playPosition
        renderer.playPosition -= positionDelta;

        // Clear manual offset
        renderer.manualDragOffset = 0;

        // Recalculate display window for the new playPosition
        renderer.calculateDisplayWindow();

        // Seek audio
        const seekTime = renderer.playPosition * renderer.waveformData.duration;
        audio.currentTime = Math.max(0, Math.min(audio.duration, seekTime));
        console.log('Scrubbed to:', seekTime);

        // Resume playback if it was playing before drag
        if (wasPlaying) {
            audio.play();
        }
    }
});

canvas.style.cursor = 'grab';

canvas.addEventListener('wheel', (event) => {
    renderer.handleWheel(event);
});

// Minimap click for navigation
minimapCanvas.addEventListener('click', (event) => {
    const seekTime = minimapRenderer.handleClick(event);
    if (seekTime !== undefined && audio.duration) {
        audio.currentTime = seekTime;

        // Update main waveform position (especially important when paused)
        renderer.setPlayPosition(seekTime);

        console.log('Minimap clicked, seeking to:', seekTime);
    }
});

document.getElementById('zoom-in').addEventListener('click', () => {
    renderer.zoomIn();
});

document.getElementById('zoom-out').addEventListener('click', () => {
    renderer.zoomOut();
});

document.getElementById('zoom-reset').addEventListener('click', () => {
    renderer.setZoom(1.0);
});
