"""HTTP shell-boundary tests use synthetic paths and standalone FastAPI only."""
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient
import backend.cloud_shell as module


def client(monkeypatch, *, token="synthetic-shell", path=Path("/synthetic/not-opened.db"), peer="127.0.0.1"):
    calls=[]
    def prepare(value):
        calls.append(value)
        return {"parts":[],"rowCounts":{},"omissions":[]}
    monkeypatch.setattr(module,"prepare_snapshot",prepare)
    app=FastAPI();module.install_cloud_snapshot_route(app,token,path)
    return TestClient(app,client=(peer,12345)),calls


def test_no_route_without_managed_shell_token(monkeypatch):
    c,calls=client(monkeypatch,token="")
    assert c.post(module.PATH).status_code==404
    assert not calls


def test_requires_loopback_shell_token_no_browser_origin_no_proxy(monkeypatch):
    c,calls=client(monkeypatch)
    for headers in [{},{"x-manadj-shell-token":"wrong"},{"x-manadj-shell-token":"synthetic-shell","origin":"http://127.0.0.1:1234"},
                    {"x-manadj-shell-token":"synthetic-shell","forwarded":"for=127.0.0.1"},
                    {"x-manadj-shell-token":"synthetic-shell","x-forwarded-for":"127.0.0.1"}]:
        assert c.post(module.PATH,headers=headers).status_code==403
    assert not calls
    c,calls=client(monkeypatch,peer="192.0.2.1")
    assert c.post(module.PATH,headers={"x-manadj-shell-token":"synthetic-shell"}).status_code==403
    assert not calls


def test_no_paths_payload_or_options_from_caller(monkeypatch):
    c,calls=client(monkeypatch)
    result=c.post(module.PATH,headers={"x-manadj-shell-token":"synthetic-shell"},json={"path":"/not/allowed"})
    assert result.status_code==400
    assert not calls


def test_exact_app_database_and_private_no_store_summary(monkeypatch):
    c,calls=client(monkeypatch)
    result=c.post(module.PATH,headers={"x-manadj-shell-token":"synthetic-shell"})
    assert result.status_code==200
    assert result.json()=={"parts":[],"rowCounts":{},"omissions":[]}
    assert calls==[Path("/synthetic/not-opened.db")]
    assert result.headers["cache-control"]=="no-store"
    assert result.headers["x-content-type-options"]=="nosniff"
    assert result.headers.get("access-control-allow-origin") is None


def test_non_file_database_fails_without_fallback(monkeypatch):
    c,calls=client(monkeypatch,path=None)
    result=c.post(module.PATH,headers={"x-manadj-shell-token":"synthetic-shell"})
    assert result.status_code==409
    assert not calls


def test_preparation_error_returns_code_not_sqlite_path_or_label(monkeypatch):
    c,calls=client(monkeypatch)
    def failure(path):
        raise module.PreparationError("cloud_metadata_text_limit")
    monkeypatch.setattr(module,"prepare_snapshot",failure)
    result=c.post(module.PATH,headers={"x-manadj-shell-token":"synthetic-shell"})
    assert result.status_code==409
    assert result.json()=={"error":"cloud_metadata_text_limit"}
    assert result.headers["cache-control"]=="no-store"
