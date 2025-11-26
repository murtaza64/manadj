import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, BACKEND_URL } from '../api/client';
import type { WaveformResponse } from '../types';
import './Waveform.css';

interface PngWaveformProps {
  audioElement: HTMLAudioElement | null;
  trackId: number | null;
  cuePoint: number | null;
}

export default function PngWaveform({ audioElement, trackId, cuePoint }: PngWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const animationFrameRef = useRef<number | null>(null);

  const { data: waveformData, isLoading, error: fetchError } = useQuery<WaveformResponse>({
    queryKey: ['waveform', trackId],
    queryFn: () => api.waveforms.get(trackId!),
    enabled: trackId !== null,
    staleTime: Infinity,
    retry: 1,
  });

  // Handle PNG image load
  useEffect(() => {
    setImageLoaded(false);
  }, [waveformData?.png_url]);

  // Update scroll position to follow playback
  useEffect(() => {
    if (!audioElement || !containerRef.current || !imageRef.current || !waveformData || !imageLoaded) {
      return;
    }

    const updateScroll = () => {
      if (!audioElement || !containerRef.current || !imageRef.current || !waveformData) {
        return;
      }

      // Use audio element's duration instead of waveformData duration for accurate sync
      const duration = audioElement.duration;
      const progress = duration > 0 ? audioElement.currentTime / duration : 0;

      // Calculate scroll position based on actual scrollable range
      // maxScroll = scrollWidth - clientWidth (total content width - visible width)
      const maxScroll = containerRef.current.scrollWidth - containerRef.current.clientWidth;
      const scrollX = progress * maxScroll;

      containerRef.current.scrollLeft = scrollX;

      // Continue animation if playing
      if (!audioElement.paused) {
        animationFrameRef.current = requestAnimationFrame(updateScroll);
      }
    };

    const handlePlay = () => {
      animationFrameRef.current = requestAnimationFrame(updateScroll);
    };

    const handlePause = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      updateScroll(); // Update once when paused
    };

    const handleTimeUpdate = () => {
      if (audioElement.paused) {
        updateScroll(); // Update on seek when paused
      }
    };

    audioElement.addEventListener('play', handlePlay);
    audioElement.addEventListener('pause', handlePause);
    audioElement.addEventListener('timeupdate', handleTimeUpdate);
    audioElement.addEventListener('seeked', handleTimeUpdate);

    // Initial update
    updateScroll();

    return () => {
      audioElement.removeEventListener('play', handlePlay);
      audioElement.removeEventListener('pause', handlePause);
      audioElement.removeEventListener('timeupdate', handleTimeUpdate);
      audioElement.removeEventListener('seeked', handleTimeUpdate);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [audioElement, waveformData, imageLoaded]);

  // Handle click to seek
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!audioElement || !imageRef.current || !waveformData) return;

    const container = event.currentTarget;
    const rect = container.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const scrollX = container.scrollLeft;

    // Calculate progress based on scroll position
    // Use the same calculation as the scroll update for consistency
    const maxScroll = container.scrollWidth - container.clientWidth;
    const scrollPosition = clickX + scrollX;
    const progress = maxScroll > 0 ? scrollPosition / (container.scrollWidth) : 0;

    // Calculate seek time (clamp to valid range)
    const seekTime = Math.max(0, Math.min(audioElement.duration, progress * audioElement.duration));

    audioElement.currentTime = seekTime;
  };

  // Calculate cue point position
  const getCuePointPosition = (): number | null => {
    if (!cuePoint || !waveformData || !containerRef.current || !audioElement) return null;

    // Use audio element's duration for consistency with scroll calculation
    const duration = audioElement.duration || waveformData.data.duration;
    const progress = cuePoint / duration;

    // Use the same approach as scroll calculation for consistency
    // The cue point position in the scrollable content is:
    // progress * total_scrollable_width
    // where total_scrollable_width = scrollWidth - clientWidth + clientWidth = scrollWidth
    // But we want position relative to the start of content, not the scroll position
    // So we use: progress * maxScroll + paddingLeft
    const maxScroll = containerRef.current.scrollWidth - containerRef.current.clientWidth;
    const paddingLeft = containerRef.current.clientWidth * 0.25;

    return paddingLeft + (progress * maxScroll);
  };

  if (!trackId) {
    return (
      <div className="png-waveform-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--subtext1)', fontSize: '12px' }}>hello world</span>
      </div>
    );
  }

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

  if (!waveformData?.png_url) {
    return (
      <div className="waveform-container waveform-error">
        <span style={{ color: 'var(--peach)', fontSize: '12px' }}>
          PNG waveform not available (using Canvas fallback)
        </span>
      </div>
    );
  }

  const cuePointX = getCuePointPosition();

  // Construct full URL for PNG using backend base URL
  const pngUrl = waveformData.png_url ? `${BACKEND_URL}${waveformData.png_url}` : null;

  return (
    <div className="png-waveform-wrapper">
      <div className="png-waveform-scroll-container" ref={containerRef} onClick={handleClick}>
        <img
          ref={imageRef}
          src={pngUrl || ''}
          alt="Waveform"
          className="png-waveform-image"
          onLoad={() => setImageLoaded(true)}
          onError={() => setError('Failed to load waveform image')}
        />

        {/* Cue point indicator - scrolls with image */}
        {imageLoaded && cuePointX !== null && (
          <div
            className="waveform-cue-point"
            style={{ left: `${cuePointX}px` }}
          >
            <div className="waveform-cue-triangle" />
          </div>
        )}
      </div>

      {/* Playhead indicator - fixed at 25% of viewport, doesn't scroll */}
      {imageLoaded && <div className="waveform-playhead" />}
    </div>
  );
}
