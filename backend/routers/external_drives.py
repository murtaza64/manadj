"""External drive libraries: detect Rekordbox/Engine USB libraries, confirmed pull.

Pull = device -> manadj only. Push (manadj -> device) writes a manufacturer
library and is a separate feature (export gate, ADR 0043); nothing here
writes to a drive.
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import external_drives
from ..database import get_db

router = APIRouter()


class PreviewRequest(BaseModel):
    root: str
    # Optional: bind the returned fingerprint to this destination. The UI
    # re-previews with the destination right before confirming, so the
    # fingerprint it confirms covers the reviewed set AND where it lands.
    destination: str | None = None
    # False skips content verification (no hashing): the response lists
    # every track with its metadata immediately, with matches that still
    # need verification left "uncertain". Imports must bind a verified
    # preview's fingerprint, never a fast one.
    verify: bool = True


class ImportRequest(BaseModel):
    root: str
    destination: str | None = None
    # The UI shows build_pull_preview output first; the import runs only on
    # an explicit confirm. Anything but true is a refusal, never a default.
    confirm: bool = False
    # Binds the confirm to the reviewed preview: the server recomputes the
    # plan and refuses when it no longer matches, so the confirmed set can
    # never silently grow or shrink between preview and click.
    preview_fingerprint: str | None = None
    # The user's checkbox selection from that same reviewed plan (entry
    # ordinals). None imports every new entry. Any ordinal that is not a
    # new entry in the verified plan refuses the whole import.
    ordinals: list[int] | None = None
    # Optional: import one device playlist's new tracks and create a local
    # playlist with every resolvable member in device order. The playlist
    # defines the selection; combining it with explicit ordinals is
    # refused so the two can never disagree.
    create_playlist_id: int | None = None
    # Override for the local playlist name (defaults to the device name).
    playlist_name: str | None = None
    # The user's explicit local counterpart for a sync-from-USB update.
    # Only meaningful with create_playlist_id; a name suggestion never
    # fills this in - the client passes it after the user picks the exact
    # local playlist.
    update_playlist_id: int | None = None
    # Snapshot of the local target as reviewed; required with
    # update_playlist_id so a target edited since the review is refused
    # instead of silently overwritten.
    update_target_token: str | None = None


class PullEntryOut(BaseModel):
    ordinal: int
    title: str | None
    artist: str | None
    bpm: float | None
    key: str | None
    duration_secs: float | None
    device_path: str
    status: str
    detail: str | None
    matched_path: str | None
    matched_track_id: int | None = None
    candidates: list[dict] = []


class MembershipOut(BaseModel):
    counterpart_status: str
    counterpart_id: int | None
    target_token: str | None = None
    candidate_id: int | None = None
    candidate_name: str | None = None
    common: int
    adds_in_library: int
    adds_new: int
    removes: int
    removes_provisional: bool
    uncertain_members: int
    order_differs: bool | None


class PlaylistOut(BaseModel):
    id: int
    name: str | None
    folder_path: str
    folder_parts: list[str] = []
    sort_order: int
    track_count: int
    new_count: int
    present_count: int
    uncertain_count: int
    other_count: int
    track_ordinals: list[int] = []
    membership: MembershipOut | None = None
    folder_not_representable: bool = False


class PreviewResponse(BaseModel):
    root: str
    kind: str
    device_track_count: int
    new_count: int
    present_count: int
    uncertain_count: int
    duplicate_count: int
    missing_file_count: int
    default_destination: str | None
    fingerprint: str
    source_fingerprint: str
    entries: list[PullEntryOut]
    playlists: list[PlaylistOut] = []


def _preview_out(preview: external_drives.PullPreview) -> PreviewResponse:
    return PreviewResponse(
        root=preview.root,
        kind=preview.kind,
        device_track_count=preview.device_track_count,
        new_count=preview.new_count,
        present_count=preview.present_count,
        uncertain_count=preview.uncertain_count,
        duplicate_count=preview.duplicate_count,
        missing_file_count=preview.missing_file_count,
        default_destination=preview.default_destination,
        fingerprint=preview.fingerprint,
        source_fingerprint=preview.source_fingerprint,
        entries=[PullEntryOut(**vars(e)) for e in preview.entries],
        playlists=[
            PlaylistOut(
                **{k: v for k, v in vars(pl).items() if k != "membership"},
                membership=MembershipOut(**vars(pl.membership)) if pl.membership else None,
            )
            for pl in preview.playlists
        ],
    )


@router.get("")
def list_drives():
    """Detect Rekordbox/Engine libraries on mounted external drives."""
    from dataclasses import asdict

    return [asdict(d) for d in external_drives.detect_drives()]


@router.post("/preview", response_model=PreviewResponse)
def preview_pull(request: PreviewRequest, db: Session = Depends(get_db)):
    """Read-only diff of a device library against the manadj library."""
    try:
        preview = external_drives.build_pull_preview(
            db,
            Path(request.root),
            Path(request.destination) if request.destination else None,
            verify=request.verify,
        )
    except external_drives.ExternalDriveError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    response = _preview_out(preview)
    # Suggestions are display-only: they never change status, fingerprints, import
    # selection, counterpart identity or field-write eligibility.
    from backend.models import Track
    from backend.sync_common.suggestions import suggest_copies
    tracks = db.query(Track).all()
    candidates = suggest_copies(preview.entries, tracks)
    # Only already content-verified matches may borrow a Library waveform.
    # A path or name suggestion alone must never supply preview identity.
    ids_by_path: dict[str, list[int]] = {}
    for track in tracks:
        ids_by_path.setdefault(track.filename, []).append(track.id)
    for entry in response.entries:
        entry.candidates = candidates.get(entry.ordinal, [])
        ids = ids_by_path.get(entry.matched_path, [])
        if entry.status == "present" and len(ids) == 1:
            entry.matched_track_id = ids[0]
    return response


class CheckRequest(BaseModel):
    root: str


class FieldChange(BaseModel):
    track_id: int
    field: str
    # The values the user reviewed. Required (null is a valid reviewed value):
    # a change refuses if either moved since review.
    drive: str | float | None
    library: str | float | None


class FieldApplyRequest(BaseModel):
    root: str
    preview_fingerprint: str
    changes: list[FieldChange]


@router.post("/fields/apply")
def apply_fields(request: FieldApplyRequest, db: Session = Depends(get_db)):
    """Take the drive's value for reviewed (track, field) pairs. Library only."""
    try:
        return external_drives.apply_field_changes(
            db, Path(request.root), request.preview_fingerprint,
            [c.model_dump(exclude_unset=True) for c in request.changes],
        )
    except external_drives.FieldChangeRefused as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except external_drives.ExternalDriveError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/fields")
def compare_fields(request: CheckRequest, db: Session = Depends(get_db)):
    """Read-only per-track metadata comparison against the library."""
    try:
        preview = external_drives.build_pull_preview(db, Path(request.root), None, verify=True)
    except external_drives.ExternalDriveError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return external_drives.compare_matched_fields(db, preview)


class ExportImpactRequest(BaseModel):
    root: str
    playlist_ids: list[int] = []


@router.post("/export/impact")
def export_impact(request: ExportImpactRequest, db: Session = Depends(get_db)):
    """Read-only: what exporting these playlists to this drive would rebuild. Writes nothing."""
    try:
        return external_drives.export_impact(db, Path(request.root), request.playlist_ids)
    except external_drives.ExternalDriveError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/check")
def check_structure(request: CheckRequest):
    """Read-only structural readback of a drive (see check_drive_structure)."""
    try:
        return external_drives.check_drive_structure(Path(request.root))
    except external_drives.ExternalDriveError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - an unreadable tree is a result, not a 500
        return {"kind": "rekordbox", "checked": True, "tracks": 0, "playlists": 0,
                "analysis_files": 0, "errors": [f"unreadable: {exc}"], "error_count": 1}


@router.post("/import")
def import_pull(request: ImportRequest, db: Session = Depends(get_db)):
    """Run the confirmed pull: copy new audio into the library, add Tracks."""
    if request.confirm is not True:
        raise HTTPException(
            status_code=400,
            detail="Pull imports require confirm: true after reviewing the preview.",
        )
    if not request.preview_fingerprint:
        raise HTTPException(
            status_code=400,
            detail=(
                "Pull imports require the preview's fingerprint, so the "
                "confirmed set is bound to what was reviewed."
            ),
        )
    destination = request.destination or external_drives.default_destination()
    if not destination:
        raise HTTPException(
            status_code=400,
            detail="No library directory configured; pass an explicit destination.",
        )
    if request.update_playlist_id is not None and not request.update_target_token:
        raise HTTPException(
            status_code=400,
            detail="update_playlist_id requires update_target_token (the reviewed snapshot of the local target).",
        )
    if request.update_playlist_id is not None and request.create_playlist_id is None:
        raise HTTPException(
            status_code=400,
            detail="update_playlist_id requires create_playlist_id (the device playlist to sync from).",
        )
    if request.update_playlist_id is not None and request.playlist_name is not None:
        raise HTTPException(
            status_code=400,
            detail="an update keeps the existing playlist's name; do not pass playlist_name.",
        )
    if request.create_playlist_id is not None and request.ordinals is not None:
        raise HTTPException(
            status_code=400,
            detail=(
                "create_playlist_id already selects the playlist's new tracks; "
                "do not combine it with explicit ordinals."
            ),
        )
    try:
        if request.update_playlist_id is not None:
            update_result = external_drives.execute_playlist_update(
                db,
                Path(request.root),
                Path(destination),
                device_playlist_id=request.create_playlist_id,
                local_playlist_id=request.update_playlist_id,
                expected_target_token=request.update_target_token,
                expected_fingerprint=request.preview_fingerprint,
            )
            result = update_result.pull
            playlist_result = None
        elif request.create_playlist_id is not None:
            update_result = None
            playlist_result = external_drives.execute_playlist_pull(
                db,
                Path(request.root),
                Path(destination),
                device_playlist_id=request.create_playlist_id,
                expected_fingerprint=request.preview_fingerprint,
                playlist_name=request.playlist_name,
            )
            result = playlist_result.pull
        else:
            update_result = None
            playlist_result = None
            result = external_drives.execute_pull(
                db,
                Path(request.root),
                Path(destination),
                expected_fingerprint=request.preview_fingerprint,
                ordinals=set(request.ordinals) if request.ordinals is not None else None,
            )
    except external_drives.PlanChangedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except external_drives.ExternalDriveError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    response = {
        "root": result.root,
        "kind": result.kind,
        "destination": result.destination,
        "imported": result.imported,
        "skipped_present": result.skipped_present,
        "skipped_uncertain": result.skipped_uncertain,
        "skipped_duplicate": result.skipped_duplicate,
        "skipped_missing_file": result.skipped_missing_file,
        "skipped_unselected": result.skipped_unselected,
        "errors": result.errors,
        "track_ids": result.track_ids,
    }
    if playlist_result is not None:
        response["playlist"] = {
            "playlist_id": playlist_result.playlist_id,
            "name": playlist_result.name,
            "member_count": playlist_result.member_count,
            "imported": playlist_result.imported,
            "already_in_library": playlist_result.already_in_library,
            "skipped_uncertain": playlist_result.skipped_uncertain,
            "skipped_other": playlist_result.skipped_other,
        }
    if update_result is not None:
        response["playlist_update"] = {
            "playlist_id": update_result.playlist_id,
            "name": update_result.name,
            "member_count": update_result.member_count,
            "added_imported": update_result.added_imported,
            "added_from_library": update_result.added_from_library,
            "kept_local_only": update_result.kept_local_only,
            "skipped_uncertain": update_result.skipped_uncertain,
            "skipped_other": update_result.skipped_other,
        }
    return response
