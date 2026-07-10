import { useEffect, useState } from 'react';
import { KEY_TABLE } from '../utils/keyTable.generated';
import './CircleOfFifthsModal.css';

interface KeyInfo {
  openKey: string;      // "1d", "5m", etc.
  musicalKey: string;   // "C", "Am", etc.
  position: number;     // 0-11 (clock position)
}

interface CircleOfFifthsModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedKeys: Set<string>;
  onToggleKey: (key: string) => void;
  onClearAll: () => void;
  openPosition?: { x: number; y: number };
}

// The two rings are projections of the generated key table (the single Key
// authority). Clock position is the OpenKey number minus one (1d/1m → 12
// o'clock); the ring is chosen by the OpenKey suffix (d = major, m = minor).
const buildRing = (suffix: 'd' | 'm'): KeyInfo[] =>
  KEY_TABLE.filter((row) => row.openkey.endsWith(suffix))
    .map((row) => ({
      openKey: row.openkey,
      musicalKey: row.musical,
      position: parseInt(row.openkey) - 1,
    }))
    .sort((a, b) => a.position - b.position);

const MAJOR_KEYS_ORDER: KeyInfo[] = buildRing('d');
const MINOR_KEYS_ORDER: KeyInfo[] = buildRing('m');

const createWedgePath = (
  innerRadius: number,
  outerRadius: number,
  position: number
): string => {
  // Each wedge is 30° (360° / 12 positions)
  const startAngle = position * 30 - 90;  // -90 to start at 12 o'clock
  const endAngle = startAngle + 30;

  // Convert to radians
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;

  // Calculate 4 corner points
  const outerStart = {
    x: outerRadius * Math.cos(startRad),
    y: outerRadius * Math.sin(startRad),
  };
  const outerEnd = {
    x: outerRadius * Math.cos(endRad),
    y: outerRadius * Math.sin(endRad),
  };
  const innerStart = {
    x: innerRadius * Math.cos(startRad),
    y: innerRadius * Math.sin(startRad),
  };
  const innerEnd = {
    x: innerRadius * Math.cos(endRad),
    y: innerRadius * Math.sin(endRad),
  };

  // SVG path: outer arc, line to inner, inner arc back, close
  return `
    M ${outerStart.x} ${outerStart.y}
    A ${outerRadius} ${outerRadius} 0 0 1 ${outerEnd.x} ${outerEnd.y}
    L ${innerEnd.x} ${innerEnd.y}
    A ${innerRadius} ${innerRadius} 0 0 0 ${innerStart.x} ${innerStart.y}
    Z
  `;
};

const getLabelPosition = (
  innerRadius: number,
  outerRadius: number,
  position: number
) => {
  const labelRadius = (innerRadius + outerRadius) / 2;  // Center of ring
  // Add 15° to center the label within the 30° wedge
  const angle = ((position * 30 + 15) * Math.PI) / 180;
  return {
    x: labelRadius * Math.sin(angle),
    y: -labelRadius * Math.cos(angle),  // Negative for SVG coordinates
  };
};

export default function CircleOfFifthsModal({
  isOpen,
  onClose,
  selectedKeys,
  onToggleKey,
  onClearAll,
  openPosition,
}: CircleOfFifthsModalProps) {
  // Clamp modal position to viewport bounds
  const getClampedPosition = (pos: { x: number; y: number }) => {
    // Circle of fifths modal dimensions (SVG + footer)
    const modalWidth = 520;
    const modalHeight = 580;
    const padding = 20;

    // Clamp x position
    const minX = modalWidth / 2 + padding;
    const maxX = window.innerWidth - modalWidth / 2 - padding;
    const clampedX = Math.max(minX, Math.min(maxX, pos.x));

    // Clamp y position
    const minY = modalHeight / 2 + padding;
    const maxY = window.innerHeight - modalHeight / 2 - padding;
    const clampedY = Math.max(minY, Math.min(maxY, pos.y));

    return { x: clampedX, y: clampedY };
  };

  const rawPosition = openPosition || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const modalPosition = getClampedPosition(rawPosition);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Handle ESC key — capture + stopPropagation: a modal's Escape must beat
  // the staged search-clear and the view hubs (keyboard-focus 02).
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc, { capture: true });
    return () => document.removeEventListener('keydown', handleEsc, { capture: true });
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const renderKeySegment = (
    keyInfo: KeyInfo,
    innerRadius: number,
    outerRadius: number
  ) => {
    const isSelected = selectedKeys.has(keyInfo.openKey);
    const isHovered = hoveredKey === keyInfo.openKey;

    const path = createWedgePath(innerRadius, outerRadius, keyInfo.position);
    const labelPos = getLabelPosition(innerRadius, outerRadius, keyInfo.position);

    let segmentClass = 'cof-key-segment';
    if (isSelected) {
      segmentClass += ' selected';
    } else if (isHovered) {
      segmentClass += ' hovered';
    } else {
      segmentClass += ' unselected';
    }

    return (
      <g key={keyInfo.openKey}>
        <path
          d={path}
          className={segmentClass}
          onClick={() => onToggleKey(keyInfo.openKey)}
          onMouseEnter={() => setHoveredKey(keyInfo.openKey)}
          onMouseLeave={() => setHoveredKey(null)}
        />
        <text
          x={labelPos.x}
          y={labelPos.y}
          className="cof-key-label"
        >
          {keyInfo.openKey} ({keyInfo.musicalKey})
        </text>
      </g>
    );
  };

  return (
    <div
      className="cof-modal-overlay"
      onClick={onClose}
      style={{
        '--blur-center-x': `${modalPosition.x}px`,
        '--blur-center-y': `${modalPosition.y}px`,
      } as React.CSSProperties}
    >
      <div
        className="cof-modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: `${modalPosition.x}px`,
          top: `${modalPosition.y}px`,
          transform: 'translate(-50%, -45%)',
        }}
      >
        <svg viewBox="-200 -200 400 400" className="cof-svg">
          {/* Major keys (outer ring) */}
          {MAJOR_KEYS_ORDER.map((key) => renderKeySegment(key, 140, 180))}
          {/* Minor keys (inner ring) */}
          {MINOR_KEYS_ORDER.map((key) => renderKeySegment(key, 90, 130))}
        </svg>

        <div className="cof-modal-footer">
          <span style={{ color: 'var(--text)', fontSize: '14px' }}>
            {selectedKeys.size} {selectedKeys.size === 1 ? 'key' : 'keys'} selected
          </span>
          <button onClick={onClearAll} className="cof-clear-btn">
            Clear All
          </button>
          <button onClick={onClose} className="cof-clear-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
