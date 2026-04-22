"""
One-time script to assign colors to all existing tags.
Run after adding color column to tags table.
"""
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "data" / "library.db"

# Color palette (same as frontend)
COLORS = [
    '#aa76e9',  # mauve
    '#7b8aea',  # lavender
    '#e55f85',  # red
    '#e36d80',  # maroon
    '#e59461',  # peach
    '#eac77b',  # yellow
    '#7ad872',  # green
    '#6495e6',  # blue
    '#50b5e2',  # sapphire
    '#ea7bcb',  # pink
    '#58cfe4',  # sky
    '#66d9c5',  # teal
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
