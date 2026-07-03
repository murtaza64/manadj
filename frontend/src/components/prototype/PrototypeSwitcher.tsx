/* eslint-disable react-refresh/only-export-components -- throwaway prototype */
import { useEffect, useState } from 'react';

/**
 * PROTOTYPE — floating variant switcher (dev-only). Delete with the
 * prototype it serves.
 */
export function PrototypeSwitcher({
  variants,
  current,
  onChange,
  labels = {},
}: {
  variants: string[];
  current: string;
  onChange: (v: string) => void;
  labels?: Record<string, string>;
}) {
  const index = Math.max(0, variants.indexOf(current));

  const cycle = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    onChange(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') cycle(-1);
      else if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, variants]);

  if (!import.meta.env.DEV) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        borderRadius: 999,
        background: '#ff2d95',
        color: '#11111b',
        fontWeight: 700,
        fontSize: 13,
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        userSelect: 'none',
      }}
    >
      <button onClick={() => cycle(-1)} style={pillButton}>←</button>
      <span>
        {current}
        {labels[current] ? ` — ${labels[current]}` : ''}
      </span>
      <button onClick={() => cycle(1)} style={pillButton}>→</button>
    </div>
  );
}

const pillButton: React.CSSProperties = {
  background: '#11111b',
  color: '#ff2d95',
  border: 'none',
  borderRadius: 999,
  width: 26,
  height: 26,
  cursor: 'pointer',
  fontWeight: 700,
};

/** URL-search-param state without a router (`history.replaceState`). */
export function useVariantParam(defaultVariant: string): [string, (v: string) => void] {
  const [variant, setVariant] = useState<string>(() => {
    return new URLSearchParams(window.location.search).get('variant') ?? defaultVariant;
  });

  const set = (v: string) => {
    const url = new URL(window.location.href);
    if (v === defaultVariant) url.searchParams.delete('variant');
    else url.searchParams.set('variant', v);
    window.history.replaceState(null, '', url);
    setVariant(v);
  };

  return [variant, set];
}
