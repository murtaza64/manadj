"""API routes for playlists."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from .. import crud, schemas
from ..database import get_db

router = APIRouter()


@router.get("/", response_model=List[schemas.Playlist])
def list_playlists(db: Session = Depends(get_db)):
    """Get all playlists ordered by display_order."""
    return crud.get_playlists(db)


@router.get("/{playlist_id}", response_model=schemas.PlaylistWithTracks)
def get_playlist(playlist_id: int, db: Session = Depends(get_db)):
    """Get a playlist with all its tracks in order."""
    playlist = crud.get_playlist_with_tracks(db, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.post("/", response_model=schemas.Playlist, status_code=201)
def create_playlist(playlist: schemas.PlaylistCreate, db: Session = Depends(get_db)):
    """Create a new playlist."""
    return crud.create_playlist(db, playlist)


@router.patch("/{playlist_id}", response_model=schemas.Playlist)
def update_playlist(
    playlist_id: int,
    playlist_update: schemas.PlaylistUpdate,
    db: Session = Depends(get_db)
):
    """Update playlist properties (name, color, display_order)."""
    playlist = crud.update_playlist(db, playlist_id, playlist_update)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.delete("/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: int, db: Session = Depends(get_db)):
    """Delete a playlist."""
    result = crud.delete_playlist(db, playlist_id)
    if not result:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return None


@router.post("/{playlist_id}/tracks", response_model=schemas.PlaylistWithTracks)
def add_track_to_playlist(
    playlist_id: int,
    track_add: schemas.PlaylistTrackAdd,
    db: Session = Depends(get_db)
):
    """Add a track to a playlist at specified position (or end if position is None)."""
    playlist = crud.add_track_to_playlist(
        db, playlist_id, track_add.track_id, track_add.position
    )
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.delete("/{playlist_id}/tracks/{playlist_track_id}", response_model=schemas.PlaylistWithTracks)
def remove_track_from_playlist(
    playlist_id: int,
    playlist_track_id: int,
    db: Session = Depends(get_db)
):
    """Remove a track from a playlist."""
    playlist = crud.remove_track_from_playlist(db, playlist_id, playlist_track_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist or track not found")
    return playlist


@router.post("/{playlist_id}/reorder-tracks", response_model=schemas.PlaylistWithTracks)
def reorder_playlist_tracks(
    playlist_id: int,
    reorder: schemas.PlaylistTrackReorder,
    db: Session = Depends(get_db)
):
    """Reorder tracks within a playlist."""
    playlist = crud.reorder_playlist_tracks(db, playlist_id, reorder.track_positions)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.post("/reorder", status_code=200)
def reorder_playlists(
    playlist_order: List[dict],
    db: Session = Depends(get_db)
):
    """Reorder playlists in the sidebar."""
    crud.reorder_playlists(db, playlist_order)
    return {"message": "Playlists reordered successfully"}
