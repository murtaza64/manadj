// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { ExternalDrivesSync } from './ExternalDrivesSync';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const DRIVE = {
  root: '/Volumes/REKORDBOX',
  kind: 'rekordbox' as const,
  name: 'REKORDBOX',
  track_count: 3,
  written_by_manadj: false,
};

const PREVIEW = {
  root: DRIVE.root,
  kind: 'rekordbox' as const,
  device_track_count: 3,
  new_count: 1,
  present_count: 1,
  uncertain_count: 1,
  duplicate_count: 0,
  missing_file_count: 1,
  default_destination: '/library',
  fingerprint: 'fp-test',
  entries: [
    {
      ordinal: 0,
      title: 'Bright Lights',
      artist: 'Lane 8',
      bpm: 174,
      key: 'Am',
      duration_secs: 362,
      device_path: '/Contents/track1.mp3',
      status: 'new' as const,
      detail: null,
    },
    {
      ordinal: 3,
      title: 'Name Twin',
      artist: null,
      bpm: null,
      key: null,
      duration_secs: null,
      device_path: '/Contents/twin.mp3',
      status: 'uncertain' as const,
      detail: 'a library track has this file name',
    },
  ],
};

const tick = () => new Promise((r) => setTimeout(r, 10));

function render() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);
  return { host, root, button };
}

it('lists detected drives and pulls only after the confirmed preview', async () => {
  const list = vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  const preview = vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(PREVIEW);
  const imp = vi.spyOn(api.externalDrives, 'import').mockResolvedValue({
    root: DRIVE.root,
    kind: 'rekordbox',
    destination: '/library',
    imported: 1,
    skipped_present: 1,
    skipped_uncertain: 1,
    skipped_duplicate: 0,
    skipped_missing_file: 1,
    errors: [],
    track_ids: [42],
  });
  const { host, root, button } = render();
  try {
    await act(async () => {
      root.render(<ExternalDrivesSync />);
      await tick();
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Rekordbox');
    expect(host.textContent).toContain('/Volumes/REKORDBOX');
    expect(host.textContent).toContain('3 tracks');

    await act(async () => {
      button('Pull…')!.click();
      await tick();
    });
    expect(preview).toHaveBeenCalledWith(DRIVE.root);
    expect(host.textContent).toContain('1 new · 1 already in library');
    expect(host.textContent).toContain('1 name-only match (not imported)');
    expect(host.textContent).toContain('Bright Lights');
    expect(host.textContent).toContain('Name Twin');

    // the confirm button carries the exact count and is not an import yet
    const confirm = button('Import 1 track')!;
    expect(confirm.disabled).toBe(false);
    expect(imp).not.toHaveBeenCalled();

    await act(async () => {
      confirm.click();
      await tick();
    });
    expect(imp).toHaveBeenCalledWith({
      root: DRIVE.root,
      destination: '/library',
      confirm: true,
      preview_fingerprint: 'fp-test',
    });
    expect(host.textContent).toContain('Imported from REKORDBOX');
    expect(host.textContent).toContain('1 added');
  } finally {
    act(() => root.unmount());
  }
});

it('never imports a plan the user did not review, even if the re-preview could bind it', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  // A track appears on the drive between the on-screen preview and the
  // Import click: the destination-binding re-preview sees it, but the
  // confirm must refuse to mint a fingerprint for an unseen plan.
  const changed = {
    ...PREVIEW,
    new_count: 2,
    entries: [
      ...PREVIEW.entries,
      {
        ordinal: 7,
        title: 'Added While Reviewing',
        artist: null,
        bpm: null,
        key: null,
        duration_secs: null,
        device_path: '/Contents/sneaky.mp3',
        status: 'new' as const,
        detail: null,
      },
    ],
  };
  vi.spyOn(api.externalDrives, 'preview')
    .mockResolvedValueOnce(PREVIEW)
    .mockResolvedValueOnce(changed);
  const imp = vi.spyOn(api.externalDrives, 'import').mockResolvedValue({
    root: DRIVE.root,
    kind: 'rekordbox',
    destination: '/library',
    imported: 0,
    skipped_present: 0,
    skipped_uncertain: 0,
    skipped_duplicate: 0,
    skipped_missing_file: 0,
    errors: [],
    track_ids: [],
  });
  const { host, root, button } = render();
  try {
    await act(async () => {
      root.render(<ExternalDrivesSync />);
      await tick();
    });
    await act(async () => {
      button('Pull…')!.click();
      await tick();
    });
    await act(async () => {
      button('Import 1 track')!.click();
      await tick();
    });
    expect(imp).not.toHaveBeenCalled();
    expect(host.textContent).toContain('changed since this preview');
    // the refreshed plan is on screen for explicit review
    expect(host.textContent).toContain('Added While Reviewing');
    expect(host.textContent).toContain('Import 2 tracks');
  } finally {
    act(() => root.unmount());
  }
});

it('keeps the confirm button disabled without a destination', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue({
    ...PREVIEW,
    default_destination: null,
  });
  const { root, button } = render();
  try {
    await act(async () => {
      root.render(<ExternalDrivesSync />);
      await tick();
    });
    await act(async () => {
      button('Pull…')!.click();
      await tick();
    });
    expect(button('Import 1 track')!.disabled).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});
