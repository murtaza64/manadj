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

describe('Help routes and contexts', () => {
  it('uses the generated manifest with root and nested deployment bases', () => {
    expect(HELP_TOPICS).toHaveLength(13);
    expect(helpHref()).toBe('/manual/help/index.html');
    expect(helpHref('controllers', 'check', '/app/')).toBe('/app/manual/help/controllers/index.html#check');
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

  it('confines native navigation to the bundled manual, including glossary and clips', () => {
    const base = '/app/';
    const origin = 'http://localhost:5173/app/';
    for (const path of ['help/start/index.html#setup', 'index.html#words', 'media/editor.mp4']) {
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
        expect(target.topic, context).toBeTruthy();
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
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('/manual/help/acquire/index.html#soundcloud');
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

  it('keeps native manual links in-frame, blocks app/external links and rebinds each loaded document', () => {
    act(() => root.render(<HelpViewer />));
    act(() => { openHelp('perform'); });
    const { frame, doc } = loadArticle('<a href="../editor/index.html#editing" target="_top">Article</a><a href="/">App</a><a href="https://example.com">External</a>');
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    const [article, app, external] = [...doc.querySelectorAll('a')];
    const click = (link: HTMLAnchorElement) => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      // Observe whether the viewer allows native navigation, then stop jsdom's
      // unimplemented navigation default after that capture listener has run.
      let prevented = false;
      link.addEventListener('click', () => { prevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
      act(() => link.dispatchEvent(event));
      return prevented;
    };
    expect(click(article)).toBe(false);
    expect(article.target).toBe('_self');
    expect(click(app)).toBe(true);
    expect(click(external)).toBe(true);
    const next = loadArticle('<a href="#main">New document</a>');
    key(next.doc.querySelector('a')!, 'Escape');
    expect(isHelpOpen()).toBe(false);
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
