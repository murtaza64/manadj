import type { ReactNode } from 'react';
import { openHelp } from './helpStore';
import type { HelpTarget } from './routes';

export function HelpLink({ topic, anchor, children = 'Help', label }: HelpTarget & { children?: ReactNode; label?: string }) {
  return <button type="button" className="btn btn-secondary btn-mini" data-help-link=""
    aria-label={label} onClick={(event) => {
      // Pointer activation need not focus buttons elsewhere in the app; Help
      // explicitly remembers this opener for its nested-modal return path.
      event.currentTarget.focus();
      openHelp(topic, anchor);
    }}>{children}</button>;
}
