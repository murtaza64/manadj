"""Ground truth corpus: tiering logic (ADR 0024).

Pure functions and dataclasses — no DB access, no heavy deps. The measuring
stick for Analysis accuracy: gold tier where Engine DJ and Rekordbox concur,
disputed where they disagree (excluded from headline scoring until a
hand-verified override promotes them). Grid phase truth is Engine-only.
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from backend.key import Key

# Engine and Rekordbox BPMs agree when within this (matches the harness
# scoring tolerance). Small epsilon keeps the inclusive boundary stable
# under float noise.
BPM_AGREEMENT = 0.05
_EPS = 1e-9

Tier = Literal["gold", "disputed", "engine_only", "rb_only", "missing"]


@dataclass(frozen=True)
class SourceValues:
    """Key/BPM as one external source (Engine or Rekordbox) reports them."""

    key: Key | None
    bpm: float | None


@dataclass(frozen=True)
class Override:
    """Hand-verified values; outrank both sources (edited > imported)."""

    key: Key | None = None
    bpm: float | None = None


@dataclass(frozen=True)
class FieldTruth[T]:
    """One field's tiered ground truth: what each source said, the verdict."""

    tier: Tier
    truth: T | None
    engine: T | None
    rb: T | None
    verified: bool = False  # promoted by a hand-verified override

    @classmethod
    def build(
        cls,
        engine: T | None,
        rb: T | None,
        agree: Callable[[T, T], bool],
        override: T | None,
    ) -> FieldTruth[T]:
        if override is not None:
            return cls(tier="gold", truth=override, engine=engine, rb=rb, verified=True)
        if engine is not None and rb is not None:
            if agree(engine, rb):
                return cls(tier="gold", truth=engine, engine=engine, rb=rb)  # Engine primary
            return cls(tier="disputed", truth=None, engine=engine, rb=rb)
        if engine is not None:
            return cls(tier="engine_only", truth=engine, engine=engine, rb=rb)
        if rb is not None:
            return cls(tier="rb_only", truth=rb, engine=engine, rb=rb)
        return cls(tier="missing", truth=None, engine=engine, rb=rb)

    def to_dict(self, dump: Callable[[T], object]) -> dict:
        return {
            "tier": self.tier,
            "truth": dump(self.truth) if self.truth is not None else None,
            "engine": dump(self.engine) if self.engine is not None else None,
            "rb": dump(self.rb) if self.rb is not None else None,
            "verified": self.verified,
        }

    @classmethod
    def from_dict(cls, d: dict, load: Callable[[object], T]) -> FieldTruth[T]:
        return cls(
            tier=d["tier"],
            truth=load(d["truth"]) if d["truth"] is not None else None,
            engine=load(d["engine"]) if d["engine"] is not None else None,
            rb=load(d["rb"]) if d["rb"] is not None else None,
            verified=d["verified"],
        )


@dataclass(frozen=True)
class GridTruth:
    """Engine's beatgrid as phase ground truth (manadj tempo-change shape)."""

    tempo_changes: tuple[dict, ...]

    @property
    def constant(self) -> bool:
        return len(self.tempo_changes) == 1


@dataclass(frozen=True)
class CorpusEntry:
    filename: str
    key: FieldTruth[Key]
    bpm: FieldTruth[float]
    grid: GridTruth | None

    def to_dict(self) -> dict:
        return {
            "filename": self.filename,
            "key": self.key.to_dict(lambda k: k.openkey),
            "bpm": self.bpm.to_dict(lambda b: b),
            "grid": (
                {"tempo_changes": list(self.grid.tempo_changes), "constant": self.grid.constant}
                if self.grid
                else None
            ),
        }

    @classmethod
    def from_dict(cls, d: dict) -> CorpusEntry:
        return cls(
            filename=d["filename"],
            key=FieldTruth.from_dict(d["key"], lambda v: Key.from_openkey(v)),
            bpm=FieldTruth.from_dict(d["bpm"], lambda v: float(v)),
            grid=(
                GridTruth(tempo_changes=tuple(d["grid"]["tempo_changes"])) if d["grid"] else None
            ),
        )


def _bpm_agree(a: float, b: float) -> bool:
    return abs(a - b) <= BPM_AGREEMENT + _EPS


def build_entry(
    filename: str,
    engine: SourceValues | None,
    rb: SourceValues | None,
    grid_tempo_changes: list[dict] | None = None,
    override: Override | None = None,
) -> CorpusEntry:
    return CorpusEntry(
        filename=filename,
        key=FieldTruth.build(
            engine=engine.key if engine else None,
            rb=rb.key if rb else None,
            agree=lambda a, b: a == b,
            override=override.key if override else None,
        ),
        bpm=FieldTruth.build(
            engine=engine.bpm if engine else None,
            rb=rb.bpm if rb else None,
            agree=_bpm_agree,
            override=override.bpm if override else None,
        ),
        grid=GridTruth(tempo_changes=tuple(grid_tempo_changes)) if grid_tempo_changes else None,
    )


def load_corpus(path: Path) -> list[CorpusEntry]:
    """Read the corpus artifact written by harness.build_corpus."""
    data = json.loads(path.read_text())
    return [CorpusEntry.from_dict(d) for d in data["entries"]]


def parse_overrides(text: str) -> dict[str, Override]:
    """Parse the hand-verification override file (TOML: one table per filename)."""
    raw = tomllib.loads(text)
    overrides: dict[str, Override] = {}
    for filename, fields in raw.items():
        k = None
        if "key" in fields:
            k = Key.from_musical(fields["key"])
            if k is None:
                raise ValueError(f"Unparseable key for {filename!r}: {fields['key']!r}")
        overrides[filename] = Override(key=k, bpm=fields.get("bpm"))
    return overrides


def disputed_queue(entries: list[CorpusEntry]) -> list[CorpusEntry]:
    """Tracks with at least one disputed field — the hand-verification worklist."""
    return [e for e in entries if e.key.tier == "disputed" or e.bpm.tier == "disputed"]


def summarize(entries: list[CorpusEntry]) -> dict[str, dict[str, int]]:
    """Tier counts per field, for the build report."""
    counts: dict[str, dict[str, int]] = {"key": {}, "bpm": {}}
    for e in entries:
        counts["key"][e.key.tier] = counts["key"].get(e.key.tier, 0) + 1
        counts["bpm"][e.bpm.tier] = counts["bpm"].get(e.bpm.tier, 0) + 1
    return counts
