import { useEffect, useRef, useState } from 'react';
import { WebGLWaveformRenderer } from '../utils/WebGLWaveformRenderer';
import { useAudio } from '../hooks/useAudio';
import { useWaveformData } from '../hooks/useWaveformData';
import { useHotCues } from '../hooks/useHotCues';
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

  // Fetch hot cues
  const { data: hotCuesArray = [] } = useHotCues(trackId);

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

      // Set initial hot cues if already loaded
      if (hotCuesArray && hotCuesArray.length > 0) {
        renderer.setHotCues(hotCuesArray);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waveformData]);

  // Update cue point when it changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCuePoint(audio.cuePoint);
    }
  }, [audio.cuePoint]);

  // Update hot cues when data changes
  useEffect(() => {
    if (rendererRef.current && hotCuesArray) {
      rendererRef.current.setHotCues(hotCuesArray);
      rendererRef.current.render();
    }
  }, [hotCuesArray]);

  // Sync renderer position on seeks/cue updates and play state changes
  useEffect(() => {
    if (rendererRef.current && audio.audioRef.current) {
      rendererRef.current.setPlayPosition(audio.audioRef.current.currentTime);
    }
  }, [audio.isPlaying, audio.cuePoint, audio.seekVersion, audio.audioRef]);

  // Click-to-seek handler
  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const seekTime = renderer.handleClick(event.nativeEvent);
    if (seekTime !== undefined && audio.duration) {
      audio.seek(seekTime);

      // Manually sync minimap renderer position immediately
      if (audio.audioRef.current) {
        renderer.setPlayPosition(audio.audioRef.current.currentTime);
      }
      // Main waveform sync happens via useEffect triggered by seekVersion change
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
