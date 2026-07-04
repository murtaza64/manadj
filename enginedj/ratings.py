"""Energy ↔ Engine star-rating encoding.

Engine DJ stores Track.rating as a 0-100 int (star = rating/20; 0 = unrated).
manadj's Energy (1-5) encodes on the Engine Surface as that star rating.
This mapping is the enginedj package's format knowledge — every read or
write of energy at the Engine boundary goes through here.
"""

_STAR = 20  # rating points per star


def rating_to_energy(rating: int | None) -> int | None:
    """Decode an Engine rating to Energy. 0/NULL (unrated) decode as absent;
    any positive rating rounds to the nearest star (half up), clamped 1-5."""
    if rating is None or rating <= 0:
        return None
    stars = (rating + _STAR // 2) // _STAR  # round half up
    return max(1, min(5, stars))


def energy_to_rating(energy: int) -> int:
    """Encode Energy as an Engine rating (exact star multiple)."""
    if not 1 <= energy <= 5:
        raise ValueError(f"Energy must be 1-5, got {energy}")
    return energy * _STAR
