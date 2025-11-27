"""Color mapping and energy-to-color translation for Rekordbox."""

from pyrekordbox.db6.tables import DjmdColor


def build_energy_color_map(rb_session) -> dict[int, str]:
    """
    Build mapping from manadj energy values (1-5) to Rekordbox ColorIDs.

    Auto-discovers ColorIDs by querying djmdColor table and matching color names.

    Args:
        rb_session: Rekordbox SQLAlchemy session

    Returns:
        dict[int, str]: energy_value -> ColorID (as string)
    """
    ENERGY_COLOR_NAMES = {
        1: "Blue",
        2: "Aqua",      # May also match "Cyan" or "Turquoise"
        3: "Yellow",
        4: "Orange",
        5: "Red"
    }

    energy_to_color_id = {}
    colors = rb_session.query(DjmdColor).all()

    for energy, target_name in ENERGY_COLOR_NAMES.items():
        for color in colors:
            if color.Commnt and target_name.lower() in color.Commnt.lower():
                energy_to_color_id[energy] = color.ID
                break

    return energy_to_color_id
