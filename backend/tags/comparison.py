"""Tag structure comparison and matching logic.

Match itself — bucketing items across sources by a match key — is single-homed
in ``backend.sync_common.matching.match_by_key``. This module only supplies the
tag-specific key: manadj/rekordbox match on ``(category_name, tag_name)``, while
Engine's flat structure matches on tag name alone, so an Engine tag folds into
whatever ``(category, name)`` bucket shares its name.
"""

from backend.sync_common.matching import match_by_key

from .models import TagInfo, TagStructure


def _flatten(structure: TagStructure | None) -> list[TagInfo]:
    if structure is None:
        return []
    return [tag for category in structure.categories for tag in category.tags]


def match_tags_by_name(
    structures: dict[str, TagStructure | None]
) -> dict[tuple[str, str], dict[str, TagInfo | None]]:
    """Match tags by (category_name, tag_name) across all sources.

    Engine DJ uses a flat structure (no categories), so Engine matching is done
    by tag name only. For manadj and rekordbox, full (category_name, tag_name)
    pairs are used.

    Returns:
        Dictionary mapping (category_name, tag_name) to source tags:
        {
            ("Genre", "House"): {
                'manadj': TagInfo(...),
                'engine': TagInfo(...) or None,
                'rekordbox': TagInfo(...) or None
            }
        }
    """
    # Categorized sources (manadj, rekordbox) define the (category, name) buckets.
    categorized = {
        source: _flatten(structure)
        for source, structure in structures.items()
        if source != "engine"
    }
    buckets = match_by_key(categorized, key_of=lambda t: (t.category_name, t.name))

    # Engine's flat tags fold into buckets sharing their name (name-only Match).
    engine_by_name = {t.name: t for t in _flatten(structures.get("engine"))}

    matched: dict[tuple[str, str], dict[str, TagInfo | None]] = {}
    for (category_name, tag_name), bucket in buckets.items():
        matched[(category_name, tag_name)] = {
            "manadj": bucket.get("manadj"),
            "engine": engine_by_name.get(tag_name),
            "rekordbox": bucket.get("rekordbox"),
        }
    return matched
