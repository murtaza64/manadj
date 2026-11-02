"""Read DB facts without touching media, assigning identity, or applying remote data."""
from collections import defaultdict

from pydantic import ValidationError
from sqlalchemy import select

from ..models import Track
from .contracts import MAX_EXPORT, MAX_TRACKS, ExportRequest, Facts, Inventory, Location, TrackRow, canonical

CAPABILITIES = {"merge": False, "session_import": False, "audio_transfer": False}


class TooLarge(ValueError):
    pass


def location_for(filename, roots):
    matches = []
    for root in roots:
        path, base = root.pure(filename), root.pure(root.path)
        if not path.is_absolute() or ".." in path.parts:
            continue
        try:
            location = Location(root_key=root.key, parts=list(path.relative_to(base).parts))
        except (ValueError, ValidationError):
            continue
        matches.append((len(base.parts), location))
    if not matches:
        return None
    # Longest explicit root wins; equally specific aliases are not guessed.
    longest = max(length for length, _ in matches)
    best = [location for length, location in matches if length == longest]
    return best[0] if len(best) == 1 else None


def export_inventory(db, request: ExportRequest):
    with db.no_autoflush:
        tracks = db.scalars(select(Track).order_by(Track.id).limit(MAX_TRACKS + 1)).all()
    if len(tracks) > MAX_TRACKS:
        raise TooLarge("inventory_track_limit")
    ids = {str(track.id) for track in tracks}
    if not request.logical_ids.keys() <= ids:
        raise ValueError("Logical UUID mapping references unknown local Track")
    rows = []
    for track in tracks:
        facts = Facts(title=track.title, artist=track.artist, bpm_centibpm_cache=track.bpm,
                      key=track.key, energy=track.energy, duration_secs=track.duration_secs,
                      filesize_bytes=track.filesize_bytes, archived=track.archived_at is not None)
        fields = {
            "source_local_id": track.id,
            "logical_track_id": str(request.logical_ids[str(track.id)]) if str(track.id) in request.logical_ids else None,
            "source_created_at": track.created_at.isoformat() if track.created_at else None,
            "location": location_for(track.filename, request.roots),
            "legacy_hash_hint": track.file_hash, "availability": "not_checked", "facts": facts,
        }
        # Serialize public facts through typed models before computing a token.
        fields["location"] = fields["location"].model_dump() if fields["location"] else None
        fields["facts"] = facts.model_dump()
        wire_fields = {**fields, "snapshot_token": TrackRow.token(fields)}
        rows.append(TrackRow.model_validate_json(canonical(wire_fields)))
    inventory = Inventory(format="manadj-peer-inventory", version=1, replica_id=request.replica_id, tracks=rows)
    if len(canonical(inventory.model_dump(mode="json"))) > MAX_EXPORT:
        raise TooLarge("inventory_byte_limit")
    return inventory


def _hints(row):
    if row.logical_track_id:
        yield "logical_id_claim", str(row.logical_track_id)
    if row.location:
        yield "relative_location", (row.location.root_key, tuple(row.location.parts))
    if row.legacy_hash_hint:
        yield "legacy_hash_hint", row.legacy_hash_hint
    if row.facts.title and row.facts.artist:
        yield "metadata", (row.facts.title, row.facts.artist)


def compare_inventory(db, request):
    local = export_inventory(db, request.local)
    by_id = {row.source_local_id: row for row in local.tracks}
    index = defaultdict(set)
    for row in local.tracks:
        for hint in _hints(row):
            index[hint].add(row.source_local_id)
    items = []
    hinted_local_ids = set()
    configured_root_keys = {root.key for root in request.local.roots}
    for remote in request.remote.tracks:
        matches = defaultdict(list)
        for hint in _hints(remote):
            for local_id in index.get(hint, ()):
                matches[local_id].append(hint[0])
        hinted_local_ids.update(matches)
        candidates = []
        remote_facts = remote.facts.model_dump()
        for local_id in sorted(matches)[:20]:
            facts = by_id[local_id].facts.model_dump()
            candidates.append({"local_id": local_id, "reasons": sorted(matches[local_id]),
                               "divergent_fields": [key for key, value in remote_facts.items() if facts[key] != value]})
        overlap = by_id.get(remote.source_local_id)
        items.append({
            "source_local_id": remote.source_local_id,
            "status": "ambiguous" if len(matches) > 1 else "candidate" if matches else "unresolved",
            "candidate_total": len(matches), "candidates": candidates, "resolved_local_id": None,
            "local_id_overlap": overlap is not None,
            "origin_row_changed": bool(overlap and local.replica_id == request.remote.replica_id
                                       and overlap.snapshot_token != remote.snapshot_token),
            "location_unmapped": remote.location is None or remote.location.root_key not in configured_root_keys,
        })
    return {"version": 1, "source_replica_id": str(request.remote.replica_id),
            "local_replica_id": str(local.replica_id), "items": items, "capabilities": CAPABILITIES,
            "local_without_candidate_ids": sorted(by_id.keys() - hinted_local_ids),
            "local_unmapped_ids": [row.source_local_id for row in local.tracks if row.location is None],
            "notice": "Candidate hints only; no identity resolution, availability check, deletion inference or merge."}
