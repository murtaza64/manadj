"""Synthetic USB analysis only. Read comparisons must not alter either source."""
import json
import shutil

import pytest

from backend import external_drives as drives
from backend.models import Beatgrid, HotCue
from backend.sync_cue_comparison import compare_row
from rekordbox.decode_offset import export_offset_ms
from rekordbox.device import anlz_write as w
from tests.test_external_drives import make_rekordbox_usb, put_audio, track_spec, tree_digest


@pytest.fixture
def matched(db, make_track, tmp_path):
    usb = make_rekordbox_usb(tmp_path / 'USB', [track_spec(1, 'Tune', '/Contents/tune.mp3')])
    source = put_audio(usb, '/Contents/tune.mp3')
    local = tmp_path / 'Library' / 'tune.mp3'
    local.parent.mkdir()
    shutil.copy2(source, local)
    track = make_track(filename=str(local), title='Tune', cue_point_time=0.25, duration_secs=8)
    db.add(HotCue(track_id=track.id, slot_number=1, time_seconds=1, label='Library intro', color='#00ff00'))
    db.add(Beatgrid(track_id=track.id, origin='edited', tempo_changes_json=json.dumps([
        {'start_time': 0.5, 'bpm': 120, 'time_signature_num': 4, 'time_signature_den': 4, 'bar_position': 1}
    ])))
    db.commit()
    dat = usb / 'PIONEER/USBANLZ/P000/00000001/ANLZ0000.DAT'
    dat.parent.mkdir(parents=True)
    off = export_offset_ms(source)
    dat.write_bytes(w.build_anlz([
        w.PathSection('/Contents/tune.mp3'),
        w.BeatGridSection([w.Beat(1, 12000, 500 + off), w.Beat(2, 12000, 1000 + off)]),
        w.CueListSection(1, [w.CueEntry(1, 1500 + off)]),
        w.CueListSection(0, [w.CueEntry(0, 2000 + off, type=2, loop_time_ms=3000 + off)]),
    ]))
    dat.with_suffix('.EXT').write_bytes(w.build_anlz([
        w.PathSection('/Contents/tune.mp3'),
        w.CueExtendedListSection(1, [w.CueExtendedEntry(1, 1500 + off, comment='USB intro\x00', color_rgb=(255, 0, 0))]),
    ]))
    preview = drives.build_pull_preview(db, usb, verify=True)
    return usb, source, local, track, dat, preview


def test_read_aligned_cues_grid_labels_loops_and_never_write(db, matched):
    usb, _, local, track, _, preview = matched
    before = tree_digest(usb), local.read_bytes(), track.cue_point_time, track.hotcues[0].label
    result = compare_row(db, usb, 0, preview.fingerprint)
    assert result['read_only'] is True and result['newer_source'] is None
    assert result['track_id'] == track.id
    assert result['usb']['state'] == 'read'
    hot, loop = result['usb']['cues']
    assert hot['time'] == 1.5 and hot['label'] == 'USB intro' and hot['color'] == '#ff0000'
    assert loop['kind'] == 'memory' and loop['loop_end'] == 3
    assert result['usb']['beats'][0] == {'time': .5, 'beat': 1, 'bpm': 120}
    assert result['library']['tempo_changes'][0]['start_time'] == .5
    assert len(result['library']['cues']) == 2
    assert before == (tree_digest(usb), local.read_bytes(), track.cue_point_time, track.hotcues[0].label)


def test_stale_review_and_missing_ordinal_refuse(db, matched):
    usb, _, _, _, _, preview = matched
    with pytest.raises(drives.PlanChangedError):
        compare_row(db, usb, 0, 'old')
    with pytest.raises(drives.ExternalDriveError, match='exact-audio'):
        compare_row(db, usb, 99, preview.fingerprint)


@pytest.mark.parametrize('mode', ['missing', 'corrupt', 'wrong-audio', 'symlink'])
def test_unavailable_analysis_is_unknown_not_equal_or_empty_success(db, matched, tmp_path, mode):
    usb, _, _, _, dat, preview = matched
    if mode == 'missing':
        dat.unlink()
    elif mode == 'corrupt':
        dat.write_bytes(b'not an analysis file')
    elif mode == 'wrong-audio':
        dat.write_bytes(w.build_anlz([w.PathSection('/Contents/another.mp3')]))
    else:
        outside = tmp_path / 'private.DAT'
        outside.write_bytes(dat.read_bytes())
        dat.unlink()
        dat.symlink_to(outside)
    result = compare_row(db, usb, 0, preview.fingerprint)
    assert result['usb']['state'] == 'unavailable'
    assert result['usb']['reason']
    assert result['library']['cues']  # local context retained, no equality verdict


def test_wrong_audio_refuses_even_if_preview_claims_present(db, matched, monkeypatch):
    usb, source, _, _, _, preview = matched
    monkeypatch.setattr(drives, 'build_pull_preview', lambda *a, **kw: preview)
    source.write_bytes(b'different contents')
    with pytest.raises(drives.PlanChangedError, match='Audio changed'):
        compare_row(db, usb, 0, preview.fingerprint)


def test_another_variant_path_invalidates_usb_comparison(db, matched):
    usb, _, _, _, dat, preview = matched
    dat.with_suffix('.EXT').write_bytes(w.build_anlz([w.PathSection('/Contents/other.mp3')]))
    assert compare_row(db, usb, 0, preview.fingerprint)['usb']['state'] == 'unavailable'


def test_route_exposes_only_read_and_stale_is_409(db, matched):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.database import get_db
    from backend.routers.external_drives import router
    usb, _, _, _, _, preview = matched
    app = FastAPI()
    app.include_router(router, prefix='/api/external-drives')
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    body = {'root': str(usb), 'ordinal': 0, 'preview_fingerprint': preview.fingerprint}
    response = client.post('/api/external-drives/performance/compare', json=body)
    assert response.status_code == 200 and response.json()['read_only']
    body['preview_fingerprint'] = 'stale'
    assert client.post('/api/external-drives/performance/compare', json=body).status_code == 409
    assert client.post('/api/external-drives/performance/apply', json=body).status_code == 404


def test_read_io_error_is_explicit_not_internal_failure(db, matched, monkeypatch):
    usb, _, _, _, _, preview = matched
    monkeypatch.setattr(drives, 'build_pull_preview', lambda *a, **kw: preview)
    def fail(*a):
        raise PermissionError('unreadable')
    monkeypatch.setattr(drives, '_sha256', fail)
    with pytest.raises(drives.ExternalDriveError, match='could not be read'):
        compare_row(db, usb, 0, preview.fingerprint)


def test_corrupt_local_grid_preserves_unknown(db, matched):
    usb, _, _, track, _, preview = matched
    track.beatgrid.tempo_changes_json = '{}'
    db.commit()
    # Beatgrid data does not participate in the pull preview fingerprint.
    result = compare_row(db, usb, 0, preview.fingerprint)
    assert result['library']['tempo_changes'] is None
    assert result['library']['grid_state'] == 'unavailable'


def test_engine_and_unsafe_analysis_path_refuse(db, matched, monkeypatch):
    from dataclasses import replace
    usb, _, _, _, _, preview = matched
    monkeypatch.setattr(drives, 'build_pull_preview', lambda *a, **kw: replace(preview, kind='engine'))
    with pytest.raises(drives.ExternalDriveError, match='Rekordbox USB only'):
        compare_row(db, usb, 0, preview.fingerprint)
    monkeypatch.setattr(drives, 'build_pull_preview', lambda *a, **kw: preview)
    device = drives.read_rekordbox_device(usb)
    device.tracks[0].analyze_path = '../../private.DAT'
    monkeypatch.setattr(drives, 'read_rekordbox_device', lambda *a: device)
    with pytest.raises(drives.ExternalDriveError, match='Unsafe'):
        compare_row(db, usb, 0, preview.fingerprint)


def test_outside_root_extended_cues_do_not_silently_become_missing(db, matched, tmp_path):
    usb, _, _, _, dat, preview = matched
    ext = dat.with_suffix('.EXT')
    outside = tmp_path / 'outside.EXT'
    outside.write_bytes(ext.read_bytes())
    ext.unlink()
    ext.symlink_to(outside)
    assert compare_row(db, usb, 0, preview.fingerprint)['usb']['state'] == 'unavailable'
