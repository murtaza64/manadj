"""Tag structure comparison and matching logic."""

from .models import TagStructure, TagInfo


def match_tags_by_name(
    structures: dict[str, TagStructure | None]
) -> dict[tuple[str, str], dict[str, TagInfo | None]]:
    """Match tags by (category_name, tag_name) across all sources.

    Engine DJ uses a flat structure (no categories), so matching is done
    by tag name only for Engine. For manadj and rekordbox, full
    (category_name, tag_name) pairs are used.

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
    # Collect all unique (category, tag) pairs from manadj/rekordbox
    all_pairs = set()

    for source_name, structure in structures.items():
        if structure is None or source_name == 'engine':
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
                    if source_name == 'engine':
                        # Engine uses flat structure - index by tag name only
                        lookups[source_name][tag.name] = tag
                    else:
                        lookups[source_name][(category.name, tag.name)] = tag

    # Match across sources
    matched = {}
    for pair in all_pairs:
        tag_name = pair[1]
        matched[pair] = {
            'manadj': lookups.get('manadj', {}).get(pair),
            # Engine matches by tag name only (flat structure)
            'engine': lookups.get('engine', {}).get(tag_name),
            'rekordbox': lookups.get('rekordbox', {}).get(pair),
        }

    return matched
