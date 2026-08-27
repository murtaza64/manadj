"""Design-token mirror guard (gh#199, DESIGN.md).

backend/hotcue_palette.py cannot import frontend/src/theme/tokens.ts, so the
hotcue slot palette exists twice. This test replaces the old comment
discipline: both files are parsed and compared, so a palette edit that
touches only one side fails loudly.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

SLOT_HEX_RE = re.compile(r"^\s*(\d+):\s*['\"](#[0-9a-fA-F]{6})['\"],", re.MULTILINE)


def _slot_map(text: str, block_marker: str) -> dict[int, str]:
    """Extract {slot: hex} from the brace block following block_marker."""
    start = text.index(block_marker)
    block = text[start : text.index("}", start)]
    pairs = SLOT_HEX_RE.findall(block)
    assert pairs, f"no slot/hex pairs found after {block_marker!r}"
    return {int(slot): hex_.lower() for slot, hex_ in pairs}


def test_hotcue_palette_mirrors_frontend_tokens():
    backend = _slot_map(
        (REPO / "backend" / "hotcue_palette.py").read_text(),
        "HOT_CUE_SLOT_COLORS",
    )
    frontend = _slot_map(
        (REPO / "frontend" / "src" / "theme" / "tokens.ts").read_text(),
        "HOT_CUE_CSS_COLORS",
    )
    assert backend == frontend
    assert set(backend) == set(range(1, 9))
