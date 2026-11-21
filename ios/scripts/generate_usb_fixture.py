"""Generate synthetic DeviceSQL test data using the independent desktop writer.
No user media/database. Run from repository root.
"""
import importlib.util
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('pdb_fixture_writer', root / 'rekordbox/device/pdb_write.py')
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)
tracks = []
for i in range(1, 41):
    strings = [m.sql_string('') for _ in range(21)]
    strings[17] = m.sql_string('Süper pulse 1' if i == 1 else f'Pulse {i}')
    strings[19] = m.sql_string(f'tone{i}.wav')
    strings[20] = m.sql_string(f'/Contents/tone{i}.wav')
    track = m.TrackRowSpec(id=i, strings=strings, artist_id=1, tempo_centibpm=12800, duration_secs=24, file_size=1234)
    tracks.append(m.encode_track_row(m.pad_track_row(track)))
tables = [m.TableData(0, tracks),
          m.TableData(2, [m.ArtistRowSpec(id=1, name=m.sql_string('Generated artist')).encode()]),
          m.TableData(7, [m.PlaylistTreeRowSpec(id=5, name=m.sql_string('Synthetic set'), sort_order=0).encode()]),
          m.TableData(8, [m.PlaylistEntryRowSpec(entry_index=2, track_id=1, playlist_id=5).encode(),
                          m.PlaylistEntryRowSpec(entry_index=1, track_id=2, playlist_id=5).encode()])]
target = root / 'ios/Packages/ManadjCore/Tests/ManadjCoreTests/Resources/usb/generated-export.pdb'
target.write_bytes(m.build_pdb(tables))
print(target)

# Real generated PCM is bundled separately. Only track1 exists in UI fixture.
audio = root / 'ios/Manadj/Resources/synthetic-A.wav'
ui_rows = []
for i in range(1, 1076):
    strings = [m.sql_string('') for _ in range(21)]
    strings[17] = m.sql_string('USB generated pulse' if i == 1 else 'Missing USB audio')
    strings[19] = m.sql_string(f'tone{i}.wav')
    strings[20] = m.sql_string(f'/Contents/tone{i}.wav')
    ui_rows.append(m.encode_track_row(m.pad_track_row(m.TrackRowSpec(id=i, strings=strings, tempo_centibpm=12800, duration_secs=24, file_size=audio.stat().st_size))))
ui_tables = [m.TableData(0, ui_rows), m.TableData(7, [m.PlaylistTreeRowSpec(id=1, name=m.sql_string('USB fixture set')).encode()]), m.TableData(8, [m.PlaylistEntryRowSpec(entry_index=1, track_id=1, playlist_id=1).encode()])]
(root / 'ios/Manadj/Resources/synthetic-usb-export.pdb').write_bytes(m.build_pdb(ui_tables))
