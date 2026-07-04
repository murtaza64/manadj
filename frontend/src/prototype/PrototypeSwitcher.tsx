// PROTOTYPE — wipe me. Floating variant switcher for prototype pages
// (waveform-overhaul). Cycles style variants; ←/→ keys or arrows.

import { useEffect } from 'react';

interface Props {
  variants: { id: string; name: string }[];
  current: string;
  onChange: (id: string) => void;
}

export function PrototypeSwitcher({ variants, current, onChange }: Props) {
  const idx = Math.max(0, variants.findIndex((v) => v.id === current));

  const cycle = (d: number) => {
    onChange(variants[(idx + d + variants.length) % variants.length].id);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="proto-switcher">
      <button onClick={() => cycle(-1)} aria-label="previous variant">◀</button>
      <span>
        {variants[idx].id} — {variants[idx].name}
      </span>
      <button onClick={() => cycle(1)} aria-label="next variant">▶</button>
    </div>
  );
}
