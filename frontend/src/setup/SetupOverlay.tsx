/** Modal chrome for Setup guides and the sequence (First run, Settings
 * relaunch). Wears `data-tour-suppress` so the feature tour waits until
 * setup is out of the way (TourController). */
import type { ReactNode } from 'react';
import './setup.css';

export function SetupOverlay({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="setup-overlay" data-tour-suppress="" data-testid={testId}>
      <div className="setup-panel">{children}</div>
    </div>
  );
}
