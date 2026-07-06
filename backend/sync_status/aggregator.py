"""The unified sync view aggregator.

One interface: compute_sync_status(db, surfaces) -> SyncStatusResult.
`surfaces` maps a SurfaceId to a SurfaceReader — the seam at which external
libraries and the disk are read (fakes in tests; adapters in production).
This seam is a read-only down payment on the ExternalLibrary seam
(architecture review candidate 3).
"""

from pathlib import Path
from typing import Mapping, Protocol

from sqlalchemy.orm import Session, joinedload

from backend import models
from backend.sync_common.matching import TrackIndex

from .compare import (
    CUE_TIME_TOLERANCE,
    beatgrid_value_from_row,
    beatgrids_equal,
    hotcue_sets_equal,
    hotcue_values_from_rows,
)
from .models import (
    EXTERNAL_LIBRARY_IDS,
    SCALAR_FIELDS,
    SURFACE_IDS,
    FieldDivergence,
    RowStatus,
    SurfaceTrackRef,
    SyncStatusResult,
    SyncStatusRow,
    TrackFields,
)

BPM_TOLERANCE = 0.01


class SurfaceReader(Protocol):
    """What the aggregator needs from a Surface: its tracks and which fields
    it carries."""

    fields: frozenset[str]

    def list_tracks(self) -> list[SurfaceTrackRef]: ...


def compute_sync_status(
    db: Session, surfaces: Mapping[str, SurfaceReader]
) -> SyncStatusResult:
    """One row per track matched across Surfaces, with rollup status,
    diverged fields, capability info, and no-overwrite warnings."""
    surface_refs: dict[str, list[SurfaceTrackRef]] = {
        sid: [r for r in reader.list_tracks() if r.path] for sid, reader in surfaces.items()
    }
    surface_index: dict[str, TrackIndex[SurfaceTrackRef]] = {
        sid: TrackIndex.build(refs, lambda r: r.path) for sid, refs in surface_refs.items()
    }

    rows: list[SyncStatusRow] = []
    matched_ref_ids: set[int] = set()

    library_tracks = (
        db.query(models.Track)
        .options(
            joinedload(models.Track.track_tags).joinedload(models.TrackTag.tag),
            joinedload(models.Track.hotcues),
            joinedload(models.Track.beatgrid),
        )
        .all()
    )
    # Main cues live on the Track itself (waveform-overhaul issue 06); the
    # dict shape is kept for _library_row's signature.
    maincue_by_track: dict[int, float | None] = {
        t.id: t.cue_point_time for t in library_tracks
    }

    for track in library_tracks:
        rows.append(
            _library_row(track, maincue_by_track, surfaces, surface_index, matched_ref_ids)
        )

    rows.extend(_orphan_rows(surfaces, surface_refs, matched_ref_ids))

    counts: dict[str, int] = {
        s: 0
        for s in ("missing-downstream", "diverged", "not-in-library", "unimported", "in-sync")
    }
    for row in rows:
        counts[row.status] += 1
    return SyncStatusResult(rows=rows, counts=counts)


# ---------------------------------------------------------------- library rows


def _library_fields(track: models.Track, maincue: float | None) -> TrackFields:
    return TrackFields(
        title=track.title,
        artist=track.artist,
        key=track.key,
        # One served BPM (ADR 0027): the sync BPM cell reads the grid-first
        # projection, not the internal column (ADR 0016 line-61 follow-up).
        bpm=track.bpm_projected,
        energy=track.energy,
        tags=sorted(tt.tag.name for tt in track.track_tags),
        hotcues=hotcue_values_from_rows(track.hotcues),
        beatgrid=beatgrid_value_from_row(track.beatgrid),
        maincue=maincue,
    )


def _library_row(
    track: models.Track,
    maincue_by_track: dict[int, float | None],
    surfaces: Mapping[str, SurfaceReader],
    surface_index: dict[str, TrackIndex[SurfaceTrackRef]],
    matched_ref_ids: set[int],
) -> SyncStatusRow:
    lib = _library_fields(track, maincue_by_track.get(track.id))
    presence: dict[str, bool] = {"library": True}
    diverged: dict[str, FieldDivergence] = {}
    warnings: list[str] = []

    for sid, reader in surfaces.items():
        ref = surface_index[sid].match(track.filename)
        presence[sid] = ref is not None
        if ref is None:
            continue
        matched_ref_ids.add(id(ref))
        _collect_divergences(sid, reader, lib, ref.fields, diverged, warnings)

    # every known surface key must exist in presence even if reader missing
    for sid in SURFACE_IDS:
        presence.setdefault(sid, False)

    unprocessed = not lib.tags
    archived = track.archived_at is not None
    # only surfaces we can actually see count toward "missing downstream" —
    # an unavailable reader means unknown, not missing
    missing_downstream = any(
        sid in surfaces and not presence[sid] for sid in EXTERNAL_LIBRARY_IDS
    )
    # rollup priority: missing-downstream > diverged > in-sync.
    # Presence beats field agreement — you can't reconcile fields with a
    # Surface the track isn't on, so presence Export is the primary action;
    # divergences remain on the row for the matrix.
    # Archived rows always roll up in-sync: they left Export, so nothing
    # about them is actionable — the row exists only so Match still claims
    # their downstream copies (which would otherwise look external-only).
    status: RowStatus
    if archived:
        status = "in-sync"
    elif missing_downstream:
        status = "missing-downstream"
    elif diverged:
        status = "diverged"
    else:
        status = "in-sync"

    return SyncStatusRow(
        path=track.filename,
        title=track.title,
        artist=track.artist,
        track_id=track.id,
        presence=presence,
        status=status,
        unprocessed=unprocessed,
        archived=archived,
        diverged=list(diverged.values()),
        warnings=warnings,
    )


def _collect_divergences(
    sid: str,
    reader: SurfaceReader,
    lib: TrackFields,
    surface: TrackFields,
    diverged: dict[str, FieldDivergence],
    warnings: list[str],
) -> None:
    for fname in SCALAR_FIELDS:
        if fname not in reader.fields:
            continue
        lib_v = getattr(lib, fname)
        surf_v = getattr(surface, fname)
        if _values_equal(fname, lib_v, surf_v):
            continue
        _record_divergence(sid, reader, fname, lib_v, surf_v, diverged, warnings)

    if "tags" in reader.fields and surface.tags is not None:
        if sorted(surface.tags) != (lib.tags or []):
            _record_divergence(sid, reader, "tags", lib.tags or [], surface.tags, diverged, warnings)

    # hotcues: whole-set comparison (glossary "Diverged"). None means the
    # surface doesn't carry cues for this track — not a divergence.
    if "hotcues" in reader.fields and surface.hotcues is not None:
        if not hotcue_sets_equal(lib.hotcues or [], surface.hotcues):
            _record_divergence(
                sid, reader, "hotcues", lib.hotcues or [], surface.hotcues, diverged, warnings
            )

    # beatgrid: structural comparison; surface None (no grid there) is not a
    # divergence, and the Library's placeholder already reads as None.
    if "beatgrid" in reader.fields and surface.beatgrid is not None:
        if not beatgrids_equal(lib.beatgrid, surface.beatgrid):
            _record_divergence(
                sid, reader, "beatgrid", lib.beatgrid, surface.beatgrid, diverged, warnings
            )

    # maincue: surface None means no user-set cue there (Engine: overridden
    # flag unset) — nothing to compare.
    if "maincue" in reader.fields and surface.maincue is not None:
        if lib.maincue is None or abs(lib.maincue - surface.maincue) > CUE_TIME_TOLERANCE:
            _record_divergence(
                sid, reader, "maincue", lib.maincue, surface.maincue, diverged, warnings
            )


def _record_divergence(
    sid: str,
    reader: SurfaceReader,
    fname: str,
    lib_v: object,
    surf_v: object,
    diverged: dict[str, FieldDivergence],
    warnings: list[str],
) -> None:
    d = diverged.get(fname)
    if d is None:
        empty = lib_v is None or lib_v == []
        d = FieldDivergence(
            field=fname,
            library_value=lib_v,
            surface_values={},
            importable_from=[],
            no_overwrite=empty,
        )
        if empty:
            warnings.append(
                f"Library has no {fname}; Export will skip it — "
                f"import manually if the downstream value is right"
            )
        diverged[fname] = d
    d.surface_values[sid] = surf_v
    # a surface can supply the field on Import only if it actually has a value
    has_value = surf_v is not None and surf_v != []
    if has_value and sid not in d.importable_from:
        d.importable_from.append(sid)


def _values_equal(fname: str, a: object, b: object) -> bool:
    if fname == "bpm" and a is not None and b is not None:
        return abs(float(a) - float(b)) <= BPM_TOLERANCE  # type: ignore[arg-type]
    # a surface with no value where the library also has none is agreement;
    # asymmetric emptiness is a divergence (handled by caller via _record)
    return a == b


# ---------------------------------------------------------------- orphan rows


def _orphan_rows(
    surfaces: Mapping[str, SurfaceReader],
    surface_refs: dict[str, list[SurfaceTrackRef]],
    matched_ref_ids: set[int],
) -> list[SyncStatusRow]:
    """Rows for tracks that exist on Surfaces but not in the Library.
    A track on several Surfaces merges into one row (matched by path).
    Disk is iterated first so a merged orphan that exists on disk rolls up as
    "unimported" — the actionable path is Disk Import."""
    orphans: list[SyncStatusRow] = []
    by_path: dict[str, SyncStatusRow] = {}
    by_filename: dict[str, SyncStatusRow] = {}

    for sid in SURFACE_IDS:  # disk first
        if sid not in surfaces:
            continue
        for ref in surface_refs[sid]:
            if id(ref) in matched_ref_ids:
                continue
            path = ref.path or ""
            existing = by_path.get(path) or by_filename.get(Path(path).name)
            if existing is not None:
                existing.presence[sid] = True
                continue
            row = SyncStatusRow(
                path=path,
                title=ref.fields.title,
                artist=ref.fields.artist,
                track_id=None,
                presence={
                    "library": False,
                    "disk": False,
                    "engine": False,
                    "rekordbox": False,
                    sid: True,
                },
                status="unimported" if sid == "disk" else "not-in-library",
                unprocessed=False,
            )
            orphans.append(row)
            by_path[path] = row
            by_filename[Path(path).name] = row

    return orphans
