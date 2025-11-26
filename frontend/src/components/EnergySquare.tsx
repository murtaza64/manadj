import './EnergySquare.css';

interface EnergySquareProps {
  level: number;           // 1-5
  filled: boolean;         // Whether square is filled/selected
  onClick?: () => void;    // Optional click handler
  onMouseDown?: () => void; // Optional mouse down handler
  disabled?: boolean;      // Disabled state
  showNumber?: boolean;    // Whether to show number (default true)
}

export default function EnergySquare({
  level,
  filled,
  onClick,
  onMouseDown,
  disabled = false,
  showNumber = true
}: EnergySquareProps) {
  const classNames = [
    'energy-square',
    `level-${level}`,
    filled ? 'filled' : 'unfilled',
    (onClick || onMouseDown) ? 'clickable' : '',
    disabled ? 'disabled' : ''
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classNames}
      onClick={disabled ? undefined : onClick}
      onMouseDown={disabled ? undefined : onMouseDown}
    >
      {showNumber ? level : null}
    </div>
  );
}
