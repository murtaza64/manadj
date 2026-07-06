"""Native key Analysis: audio in, Track.key with provenance "analyzed" out.

ADR 0024: the winning key backend (madmom_keycnn, issue 06 shootout) sits
behind the same KeyCandidate seam the harness scored. Detection writes the
key straight onto the Track (keys have no side artifact — unlike grids there
is no bail/worklist concept: an undetected key simply writes nothing).
Precedence protection is the bulk runner's concern (issue 09) — this seam
overwrites freely.

Heavy deps (madmom) stay inside the candidate's key() — importing this
module is light (import-hygiene guard).
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from harness.key_candidates import KeyCandidate, MadmomKeyCNN

from . import models
from .key import Key


def default_key_candidate() -> KeyCandidate:
    """The shootout winner (native-analysis-accuracy 06): madmom KeyCNN."""
    return MadmomKeyCNN()


def analyze_track_key(
    db: Session, track: models.Track, candidate: KeyCandidate
) -> tuple[Key | None, float | None]:
    """Analyze one Track's key and persist the outcome.

    Detection: Track.key = the estimate, provenance "analyzed". Undetected
    ((None, None) from the candidate): nothing is written — whatever key and
    provenance the Track has stay untouched.
    """
    detected, confidence = candidate.key(track.filename)
    if detected is not None:
        track.key = detected.engine_id
        track.key_provenance = "analyzed"
        db.commit()
    return detected, confidence
