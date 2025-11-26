import { useEffect, useRef, useState } from 'react';
import { WebGLWaveformRenderer } from '../utils/WebGLWaveformRenderer';
import { useAudio } from '../hooks/useAudio';
import { useWaveformData } from '../hooks/useWaveformData';
import './Waveform.css';

interface WaveformMinimapProps {
  trackId: number | null;
  className?: string;
}

export default function WaveformMinimap({ trackId, className }: WaveformMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLWaveformRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Get audio state and controls from context
  const audio = useAudio();

  // Fetch waveform data
  const { data: waveformData, isLoading, error: fetchError } = useWaveformData(trackId);

  // Initialize renderer
  useEffect(() => {
    if (!canvasRef.current || !waveformData) return;

    try {
      const renderer = new WebGLWaveformRenderer(canvasRef.current, {
        isMinimapMode: true,
        playMarkerPosition: 0.0,  // Not used in minimap mode
        maxZoom: 1.0,
        minZoom: 1.0,
      });

      renderer.setWaveformData(waveformData);

      // Minimap always shows full track
      renderer.setZoom(1.0);
      renderer.firstDisplayedPosition = 0.0;
      renderer.lastDisplayedPosition = 1.0;

      // Set cue point if available
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
      setError('Failed to initialize minimap renderer');
      console.error('Minimap renderer error:', err);
    }
  }, [waveformData, audio.audioRef, audio.cuePoint]);

  // Update cue point when it changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCuePoint(audio.cuePoint);
    }
  }, [audio.cuePoint]);

  // Sync renderer position when audio is paused and currentTime changes
  useEffect(() => {
    if (rendererRef.current && !audio.isPlaying && audio.audioRef.current) {
      rendererRef.current.setPlayPosition(audio.audioRef.current.currentTime);
    }
  }, [audio.currentTime, audio.isPlaying, audio.audioRef, audio.isPreviewing, audio.cuePoint]);

  // Click-to-seek handler
  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const seekTime = renderer.handleClick(event.nativeEvent);
    if (seekTime !== undefined && audio.duration) {
      audio.seek(seekTime);
    }
  };

  // Loading and error states
  if (isLoading) {
    return (
      <div className={`minimap-container ${className || ''}`}>
        <div className="minimap-loading">Loading...</div>
      </div>
    );
  }

  if (fetchError || error) {
    return (
      <div className={`minimap-container ${className || ''}`}>
        <div className="minimap-error">
          {error || 'Failed to load minimap'}
        </div>
      </div>
    );
  }

  if (!trackId) {
    return (
      <div className={`minimap-container ${className || ''}`}>
        <div className="minimap-empty">No track</div>
      </div>
    );
  }

  return (
    <div className={`minimap-container ${className || ''}`}>
      <canvas
        ref={canvasRef}
        className="minimap-canvas"
        style={{ cursor: 'pointer' }}
        onClick={handleClick}
      />
    </div>
  );
}
