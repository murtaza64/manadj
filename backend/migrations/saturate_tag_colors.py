"""
One-time script to remap legacy tag colors to the current palette.
Applies to tags and tag categories. Safe to run multiple times.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "data" / "library.db"

COLOR_REMAP = {
    '#cba6f7': '#aa76e9',
    '#b4befe': '#7b8aea',
    '#f38ba8': '#e55f85',
    '#eba0ac': '#e36d80',
    '#fab387': '#e59461',
    '#f9e2af': '#eac77b',
    '#a6e3a1': '#7ad872',
    '#89b4fa': '#6495e6',
    '#74c7ec': '#50b5e2',
    '#f5c2e7': '#ea7bcb',
    '#89dceb': '#58cfe4',
    '#94e2d5': '#66d9c5',
    '#8b2aff': '#aa76e9',
    '#3954ff': '#7b8aea',
    '#ff1456': '#e55f85',
    '#f92446': '#e36d80',
    '#ff6f16': '#e59461',
    '#ffbf32': '#eac77b',
    '#3fe631': '#7ad872',
    '#1870ff': '#6495e6',
    '#00affd': '#50b5e2',
    '#ff3dca': '#ea7bcb',
    '#0ddaff': '#58cfe4',
    '#23ebc9': '#66d9c5',
}


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    placeholders = ", ".join("?" for _ in COLOR_REMAP)

    cursor.execute(
        f"""
        SELECT COUNT(*)
        FROM tags
        WHERE lower(color) IN ({placeholders})
        """,
        tuple(COLOR_REMAP.keys()),
    )
    tags_to_update = cursor.fetchone()[0]

    cursor.execute(
        f"""
        SELECT COUNT(*)
        FROM tag_categories
        WHERE lower(color) IN ({placeholders})
        """,
        tuple(COLOR_REMAP.keys()),
    )
    categories_to_update = cursor.fetchone()[0]

    if tags_to_update == 0 and categories_to_update == 0:
        print("✓ No tag colors needed remapping")
        conn.close()
        return

    cases = " ".join(
        f"WHEN '{old}' THEN '{new}'"
        for old, new in COLOR_REMAP.items()
    )

    if tags_to_update > 0:
        cursor.execute(
            f"""
            UPDATE tags
            SET color = CASE lower(color)
                {cases}
                ELSE color
            END
            WHERE lower(color) IN ({placeholders})
            """,
            tuple(COLOR_REMAP.keys()),
        )

    if categories_to_update > 0:
        cursor.execute(
            f"""
            UPDATE tag_categories
            SET color = CASE lower(color)
                {cases}
                ELSE color
            END
            WHERE lower(color) IN ({placeholders})
            """,
            tuple(COLOR_REMAP.keys()),
        )

    conn.commit()
    conn.close()
    print(f"✓ Updated {tags_to_update} tags and {categories_to_update} categories")


if __name__ == "__main__":
    migrate()
