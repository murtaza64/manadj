"""Custom SQLAlchemy types for Engine DJ database."""

from typing import Any

from sqlalchemy.types import TypeDecorator, LargeBinary


class ZlibBlob(TypeDecorator):
    """
    Store zlib-compressed binary data as opaque bytes.

    For read-only mode, BLOBs are kept as raw bytes without decompression.
    Future versions could add decompression if needed.
    """
    impl = LargeBinary
    cache_ok = True

    def process_bind_param(self, value: bytes | None, dialect: Any) -> bytes | None:
        """Process parameter for binding (not used in read-only mode)."""
        return value

    def process_result_value(self, value: bytes | None, dialect: Any) -> bytes | None:
        """Process result value - return raw bytes without decompression."""
        return value
