import './HotCue.css';

interface HotCueProps {
  number: number;        // 1-8
  isSet: boolean;        // Whether hot cue is set
  onClick?: () => void;  // Optional click handler
  disabled?: boolean;    // Disabled state
}

export default function HotCue({
  number,
  isSet,
  onClick,
  disabled = false
}: HotCueProps) {
  const classNames = [
    'hot-cue',
    `cue-${number}`,
    isSet ? 'set' : 'unset',
    onClick ? 'clickable' : '',
    disabled ? 'disabled' : ''
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classNames}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={`Hot Cue ${number}`}
    >
      {number}
    </button>
  );
}
