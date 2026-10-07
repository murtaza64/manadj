"""Onboarding: bulk External Import of a Rekordbox library (#274).

PRD: docs/prds/rekordbox-onboarding-import.md. One snapshot-backed,
fill-blanks-only, idempotent import of everything manadj can hold:
tracks (in place), keys, beatgrids, hot cues, Main cues, StockDate ->
created_at, MyTags -> Tag Categories/Tags, Genre -> "Genre" Tags
(option), playlists (folders flattened, smart playlists as stored
snapshots). Never writes to Rekordbox; never enqueues stems.

Module interface (ADR 0002): detect_rekordbox_library, open_snapshot_db,
preview_import, run_import. The task wrapper lives in
backend/onboarding/tasks.py; HTTP in backend/routers/onboarding.py.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from sqlalchemy.orm import Session

from backend import models
from backend.config import get_config
from backend.data_root import data_root
from backend.tag_palette import TagColorPicker
from backend.sync_performance.bulk import bulk_import
from backend.sync_performance.rekordbox_source import (
    RekordboxPerformanceSource,
    is_loop_row,
    standalone_memory_ms,
)
from backend.sync_status.adapters import _rb_related

if TYPE_CHECKING:
    from pyrekordbox.db6 import Rekordbox6Database

logger = logging.getLogger(__name__)

# Playlists manadj itself wrote into Rekordbox, never onboarding material.
_SKIPPED_PLAYLIST_RE = re.compile(r"^manadj", re.IGNORECASE)
_SKIPPED_PLAYLIST_NAMES = {"CUE Analysis Playlist"}

GENRE_CATEGORY_NAME = "Genre"

Progress = Callable[[str, int, int], None]  # (phase, done, total)


# -- detection & snapshot ------------------------------------------------------


def detect_rekordbox_library() -> Path | None:
    """The Rekordbox library dir (contains master.db): config.toml's
    rekordbox_path when set, else pyrekordbox's own config discovery."""
    config = get_config()
    if config.database.rekordbox_path:
        p = Path(config.database.rekordbox_path)
        if (p / "master.db").exists():
            return p
    try:
        from pyrekordbox.config import get_config as rb_get_config

        for section in ("rekordbox7", "rekordbox6"):
            try:
                db_path = rb_get_config(section, "db_path")
            except Exception:
                continue
            if db_path and Path(db_path).exists():
                return Path(db_path).parent
    except Exception as e:  # noqa: BLE001 — detection must never raise
        logger.warning("onboarding: pyrekordbox config discovery failed: %s", e)
    return None


_snapshots: dict[str, Path] = {}  # library dir -> snapshot taken this process run
# Serializes snapshotting: concurrent first requests (a StrictMode
# double-mount fires two previews) otherwise race two copies + the prune
# step, and were observed to hang the request threads.
_snapshot_lock = threading.Lock()


def snapshot_rekordbox_library(library_dir: Path) -> Path:
    with _snapshot_lock:
        return _snapshot_locked(library_dir)


def _snapshot_locked(library_dir: Path) -> Path:
    """Read-snapshot of the whole Rekordbox library dir (master.db + ANLZ
    share) under manadj's own data dir, once per process run — preview and
    import read the same frozen state, and Rekordbox may stay open.

    APFS clonefile (`cp -Rc`): instant and space-free; plain copy fallback.
    Older onboarding snapshots are pruned when a new one is taken.
    """
    library_dir = Path(library_dir)
    snapshots_dir = data_root() / "data" / "rekordbox-snapshots"
    cached = _snapshots.get(str(library_dir))
    if cached is not None and cached.parent == snapshots_dir and cached.exists():
        return cached
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = snapshots_dir / f"{stamp}-onboarding"
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    for old in snapshots_dir.iterdir():
        if old.is_dir() and old != dest:
            shutil.rmtree(old, ignore_errors=True)
    try:
        subprocess.run(
            ["cp", "-Rc", str(library_dir), str(dest)], check=True, capture_output=True
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(library_dir, dest)
    _snapshots[str(library_dir)] = dest
    logger.info("onboarding: rekordbox snapshot %s", dest)
    return dest


def open_snapshot_db(library_dir: Path) -> "Rekordbox6Database":
    """Snapshot the library and open the snapshot's master.db (read-only
    by construction — writes land on the clone, which is discarded)."""
    from pyrekordbox.db6 import Rekordbox6Database

    snap = snapshot_rekordbox_library(library_dir)
    return Rekordbox6Database(db_dir=snap, path=snap / "master.db")


# -- content classification ----------------------------------------------------


@dataclass
class _ContentSplit:
    importable: list = field(default_factory=list)  # DjmdContent, file on disk
    missing: list = field(default_factory=list)  # local path, file gone
    streaming: list = field(default_factory=list)  # no local file at all


def _split_contents(rb_db: "Rekordbox6Database") -> _ContentSplit:
    from pyrekordbox.db6.tables import DjmdContent

    split = _ContentSplit()
    rows = (
        rb_db.session.query(DjmdContent)
        .filter(DjmdContent.rb_local_deleted == 0)
        .all()
    )
    for c in rows:
        if not c.FolderPath or (c.ServiceID or 0) != 0:
            split.streaming.append(c)
        elif not Path(c.FolderPath).exists():
            split.missing.append(c)
        else:
            split.importable.append(c)
    return split


def _cues_by_content(rb_db: "Rekordbox6Database") -> dict[str, list]:
    from pyrekordbox.db6.tables import DjmdCue

    out: dict[str, list] = {}
    for cue in rb_db.session.query(DjmdCue).filter(DjmdCue.rb_local_deleted == 0):
        out.setdefault(cue.ContentID, []).append(cue)
    return out


def _parse_stock_date(value: str | None) -> datetime | None:
    """StockDate ("date added") is a VARCHAR, typically YYYY-MM-DD."""
    if not value:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip()[: len(fmt) + 9], fmt)
        except ValueError:
            continue
    return None


# -- MyTag / playlist structure reads ------------------------------------------


def _mytag_structure(rb_db: "Rekordbox6Database"):
    """(categories, tags_by_category, assignments) from djmdMyTag.

    Categories are ParentID=="root" rows; the Energy category encodes the
    energy field (not imported — PRD) and is excluded entirely.
    Returns ([(seq, name)], {category_name: [(seq, tag_name)]},
    [(content_id, category_name, tag_name)]).
    """
    from pyrekordbox.db6.tables import DjmdMyTag, DjmdSongMyTag

    session = rb_db.session
    rows = (
        session.query(DjmdMyTag).filter(DjmdMyTag.rb_local_deleted == 0).all()
    )
    categories = [
        r for r in rows if r.ParentID == "root" and r.Name and r.Name != "Energy"
    ]
    cat_by_id = {r.ID: r for r in categories}
    tags = [r for r in rows if r.ParentID in cat_by_id and r.Name]
    tag_by_id = {r.ID: r for r in tags}

    cat_list = [(c.Seq or 0, c.Name) for c in sorted(categories, key=lambda r: r.Seq or 0)]
    tags_by_cat: dict[str, list[tuple[int, str]]] = {name: [] for _, name in cat_list}
    for t in sorted(tags, key=lambda r: r.Seq or 0):
        tags_by_cat[cat_by_id[t.ParentID].Name].append((t.Seq or 0, t.Name))

    assignments: list[tuple[str, str, str]] = []
    for st in session.query(DjmdSongMyTag).filter(DjmdSongMyTag.rb_local_deleted == 0):
        tag = tag_by_id.get(st.MyTagID)
        if tag is not None:
            assignments.append((st.ContentID, cat_by_id[tag.ParentID].Name, tag.Name))
    return cat_list, tags_by_cat, assignments


@dataclass
class _RBPlaylist:
    name: str  # flattened "Folder > Sub > Name"
    smart: bool
    content_ids: list[str]  # play order (TrackNo)


def _collect_playlists(rb_db: "Rekordbox6Database") -> tuple[list[_RBPlaylist], int]:
    """All importable playlists, folders flattened into names, plus the
    count of smart playlists skipped for having no stored result rows.

    Folder rows (Attribute=1) are never playlists themselves; smart
    playlists (Attribute=4) import as static snapshots of their stored
    DjmdSongPlaylist rows when present.
    """
    from pyrekordbox.db6.tables import DjmdPlaylist, DjmdSongPlaylist

    session = rb_db.session
    rows = (
        session.query(DjmdPlaylist).filter(DjmdPlaylist.rb_local_deleted == 0).all()
    )
    by_id = {r.ID: r for r in rows}

    def flattened(pl) -> str:
        parts, cur, seen = [], pl, set()
        while cur is not None and cur.ID not in seen:
            seen.add(cur.ID)
            if cur.Name:
                parts.insert(0, cur.Name)
            cur = by_id.get(cur.ParentID) if cur.ParentID not in (None, "root", "0") else None
        return " > ".join(parts)

    songs_by_playlist: dict[str, list] = {}
    for sp in (
        session.query(DjmdSongPlaylist)
        .filter(DjmdSongPlaylist.rb_local_deleted == 0)
        .order_by(DjmdSongPlaylist.TrackNo)
    ):
        songs_by_playlist.setdefault(sp.PlaylistID, []).append(sp)

    FOLDER, SMART = 1, 4
    playlists: list[_RBPlaylist] = []
    smart_skipped = 0
    for pl in sorted(rows, key=lambda r: r.Seq or 0):
        if not pl.Name or (pl.Attribute or 0) == FOLDER:
            continue
        name_parts = flattened(pl).split(" > ")
        # Skip manadj's own exports wherever they live — including under a
        # "manadj Playlists" folder — and Rekordbox system playlists.
        if any(_SKIPPED_PLAYLIST_RE.match(part) for part in name_parts) or (
            pl.Name in _SKIPPED_PLAYLIST_NAMES
        ):
            continue
        smart = (pl.Attribute or 0) == SMART
        songs = songs_by_playlist.get(pl.ID, [])
        if smart and not songs:
            smart_skipped += 1  # no stored result to snapshot — noted
            continue
        playlists.append(
            _RBPlaylist(
                name=flattened(pl),
                smart=smart,
                content_ids=[sp.ContentID for sp in songs],
            )
        )
    return playlists, smart_skipped


# -- preview -------------------------------------------------------------------


@dataclass
class RekordboxPreview:
    library_dir: str
    tracks_total: int
    tracks_importable: int
    tracks_already_imported: int
    tracks_missing_file: int
    tracks_streaming: int
    hotcues: int
    saved_loops: int
    grids: int
    keys: int
    tag_categories: int
    tags: int
    tag_assignments: int
    genres: int
    playlists: int
    smart_playlists: int
    smart_playlists_skipped: int


def preview_import(db: Session, rb_db: "Rekordbox6Database") -> RekordboxPreview:
    """Counts for the wizard's preview step — reads the snapshot only."""
    from rekordbox.cue_mapping import HOT_CUE_KINDS

    split = _split_contents(rb_db)
    existing = {f for (f,) in db.query(models.Track.filename).all()}
    already = sum(1 for c in split.importable if c.FolderPath in existing)

    cues_by_content = _cues_by_content(rb_db)
    hotcues = loops = grids = keys = 0
    genre_names: set[str] = set()
    for c in split.importable:
        rows = cues_by_content.get(c.ID, [])
        loops += sum(1 for r in rows if is_loop_row(r))
        hotcues += sum(
            1 for r in rows if not is_loop_row(r) and r.Kind in HOT_CUE_KINDS
        )
        if c.AnalysisDataPath:
            grids += 1
        if _rb_related(c, "Key", "ScaleName"):
            keys += 1
        genre = _rb_related(c, "Genre", "Name")
        if genre:
            genre_names.add(genre)

    cat_list, tags_by_cat, assignments = _mytag_structure(rb_db)
    playlists, smart_skipped = _collect_playlists(rb_db)

    return RekordboxPreview(
        library_dir=str(Path(rb_db._db_dir)),
        tracks_total=len(split.importable) + len(split.missing) + len(split.streaming),
        tracks_importable=len(split.importable),
        tracks_already_imported=already,
        tracks_missing_file=len(split.missing),
        tracks_streaming=len(split.streaming),
        hotcues=hotcues,
        saved_loops=loops,
        grids=grids,
        keys=keys,
        tag_categories=len(cat_list),
        tags=sum(len(v) for v in tags_by_cat.values()),
        tag_assignments=len(assignments),
        genres=len(genre_names),
        playlists=len(playlists),
        smart_playlists=sum(1 for p in playlists if p.smart),
        smart_playlists_skipped=smart_skipped,
    )


# -- run -----------------------------------------------------------------------


@dataclass
class ImportSummary:
    """What the import did (and dropped) — the wizard's summary screen."""

    tracks_imported: int = 0
    tracks_already_imported: int = 0
    tracks_missing_file: int = 0
    tracks_streaming: int = 0
    hotcues_applied: int = 0
    beatgrids_applied: int = 0
    maincues_applied: int = 0
    keys_applied: int = 0
    pending_conflicts: int = 0  # saved Library data differed; left untouched
    tag_categories_created: int = 0
    tags_created: int = 0
    tag_assignments_added: int = 0
    genre_tags_created: int = 0
    genre_assignments_added: int = 0
    tag_colors_assigned: int = 0  # new or colorless Tags/Categories (#326)
    playlists_created: int = 0
    playlist_entries_added: int = 0
    playlists_already_present: int = 0
    smart_playlists_snapshotted: int = 0
    smart_playlists_skipped: int = 0
    dropped_memory_cues: int = 0  # standalone memory cues beyond the first
    dropped_loops: int = 0

    def to_dict(self) -> dict:
        return asdict(self)


def run_import(
    db: Session,
    rb_db: "Rekordbox6Database",
    include_genre: bool = True,
    progress: Progress | None = None,
    color_picker: TagColorPicker | None = None,
) -> ImportSummary:
    """The bulk External Import. Fill-blanks only; idempotent on re-run.

    Tag Categories / Tags the import creates — or finds colorless — get a
    random saturated color (#326); an existing color is never replaced.

    Phases (each reported via `progress`): tracks -> performance -> tags
    [-> genre] -> playlists -> finalize. Enqueues waveforms and missing
    analysis at the end; NEVER stems (PRD).
    """

    def report(phase: str, done: int, total: int) -> None:
        if progress is not None:
            progress(phase, done, total)

    summary = ImportSummary()
    picker = color_picker or TagColorPicker()
    split = _split_contents(rb_db)
    summary.tracks_missing_file = len(split.missing)
    summary.tracks_streaming = len(split.streaming)

    # ---- phase: tracks (in place — no file copies)
    existing = {f for (f,) in db.query(models.Track.filename).all()}
    total = len(split.importable)
    report("tracks", 0, total)
    for i, c in enumerate(split.importable, start=1):
        if c.FolderPath in existing:
            summary.tracks_already_imported += 1
        else:
            track = models.Track(
                filename=c.FolderPath,
                title=c.Title or Path(c.FolderPath).stem,
                artist=_rb_related(c, "Artist", "Name"),
                bpm=c.BPM or None,  # RB stores centiBPM; so do we
                energy=None,
            )
            created = _parse_stock_date(c.StockDate)
            if created is not None:
                track.created_at = created
            db.add(track)
            summary.tracks_imported += 1
        if i % 200 == 0:
            db.commit()
            report("tracks", i, total)
    db.commit()
    report("tracks", total, total)

    # ---- phase: performance (hot cues, grids, Main cues, keys)
    # Fill-blanks via the sync_performance bulk machinery: conflicts with
    # saved Library data become pending items we drop on the floor (the
    # idempotence contract — re-runs change nothing already imported).
    rb_paths = {c.FolderPath for c in split.importable}
    track_ids = [
        tid
        for (tid, fname) in db.query(models.Track.id, models.Track.filename).all()
        if fname in rb_paths
    ]
    source = RekordboxPerformanceSource(rb_db)
    report("performance", 0, len(track_ids))
    CHUNK = 50
    for start in range(0, len(track_ids), CHUNK):
        chunk = track_ids[start : start + CHUNK]
        result = bulk_import(db, source, chunk)
        summary.hotcues_applied += result.applied["hotcues"]
        summary.beatgrids_applied += result.applied["beatgrid"]
        summary.maincues_applied += result.applied["maincue"]
        summary.keys_applied += result.applied["key"]
        summary.pending_conflicts += len(result.pending)
        report("performance", min(start + CHUNK, len(track_ids)), len(track_ids))

    # Dropped performance data (summary honesty — PRD story 11).
    cues_by_content = _cues_by_content(rb_db)
    for c in split.importable:
        rows = cues_by_content.get(c.ID, [])
        summary.dropped_loops += sum(1 for r in rows if is_loop_row(r))
        summary.dropped_memory_cues += max(0, len(standalone_memory_ms(rows)) - 1)

    # ---- phase: tags (MyTags -> Tag Categories/Tags + assignments)
    track_id_by_path = {
        fname: tid
        for (tid, fname) in db.query(models.Track.id, models.Track.filename).all()
    }
    path_by_content = {c.ID: c.FolderPath for c in split.importable}
    cat_list, tags_by_cat, assignments = _mytag_structure(rb_db)
    report("tags", 0, len(cat_list) or 1)
    for done, (seq, cat_name) in enumerate(cat_list, start=1):
        category, created = _get_or_create_category(db, cat_name, seq, picker, summary)
        summary.tag_categories_created += created
        for tag_seq, tag_name in tags_by_cat.get(cat_name, []):
            _, created = _get_or_create_tag(db, category, tag_name, tag_seq, picker, summary)
            summary.tags_created += created
        report("tags", done, len(cat_list) or 1)
    db.commit()
    summary.tag_assignments_added += _add_assignments(
        db,
        [
            (track_id_by_path[path_by_content[cid]], cat_name, tag_name)
            for (cid, cat_name, tag_name) in assignments
            if path_by_content.get(cid) in track_id_by_path
        ],
    )

    # ---- phase: genre (Rekordbox Genre -> Tags in a "Genre" category)
    if include_genre:
        report("genre", 0, 1)
        genre_assignments: list[tuple[int, str, str]] = []
        genre_names: dict[str, None] = {}
        for c in split.importable:
            name = _rb_related(c, "Genre", "Name")
            tid = track_id_by_path.get(c.FolderPath)
            if name and tid is not None:
                genre_names.setdefault(name)
                genre_assignments.append((tid, GENRE_CATEGORY_NAME, name))
        if genre_names:
            category, created = _get_or_create_category(
                db, GENRE_CATEGORY_NAME, len(cat_list), picker, summary
            )
            summary.tag_categories_created += created
            for i, name in enumerate(genre_names):
                _, created = _get_or_create_tag(db, category, name, i, picker, summary)
                summary.genre_tags_created += created
            db.commit()
            summary.genre_assignments_added += _add_assignments(db, genre_assignments)
        report("genre", 1, 1)

    # ---- phase: playlists (play order; folders flattened; smart = snapshot)
    playlists, smart_skipped = _collect_playlists(rb_db)
    summary.smart_playlists_skipped = smart_skipped
    existing_names = {name for (name,) in db.query(models.Playlist.name).all()}
    report("playlists", 0, len(playlists) or 1)
    for done, pl in enumerate(playlists, start=1):
        if pl.name in existing_names:
            summary.playlists_already_present += 1
            continue
        row = models.Playlist(name=pl.name)
        db.add(row)
        db.flush()
        position = 0
        seen: set[int] = set()
        for cid in pl.content_ids:
            tid = track_id_by_path.get(path_by_content.get(cid, ""))
            if tid is None or tid in seen:
                continue  # missing/streaming track, or dup within the playlist
            seen.add(tid)
            db.add(
                models.PlaylistTrack(playlist_id=row.id, track_id=tid, position=position)
            )
            position += 1
        summary.playlists_created += 1
        summary.playlist_entries_added += position
        if pl.smart:
            summary.smart_playlists_snapshotted += 1
        report("playlists", done, len(playlists) or 1)
    db.commit()

    # ---- phase: finalize (file facts, waveforms, analysis — never stems)
    report("finalize", 0, 1)
    from backend.analysis_tasks import enqueue_missing_analysis
    from backend.track_metadata.file_facts import refresh_file_facts
    from backend.waveform_tasks import enqueue_missing_waveforms

    refresh_file_facts(db)
    enqueue_missing_waveforms(db)
    enqueue_missing_analysis(db)
    db.commit()
    report("finalize", 1, 1)
    return summary


# -- tag helpers ---------------------------------------------------------------


def _fill_color(row, picker: TagColorPicker, summary: "ImportSummary") -> None:
    """Give a colorless Tag/Category a palette color; never overwrite."""
    if not row.color:
        row.color = picker.next()
        summary.tag_colors_assigned += 1


def _get_or_create_category(
    db: Session,
    name: str,
    display_order: int,
    picker: TagColorPicker,
    summary: "ImportSummary",
) -> tuple[models.TagCategory, bool]:
    row = db.query(models.TagCategory).filter(models.TagCategory.name == name).first()
    if row is not None:
        _fill_color(row, picker, summary)  # one-time fix for grey imports
        return row, False
    row = models.TagCategory(name=name, display_order=display_order)
    _fill_color(row, picker, summary)
    db.add(row)
    db.flush()
    return row, True


def _get_or_create_tag(
    db: Session,
    category: models.TagCategory,
    name: str,
    display_order: int,
    picker: TagColorPicker,
    summary: "ImportSummary",
) -> tuple[models.Tag, bool]:
    row = (
        db.query(models.Tag)
        .filter(models.Tag.category_id == category.id, models.Tag.name == name)
        .first()
    )
    if row is not None:
        _fill_color(row, picker, summary)
        return row, False
    row = models.Tag(category_id=category.id, name=name, display_order=display_order)
    _fill_color(row, picker, summary)
    db.add(row)
    db.flush()
    return row, True


def _add_assignments(
    db: Session, wanted: list[tuple[int, str, str]]
) -> int:
    """Insert missing TrackTag rows for (track_id, category_name, tag_name)
    triples. Existing assignments are left alone (fill-blanks)."""
    tag_ids = {
        (cat_name, tag_name): tag_id
        for (tag_id, tag_name, cat_name) in (
            db.query(models.Tag.id, models.Tag.name, models.TagCategory.name)
            .join(models.TagCategory, models.Tag.category_id == models.TagCategory.id)
            .all()
        )
    }
    existing_pairs = {
        (tt.track_id, tt.tag_id) for tt in db.query(models.TrackTag).all()
    }
    added = 0
    for track_id, cat_name, tag_name in wanted:
        tag_id = tag_ids.get((cat_name, tag_name))
        if tag_id is None or (track_id, tag_id) in existing_pairs:
            continue
        db.add(models.TrackTag(track_id=track_id, tag_id=tag_id))
        existing_pairs.add((track_id, tag_id))
        added += 1
    db.commit()
    return added
