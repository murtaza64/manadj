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
  source_fingerprint: 'source-test',
  playlists: [],
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
      matched_path: null,
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
      matched_path: null,
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
    skipped_unselected: 0,
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
    expect(preview).toHaveBeenCalledWith(DRIVE.root, undefined, false);
    expect(host.textContent).toContain('1 no match found · 1 already in library');
    expect(host.textContent).toContain('1 unverified match (not imported)');
    expect(host.textContent).toContain('Bright Lights');
    expect(host.textContent).toContain('Name Twin');

    // the confirm button carries the exact count and is not an import yet
    const confirm = button('Import 1 selected')!;
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
      ordinals: [0],
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
        matched_path: null,
      },
    ],
  };
  vi.spyOn(api.externalDrives, 'preview')
    .mockResolvedValueOnce(PREVIEW) // fast metadata pass
    .mockResolvedValueOnce(PREVIEW) // verified pass
    .mockResolvedValueOnce(changed); // destination-binding re-preview
  const imp = vi.spyOn(api.externalDrives, 'import').mockResolvedValue({
    root: DRIVE.root,
    kind: 'rekordbox',
    destination: '/library',
    imported: 0,
    skipped_present: 0,
    skipped_uncertain: 0,
    skipped_duplicate: 0,
    skipped_missing_file: 0,
    skipped_unselected: 0,
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
      button('Import 1 selected')!.click();
      await tick();
    });
    expect(imp).not.toHaveBeenCalled();
    expect(host.textContent).toContain('changed since this preview');
    // the refreshed plan is on screen for explicit review
    expect(host.textContent).toContain('Added While Reviewing');
    expect(host.textContent).toContain('Import 2 selected');
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
    expect(button('Import 1 selected')!.disabled).toBe(true);
  } finally {
    act(() => root.unmount());
  }
});

it('shows verified renames with both file names, not a silent present', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue({
    ...PREVIEW,
    new_count: 0,
    present_count: 2,
    uncertain_count: 0,
    entries: [
      {
        ordinal: 0,
        title: 'Renamed Tune',
        artist: 'Lane 8',
        bpm: 128,
        key: '6m',
        duration_secs: 300,
        device_path: '/Contents/dj-edit-01.mp3',
        status: 'present' as const,
        detail: 'already in the manadj library (same audio under a different file name, content-verified)',
        matched_path: '/library/Renamed Tune.mp3',
      },
      {
        ordinal: 1,
        title: 'Same Name',
        artist: 'Lane 8',
        bpm: 174,
        key: 'Am',
        duration_secs: 362,
        device_path: '/Contents/track2.mp3',
        status: 'present' as const,
        detail: 'already in the manadj library (same audio, content-verified)',
        matched_path: '/music/track2.mp3',
      },
    ],
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
    expect(host.textContent).toContain('renamed, verified');
    expect(host.textContent).toContain('USB dj-edit-01.mp3');
    expect(host.textContent).toContain('library Renamed Tune.mp3');
    // a same-name verified match is a plain library row, not a rename
    expect(host.textContent).toContain('in library');
    expect(host.textContent).not.toContain('USB track2.mp3');
  } finally {
    act(() => root.unmount());
  }
});

it('labels unmatched tracks as no match found, not proven new', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(PREVIEW);
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
    expect(host.textContent).toContain('no match found');
    expect(host.textContent).toContain('unverified match');
  } finally {
    act(() => root.unmount());
  }
});

it('lists tracks metadata-first and unlocks import only after verification', async () => {
  // Fast pass: the same-name match is not yet content-verified, so the row
  // reads as checking and Import stays locked. When the verified pass
  // lands, the row refines and Import unlocks.
  const fast = {
    ...PREVIEW,
    new_count: 1,
    present_count: 0,
    uncertain_count: 2,
    entries: PREVIEW.entries.map((e) =>
      e.title === 'Bright Lights' ? e : { ...e, status: 'uncertain' as const }
    ),
  };
  let resolveFull: (p: typeof PREVIEW) => void = () => {};
  const fullCalled = new Promise<typeof PREVIEW>((res) => {
    resolveFull = res;
  });
  const preview = vi
    .spyOn(api.externalDrives, 'preview')
    .mockResolvedValueOnce(fast)
    .mockImplementationOnce(() => fullCalled);
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
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
    // metadata visible before verification finished
    expect(host.textContent).toContain('Bright Lights');
    expect(host.textContent).toContain('checking 2 possible matches');
    expect(host.textContent).toContain('checking…');
    expect(button('Checking matches…')!.disabled).toBe(true);
    expect(preview).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFull(PREVIEW);
      await tick();
    });
    expect(host.textContent).toContain('1 already in library');
    expect(button('Import 1 selected')!.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
  }
});

it('discards a verification result that lands after cancel', async () => {
  let resolveFull: (p: typeof PREVIEW) => void = () => {};
  const fullCalled = new Promise<typeof PREVIEW>((res) => {
    resolveFull = res;
  });
  vi.spyOn(api.externalDrives, 'preview')
    .mockResolvedValueOnce(PREVIEW)
    .mockImplementationOnce(() => fullCalled);
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
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
      button('Cancel')!.click();
      await tick();
    });
    await act(async () => {
      resolveFull(PREVIEW);
      await tick();
    });
    // the late verified preview must not resurrect the cancelled plan
    expect(host.textContent).not.toContain('Import 1 track');
    expect(button('Pull…')).toBeTruthy();
  } finally {
    act(() => root.unmount());
  }
});

it('imports only the checked tracks', async () => {
  const twoNew = {
    ...PREVIEW,
    new_count: 2,
    present_count: 0,
    uncertain_count: 0,
    entries: [
      { ...PREVIEW.entries[0] },
      {
        ordinal: 5,
        title: 'Second New',
        artist: 'Lane 8',
        bpm: 122,
        key: 'C',
        duration_secs: 318,
        device_path: '/Contents/d.mp3',
        status: 'new' as const,
        detail: null,
        matched_path: null,
      },
    ],
  };
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(twoNew);
  const imp = vi.spyOn(api.externalDrives, 'import').mockResolvedValue({
    root: DRIVE.root,
    kind: 'rekordbox',
    destination: '/library',
    imported: 1,
    skipped_present: 0,
    skipped_uncertain: 0,
    skipped_duplicate: 0,
    skipped_missing_file: 0,
    skipped_unselected: 1,
    errors: [],
    track_ids: [42],
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
    expect(button('Import 2 selected')).toBeTruthy();
    // uncheck Second New; only non-new rows lack a checkbox
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    await act(async () => {
      boxes[1].click();
      await tick();
    });
    await act(async () => {
      button('Import 1 selected')!.click();
      await tick();
    });
    expect(imp).toHaveBeenCalledWith(
      expect.objectContaining({ ordinals: [0] })
    );
    expect(host.textContent).toContain('1 added');
  } finally {
    act(() => root.unmount());
  }
});

const PLAYLIST_PREVIEW = {
  ...PREVIEW,
  playlists: [
    {
      id: 63,
      name: 'nov 7',
      folder_path: '',
      track_count: 61,
      new_count: 40,
      present_count: 20,
      uncertain_count: 1,
      other_count: 0,
      folder_not_representable: false,
      track_ordinals: [0, 1, 2],
      membership: null,
    },
  ],
};

const PLAYLIST_RESULT = {
  root: DRIVE.root,
  kind: 'rekordbox',
  destination: '/library',
  imported: 40,
  skipped_present: 0,
  skipped_uncertain: 0,
  skipped_duplicate: 0,
  skipped_missing_file: 0,
  skipped_unselected: 0,
  errors: [],
  track_ids: [42],
  playlist: {
    playlist_id: 7,
    name: 'nov 7',
    member_count: 60,
    imported: 40,
    already_in_library: 20,
    skipped_uncertain: 1,
    skipped_other: 0,
  },
};

it('imports a device playlist with its tracks in one confirmed click', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(PLAYLIST_PREVIEW);
  const imp = vi.spyOn(api.externalDrives, 'import').mockResolvedValue(PLAYLIST_RESULT);
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
    expect(host.textContent).toContain('Playlists on this drive');
    expect(host.textContent).toContain('nov 7');
    expect(host.textContent).toContain('61 tracks · 40 to import · 20 already in library');
    expect(host.textContent).toContain('1 unverified (skipped)');

    await act(async () => {
      button('Import playlist')!.click();
      await tick();
    });
    // the playlist defines the selection: no ordinals, device name kept
    expect(imp).toHaveBeenCalledWith({
      root: DRIVE.root,
      destination: '/library',
      confirm: true,
      preview_fingerprint: 'fp-test',
      create_playlist_id: 63,
    });
    expect(host.textContent).toContain(
      'Playlist "nov 7" created with 60 tracks in USB order'
    );
    expect(host.textContent).toContain('40 new files copied');
    expect(host.textContent).toContain('20 already in library');
    expect(host.textContent).toContain('1 unverified skipped');
  } finally {
    act(() => root.unmount());
  }
});

it('sends the edited local name instead of silently merging', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(PLAYLIST_PREVIEW);
  const imp = vi.spyOn(api.externalDrives, 'import').mockResolvedValue(PLAYLIST_RESULT);
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
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Local name for nov 7"]'
    )!;
    expect(input.value).toBe('nov 7');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )!.set!;
    await act(async () => {
      setter.call(input, 'nov 7 (USB)');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await tick();
    });
    await act(async () => {
      button('Import playlist')!.click();
      await tick();
    });
    expect(imp).toHaveBeenCalledWith({
      root: DRIVE.root,
      destination: '/library',
      confirm: true,
      preview_fingerprint: 'fp-test',
      create_playlist_id: 63,
      playlist_name: 'nov 7 (USB)',
    });
  } finally {
    act(() => root.unmount());
  }
});

it('refuses a playlist import when membership reordered after review, same count', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  // Same playlist, same name, same count, different order: counts alone
  // cannot see this, so the review guard must compare ordered membership.
  const reordered = {
    ...PLAYLIST_PREVIEW,
    playlists: [
      { ...PLAYLIST_PREVIEW.playlists[0], track_ordinals: [2, 1, 0] },
    ],
  };
  vi.spyOn(api.externalDrives, 'preview')
    .mockResolvedValueOnce(PLAYLIST_PREVIEW) // fast metadata pass
    .mockResolvedValueOnce(PLAYLIST_PREVIEW) // verified pass
    .mockResolvedValueOnce(reordered); // destination-binding re-preview
  const imp = vi.spyOn(api.externalDrives, 'import').mockResolvedValue(PLAYLIST_RESULT);
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
      button('Import playlist')!.click();
      await tick();
    });
    expect(imp).not.toHaveBeenCalled();
    expect(host.textContent).toContain('changed since this preview');
  } finally {
    act(() => root.unmount());
  }
});

for (const playlist of [false, true]) {
  it(`refuses changed same-path source evidence for ${playlist ? 'playlist' : 'track'} import`, async () => {
    const reviewed = playlist ? PLAYLIST_PREVIEW : PREVIEW;
    vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
    vi.spyOn(api.externalDrives, 'preview')
      .mockResolvedValueOnce(reviewed)
      .mockResolvedValueOnce(reviewed)
      .mockResolvedValueOnce({ ...reviewed, source_fingerprint: 'changed-source' });
    const imp = vi.spyOn(api.externalDrives, 'import').mockResolvedValue(PLAYLIST_RESULT);
    const { host, root, button } = render();
    try {
      await act(async () => { root.render(<ExternalDrivesSync />); await tick(); });
      await act(async () => { button('Pull…')!.click(); await tick(); });
      await act(async () => {
        button(playlist ? 'Import playlist' : 'Import 1 selected')!.click();
        await tick();
      });
      expect(imp).not.toHaveBeenCalled();
      expect(host.textContent).toContain('changed since this preview');
    } finally { act(() => root.unmount()); }
  });
}

const UPDATE_PREVIEW = {
  ...PLAYLIST_PREVIEW,
  playlists: [
    {
      ...PLAYLIST_PREVIEW.playlists[0],
      name: 'RIG Mix',
      membership: {
        counterpart_status: 'unique-name-match' as const,
        counterpart_id: 7,
        target_token: 'tok-reviewed-7',
        common: 1,
        adds_in_library: 0,
        adds_new: 2,
        removes: 1,
        removes_provisional: true,
        uncertain_members: 1,
        order_differs: true,
      },
    },
  ],
};

const UPDATE_RESULT = {
  ...PLAYLIST_RESULT,
  playlist_update: {
    playlist_id: 7,
    name: 'RIG Mix',
    member_count: 4,
    added_imported: 2,
    added_from_library: 0,
    kept_local_only: 1,
    skipped_uncertain: 1,
    skipped_other: 0,
  },
};

it('previews the update and syncs the explicitly chosen local playlist', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(UPDATE_PREVIEW);
  const imp = vi.spyOn(api.externalDrives, 'import').mockResolvedValue(UPDATE_RESULT);
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
    expect(host.textContent).toContain('suggested match: local playlist');
    expect(host.textContent).toContain('1 local-only kept (provisional)');
    expect(imp).not.toHaveBeenCalled();

    // the review spells out adds, kept local-only tracks and order first
    await act(async () => {
      button('Review update')!.click();
      await tick();
    });
    expect(host.textContent).toContain('import 2 new tracks');
    expect(host.textContent).toContain('match the playlist order to the USB');
    expect(host.textContent).toContain('Nothing is removed');
    expect(imp).not.toHaveBeenCalled();

    // the confirm names the exact local counterpart
    await act(async () => {
      button('Update local playlist "RIG Mix"')!.click();
      await tick();
    });
    expect(imp).toHaveBeenCalledWith({
      root: DRIVE.root,
      destination: '/library',
      confirm: true,
      preview_fingerprint: 'fp-test',
      create_playlist_id: 63,
      update_playlist_id: 7,
      update_target_token: 'tok-reviewed-7',
    });
    expect(host.textContent).toContain('Playlist "RIG Mix" updated');
    expect(host.textContent).toContain('1 local-only kept');
  } finally {
    act(() => root.unmount());
  }
});

it('never offers an update when the name match is ambiguous', async () => {
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  const ambiguous = {
    ...PLAYLIST_PREVIEW,
    playlists: [
      {
        ...PLAYLIST_PREVIEW.playlists[0],
        membership: {
          counterpart_status: 'ambiguous-name' as const,
          counterpart_id: null,
          target_token: null,
          common: 0,
          adds_in_library: 0,
          adds_new: 0,
          removes: 0,
          removes_provisional: false,
          uncertain_members: 0,
          order_differs: null,
        },
      },
    ],
  };
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(ambiguous);
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
    expect(host.textContent).toContain('several local playlists share this name');
    expect(button('Review update')).toBeUndefined();
  } finally {
    act(() => root.unmount());
  }
});

it('highlights the playlist the user came from without binding anything', async () => {
  const withPlaylists = {
    ...PREVIEW,
    playlists: [
      { id: 11, name: 'Warm Up', folder_path: '', track_count: 5, new_count: 2, present_count: 3, uncertain_count: 0, other_count: 0, folder_not_representable: false, track_ordinals: [0], membership: null },
      { id: 12, name: 'House Set', folder_path: 'Crate', track_count: 4, new_count: 4, present_count: 0, uncertain_count: 0, other_count: 0, folder_not_representable: false, track_ordinals: [0], membership: null },
    ],
  };
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(withPlaylists);
  const { host, root, button } = render();
  try {
    await act(async () => {
      root.render(<ExternalDrivesSync focusPlaylist="Warm Up" />);
      await tick();
    });
    await act(async () => {
      button('Pull…')!.click();
      await tick();
    });
    const rows = [...host.querySelectorAll<HTMLLIElement>('li.external-drive-playlist')];
    expect(rows).toHaveLength(2);
    const focused = rows.filter((r) => r.classList.contains('focused'));
    expect(focused).toHaveLength(1);
    expect(focused[0].textContent).toContain('Warm Up');
    expect(rows[1].textContent).toContain('House Set');
    // Highlighting is not a choice: nothing pre-selected, nothing bound.
    expect(host.querySelectorAll<HTMLInputElement>('li.external-drive-playlist input:checked')).toHaveLength(0);
  } finally {
    act(() => root.unmount());
  }
});

it('highlights nothing when no drive playlist shares the name', async () => {
  const withPlaylists = {
    ...PREVIEW,
    playlists: [
      { id: 11, name: 'Warm Up', folder_path: '', track_count: 5, new_count: 2, present_count: 3, uncertain_count: 0, other_count: 0, folder_not_representable: false, track_ordinals: [0], membership: null },
    ],
  };
  vi.spyOn(api.externalDrives, 'list').mockResolvedValue([DRIVE]);
  vi.spyOn(api.externalDrives, 'preview').mockResolvedValue(withPlaylists);
  const { host, root, button } = render();
  try {
    await act(async () => {
      root.render(<ExternalDrivesSync focusPlaylist="Not On This Drive" />);
      await tick();
    });
    await act(async () => {
      button('Pull…')!.click();
      await tick();
    });
    expect(host.querySelectorAll('li.external-drive-playlist.focused')).toHaveLength(0);
  } finally {
    act(() => root.unmount());
  }
});
