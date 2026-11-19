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
    entries: list[PullEntryOut]


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
        entries=[PullEntryOut(**vars(e)) for e in preview.entries],
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
    return _preview_out(preview)


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
    try:
        result = external_drives.execute_pull(
            db,
            Path(request.root),
            Path(destination),
            expected_fingerprint=request.preview_fingerprint,
        )
    except external_drives.PlanChangedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except external_drives.ExternalDriveError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "root": result.root,
        "kind": result.kind,
        "destination": result.destination,
        "imported": result.imported,
        "skipped_present": result.skipped_present,
        "skipped_uncertain": result.skipped_uncertain,
        "skipped_duplicate": result.skipped_duplicate,
        "skipped_missing_file": result.skipped_missing_file,
        "errors": result.errors,
        "track_ids": result.track_ids,
      }
