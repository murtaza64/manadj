"""Read-only cross-copy candidates. Never evidence for import reuse or field writes."""
import re
from pathlib import Path

from backend.acquisition.matching import (
    MatchingConfig,
    artists_compatible,
    duration_status,
    normalize,
    score_pair,
)

_PREFIX = re.compile(r'^\d{1,3}[\s._-]+')
_VERSION = re.compile(r'\b(remix|vip|bootleg|edit|dub|mix|instrumental|extended|original|radio)\b', re.I)
_BRACKETS = re.compile(r'\([^)]*\)|\[[^]]*\]')


def core_title(title: str | None) -> str:
    """Title without numbering or version qualifiers, for fuzzy suggestions only.

    Never feed this into auto-confirm: 'Ascension' and 'Ascension (Aries Remix)'
    share a core. Conflicting explicit version labels are still withheld by
    version_tokens before scoring reaches this. Only bracketed segments that
    are themselves version qualifiers are dropped; unrelated parentheticals
    ('(Live at Printworks)', '(Part 2)') stay, since they can be the title's
    identity.
    """
    title = _PREFIX.sub('', title or '')
    title = _BRACKETS.sub(lambda m: ' ' if _VERSION.search(m.group(0)) else m.group(0), title)
    parts = re.split(r'\s[-–]\s', title)
    if len(parts) > 1 and _VERSION.search(parts[-1]):
        title = parts[0]
    return title


def version_tokens(title: str) -> set[str]:
    # Keep version qualifiers, not only the word remix. Different named remixes must not collapse.
    parts = re.findall(r'\(([^)]+)\)|\[([^]]+)\]', title)
    qualified = [a or b for a, b in parts if _VERSION.search(a or b)]
    # An unbracketed version suffix is still meaningful. Keep the entire trailing
    # segment after a separator rather than reducing named remixes to just remix.
    if not qualified and _VERSION.search(title):
        qualified = [re.split(r'\s[-–]\s', title)[-1]]
    return set(normalize(' '.join(qualified)).split())


def suggest_copies(entries: list, tracks: list) -> dict[int, list[dict]]:
    """Top three alternatives, with ties retained, using acquisition name/duration evidence.

    No audio was decoded or fingerprinted here. Even an exact name/duration is only a
    suggestion. Missing duration and conflicting explicit version labels are withheld.
    """
    config = MatchingConfig()
    by_token: dict[str, list[int]] = {}
    for i, track in enumerate(tracks):
        words = normalize(f'{track.title or ""} {track.artist or ""} {Path(track.filename).stem}')
        for token in set(words.split()):
            by_token.setdefault(token, []).append(i)
    result = {}
    for entry in entries:
        if entry.status not in ('new', 'uncertain') or not entry.duration_secs or not entry.title:
            continue
        title = _PREFIX.sub('', entry.title)
        candidates = set()
        for token in set(normalize(title).split()):
            candidates.update(by_token.get(token, ()))
        found = []
        for i in sorted(candidates):
            track = tracks[i]
            dur = duration_status(entry.duration_secs * 1000, track.duration_secs, config)
            if dur not in ('exact', 'plausible'):
                continue
            left, right = version_tokens(title), version_tokens(track.title or '')
            if left and right and left != right:
                continue
            if not artists_compatible(entry.artist, track.artist):
                continue
            score = score_pair(title, entry.artist or '', track.title, track.artist, track.filename)
            # Rips and stores drop version qualifiers, so also compare the bare
            # titles. Suggestions only: this never feeds auto-confirm.
            core = score_pair(core_title(title), entry.artist or '',
                              core_title(track.title), track.artist, track.filename)
            score = max(score, core)
            if score < config.proposal_score:
                continue
            found.append({'track_id': track.id, 'title': track.title, 'artist': track.artist,
                          'filename': track.filename, 'score': round(score, 3), 'duration': dur,
                          'evidence': 'Similar name and duration only; audio identity unverified'})
        found.sort(key=lambda row: (-row['score'], row['track_id']))
        if found:
            result[entry.ordinal] = found[:3]
    return result
