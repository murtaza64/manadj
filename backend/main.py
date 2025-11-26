"""Main FastAPI application."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import engine
from .models import Base
from .routers import tracks, tags, waveforms

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Music Library Manager", version="1.0.0")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(tracks.router, prefix="/api/tracks", tags=["tracks"])
app.include_router(tags.router, prefix="/api/tags", tags=["tags"])
app.include_router(waveforms.router, prefix="/api/waveforms", tags=["waveforms"])

@app.get("/")
def root():
    return {"message": "Music Library Manager API"}
