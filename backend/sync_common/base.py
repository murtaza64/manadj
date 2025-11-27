"""Base classes and common utilities for sync operations."""

from dataclasses import dataclass, field


@dataclass
class SyncStats:
    """Base statistics class for sync operations."""
    scanned: int = 0
    matched: int = 0
    unmatched: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0
