"""Video export endpoints (#377): frame stream + WAV → MP4 via ffmpeg.

POST /api/video-export/jobs?name&fps&width&height   body: WAV bytes
POST /api/video-export/jobs/{id}/frames?count        body: concatenated JPEGs
POST /api/video-export/jobs/{id}/finish              → {path, url, frames}
POST /api/video-export/jobs/{id}/abort
GET  /api/video-export/files/{name}                  serve a finished MP4
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend import schemas, video_export
from backend.database import get_db

router = APIRouter()


@router.post("/jobs")
async def start(
    request: Request,
    name: str = Query("routine"),
    fps: int = Query(30, ge=1, le=120),
    width: int = Query(1080, ge=16, le=8192),
    height: int = Query(1920, ge=16, le=8192),
) -> dict:
    wav = await request.body()
    if len(wav) < 44:
        raise HTTPException(400, "WAV body required")
    try:
        job = video_export.start_job(wav, name=name, fps=fps, width=width, height=height)
    except video_export.VideoExportError as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"id": job.id, "output": str(job.output)}


@router.post("/jobs/{job_id}/frames")
async def frames(request: Request, job_id: str, count: int = Query(1, ge=1)) -> dict:
    data = await request.body()
    try:
        job = video_export.get_job(job_id)
        video_export.write_frames(job, data, count)
    except video_export.VideoExportError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"frames": job.frames, "bytes": job.bytes_written}


@router.post("/jobs/{job_id}/finish")
def finish(job_id: str) -> dict:
    try:
        job = video_export.get_job(job_id)
        frames_written = job.frames
        output = video_export.finish_job(job)
    except video_export.VideoExportError as exc:
        raise HTTPException(500, str(exc)) from exc
    return {
        "path": str(output),
        "url": f"/api/video-export/files/{output.name}",
        "frames": frames_written,
        "bytes": output.stat().st_size,
    }


@router.post("/jobs/{job_id}/abort")
def abort(job_id: str) -> dict:
    try:
        job = video_export.get_job(job_id)
    except video_export.VideoExportError as exc:
        raise HTTPException(404, str(exc)) from exc
    video_export.abort_job(job)
    return {"ok": True}


@router.get("/files/{name}")
def file(name: str) -> FileResponse:
    if "/" in name or name.startswith(".") or not name.endswith(".mp4"):
        raise HTTPException(404)
    path = video_export.exports_dir() / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="video/mp4", filename=name)


@router.get("/session-span/{session_uuid}", response_model=schemas.RoutineDetail)
def session_span(
    session_uuid: str,
    start_s: float = Query(...),
    end_s: float = Query(...),
    db: Session = Depends(get_db),
) -> schemas.RoutineDetail:
    """Promotion preview of an arbitrary Session span (clip editor source)."""
    if end_s <= start_s:
        raise HTTPException(400, "end_s must be after start_s")
    try:
        cast, result = video_export.session_span_preview(db, session_uuid, start_s, end_s)
    except video_export.VideoExportError as exc:
        raise HTTPException(422, str(exc)) from exc
    return schemas.RoutineDetail(
        uuid=f"preview-span-{session_uuid}-{start_s:.1f}-{end_s:.1f}",
        name=None,
        cast=list(cast),
        entry_offsets_beats=result.entry_offsets_beats,
        entry_positions=result.entry_positions,
        duration_beats=result.duration_beats,
        origin_take_uuid=None,
        created_at=None,
        events=result.events,
        edits=None,
    )
