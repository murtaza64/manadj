import { useEffect, useState } from 'react';
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

const MAJOR_KEYS_ORDER: KeyInfo[] = [
  { openKey: '1d', musicalKey: 'C', position: 0 },
  { openKey: '2d', musicalKey: 'G', position: 1 },
  { openKey: '3d', musicalKey: 'D', position: 2 },
  { openKey: '4d', musicalKey: 'A', position: 3 },
  { openKey: '5d', musicalKey: 'E', position: 4 },
  { openKey: '6d', musicalKey: 'B', position: 5 },
  { openKey: '7d', musicalKey: 'F#', position: 6 },
  { openKey: '8d', musicalKey: 'Db', position: 7 },
  { openKey: '9d', musicalKey: 'Ab', position: 8 },
  { openKey: '10d', musicalKey: 'Eb', position: 9 },
  { openKey: '11d', musicalKey: 'Bb', position: 10 },
  { openKey: '12d', musicalKey: 'F', position: 11 },
];

const MINOR_KEYS_ORDER: KeyInfo[] = [
  { openKey: '1m', musicalKey: 'Am', position: 0 },
  { openKey: '2m', musicalKey: 'Em', position: 1 },
  { openKey: '3m', musicalKey: 'Bm', position: 2 },
  { openKey: '4m', musicalKey: 'F#m', position: 3 },
  { openKey: '5m', musicalKey: 'C#m', position: 4 },
  { openKey: '6m', musicalKey: 'G#m', position: 5 },
  { openKey: '7m', musicalKey: 'D#m', position: 6 },
  { openKey: '8m', musicalKey: 'Bbm', position: 7 },
  { openKey: '9m', musicalKey: 'Fm', position: 8 },
  { openKey: '10m', musicalKey: 'Cm', position: 9 },
  { openKey: '11m', musicalKey: 'Gm', position: 10 },
  { openKey: '12m', musicalKey: 'Dm', position: 11 },
];

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

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
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
