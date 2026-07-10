"""Rekordbox hot-cue pad ↔ djmdCue.Kind mapping, and cue colors.

FINAL — pinned by a self-labeling experiment (2026-07-10: Kinds 1-9
written with Comment "K<kind>"; the user read the pad grid):

    pad:  A  B  C  D  E  F  G  H
    Kind: 1  2  3  5  6  7  8  9

Kind 4 exists but RENDERS AS A MEMORY CUE (legacy type) — never write
it, and never interpret it as a hot cue. (An earlier "controlled"
contradiction was a hot-reload artifact: the lane app's uvicorn watches
backend/ only, so a stale map in rekordbox/ served that export.)
manadj slots 1-8 map to pads A-H.

Colors: `djmdCue.Color` is a palette INDEX (-1 = none). Probe-confirmed
(memory cues Color 0-7, user readout):

    0 pink · 1 red · 2 orange · 3 yellow · 4 green · 5 aqua · 6 blue · 7 purple

The old real-library shape (Color=255 + ColorTableIndex) does not render
in RB7 — never write it.
"""

SLOT_TO_KIND: dict[int, int] = {1: 1, 2: 2, 3: 3, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9}
KIND_TO_SLOT: dict[int, int] = {v: k for k, v in SLOT_TO_KIND.items()}
HOT_CUE_KINDS = frozenset(SLOT_TO_KIND.values())
MEMORY_KIND = 0
LEGACY_MEMORY_KIND = 4  # renders as a memory cue; never written by manadj

# palette index -> representative RGB (for display + nearest-color export)
CUE_PALETTE: dict[int, tuple[int, int, int]] = {
    0: (237, 100, 216),  # pink
    1: (228, 43, 43),    # red
    2: (232, 160, 41),   # orange
    3: (232, 220, 40),   # yellow
    4: (53, 211, 68),    # green
    5: (44, 190, 232),   # aqua
    6: (42, 72, 232),    # blue
    7: (142, 43, 232),   # purple
}


def palette_index_to_hex(index: int | None) -> str | None:
    if index is None or index not in CUE_PALETTE:
        return None
    r, g, b = CUE_PALETTE[index]
    return f"#{r:02X}{g:02X}{b:02X}"


def nearest_palette_index(hex_color: str | None) -> int | None:
    """Nearest RB palette index for a manadj #RRGGBB color (None -> None)."""
    if not hex_color:
        return None
    try:
        s = hex_color.lstrip("#")
        r, g, b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except (ValueError, IndexError):
        return None
    return min(
        CUE_PALETTE,
        key=lambda i: sum((a - b) ** 2 for a, b in zip(CUE_PALETTE[i], (r, g, b))),
    )
