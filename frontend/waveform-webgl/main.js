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
        minimapRenderer.playMarkerPosition = 0.0;  // Playhead moves across width, not fixed
        minimapRenderer.lockDisplayWindow = true;  // Prevent display window recalculation

        // Set display window to always show full track (0.0 to 1.0)
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
let dragStartFirstPos = 0;
let dragStartLastPos = 0;
let wasPlaying = false;

canvas.addEventListener('mousedown', (event) => {
    if (!renderer.waveformData) return;

    isDragging = true;
    dragStartX = event.clientX;
    dragStartFirstPos = renderer.firstDisplayedPosition;
    dragStartLastPos = renderer.lastDisplayedPosition;
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

    // Calculate how much to move in track position space
    // Negative for natural scroll direction (drag right = forward in time)
    const visibleRange = dragStartLastPos - dragStartFirstPos;
    const deltaPosition = -(deltaX / canvas.width) * visibleRange;

    // Shift the display window
    renderer.firstDisplayedPosition = dragStartFirstPos + deltaPosition;
    renderer.lastDisplayedPosition = dragStartLastPos + deltaPosition;

    // Update playPosition to reflect what's under the playhead (at 25%)
    renderer.playPosition = renderer.firstDisplayedPosition +
        (renderer.lastDisplayedPosition - renderer.firstDisplayedPosition) * renderer.playMarkerPosition;
});

canvas.addEventListener('mouseup', () => {
    if (!isDragging) return;

    isDragging = false;
    canvas.style.cursor = 'grab';

    // Seek audio to the scrubbed position
    if (renderer.waveformData && audio.duration) {
        const seekTime = renderer.playPosition * renderer.waveformData.duration;
        audio.currentTime = Math.max(0, Math.min(audio.duration, seekTime));
        console.log('Scrubbed to:', seekTime);

        // Resume normal auto-tracking by recalculating display window
        renderer.calculateDisplayWindow();

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

    // Seek on mouse leave as well
    if (renderer.waveformData && audio.duration) {
        const seekTime = renderer.playPosition * renderer.waveformData.duration;
        audio.currentTime = Math.max(0, Math.min(audio.duration, seekTime));
        console.log('Scrubbed to:', seekTime);

        // Resume normal auto-tracking by recalculating display window
        renderer.calculateDisplayWindow();

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
