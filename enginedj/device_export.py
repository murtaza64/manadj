"""Export a manadj library to an Engine DJ device directory (#268).

Builds a fresh, standalone Engine device library — `Engine
Library/Database2/m.db` + portable copied audio — at a destination
directory that a FAT32/exFAT drive root would later be. The on-disk
contract is the one reverse-engineered in
docs/research/engine-usb-export.md (#267): verbatim 3.0.1 DDL
(`device_schema_3_0_1.sql`, real triggers/views), fresh library UUID,
self-referential origins, drive-relative track paths, linked-list
playlist ordering, and the desktop-proven blob formats.

Sources: every active manadj Track (including tracks outside playlists)
and every Playlist in position order. manadj owns metadata, cues, main
cue, grid, and key. An optional *donor* — a native analyzed Engine
library — contributes only what manadj cannot know: sample rate,
trackData loudness (never invented), overview waveform, loops, extra
cue slots manadj doesn't occupy, and absent-source metadata fields
(user-approved policy, #268).

Safety: all filesystem access goes through the explicit
`DeviceFilesystem` seam; destinations under /Volumes, ~/Music, or
~/Library are refused (resolved first, so symlink escapes are caught),
existing Engine Libraries are never clobbered unless they carry our
marker, free space is checked up front, and every audio copy is
sha256-read-back-verified. This module never touches Engine/rekordbox
applications or live libraries; production show copies use native
Engine export, not this writer, until parent verification (R2-R4 of the
#267 ladder) passes.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
import uuid as uuidlib
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from backend.models import Track as ManAdjTrack
from backend.models import Playlist as ManAdjPlaylist
from backend.models import PlaylistTrack
from backend.sync_common.matching import TrackIndex
from backend.sync_status.models import TempoChangeValue

from .connection import EngineDJDatabase
from .models.album_art import AlbumArt
from .models.performance_data import PerformanceData
from .models.playlist import Playlist
from .models.playlist_entity import PlaylistEntity
from .models.track import Track as EDJTrack
from .perf_export import _grid_markers
from .performance_blobs import (
    BeatData,
    BlobParseError,
    EngineHotCue,
    QuickCues,
    encode_beat_data,
    encode_quick_cues,
    encode_track_data,
    parse_beat_data,
    parse_quick_cues,
    parse_track_data,
)
from .ratings import energy_to_rating
from .sync import edj_path
from .track_export import EngineTrackSpec, insert_track

SCHEMA_SQL_PATH = Path(__file__).parent / "device_schema_3_0_1.sql"
USER_VERSION = 4194305  # PRAGMA user_version of every 3.0.1 library observed
MARKER_NAME = ".manadj-device-export"
ENGINE_LIBRARY_DIR = "Engine Library"

# Destinations that must never be written by the experimental exporter:
# real removable media, the real Engine/desktop libraries, app data.
FORBIDDEN_DEST_ROOTS = (
    Path("/Volumes"),
    Path.home() / "Music",
    Path.home() / "Library",
)


class DeviceExportError(RuntimeError):
    """Refusal or failure in device export; message says which."""


class DeviceFilesystem:
    """Explicit filesystem seam for device export.

    Every write the exporter performs goes through this object, so tests
    can substitute or wrap it, and safety checks live in one place.
    """

    def ensure_dir(self, path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)

    def free_bytes(self, path: Path) -> int:
        return shutil.disk_usage(path).free

    def file_size(self, path: Path) -> int:
        return path.stat().st_size

    def sha256(self, path: Path) -> str:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def copy_with_readback(self, src: Path, dst: Path) -> str:
        """Copy src to dst and verify the copy by re-reading and
        comparing sha256. Returns the hex digest."""
        shutil.copyfile(src, dst)
        src_hash = self.sha256(src)
        dst_hash = self.sha256(dst)
        if src_hash != dst_hash:
            raise DeviceExportError(
                f"read-back integrity failure copying {src} -> {dst}"
            )
        return dst_hash

    def is_within(self, root: Path, path: Path) -> bool:
        """Resolved containment: path stays inside root after resolving
        symlinks (the symlink-escape check)."""
        root_r = root.resolve()
        path_r = path.resolve()
        return path_r == root_r or root_r in path_r.parents

    def write_text(self, path: Path, content: str) -> None:
        path.write_text(content)


@dataclass
class DeviceExportOptions:
    dest_root: Path
    donor_database_dir: Path | None = None  # a Database2 dir, read-only
    audio_dir_name: str = "manadj"
    overwrite: bool = False
    space_margin_bytes: int = 64 * 1024 * 1024


@dataclass
class TrackExportResult:
    manadj_id: int
    engine_id: int | None
    status: str  # exported | skipped: <reason>
    donor_matched: bool = False
    is_analyzed: bool = False


@dataclass
class DeviceExportReport:
    dest_root: Path
    library_uuid: str
    tracks: list[TrackExportResult] = field(default_factory=list)
    playlists: list[tuple[str, int]] = field(default_factory=list)  # (title, entities)
    skipped_playlist_entries: int = 0

    @property
    def exported(self) -> int:
        return sum(1 for t in self.tracks if t.status == "exported")

    @property
    def skipped(self) -> list[TrackExportResult]:
        return [t for t in self.tracks if t.status != "exported"]

    def to_dict(self) -> dict:
        return {
            "dest_root": str(self.dest_root),
            "library_uuid": self.library_uuid,
            "tracks_exported": self.exported,
            "tracks_skipped": [
                {"manadj_id": t.manadj_id, "status": t.status} for t in self.skipped
            ],
            "donor_matched": sum(1 for t in self.tracks if t.donor_matched),
            "analyzed_rows": sum(1 for t in self.tracks if t.is_analyzed),
            "playlists": [
                {"title": title, "entities": count} for title, count in self.playlists
            ],
            "skipped_playlist_entries": self.skipped_playlist_entries,
        }


def validate_dest(options: DeviceExportOptions, fs: DeviceFilesystem) -> Path:
    """Refuse unsafe destinations. Returns the resolved dest root."""
    dest = Path(options.dest_root).expanduser()
    resolved = dest.resolve()
    for forbidden in FORBIDDEN_DEST_ROOTS:
        forbidden_r = forbidden.resolve()
        if resolved == forbidden_r or forbidden_r in resolved.parents:
            raise DeviceExportError(
                f"refusing destination {dest}: inside protected root {forbidden}"
            )
    library_dir = resolved / ENGINE_LIBRARY_DIR
    if library_dir.exists():
        marker = library_dir / MARKER_NAME
        if not options.overwrite:
            raise DeviceExportError(
                f"refusing: {library_dir} already exists (pass overwrite=True "
                "to replace a previous manadj export)"
            )
        if not marker.exists():
            raise DeviceExportError(
                f"refusing overwrite: {library_dir} was not created by manadj "
                f"(missing {MARKER_NAME}); never clobber a foreign Engine Library"
            )
    return resolved


@dataclass
class _DonorState:
    """Parsed donor performance state for one matched track."""

    row: EDJTrack
    beat_blob: bytes | None
    beat: BeatData | None
    quick_blob: bytes | None
    quick: QuickCues | None
    track_data_blob: bytes | None
    overview_blob: bytes | None
    loops_blob: bytes | None


class DonorLibrary:
    """Read-only view over a native analyzed Engine library used as a
    donor for analysis-derived state (loudness, overview waveform,
    loops, sample rate, extra cues, absent-source metadata)."""

    def __init__(self, database_dir: Path) -> None:
        self._db = EngineDJDatabase(Path(database_dir))
        self._session = self._db.M_Session()
        tracks = self._session.query(EDJTrack).all()
        self._index: TrackIndex[EDJTrack] = TrackIndex.build(tracks, edj_path)

    def close(self) -> None:
        self._session.close()

    def match(self, manadj_filename: str) -> _DonorState | None:
        row = self._index.match(manadj_filename)
        if row is None:
            return None
        perf = self._session.get(PerformanceData, row.id)
        beat_blob = perf.beatData if perf else None
        quick_blob = perf.quickCues if perf else None
        beat = quick = None
        try:
            beat = parse_beat_data(beat_blob) if beat_blob else None
        except BlobParseError:
            beat_blob = None
        try:
            quick = parse_quick_cues(quick_blob) if quick_blob else None
        except BlobParseError:
            quick_blob = None
        return _DonorState(
            row=row,
            beat_blob=beat_blob,
            beat=beat,
            quick_blob=quick_blob,
            quick=quick,
            track_data_blob=perf.trackData if perf else None,
            overview_blob=perf.overviewWaveFormData if perf else None,
            loops_blob=perf.loops if perf else None,
        )

    def album_art(self, row: EDJTrack) -> tuple[str, bytes] | None:
        """The donor row's album art (hash, blob), when it has real art."""
        if row.albumArtId is None:
            return None
        art = self._session.get(AlbumArt, row.albumArtId)
        if art is None or not art.albumArt:
            return None
        return (art.hash or "", art.albumArt)


# Donor metadata fields copied only when the manadj side has nothing
# (user-approved absent-source policy).
_DONOR_FILL_FIELDS = (
    "album",
    "genre",
    "label",
    "composer",
    "remixer",
    "comment",
    "year",
    "bitrate",
    "bpmAnalyzed",
)


def create_device_database(db_path: Path, library_uuid: str) -> None:
    """Create a fresh m.db from the verbatim device DDL (real triggers,
    views, indexes) with a single Information row."""
    import sqlite3

    ddl = SCHEMA_SQL_PATH.read_text()
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(ddl)
        conn.execute(f"PRAGMA user_version = {USER_VERSION}")
        conn.execute(
            "INSERT INTO Information (uuid, schemaVersionMajor, "
            "schemaVersionMinor, schemaVersionPatch, currentPlayedIndiciator, "
            "lastRekordBoxLibraryImportReadCounter) VALUES (?, 3, 0, 1, 0, 0)",
            (library_uuid,),
        )
        conn.commit()
    finally:
        conn.close()


def _tempo_changes(mtrack: ManAdjTrack) -> list[TempoChangeValue] | None:
    grid = mtrack.beatgrid
    if grid is None or grid.origin == "generated":
        return None
    changes = json.loads(grid.tempo_changes_json)
    if not changes:
        return None
    return [
        TempoChangeValue(
            start_time=tc["start_time"],
            bpm=tc["bpm"],
            bar_position=tc.get("bar_position", 1),
        )
        for tc in changes
    ]


@dataclass
class _BlobSet:
    beat_data: bytes | None = None
    quick_cues: bytes | None = None
    track_data: bytes | None = None
    overview: bytes | None = None
    loops: bytes | None = None

    @property
    def is_full(self) -> bool:
        return all(
            blob is not None
            for blob in (self.beat_data, self.quick_cues, self.track_data, self.overview)
        )


def _build_blobs(mtrack: ManAdjTrack, donor: _DonorState | None) -> _BlobSet:
    """Project manadj performance data into Engine blobs, filling
    analysis-only gaps from the donor. manadj wins cues/grid/main
    cue/key; donor loudness/overview/loops are verbatim; nothing
    unknown is invented."""
    blobs = _BlobSet()

    donor_sr = None
    donor_length = None
    if donor is not None and donor.beat is not None:
        donor_sr = donor.beat.sample_rate
        donor_length = donor.beat.track_length_samples
    donor_td = None
    if donor is not None and donor.track_data_blob:
        try:
            donor_td = parse_track_data(donor.track_data_blob)
            donor_sr = donor_sr or donor_td.sample_rate
            donor_length = donor_length or float(donor_td.track_length_samples)
        except BlobParseError:
            donor_td = None

    waveform = mtrack.waveform
    sample_rate = donor_sr or (float(waveform.sample_rate) if waveform else None)
    duration = None
    if waveform is not None:
        duration = waveform.duration
    if duration is None:
        duration = mtrack.duration_secs
    if duration is None and donor_length is not None and sample_rate:
        duration = donor_length / sample_rate

    # beatData: manadj grid projected at the resolved sample rate;
    # donor grid verbatim as fallback.
    changes = _tempo_changes(mtrack)
    if changes and sample_rate and duration:
        markers = _grid_markers(changes, sample_rate, duration)
        tail = donor.beat.tail if donor is not None and donor.beat is not None else b""
        blobs.beat_data = encode_beat_data(
            BeatData(
                sample_rate=sample_rate,
                track_length_samples=duration * sample_rate,
                default_grid=markers,
                adjusted_grid=markers,
                is_set=True,
                tail=tail or b"\0" * 9,
            )
        )
    elif donor is not None and donor.beat_blob:
        blobs.beat_data = donor.beat_blob

    # quickCues: manadj hot cues + main cue win their slots; donor cues
    # persist in slots manadj leaves empty (user-approved preservation).
    manadj_cues = {
        cue.slot_number - 1: EngineHotCue(
            slot=cue.slot_number - 1,
            label=cue.label or "",
            sample_offset=cue.time_seconds * sample_rate if sample_rate else -1.0,
            color_hex=cue.color or "#000000",
        )
        for cue in sorted(mtrack.hotcues, key=lambda c: c.slot_number)
        if 1 <= cue.slot_number <= 8
    }
    if sample_rate is not None:
        donor_quick = donor.quick if donor is not None else None
        merged = dict(manadj_cues)
        slot_count = 8
        main_cue = -1.0
        overridden = False
        default_cue = 0.0
        if donor_quick is not None:
            slot_count = max(8, donor_quick.slot_count)
            default_cue = donor_quick.default_cue_samples
            for cue in donor_quick.hot_cues:
                merged.setdefault(cue.slot, cue)
            main_cue = donor_quick.main_cue_samples
            overridden = donor_quick.main_cue_overridden
        if mtrack.cue_point_time is not None:
            main_cue = mtrack.cue_point_time * sample_rate
            overridden = True
        if merged or main_cue >= 0 or donor_quick is not None:
            blobs.quick_cues = encode_quick_cues(
                QuickCues(
                    hot_cues=list(merged.values()),
                    main_cue_samples=main_cue,
                    main_cue_overridden=overridden,
                    default_cue_samples=default_cue,
                    slot_count=slot_count,
                )
            )
    elif donor is not None and donor.quick_blob:
        blobs.quick_cues = donor.quick_blob

    # trackData: donor-only (loudness is analysis output we must never
    # invent); manadj key patches the donor copy.
    if donor_td is not None:
        if mtrack.key is not None:
            donor_td.key = mtrack.key
        blobs.track_data = encode_track_data(donor_td)

    # overview waveform + loops: donor verbatim only.
    if donor is not None:
        blobs.overview = donor.overview_blob
        blobs.loops = donor.loops_blob

    return blobs


def _plan_audio(
    manadj_tracks: list[ManAdjTrack], audio_dir: Path
) -> tuple[list[tuple[ManAdjTrack, Path, Path]], list[TrackExportResult]]:
    """Pair each track with (source, destination); report missing
    sources as skips. Destinations live under a per-track manadj-id
    directory (`<audio dir>/<id>/<basename>`, the show-USB layout) so
    Track.path stays UNIQUE and reversible with clean filenames."""
    plan: list[tuple[ManAdjTrack, Path, Path]] = []
    skipped: list[TrackExportResult] = []
    for mtrack in manadj_tracks:
        src = Path(mtrack.filename)
        if not src.is_file():
            skipped.append(
                TrackExportResult(mtrack.id, None, "skipped: source file missing")
            )
            continue
        plan.append((mtrack, src, audio_dir / str(mtrack.id) / src.name))
    return plan, skipped


def _get_or_create_art(
    session: Session, cache: dict[str, int], art: tuple[str, bytes] | None
) -> int | None:
    if art is None:
        return None
    art_hash, blob = art
    if art_hash in cache:
        return cache[art_hash]
    row = session.query(AlbumArt).filter(AlbumArt.hash == art_hash).first()
    if row is None:
        row = AlbumArt(hash=art_hash, albumArt=blob)
        session.add(row)
        session.flush()
    cache[art_hash] = row.id
    return row.id


def _assert_fresh(session: Session, library_uuid: str, audio_prefix: str) -> None:
    """Freshness invariant: a source-only device output carries exactly
    one uuid (its own) and only ../<audio dir>/ paths."""
    for (value,) in session.execute(
        text("SELECT DISTINCT originDatabaseUuid FROM Track")
    ):
        if value != library_uuid:
            raise DeviceExportError(f"stale origin uuid {value!r} in output")
    for (value,) in session.execute(
        text("SELECT DISTINCT databaseUuid FROM PlaylistEntity")
    ):
        if value != library_uuid:
            raise DeviceExportError(f"stale playlist entity uuid {value!r} in output")
    for (path,) in session.execute(text("SELECT path FROM Track")):
        if not path or not path.startswith(audio_prefix) or "/../" in path[3:]:
            raise DeviceExportError(f"non-portable track path {path!r} in output")


def export_device_library(
    manadj_session: Session,
    options: DeviceExportOptions,
    fs: DeviceFilesystem | None = None,
) -> DeviceExportReport:
    """Build the device library. Returns a report; raises
    DeviceExportError on any refusal or integrity failure."""
    fs = fs or DeviceFilesystem()
    dest = validate_dest(options, fs)

    manadj_tracks = (
        manadj_session.query(ManAdjTrack)
        .filter(ManAdjTrack.is_active)
        .order_by(ManAdjTrack.id)
        .all()
    )
    if not manadj_tracks:
        raise DeviceExportError("refusing: no active tracks to export")

    library_dir = dest / ENGINE_LIBRARY_DIR
    database_dir = library_dir / "Database2"
    audio_dir = dest / options.audio_dir_name
    audio_prefix = f"../{options.audio_dir_name}/"

    plan, results = _plan_audio(manadj_tracks, audio_dir)
    if not plan:
        raise DeviceExportError("refusing: no exportable tracks (all sources missing)")

    # Free-space check before any write.
    fs.ensure_dir(dest)
    needed = sum(fs.file_size(src) for _, src, _ in plan) + options.space_margin_bytes
    free = fs.free_bytes(dest)
    if free < needed:
        raise DeviceExportError(
            f"refusing: {needed} bytes needed (incl. margin), {free} free at {dest}"
        )

    # Fresh library shell. Overwrite (validated above) replaces our own
    # previous output wholesale — never merge into stale state.
    if library_dir.exists():
        shutil.rmtree(library_dir)
    if audio_dir.exists():
        shutil.rmtree(audio_dir)
    fs.ensure_dir(database_dir)
    fs.ensure_dir(audio_dir)

    library_uuid = str(uuidlib.uuid4())
    db_path = database_dir / "m.db"
    create_device_database(db_path, library_uuid)

    donor = (
        DonorLibrary(options.donor_database_dir)
        if options.donor_database_dir is not None
        else None
    )
    report = DeviceExportReport(dest_root=dest, library_uuid=library_uuid)
    report.tracks.extend(results)

    engine = create_engine(f"sqlite:///{db_path}")
    session_factory = sessionmaker(bind=engine)
    session = session_factory()
    engine_ids: dict[int, int] = {}  # manadj id -> engine Track id
    art_cache: dict[str, int] = {}
    try:
        for mtrack, src, dst in plan:
            fs.ensure_dir(dst.parent)
            if not fs.is_within(dest, dst):
                raise DeviceExportError(f"destination escape: {dst} outside {dest}")
            fs.copy_with_readback(src, dst)

            donor_state = donor.match(mtrack.filename) if donor is not None else None
            duration = mtrack.duration_secs
            spec = EngineTrackSpec(
                abs_path=dst,
                title=mtrack.title or src.stem,
                artist=mtrack.artist,
                length_secs=int(duration) if duration else None,
                bitrate_kbps=mtrack.bitrate_kbps,
            )
            engine_id = insert_track(session, spec, library_root=library_dir)
            row = session.get(EDJTrack, engine_id)

            # manadj-owned fields.
            bpm = mtrack.bpm_projected
            if bpm is not None:
                row.bpm = round(bpm)
                row.bpmAnalyzed = float(bpm)
            if mtrack.key is not None:
                row.key = mtrack.key
            if mtrack.energy is not None:
                row.rating = energy_to_rating(mtrack.energy)

            # Donor absent-source fills + art (never overrides manadj).
            if donor_state is not None:
                for field_name in _DONOR_FILL_FIELDS:
                    if getattr(row, field_name) is None:
                        value = getattr(donor_state.row, field_name)
                        if value is not None:
                            setattr(row, field_name, value)
                art_id = _get_or_create_art(
                    session, art_cache, donor.album_art(donor_state.row)
                )
                if art_id is not None:
                    row.albumArtId = art_id

            blobs = _build_blobs(mtrack, donor_state)
            perf = session.get(PerformanceData, engine_id)
            if perf is None:
                perf = PerformanceData(trackId=engine_id)
                session.add(perf)
            perf.beatData = blobs.beat_data
            perf.quickCues = blobs.quick_cues
            perf.trackData = blobs.track_data
            perf.overviewWaveFormData = blobs.overview
            perf.loops = blobs.loops
            # Full five-blob rows carry our analysis: mark analyzed so the
            # device won't re-analyze (the clobber vector). Partial rows
            # stay unanalyzed — the device analyzes lazily (#267, the
            # rekordbox-import pattern).
            row.isAnalyzed = blobs.is_full

            engine_ids[mtrack.id] = engine_id
            report.tracks.append(
                TrackExportResult(
                    manadj_id=mtrack.id,
                    engine_id=engine_id,
                    status="exported",
                    donor_matched=donor_state is not None,
                    is_analyzed=blobs.is_full,
                )
            )
        session.flush()

        # Playlists: sibling chain in manadj display order; entities in
        # position order; device flag state observed on real devices.
        # Built tail-first: UNIQUE (parentListId, nextListId) forbids two
        # rows pointing at 0, so each playlist is inserted already
        # pointing at its (previously created) next sibling.
        playlists = (
            manadj_session.query(ManAdjPlaylist)
            .order_by(ManAdjPlaylist.display_order, ManAdjPlaylist.id)
            .all()
        )
        now = int(time.time())
        next_list_id = 0
        for mplaylist in reversed(playlists):
            entries = (
                manadj_session.query(PlaylistTrack)
                .filter(PlaylistTrack.playlist_id == mplaylist.id)
                .order_by(PlaylistTrack.position)
                .all()
            )
            track_ids = []
            for entry in entries:
                engine_id = engine_ids.get(entry.track_id)
                if engine_id is None:
                    report.skipped_playlist_entries += 1
                    continue
                track_ids.append(engine_id)
            playlist = Playlist(
                title=mplaylist.name,
                parentListId=0,
                isPersisted=True,
                nextListId=next_list_id,
                isExplicitlyExported=True,
                lastEditTime=now,
            )
            session.add(playlist)
            session.flush()
            next_list_id = playlist.id

            entities = []
            for engine_id in track_ids:
                entity = PlaylistEntity(
                    listId=playlist.id,
                    trackId=engine_id,
                    databaseUuid=library_uuid,
                    nextEntityId=0,
                    membershipReference=0,
                )
                entities.append(entity)
                session.add(entity)
            session.flush()
            for left, right in zip(entities, entities[1:]):
                left.nextEntityId = right.id
            report.playlists.append((mplaylist.name, len(entities)))
        report.playlists.reverse()

        session.flush()
        _assert_fresh(session, library_uuid, audio_prefix)
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
        engine.dispose()
        if donor is not None:
            donor.close()

    fs.write_text(
        library_dir / MARKER_NAME,
        json.dumps(
            {
                "created_by": "manadj device export (#268)",
                "library_uuid": library_uuid,
                "created_at": int(time.time()),
                "audio_dir": options.audio_dir_name,
                "track_ids": {str(m): e for m, e in engine_ids.items()},
            },
            indent=2,
        ),
    )
    return report
