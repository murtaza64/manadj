import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { CanvasWaveformRenderer } from '../utils/CanvasWaveformRenderer';
import type { WaveformResponse } from '../types';
import './Waveform.css';

interface CanvasWaveformProps {
  audioElement: HTMLAudioElement | null;
  trackId: number | null;
  cuePoint: number | null;
}

export default function CanvasWaveform({ audioElement, trackId, cuePoint }: CanvasWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasWaveformRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: waveformData, isLoading, error: fetchError } = useQuery<WaveformResponse>({
    queryKey: ['waveform', trackId],
    queryFn: () => api.waveforms.get(trackId!),
    enabled: trackId !== null,
    staleTime: Infinity,
    retry: 1,
  });

  // Initialize renderer
  useEffect(() => {
    if (!canvasRef.current || !waveformData) return;

    try {
      const renderer = new CanvasWaveformRenderer(canvasRef.current);
      renderer.load(waveformData.data);
      renderer.onSeek((time) => {
        if (audioElement) audioElement.currentTime = time;
      });
      rendererRef.current = renderer;
      setError(null);
      return () => {
        renderer.destroy();
        rendererRef.current = null;
      };
    } catch (err) {
      setError('Failed to initialize waveform renderer');
      console.error('Waveform renderer error:', err);
    }
  }, [waveformData, audioElement]);

  // Update playback time
  useEffect(() => {
    if (!audioElement || !rendererRef.current) return;

    const handleTimeUpdate = () => rendererRef.current?.setCurrentTime(audioElement.currentTime);
    const handlePlay = () => rendererRef.current?.setPlaying(true);
    const handlePause = () => rendererRef.current?.setPlaying(false);

    audioElement.addEventListener('timeupdate', handleTimeUpdate);
    audioElement.addEventListener('play', handlePlay);
    audioElement.addEventListener('pause', handlePause);

    return () => {
      audioElement.removeEventListener('timeupdate', handleTimeUpdate);
      audioElement.removeEventListener('play', handlePlay);
      audioElement.removeEventListener('pause', handlePause);
    };
  }, [audioElement]);

  // Update CUE point
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCuePoint(cuePoint);
    }
  }, [cuePoint]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => rendererRef.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (isLoading) {
    return (
      <div className="waveform-container waveform-loading">
        <span style={{ color: 'var(--subtext1)', fontSize: '12px' }}>Generating waveform...</span>
      </div>
    );
  }

  if (fetchError || error) {
    return (
      <div className="waveform-container waveform-error">
        <span style={{ color: 'var(--red)', fontSize: '12px' }}>
          {error || 'Failed to load waveform'}
        </span>
      </div>
    );
  }

  return (
    <div className="waveform-container">
      <canvas ref={canvasRef} />
    </div>
  );
}
