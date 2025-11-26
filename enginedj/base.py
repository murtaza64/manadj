"""Base classes and type aliases for Engine DJ database models."""

from typing import Annotated
from datetime import datetime

from sqlalchemy import String, Integer, Boolean, Float, LargeBinary
from sqlalchemy.orm import DeclarativeBase, mapped_column


class Base(DeclarativeBase):
    """Base class for all Engine DJ database models."""
    pass


# Type aliases for common column patterns
intpk = Annotated[int, mapped_column(primary_key=True)]
str_50 = Annotated[str, mapped_column(String(50))]
str_100 = Annotated[str, mapped_column(String(100))]
str_200 = Annotated[str, mapped_column(String(200))]
