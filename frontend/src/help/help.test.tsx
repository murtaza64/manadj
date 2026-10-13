// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Modal from '../components/Modal';
import { hasKeyboardOverlay, isGuardedKeyEvent } from '../components/performance/performanceKeys';
import { SetupOverlay } from '../setup/SetupOverlay';
import { SetupSequence } from '../setup/SetupSequence';
import { guideStatus, type SetupGuide } from '../setup/guides';
import { HelpLink } from './HelpLink';
import { HelpViewer } from './HelpViewer';
import { closeHelp, helpSnapshot, isHelpOpen, openHelp } from './helpStore';
import { HELP_TOPICS, helpHref, isManualUrl } from './routes';
import { GUIDE_HELP, SETTINGS_HELP, TOUR_SECTION_HELP, TOUR_STEP_HELP } from './contexts';
import { TOUR_SECTIONS } from '../tour/steps';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../settings/persistedSettings', () => ({
  writeSetting: (key: string, value: string) => localStorage.setItem(key, value),
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => closeHelp());
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function key(target: EventTarget, value: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); });
  return event;
}

function loadArticle(html = '<a href="#main">First</a><video controls tabindex="0"></video><a href="../index.html">Last</a>') {
  const frame = document.querySelector<HTMLIFrameElement>('.help-frame')!;
  const doc = frame.contentDocument!;
  // jsdom does not fetch the iframe; model each same-origin document load.
  doc.open();
  doc.write(`<html><body>${html}</body></html>`);
  doc.close();
  act(() => frame.dispatchEvent(new Event('load')));
  return { frame, doc };
}

function clickLink(link: HTMLAnchorElement, init: MouseEventInit = {}, type = 'click') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  // Observe native navigation before suppressing jsdom's unimplemented default.
  let prevented = false;
  link.addEventListener(type, () => { prevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
  act(() => { link.dispatchEvent(event); });
  return prevented;
}

describe('Help routes and contexts', () => {
  it('uses the generated manifest with root and nested deployment bases', () => {
    expect(HELP_TOPICS.map(({ slug }) => slug)).toEqual([
      'start', 'acquire', 'curate', 'analysis', 'perform', 'controllers', 'audio',
      'beat-fx', 'follow', 'capture', 'editor', 'sets', 'sync',
    ]);
    expect(helpHref()).toBe('/manual/help/index.html');
    expect(helpHref('perform', 'keyboard', '/app/')).toBe('/app/manual/help/perform/index.html#keyboard');
    for (const article of HELP_TOPICS) {
      expect(helpHref(article.slug)).toBe(`/manual/help/${article.slug}/index.html`);
      for (const anchor of article.anchors) expect(helpHref(article.slug, anchor)).toContain(`#${anchor}`);
    }
  });

  it('rejects unknown topics, invalid anchors and path/URL injection without opening', () => {
    for (const topic of ['missing', '../start', '/start', 'https://example.com', 'start?x', '%2e%2e']) {
      expect(helpHref(topic)).toBeNull();
      expect(openHelp(topic)).toBe(false);
    }
    expect(helpHref('start', 'missing')).toBeNull();
    expect(helpHref('start', 'setup#tour')).toBeNull();
    expect(helpHref(undefined, 'setup')).toBeNull();
    expect(isHelpOpen()).toBe(false);
    act(() => { openHelp('start', 'setup'); });
    const before = helpSnapshot();
    expect(openHelp('start', 'missing')).toBe(false);
    expect(helpSnapshot()).toBe(before);
  });

  it('confines native navigation to the bundled manual, including the tour and clips', () => {
    const base = '/app/';
    const origin = 'http://localhost:5173/app/';
    for (const path of ['help/start/index.html#setup', 'index.html#editor', 'media/editor.mp4']) {
      expect(isManualUrl(`/app/manual/${path}`, base, origin)).toBe(true);
    }
    for (const path of ['/app/', '/app/manual-escape/x', '/app/manual/../../', '/app/manual/%2e%2e/x',
      '/app/manual/%2f..%2fx', 'https://example.com/app/manual/help/index.html', 'javascript:alert(1)']) {
      expect(isManualUrl(path, base, origin), path).toBe(false);
    }
  });

  it('keeps all Settings, guide, section and step mappings valid against the manifest', () => {
    for (const map of [SETTINGS_HELP, GUIDE_HELP, TOUR_SECTION_HELP, TOUR_STEP_HELP]) {
      for (const [context, target] of Object.entries(map)) {
        expect(target.topic, context).toBeDefined();
        expect(helpHref(target.topic, target.anchor), context).not.toBeNull();
      }
    }
    for (const section of TOUR_SECTIONS) {
      expect(TOUR_SECTION_HELP[section.id]).toBeDefined();
      for (const step of section.steps) expect(TOUR_STEP_HELP[step.anchor], step.anchor).toBeDefined();
    }
  });
});

describe('Help viewer', () => {
  it.each(['metaKey', 'ctrlKey'] as const)('isolates %s undo from document capture and restores shortcuts after closing', (modifier) => {
    let undoCount = 0;
    let releaseCount = 0;
    const undo = (event: KeyboardEvent) => {
      if (event[modifier] && event.key === 'z') undoCount++;
    };
    const release = (event: KeyboardEvent) => {
      if (event[modifier] && event.key === 'z') releaseCount++;
    };
    // Register before Help mounts, like the underlying Mix editor.
    document.addEventListener('keydown', undo, true);
    document.addEventListener('keyup', release, true);
    const press = (target: EventTarget) => {
      for (const type of ['keydown', 'keyup']) {
        const event = new KeyboardEvent(type, { key: 'z', [modifier]: true, bubbles: true, cancelable: true });
        act(() => { target.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(false);
      }
    };
    try {
      act(() => root.render(<HelpViewer />));
      act(() => { openHelp(); });
      const { doc } = loadArticle();
      for (const target of [document, document.querySelector('.help-toolbar button')!, doc.querySelector('a')!]) press(target);
      expect(undoCount).toBe(0);
      expect(releaseCount).toBe(0);
      act(() => closeHelp());
      press(document);
      expect(undoCount).toBe(1);
      expect(releaseCount).toBe(1);
    } finally {
      document.removeEventListener('keydown', undo, true);
      document.removeEventListener('keyup', release, true);
    }
  });

  it('leaves button activation, selection, copy and scrolling defaults uncanceled', () => {
    act(() => root.render(<HelpViewer />));
    act(() => { openHelp('perform'); });
    const index = document.querySelector<HTMLButtonElement>('.help-toolbar button')!;
    index.focus();
    for (const init of [{ key: ' ' }, { key: 'Enter' }, { key: 'ArrowDown', shiftKey: true },
      { key: 'PageDown' }, { key: 'a', metaKey: true }, { key: 'c', metaKey: true },
      { key: 'a', ctrlKey: true }, { key: 'c', ctrlKey: true }]) {
      for (const type of ['keydown', 'keyup']) {
        const event = new KeyboardEvent(type, { ...init, bubbles: true, cancelable: true });
        act(() => { index.dispatchEvent(event); });
        expect(event.defaultPrevented, `${type}: ${init.key}`).toBe(false);
      }
    }
    // jsdom cannot synthesize keyboard default clicks; verify the click path too.
    act(() => index.click());
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('/manual/help/index.html');
    act(() => document.querySelector<HTMLButtonElement>('.help-panel .modal-x')!.click());
    expect(isHelpOpen()).toBe(false);
  });

  it('traps focus across iframe boundaries, supports video keys, and restores its opener', () => {
    act(() => root.render(<><HelpLink topic="perform" anchor="keyboard" /><HelpViewer /></>));
    const opener = host.querySelector('button')!;
    act(() => opener.click());
    expect(hasKeyboardOverlay()).toBe(true);
    expect(isGuardedKeyEvent(new KeyboardEvent('keydown', { key: 'd' }))).toBe(true);
    const close = document.querySelector<HTMLButtonElement>('.help-panel .modal-x')!;
    const index = document.querySelector<HTMLButtonElement>('.help-toolbar button')!;
    expect(document.activeElement).toBe(close);
    const { frame, doc } = loadArticle();
    const [first, last] = [...doc.querySelectorAll('a')];
    index.focus();
    key(index, 'Tab');
    expect(document.activeElement).toBe(frame);
    expect(doc.activeElement).toBe(first);
    key(first, 'Tab', true);
    expect(document.activeElement).toBe(index);
    close.focus();
    key(close, 'Tab', true);
    expect(doc.activeElement).toBe(last);
    key(last, 'Tab');
    expect(document.activeElement).toBe(close);
    const leaked = vi.fn();
    document.addEventListener('keydown', leaked);
    const video = doc.querySelector('video')!;
    video.focus();
    expect(key(video, ' ').defaultPrevented).toBe(false);
    expect(key(video, 'ArrowRight').defaultPrevented).toBe(false);
    expect(leaked).not.toHaveBeenCalled();
    document.removeEventListener('keydown', leaked);
    key(video, 'Escape');
    expect(document.querySelector('.help-panel')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it.each(['parent', 'iframe'])('Escape from %s closes only Help above nested Settings/Setup and retains draft/state', (source) => {
    const settingsClose = vi.fn();
    const setupClose = vi.fn();
    const finish = vi.fn();
    function Draft() {
      const [value, setValue] = useState('');
      return <input aria-label="Account draft" value={value} onInput={(event) => setValue(event.currentTarget.value)} />;
    }
    const guide: SetupGuide = { id: 'soundcloud', title: 'SoundCloud', order: 1, status: () => guideStatus('soundcloud'), Component: Draft };
    act(() => root.render(<>
      <Modal title="Settings" onClose={settingsClose}>
        <SetupOverlay onClose={setupClose}><SetupSequence guides={[guide]} onFinish={finish} /></SetupOverlay>
      </Modal>
      <HelpViewer />
    </>));
    const input = host.querySelector('input')!;
    act(() => {
      input.value = 'unsaved account';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const opener = host.querySelector<HTMLButtonElement>('[data-help-link]')!;
    act(() => opener.click());
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('/manual/help/start/index.html#accounts');
    const { doc } = loadArticle();
    const first = doc.querySelector('a')!;
    first.focus();
    // Underlying Setup's document trap must not steal Help's Tab.
    key(first, 'Tab', true);
    expect(document.activeElement).toBe(document.querySelector('.help-toolbar button'));
    key(source === 'iframe' ? first : document, 'Escape');
    expect(isHelpOpen()).toBe(false);
    expect(settingsClose).not.toHaveBeenCalled();
    expect(setupClose).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(host.querySelector('input')).toBe(input);
    expect(input.value).toBe('unsaved account');
    expect(guideStatus('soundcloud')).toBe('not-started');
    expect(host.querySelector('[aria-current="step"]')?.textContent).toContain('SoundCloud');
    expect(document.activeElement).toBe(opener);
  });

  it('keeps native manual links in-frame and rebinds each loaded document', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    act(() => root.render(<HelpViewer />));
    act(() => { openHelp('perform'); });
    const { frame, doc } = loadArticle('<a href="../editor/index.html#editing" target="_top" download>Article</a><a href="#keyboard">Section</a>');
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    const [article, section] = [...doc.querySelectorAll('a')];
    expect(clickLink(article)).toBe(false);
    expect(article.target).toBe('_self');
    expect(article.hasAttribute('download')).toBe(false);
    expect(clickLink(section)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    const next = loadArticle('<a href="#main">New document</a>');
    expect(clickLink(next.doc.querySelector('a')!)).toBe(false);
    key(next.doc.querySelector('a')!, 'Escape');
    expect(isHelpOpen()).toBe(false);
  });

  it.each([
    ['https://github.com/murtaza64/manadj/releases/latest', {}, 'click'],
    ['https://soundcloud.com/', { ctrlKey: true }, 'click'],
    ['https://github.com/murtaza64/manadj', { metaKey: true }, 'click'],
    ['http://example.com/download', { button: 1 }, 'auxclick'],
  ] as const)('opens safe external link %s from the parent window', (href, init, type) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    act(() => root.render(<HelpViewer />));
    act(() => { openHelp('start'); });
    const { doc, frame } = loadArticle(`<a href="${href}" target="_top"><span>External</span></a>`);
    const frameOpen = vi.spyOn(frame.contentWindow!, 'open').mockReturnValue(null);
    const event = new MouseEvent(type, { ...init, bubbles: true, cancelable: true });
    act(() => { doc.querySelector('span')!.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledExactlyOnceWith(href, '_blank', 'noopener,noreferrer');
    expect(frameOpen).not.toHaveBeenCalled();
    expect(frame.getAttribute('src')).toBe('/manual/help/start/index.html');
    expect(isHelpOpen()).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/manual.html', 'mailto:hello@example.com', 'custom:launch', 'https://[invalid'])('blocks unsafe or unknown URL %s', (href) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    act(() => root.render(<HelpViewer />));
    act(() => { openHelp(); });
    const { doc } = loadArticle(`<a href="${href}">Blocked</a>`);
    expect(clickLink(doc.querySelector('a')!)).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not open an external link on right-click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    act(() => root.render(<HelpViewer />));
    act(() => { openHelp(); });
    const { doc } = loadArticle('<a href="https://github.com/">External</a>');
    expect(clickLink(doc.querySelector('a')!, { button: 2 }, 'auxclick')).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('can return to the index after native navigation even when the initial route was the index', () => {
    act(() => root.render(<><HelpLink /><HelpViewer /></>));
    const opener = host.querySelector('button')!;
    act(() => opener.click());
    const before = document.querySelector('iframe')!;
    const index = document.querySelector<HTMLButtonElement>('.help-toolbar button')!;
    act(() => index.click());
    const after = document.querySelector('iframe')!;
    expect(after).not.toBe(before);
    expect(after.getAttribute('src')).toBe('/manual/help/index.html');
    act(() => document.querySelector<HTMLButtonElement>('.help-panel .modal-x')!.click());
    expect(document.activeElement).toBe(opener);
  });
});
