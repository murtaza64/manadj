import { useState } from 'react';
import TagManagementModal from './TagManagementModal';
import FindRelatedTracksModal from './FindRelatedTracksModal';
import { SearchIcon } from './icons';
import { type RelatedTracksSettings } from './TrackList';
import type { Track } from '../types';
import './GlobalControls.css';

interface GlobalControlsProps {
  selectedTrack: Track | null;
  onFindRelated: () => void;
  onApplySettings: (settings: RelatedTracksSettings) => void;
}

export default function GlobalControls({ selectedTrack, onFindRelated, onApplySettings }: GlobalControlsProps) {
  const [showManagementModal, setShowManagementModal] = useState(false);
  const [showRelatedModal, setShowRelatedModal] = useState(false);
  const [relatedModalPosition, setRelatedModalPosition] = useState<{ x: number; y: number } | undefined>(undefined);

  const handleQuickApply = () => {
    onFindRelated();
  };

  const handleOpenSettings = (e: React.MouseEvent<HTMLButtonElement>) => {
    setRelatedModalPosition({ x: e.clientX, y: e.clientY });
    setShowRelatedModal(true);
  };

  const handleApplySettings = (settings: RelatedTracksSettings) => {
    onApplySettings(settings);
  };

  return (
    <div className="global-controls">
      <button
        onClick={() => setShowManagementModal(true)}
        className="global-controls-btn"
      >
        Manage Tags
      </button>

      <div className="find-related-button-group">
        <button
          onClick={handleQuickApply}
          disabled={selectedTrack === null}
          className="global-controls-btn find-related-quick"
        >
          <SearchIcon width={14} height={14} opacity={1} />
          <span>Find Related</span>
        </button>

        <button
          onClick={handleOpenSettings}
          disabled={selectedTrack === null}
          className="global-controls-btn find-related-settings"
        >
          ⚙
        </button>
      </div>

      <TagManagementModal
        isOpen={showManagementModal}
        onClose={() => setShowManagementModal(false)}
      />

      <FindRelatedTracksModal
        isOpen={showRelatedModal}
        onClose={() => setShowRelatedModal(false)}
        selectedTrack={selectedTrack}
        onApply={handleApplySettings}
        openPosition={relatedModalPosition}
      />
    </div>
  );
}
