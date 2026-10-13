import { useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';

/** Sliders apply live; typed numbers commit on blur/Enter, after intermediate signs/digits. */
export function CommittedNumberInput({
  value,
  onCommit,
  min,
  max,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'min' | 'max'
> & {
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        const text = event.target.value,
          next = Number(text);
        if (!cancelled.current && text.trim() !== '' && Number.isFinite(next))
          onCommit(Math.max(min, Math.min(max, next)));
        cancelled.current = false;
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          cancelled.current = event.key === 'Escape';
          event.currentTarget.blur();
        }
      }}
    />
  );
}
