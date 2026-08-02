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
