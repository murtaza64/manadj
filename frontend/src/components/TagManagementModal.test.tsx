// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TagManagementModal from './TagManagementModal';
import { hasKeyboardOverlay } from './performance/performanceKeys';

const tagsApi = vi.hoisted(() => ({
  listCategories: vi.fn(),
  listAll: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('../api/client', () => ({ api: { tags: tagsApi } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CATEGORIES = [
  { id: 1, name: 'Genre', display_order: 0, color: null },
  { id: 2, name: 'Mood', display_order: 4, color: null },
];
const TAGS = [
  { id: 10, name: 'House', category_id: 1, color: '#ff0000', display_order: 0, track_count: 3 },
  { id: 11, name: 'Dark', category_id: 2, color: '#00ff00', display_order: 0, track_count: 1 },
];

let host: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn<() => void>>;

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(async () => {
  tagsApi.listCategories.mockResolvedValue(CATEGORIES);
  tagsApi.listAll.mockResolvedValue(TAGS);
  tagsApi.createCategory.mockResolvedValue({ id: 3, name: 'Energy', display_order: 5, color: null });
  tagsApi.deleteCategory.mockResolvedValue(undefined);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  onClose = vi.fn<() => void>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <TagManagementModal isOpen onClose={onClose} />
    </QueryClientProvider>
  ));
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const setInput = (input: HTMLInputElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

it('creates a Tag Category appended after the last display_order', async () => {
  const input = host.querySelector<HTMLInputElement>('[aria-label="New category name"]')!;
  setInput(input, '  Energy ');
  act(() => host.querySelector<HTMLButtonElement>('[title="Create category"]')!.click());
  await flush();
  expect(tagsApi.createCategory).toHaveBeenCalledWith({ name: 'Energy', display_order: 5 });
});

it('deletes a Tag Category after confirming, blocked while tag edits are pending', async () => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const del = host.querySelector<HTMLButtonElement>('[aria-label="Delete category Mood"]')!;
  act(() => del.click());
  await flush();
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('its 1 tag?'));
  expect(tagsApi.deleteCategory).toHaveBeenCalledWith(2);

  const nameInput = [...host.querySelectorAll<HTMLInputElement>('.tag-name-input')]
    .find((i) => i.value === 'House')!;
  setInput(nameInput, 'Tech House');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Delete category Genre"]')!.disabled).toBe(true);
});

it('suspends deck keys while open and closes on Escape ahead of document listeners', () => {
  expect(hasKeyboardOverlay()).toBe(true);
  const bubble = vi.fn();
  document.addEventListener('keydown', bubble);
  try {
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  } finally {
    document.removeEventListener('keydown', bubble);
  }
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(bubble).not.toHaveBeenCalled();
});
