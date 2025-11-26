import { useEffect, useRef, useState } from 'react';
import { WebGLWaveformRenderer } from '../utils/WebGLWaveformRenderer';
import { useAudio } from '../hooks/useAudio';
import { useWaveformData } from '../hooks/useWaveformData';
import './Waveform.css';

interface WebGLWaveformProps {
  trackId: number | null;
  className?: string;
}

export default function WebGLWaveform({ trackId, className }: WebGLWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLWaveformRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Get audio state and controls from context
  const audio = useAudio();

  // Fetch waveform data
  const { data: waveformData, isLoading, error: fetchError } = useWaveformData(trackId);

  // Drag state
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const wasPlaying = useRef(false);

  // Initialize renderer (only when waveform data changes)
  useEffect(() => {
    if (!canvasRef.current || !waveformData) return;

    try {
      const renderer = new WebGLWaveformRenderer(canvasRef.current, {
        isMinimapMode: false,
        playMarkerPosition: 0.25,
        maxZoom: 50.0,
        minZoom: 0.5,
      });

      renderer.setWaveformData(waveformData);

      // Set initial cue point if available
      if (audio.cuePoint !== null) {
        renderer.setCuePoint(audio.cuePoint);
      }

      // Start render loop
      if (audio.audioRef.current) {
        renderer.startRenderLoop(audio.audioRef.current);
      }

      rendererRef.current = renderer;
      setError(null);

      return () => {
        renderer.stopRenderLoop();
        renderer.dispose();
        rendererRef.current = null;
      };
    } catch (err) {
      setError('Failed to initialize WebGL waveform renderer');
      console.error('WebGL waveform renderer error:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformData]);

  // Update cue point when it changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCuePoint(audio.cuePoint);
    }
  }, [audio.cuePoint]);

  // Sync renderer position when audio is paused and currentTime changes (e.g., from cue button seeking)
  useEffect(() => {
    if (rendererRef.current && !audio.isPlaying && audio.audioRef.current) {
      rendererRef.current.setPlayPosition(audio.audioRef.current.currentTime);
    }
  }, [audio.currentTime, audio.isPlaying, audio.audioRef]);

  // Drag-to-scrub handlers
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rendererRef.current?.waveformData) return;

    const renderer = rendererRef.current;

    isDragging.current = true;
    dragStartX.current = event.clientX;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = 'grabbing';
    }

    // Pause playback during drag if playing
    wasPlaying.current = audio.isPlaying;
    if (wasPlaying.current) {
      audio.pause();

      // Sync renderer position with current audio time before starting drag
      // (render loop only updates position when playing)
      if (audio.audioRef.current && renderer.waveformData) {
        renderer.setPlayPosition(audio.audioRef.current.currentTime);
      }
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || !rendererRef.current?.waveformData) return;

    const deltaX = event.clientX - dragStartX.current;

    // Apply drag offset directly (natural scroll: drag right = move forward in time)
    rendererRef.current.manualDragOffset = deltaX;
  };

  const handleMouseUp = () => {
    if (!isDragging.current) return;

    isDragging.current = false;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = 'grab';
    }

    // Calculate new playPosition based on drag offset
    const renderer = rendererRef.current;
    if (renderer?.waveformData && canvas && audio.audioRef.current) {
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
      audio.seek(Math.max(0, Math.min(audio.duration, seekTime)));

      // Resume playback if it was playing before drag
      if (wasPlaying.current) {
        audio.play();
      }
    }
  };

  const handleMouseLeave = () => {
    if (!isDragging.current) return;

    // Same as mouse up
    handleMouseUp();
  };

  // Wheel zoom handler
  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (rendererRef.current) {
      rendererRef.current.handleWheel(event.nativeEvent);
    }
  };

  // Loading and error states
  if (isLoading) {
    return (
      <div className={`waveform-container ${className || ''}`}>
        <div className="waveform-loading">Loading waveform...</div>
      </div>
    );
  }

  if (fetchError || error) {
    return (
      <div className={`waveform-container ${className || ''}`}>
        <div className="waveform-error">
          {error || 'Failed to load waveform'}
        </div>
      </div>
    );
  }

  if (!trackId) {
    return (
      <div className={`waveform-container ${className || ''}`}>
        <div className="waveform-empty">No track loaded</div>
      </div>
    );
  }

  return (
    <div className={`waveform-container ${className || ''}`}>
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        style={{ cursor: 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />
    </div>
  );
}
