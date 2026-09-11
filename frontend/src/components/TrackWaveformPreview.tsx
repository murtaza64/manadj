import { memo, useEffect, useState, type CSSProperties } from 'react';
import type { HotCue } from '../types';
import { useStyleSlot } from '../waveform/styleSlots';
import { useWaveformPreview } from '../waveform/useWaveformPreview';
import { previewImageKey, requestPreviewImage } from '../waveform/previewImage';
import { cueCssColor } from '../hotcues/palette';
import { CUE_FLAG_PREVIEW_SIZE, CUE_FLAG_PREVIEW_POLE_W } from '../theme/markers';
import './TrackWaveformPreview.css';

const NO_CUES: HotCue[] = [];

export const TrackWaveformPreview = memo(function TrackWaveformPreview({
  trackId, duration, cues = NO_CUES,
}: { trackId: number; duration?: number | null; cues?: HotCue[] }) {
  const { data, isError, error } = useWaveformPreview(trackId);
  const slot = useStyleSlot('minimap');
  const key = data ? previewImageKey(data, slot) : '';
  const [image, setImage] = useState<{ key: string; src: string | null } | null>(null);
  const src = image?.key === key ? image.src : null;
  useEffect(() => {
    if (!data) return;
    return requestPreviewImage(data, slot, (src) => setImage({ key, src }));
  }, [data, slot, key]);
  const seconds = data?.duration ?? duration ?? 0;
  const unavailable = error && 'status' in error && error.status === 409
    ? 'Waveform generation failed; retry it in Tasks'
    : 'Waveform unavailable';
  return (
    <div className="track-waveform-preview" aria-label="Track waveform and hotcues">
      {src ? <img src={src} alt="" draggable={false} /> : (
        <span className="track-waveform-placeholder" title={isError || image?.key === key ? unavailable : 'Preparing waveform'} aria-hidden="true" />
      )}
      {Number.isFinite(seconds) && seconds > 0 && cues.filter(cue =>
        Number.isFinite(cue.time_seconds) && cue.time_seconds >= 0 && cue.time_seconds <= seconds
      ).map(cue => (
        <span
          key={cue.id}
          className="track-waveform-cue"
          title={`Hotcue ${cue.slot_number}${cue.label ? `: ${cue.label}` : ''} (${cue.time_seconds.toFixed(1)}s)`}
          style={{
            '--cue-position': `${cue.time_seconds / seconds * 100}%`,
            width: CUE_FLAG_PREVIEW_POLE_W, color: cueCssColor(cue.slot_number, cue.color),
          } as CSSProperties}
        ><i style={{ width: CUE_FLAG_PREVIEW_SIZE, height: CUE_FLAG_PREVIEW_SIZE }} /></span>
      ))}
    </div>
  );
});
