"""List Rekordbox MyTag structure and tracks."""

from rekordbox import RekordboxReader


def main():
    reader = RekordboxReader()

    # Print MyTag structure
    print("=== MyTag Structure ===")
    structure = reader.get_mytag_structure()

    for category, tags in structure.categories.items():
        print(f"\n{category}:")
        for tag in tags:
            print(f"  - {tag}")

    # Print tracks with MyTags
    print("\n\n=== Tracks with MyTags ===")
    tracks = reader.get_tracks_with_mytags()

    for track in tracks[:10]:  # First 10
        tags_str = ", ".join([f"{cat}→{tag}" for cat, tag in track.mytags])
        print(f"{track.artist} - {track.title}")
        print(f"  Tags: {tags_str}")
        print(f"  Path: {track.file_path}")
        print()

    print(f"Total: {len(tracks)} tracks with MyTags")


if __name__ == '__main__':
    main()
