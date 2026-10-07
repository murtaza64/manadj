// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TagPopover } from './TagPopover';
import type { Track } from '../../types';

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }));
vi.mock('../../api/client', () => ({ api: { tags: { listAll: vi.fn() } } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('Manage… hands off to the full tag editor', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const anchorRef = createRef<HTMLDivElement>();
  const onManage = vi.fn();
  const track = { id: 1, tags: [] } as unknown as Track;
  try {
    act(() => root.render(
      <div ref={anchorRef}>
        <TagPopover track={track} anchorRef={anchorRef} commit={vi.fn()} onClose={vi.fn()} onManage={onManage} />
      </div>
    ));
    const manage = host.querySelector<HTMLButtonElement>('.perf-tagpop-manage')!;
    expect(manage.textContent).toBe('Manage…');
    act(() => manage.click());
    expect(onManage).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
