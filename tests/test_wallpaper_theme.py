"""Wallpaper palette endpoint: strict validation, wholesale refusal (gh#470)."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers.wallpaper_theme import adapt_pywal_colors, PaletteRefusal, router

VALID = {
    "wallpaper": "/home/u/pic.png",
    "alpha": "100",
    "special": {"background": "#1a1b26", "foreground": "#c0caf5", "cursor": "#c0caf5"},
    "colors": {f"color{i}": "#7aa2f7" for i in range(16)},
}


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api/theme")
    return TestClient(app)


def write(tmp_path, doc) -> str:
    p = tmp_path / "colors.json"
    p.write_text(json.dumps(doc))
    return str(p)


class TestAdapt:
    def test_valid_converts(self):
        out = adapt_pywal_colors(VALID)
        assert out["version"] == "wal-palette/1"
        assert out["colors"]["background"] == "#1a1b26"
        assert out["colors"]["cursor"] == "#c0caf5"
        assert len(out["colors"]["ansi"]) == 16

    def test_ignores_non_theme_fields(self):
        doc = {**VALID, "extra": {"nested": True}}
        assert adapt_pywal_colors(doc)["version"] == "wal-palette/1"

    @pytest.mark.parametrize("bad", [None, "x", 7, []])
    def test_refuses_non_objects(self, bad):
        with pytest.raises(PaletteRefusal):
            adapt_pywal_colors(bad)

    def test_refuses_missing_special(self):
        doc = {k: v for k, v in VALID.items() if k != "special"}
        with pytest.raises(PaletteRefusal) as e:
            adapt_pywal_colors(doc)
        assert e.value.reason == "missing-special"

    def test_refuses_missing_colorN(self):
        doc = json.loads(json.dumps(VALID))
        del doc["colors"]["color15"]
        with pytest.raises(PaletteRefusal) as e:
            adapt_pywal_colors(doc)
        assert e.value.reason == "missing-colorN"

    def test_refuses_malformed_hex(self):
        doc = json.loads(json.dumps(VALID))
        doc["colors"]["color3"] = "orange"
        with pytest.raises(PaletteRefusal):
            adapt_pywal_colors(doc)


class TestEndpoint:
    def test_missing_file_404(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MANADJ_WALLPAPER_PALETTE_PATH", str(tmp_path / "nope.json"))
        r = client().get("/api/theme/wallpaper-palette")
        assert r.status_code == 404
        assert r.json()["detail"]["reason"] == "no-palette-file"

    def test_valid_200_with_mtime(self, tmp_path, monkeypatch):
        monkeypatch.setenv("MANADJ_WALLPAPER_PALETTE_PATH", write(tmp_path, VALID))
        r = client().get("/api/theme/wallpaper-palette")
        assert r.status_code == 200
        body = r.json()
        assert body["palette"]["version"] == "wal-palette/1"
        assert body["mtime"] > 0

    def test_invalid_422_reason(self, tmp_path, monkeypatch):
        doc = json.loads(json.dumps(VALID))
        del doc["colors"]["color0"]
        monkeypatch.setenv("MANADJ_WALLPAPER_PALETTE_PATH", write(tmp_path, doc))
        r = client().get("/api/theme/wallpaper-palette")
        assert r.status_code == 422
        assert r.json()["detail"]["reason"] == "missing-colorN"

    def test_unparseable_422(self, tmp_path, monkeypatch):
        p = tmp_path / "colors.json"
        p.write_text("{not json")
        monkeypatch.setenv("MANADJ_WALLPAPER_PALETTE_PATH", str(p))
        r = client().get("/api/theme/wallpaper-palette")
        assert r.status_code == 422
