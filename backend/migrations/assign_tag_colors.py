"""
One-time script to assign colors to all existing tags.
Run after adding color column to tags table.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "data" / "library.db"

# Color palette (same as frontend)
COLORS = [
    '#cba6f7',  # mauve
    '#b4befe',  # lavender
    '#f38ba8',  # red
    '#eba0ac',  # maroon
    '#fab387',  # peach
    '#f9e2af',  # yellow
    '#a6e3a1',  # green
    '#89b4fa',  # blue
    '#74c7ec',  # sapphire
    '#f5c2e7',  # pink
    '#89dceb',  # sky
    '#94e2d5',  # teal
]

def assign_colors():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get all tags without colors, ordered by category and display_order
    cursor.execute("""
        SELECT id, name, category_id
        FROM tags
        WHERE color IS NULL
        ORDER BY category_id, display_order, id
    """)
    tags = cursor.fetchall()

    if not tags:
        print("✓ All tags already have colors")
        conn.close()
        return

    # Assign colors in round-robin fashion
    for i, (tag_id, tag_name, category_id) in enumerate(tags):
        color = COLORS[i % len(COLORS)]
        cursor.execute("UPDATE tags SET color = ? WHERE id = ?", (color, tag_id))
        print(f"✓ Assigned {color} to tag '{tag_name}' (ID {tag_id})")

    conn.commit()
    conn.close()
    print(f"\n✓ Assigned colors to {len(tags)} tags")

if __name__ == "__main__":
    assign_colors()
