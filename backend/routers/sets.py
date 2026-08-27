"""Sets API (sets PRD, issue 01).

A Set is an ordered sequence of Tracks whose adjacencies pin evidence
(issue 02) — a plan over the library, never an owner: deleting a Set
touches no Track/Transition/Take.

Set metadata is plain CRUD (mirroring playlists). The entry list is
client-authoritative (ADR 0011): the client owns Set state and replaces
the whole ordered list in one PUT, reconciled by track_id (entry
identity — a Track appears at most once per Set). Position is the
payload index.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from .. import models, schemas
from ..database import get_db

router = APIRouter()


def degrade_pins(db: Session, kind: str, uuids: set[str]) -> None:
    """Degrade dangling pins to Unresolved (sets 12): null every Set pin
    of the given kind referencing a deleted artifact — the DB never keeps
    a broken reference. Dormant pins (sets 07) referencing it are DROPPED
    outright: a memory of a deleted artifact restores nothing. Called
    from the deletion paths (takes router, transitions pair replace);
    the caller commits.
    """
    if not uuids:
        return
    db.query(models.SetEntry).filter(
        models.SetEntry.pin_kind == kind,
        models.SetEntry.pin_uuid.in_(uuids),
    ).update(
        {models.SetEntry.pin_kind: None, models.SetEntry.pin_uuid: None},
        synchronize_session=False,
    )
    db.query(models.SetDormantPin).filter(
        models.SetDormantPin.pin_kind == kind,
        models.SetDormantPin.pin_uuid.in_(uuids),
    ).delete(synchronize_session=False)


def degrade_cameo_pins(db: Session, kind: str, uuids: set[str]) -> None:
    """Drop Cameo pins referencing deleted artifacts (#140): a Cameo pin
    has no Unresolved state to degrade to (ornaments resolve to nothing),
    so active AND dormant rows are deleted outright. `kind` is "cameo"
    (cameos pair-replace) or "cameo-take" (takes delete); the caller
    commits."""
    if not uuids:
        return
    db.query(models.SetCameoPin).filter(
        models.SetCameoPin.pin_kind == kind,
        models.SetCameoPin.pin_uuid.in_(uuids),
    ).delete(synchronize_session=False)


def _archived_set_ids(db: Session, set_ids: list[int]) -> set[int]:
    """The subset of the given Sets containing at least one Archived Track
    (sets 12: the Set is flagged, never altered)."""
    if not set_ids:
        return set()
    rows = (
        db.query(models.SetEntry.set_id)
        .join(models.Track, models.Track.id == models.SetEntry.track_id)
        .filter(
            models.SetEntry.set_id.in_(set_ids),
            models.Track.archived_at.isnot(None),
        )
        .distinct()
        .all()
    )
    return {set_id for (set_id,) in rows}


def _get_set(db: Session, set_id: int) -> models.Set:
    row = db.query(models.Set).filter(models.Set.id == set_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Set {set_id} not found")
    return row


def _with_entries(db: Session, set_id: int) -> models.Set:
    row = (
        db.query(models.Set)
        .options(
            selectinload(models.Set.entries),
            selectinload(models.Set.dormant_pins),
            selectinload(models.Set.cameo_pins),
        )
        .filter(models.Set.id == set_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail=f"Set {set_id} not found")
    row.has_archived_tracks = bool(_archived_set_ids(db, [set_id]))
    # Cameo pins (#140): storage keys on (set, host track); the wire hangs
    # active pins off their entries and dormant ones off the Set.
    active_by_host: dict[int, list[models.SetCameoPin]] = {}
    dormant_cameos: list[models.SetCameoPin] = []
    for p in row.cameo_pins:
        if p.dormant:
            dormant_cameos.append(p)
        else:
            active_by_host.setdefault(p.host_track_id, []).append(p)
    for entry in row.entries:
        entry.cameo_pins = [
            schemas.CameoPinItem(pin_kind=p.pin_kind, pin_uuid=p.pin_uuid)
            for p in active_by_host.get(entry.track_id, [])
        ]
    row.dormant_cameos = [
        schemas.SetDormantCameoPinItem(
            host_track_id=p.host_track_id, pin_kind=p.pin_kind, pin_uuid=p.pin_uuid
        )
        for p in dormant_cameos
    ]
    return row


@router.get("", response_model=list[schemas.SetRow])
def list_sets(db: Session = Depends(get_db)):
    """All Sets, in sidebar order."""
    rows = (
        db.query(models.Set)
        .order_by(models.Set.display_order, models.Set.id)
        .all()
    )
    flagged = _archived_set_ids(db, [r.id for r in rows])
    for r in rows:
        r.has_archived_tracks = r.id in flagged
    return rows


@router.post("", response_model=schemas.SetRow, status_code=201)
def create_set(payload: schemas.SetCreate, db: Session = Depends(get_db)):
    row = models.Set(
        name=payload.name,
        color=payload.color,
        display_order=payload.display_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{set_id}", response_model=schemas.SetWithEntries)
def get_set(set_id: int, db: Session = Depends(get_db)):
    """One Set with its ordered entries."""
    return _with_entries(db, set_id)


@router.patch("/{set_id}", response_model=schemas.SetRow)
def update_set(set_id: int, payload: schemas.SetUpdate, db: Session = Depends(get_db)):
    """Update Set properties (name, color, display_order)."""
    row = _get_set(db, set_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    row.has_archived_tracks = bool(_archived_set_ids(db, [set_id]))
    return row


@router.delete("/{set_id}", status_code=204)
def delete_set(set_id: int, db: Session = Depends(get_db)):
    """Delete a Set (entries go with it; Tracks/Transitions/Takes stay)."""
    row = _get_set(db, set_id)
    db.delete(row)
    db.commit()
    return None


@router.post("/reorder", status_code=200)
def reorder_sets(order: list[schemas.SetOrderItem], db: Session = Depends(get_db)):
    """Reorder Sets in the sidebar."""
    for item in order:
        db.query(models.Set).filter(models.Set.id == item.id).update(
            {"display_order": item.display_order}
        )
    db.commit()
    return {"message": "Sets reordered"}


@router.put("/{set_id}/entries", response_model=schemas.SetWithEntries)
def replace_entries(
    set_id: int,
    payload: schemas.SetEntriesReplace,
    db: Session = Depends(get_db),
):
    """Replace the Set's ordered entry list (reconcile by track_id) and
    its Dormant pins (sets 07, replaced wholesale — memories have no
    identity beyond their ordered pair).

    An empty items list clears the Set. Idempotent: re-PUTting the same
    payload is a no-op (entry rows keep their ids).
    """
    _get_set(db, set_id)

    seen: set[int] = set()
    for item in payload.items:
        if item.track_id in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate track {item.track_id}")
        seen.add(item.track_id)
        if db.query(models.Track.id).filter(models.Track.id == item.track_id).first() is None:
            raise HTTPException(status_code=404, detail=f"Track {item.track_id} not found")

    seen_pairs: set[tuple[int, int]] = set()
    for d in payload.dormant:
        pair = (d.a_track_id, d.b_track_id)
        if pair in seen_pairs:
            raise HTTPException(
                status_code=400, detail=f"Duplicate dormant pair {pair[0]}→{pair[1]}"
            )
        seen_pairs.add(pair)
        for track_id in pair:
            if track_id in seen:
                continue
            if db.query(models.Track.id).filter(models.Track.id == track_id).first() is None:
                raise HTTPException(status_code=404, detail=f"Track {track_id} not found")

    for dc in payload.dormant_cameos:
        if dc.host_track_id in seen:
            continue
        if (
            db.query(models.Track.id).filter(models.Track.id == dc.host_track_id).first()
            is None
        ):
            raise HTTPException(
                status_code=404, detail=f"Track {dc.host_track_id} not found"
            )

    existing = {
        e.track_id: e
        for e in db.query(models.SetEntry).filter(models.SetEntry.set_id == set_id).all()
    }

    for position, item in enumerate(payload.items):
        entry = existing.get(item.track_id)
        if entry is None:
            db.add(
                models.SetEntry(
                    set_id=set_id,
                    track_id=item.track_id,
                    position=position,
                    pin_kind=item.pin_kind,
                    pin_uuid=item.pin_uuid,
                    trim=item.trim,
                )
            )
        else:
            entry.position = position
            entry.pin_kind = item.pin_kind
            entry.pin_uuid = item.pin_uuid
            entry.trim = item.trim

    for track_id, entry in existing.items():
        if track_id not in seen:
            db.delete(entry)

    # Dormant pins: wholesale replace (delete-and-insert — no row identity).
    db.query(models.SetDormantPin).filter(models.SetDormantPin.set_id == set_id).delete(
        synchronize_session=False
    )
    for d in payload.dormant:
        db.add(
            models.SetDormantPin(
                set_id=set_id,
                a_track_id=d.a_track_id,
                b_track_id=d.b_track_id,
                pin_kind=d.pin_kind,
                pin_uuid=d.pin_uuid,
            )
        )

    # Cameo pins (#140): wholesale replace, active (riding their entries)
    # and dormant (host-track memories) together — no row identity.
    db.query(models.SetCameoPin).filter(models.SetCameoPin.set_id == set_id).delete(
        synchronize_session=False
    )
    for item in payload.items:
        for position, cp in enumerate(item.cameo_pins):
            db.add(
                models.SetCameoPin(
                    set_id=set_id,
                    host_track_id=item.track_id,
                    position=position,
                    pin_kind=cp.pin_kind,
                    pin_uuid=cp.pin_uuid,
                    dormant=False,
                )
            )
    for position, dc in enumerate(payload.dormant_cameos):
        db.add(
            models.SetCameoPin(
                set_id=set_id,
                host_track_id=dc.host_track_id,
                position=position,
                pin_kind=dc.pin_kind,
                pin_uuid=dc.pin_uuid,
                dormant=True,
            )
        )

    db.commit()
    return _with_entries(db, set_id)
