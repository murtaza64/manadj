// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RootErrorBoundary from './RootErrorBoundary';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cleanup: Array<() => void> = [];

afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn());
  vi.restoreAllMocks();
});

function render(children: React.ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<RootErrorBoundary>{children}</RootErrorBoundary>);
  });
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function RenderBomb(): never {
  throw new Error('kaboom from render');
}

function EffectBomb() {
  useEffect(() => {
    throw new Error('kaboom from effect');
  }, []);
  return <div>fine until the effect runs</div>;
}

describe('RootErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    const container = render(<div data-testid="child">all good</div>);
    expect(container.textContent).toContain('all good');
    expect(container.querySelector('.crash-panel')).toBeNull();
  });

  it('shows the crash panel on a render error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = render(<RenderBomb />);
    const panel = container.querySelector('.crash-panel');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('manadj crashed');
    expect(panel!.textContent).toContain('kaboom from render');
    // component stack names the throwing component
    expect(panel!.textContent).toContain('RenderBomb');
    expect(panel!.querySelector('.crash-panel-reload')).not.toBeNull();
  });

  it('shows the crash panel on an effect error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = render(<EffectBomb />);
    const panel = container.querySelector('.crash-panel');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain('kaboom from effect');
  });

  it('reload button calls window.location.reload', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      writable: true,
    });
    const container = render(<RenderBomb />);
    const button = container.querySelector<HTMLButtonElement>('.crash-panel-reload')!;
    act(() => button.click());
    expect(reload).toHaveBeenCalled();
  });
});
