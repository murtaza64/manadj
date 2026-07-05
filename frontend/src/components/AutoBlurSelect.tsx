/**
 * A <select> that hands keyboard focus back after use (keyboard-focus 01,
 * PRD decision 3). Selects can't ride the global no-focus rule — killing
 * their mousedown stops the native picker from opening — so instead the
 * element blurs itself on change and on Escape. Space then reaches the
 * transport hubs again right after picking an option.
 *
 * Modal selects (SaveTemplateModal) stay plain <select>s: focus inside a
 * modal is fine, and the editor's capture handler exempts SELECT anyway.
 */
import type { SelectHTMLAttributes } from 'react';

export function AutoBlurSelect({
  onChange,
  onKeyDown,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      onChange={(e) => {
        onChange?.(e);
        e.currentTarget.blur();
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === 'Escape') {
          // Escape = "give me my keyboard back": blur, and keep the
          // event from reaching view hubs (e.g. the staged filter-clear).
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
    />
  );
}
