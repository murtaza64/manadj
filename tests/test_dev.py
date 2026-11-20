import socket
import sys

from scripts import dev


def test_main_rejects_occupied_backend_port(monkeypatch, capsys) -> None:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        monkeypatch.setattr(
            sys,
            "argv",
            ["dev.py", "--backend-port", str(port), "--vite-port", "0"],
        )

        assert dev.main() == 1

    assert capsys.readouterr().err == f"error: backend port {port} is already in use\n"


def test_main_uses_default_backend_port(monkeypatch, capsys) -> None:
    def reject_port(name: str, port: int) -> None:
        assert name == "backend"
        assert port == 8127
        raise RuntimeError("expected probe")

    monkeypatch.setattr(sys, "argv", ["dev.py"])
    monkeypatch.setattr(dev, "ensure_port_available", reject_port)

    assert dev.main() == 1
    assert capsys.readouterr().err == "error: expected probe\n"


def test_launcher_stops_nested_listener_even_after_wrapper_exits(tmp_path):
    import json
    import os
    import queue
    import signal

    import pytest

    if os.name == "nt":
        pytest.skip("POSIX process-group ownership regression")
    child = tmp_path / "child.py"
    child.write_text("""import socket,signal,time,json,os
signal.signal(signal.SIGTERM,signal.SIG_IGN)
s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
s.bind(('127.0.0.1',0));s.listen()
print(json.dumps({'port':s.getsockname()[1],'pid':os.getpid()}),flush=True)
while True: time.sleep(.05)
""")
    wrapper = tmp_path / "wrapper.py"
    wrapper.write_text("import subprocess,sys\nsubprocess.Popen([sys.executable,sys.argv[1]])\n")
    logs = queue.Queue()
    process = dev.spawn_process(
        "fixture", [sys.executable, str(wrapper), str(child)], tmp_path, logs
    )
    port = None
    try:
        _name, line = logs.get(timeout=5)
        port = json.loads(line)["port"]
        process.wait(timeout=3)  # wrapper gone, listener still owned by its group
        with pytest.raises(RuntimeError):
            dev.ensure_port_available("fixture", port)
        dev.stop_processes([process], grace_seconds=0.1)
        dev.ensure_port_available("fixture", port)
        # Immediate reuse proves we did not just observe the parent exit.
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", port))
            listener.listen()
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=3)


def test_probe_does_not_confuse_time_wait_with_listener():
    import os

    import pytest

    if os.name == "nt":
        pytest.skip("POSIX reusable socket semantics")
    with socket.socket() as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", 0))
        server.listen()
        port = server.getsockname()[1]
        with socket.create_connection(("127.0.0.1", port)) as client:
            accepted, _ = server.accept()
            accepted.close()  # server side owns the TIME_WAIT connection
            client.recv(1)
    dev.ensure_port_available("fixture", port)


def test_partial_start_failure_cleans_up_owned_children(monkeypatch):
    import pytest

    started = object()
    calls = []
    monkeypatch.setattr(sys, "argv", ["dev.py"])
    monkeypatch.setattr(dev, "ensure_port_available", lambda *_: None)

    def spawn(**kwargs):
        if kwargs["name"] == "backend":
            return started
        raise OSError("fixture frontend spawn failure")

    monkeypatch.setattr(dev, "spawn_process", spawn)
    monkeypatch.setattr(dev, "stop_processes", lambda processes: calls.append(list(processes)))
    with pytest.raises(OSError):
        dev.main()
    assert calls == [[started]]


def test_missing_electron_cleans_up_both_servers(monkeypatch, tmp_path):
    started = [object(), object()]
    cleaned = []
    monkeypatch.setattr(sys, "argv", ["dev.py", "--app"])
    monkeypatch.setattr(dev, "ROOT", tmp_path)
    monkeypatch.setattr(dev, "ensure_port_available", lambda *_: None)
    children = iter(started)
    monkeypatch.setattr(dev, "spawn_process", lambda **kwargs: next(children))
    monkeypatch.setattr(dev, "stop_processes", lambda processes: cleaned.append(list(processes)))
    assert dev.main() == 1
    assert cleaned == [started]
