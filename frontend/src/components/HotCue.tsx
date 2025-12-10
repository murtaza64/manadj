import { useAudioContext } from '../contexts/AudioContext';
import { useSetHotCue, useDeleteHotCue } from '../hooks/useHotCues';
import type { HotCue as HotCueType } from '../types';
import './HotCue.css';

interface HotCueProps {
  slotNumber: number;  // 1-8
  trackId: number | null;
  hotCue: HotCueType | undefined;  // Hot cue data (undefined if not set)
}

export default function HotCue({ slotNumber, trackId, hotCue }: HotCueProps) {
  const audioContext = useAudioContext();
  const setHotCueMutation = useSetHotCue();
  const deleteHotCueMutation = useDeleteHotCue();

  const isSet = hotCue !== undefined;
  const isPreviewing = audioContext.hotCuePreviewing[slotNumber] || false;

  const handleMouseDown = () => {
    if (!trackId) return;

    if (!isSet) {
      // Hot cue not set: set it at current position
      const currentTime = audioContext.audioRef.current?.currentTime ?? 0;
      setHotCueMutation.mutate({
        trackId,
        slotNumber,
        data: { time_seconds: currentTime },
      });
    } else {
      // Hot cue is set: trigger playback behavior
      audioContext.handleHotCueDown(slotNumber, hotCue.time_seconds);
    }
  };

  const handleMouseUp = () => {
    if (!isSet || !trackId) return;
    audioContext.handleHotCueUp(slotNumber, hotCue.time_seconds);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isSet || !trackId) return;

    // Right-click: delete hot cue
    deleteHotCueMutation.mutate({ trackId, slotNumber });
  };

  const classNames = [
    'hot-cue',
    `cue-${slotNumber}`,
    isSet ? 'set' : 'unset',
    isPreviewing ? 'previewing' : '',
    !trackId ? 'disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={classNames}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}  // Also trigger on mouse leave
      onContextMenu={handleContextMenu}
      disabled={!trackId}
      title={
        !trackId
          ? 'No track loaded'
          : !isSet
            ? `Set Hot Cue ${slotNumber} (${slotNumber})`
            : `Hot Cue ${slotNumber} @ ${hotCue.time_seconds.toFixed(2)}s (${slotNumber} to trigger, Shift+${slotNumber} to delete)`
      }
      style={{
        backgroundColor: isSet && hotCue.color ? hotCue.color : undefined,
      }}
    >
      {slotNumber}
    </button>
  );
}
