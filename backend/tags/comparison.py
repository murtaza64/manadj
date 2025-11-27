"""Tag structure comparison and matching logic."""

from .models import TagStructure, TagInfo


def match_tags_by_name(
    structures: dict[str, TagStructure | None]
) -> dict[tuple[str, str], dict[str, TagInfo | None]]:
    """Match tags by (category_name, tag_name) across all sources.

    Args:
        structures: Dictionary with 'manadj', 'engine', 'rekordbox' keys

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
    # Collect all unique (category, tag) pairs
    all_pairs = set()

    for source_name, structure in structures.items():
        if structure is None:
            continue
        for category in structure.categories:
            for tag in category.tags:
                all_pairs.add((category.name, tag.name))

    # Build lookup dicts per source
    lookups = {}
    for source_name, structure in structures.items():
        lookups[source_name] = {}
        if structure:
            for category in structure.categories:
                for tag in category.tags:
                    lookups[source_name][(category.name, tag.name)] = tag

    # Match across sources
    matched = {}
    for pair in all_pairs:
        matched[pair] = {
            'manadj': lookups.get('manadj', {}).get(pair),
            'engine': lookups.get('engine', {}).get(pair),
            'rekordbox': lookups.get('rekordbox', {}).get(pair),
        }

    return matched
