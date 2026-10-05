"""LAN receiver for Links. Serves the desktop UI and accepts original file uploads."""

from __future__ import annotations

import json
import os
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

try:
    import segno
except ImportError:  # pragma: no cover
    segno = None

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
CONFIG_PATH = DATA / "config.json"
DEFAULT_SAVE = ROOT / "received"
PORT = 8730
STATIC_EXT = {".html", ".css", ".js", ".svg", ".png", ".ico"}
LANES = 8
CHUNK = 8 * 1024 * 1024

lock = threading.Lock()
pair_token = secrets.token_urlsafe(12)
sessions: dict[str, float] = {}
transfers: dict[str, dict] = {}
done: list[dict] = []
file_locks: dict[str, threading.Lock] = {}


def lan_ip() -> str:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def load_config() -> dict:
    DATA.mkdir(parents=True, exist_ok=True)
    DEFAULT_SAVE.mkdir(parents=True, exist_ok=True)
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("savePath", str(DEFAULT_SAVE))
                data.setdefault("password", "")
                return data
        except (OSError, json.JSONDecodeError):
            pass
    return {"savePath": str(DEFAULT_SAVE), "password": ""}


def save_config(cfg: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def save_root() -> Path:
    raw = Path(load_config()["savePath"]).expanduser()
    raw.mkdir(parents=True, exist_ok=True)
    return raw.resolve()


def phone_url() -> str:
    return f"http://{lan_ip()}:{PORT}/?phone=1&t={pair_token}"


def qr_matrix() -> list[list[int]]:
    if segno is None:
        return []
    qr = segno.make(phone_url(), error="m")
    return [[1 if cell else 0 for cell in row] for row in qr.matrix]


def safe_name(name: str) -> str:
    base = Path(unquote(name)).name.replace("\x00", "").strip()
    if not base or base in {".", ".."}:
        raise ValueError("bad name")
    if any(ch in base for ch in '<>:"|?*\\/'):
        raise ValueError("bad name")
    return base[:180]


def inside(root: Path, target: Path) -> bool:
    try:
        target.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def unique_dest(root: Path, name: str) -> Path:
    dest = root / name
    if not dest.exists() and not dest.with_suffix(dest.suffix + ".part").exists():
        return dest
    stem, suffix = dest.stem, dest.suffix
    index = 1
    while True:
        candidate = root / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1


class Handler(BaseHTTPRequestHandler):
    server_version = "Links/0.1"

    def log_message(self, fmt: str, *args) -> None:
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode("utf-8") or "{}")
        return data if isinstance(data, dict) else {}

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/health":
            self.send_json({"ok": True})
            return
        if path == "/api/info":
            cfg = load_config()
            self.send_json(
                {
                    "host": f"{lan_ip()}:{PORT}",
                    "savePath": cfg["savePath"],
                    "passwordSet": bool(str(cfg.get("password") or "").strip()),
                    "token": pair_token,
                    "phoneUrl": phone_url(),
                    "lanes": LANES,
                }
            )
            return
        if path == "/api/qr-matrix":
            self.send_json({"matrix": qr_matrix()})
            return
        if path == "/api/transfers":
            with lock:
                active = list(transfers.values())
                finished = list(done[-20:])
            self.send_json({"active": active, "done": finished})
            return
        if path == "/api/open-dir":
            os.startfile(save_root())  # type: ignore[attr-defined]
            self.send_json({"ok": True})
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/config":
            incoming = self.read_json()
            cfg = load_config()
            if "savePath" in incoming:
                cfg["savePath"] = str(incoming["savePath"]).strip() or cfg["savePath"]
            if "password" in incoming:
                cfg["password"] = str(incoming["password"])
            save_root_path = Path(cfg["savePath"]).expanduser()
            save_root_path.mkdir(parents=True, exist_ok=True)
            save_config(cfg)
            self.send_json({"ok": True, "savePath": cfg["savePath"], "passwordSet": bool(str(cfg["password"]).strip())})
            return
        if path == "/api/pair":
            incoming = self.read_json()
            token = str(incoming.get("token") or "")
            password = str(incoming.get("password") or "")
            cfg = load_config()
            secret = str(cfg.get("password") or "")
            if token != pair_token:
                self.send_json({"ok": False, "error": "bad token"}, 403)
                return
            if secret.strip() and not password:
                self.send_json({"ok": False, "needPassword": True})
                return
            if secret.strip() and password != secret:
                self.send_json({"ok": False, "error": "bad password"}, 403)
                return
            session = secrets.token_urlsafe(16)
            with lock:
                sessions[session] = time.time()
            self.send_json({"ok": True, "session": session})
            return
        self.send_json({"error": "not found"}, 404)

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/api/upload":
            self.send_json({"error": "not found"}, 404)
            return
        query = parse_qs(parsed.query)
        session = (query.get("session") or [self.headers.get("X-Session") or ""])[0]
        with lock:
            if session not in sessions:
                self.send_json({"ok": False, "error": "no session"}, 403)
                return
        try:
            name = safe_name((query.get("name") or [""])[0])
            size = int((query.get("size") or ["0"])[0])
            offset = int((query.get("offset") or ["0"])[0])
        except (ValueError, TypeError):
            self.send_json({"ok": False, "error": "bad meta"}, 400)
            return
        if size < 0 or offset < 0 or (size and offset >= size):
            self.send_json({"ok": False, "error": "bad range"}, 400)
            return
        length = int(self.headers.get("Content-Length") or "0")
        body = self.rfile.read(length) if length else b""
        root = save_root()
        key = f"{session}:{name}:{size}"
        now = time.time()
        with lock:
            fl = file_locks.setdefault(key, threading.Lock())
            item = transfers.get(key)
            if item is None:
                dest = unique_dest(root, name)
                if not inside(root, dest):
                    self.send_json({"ok": False, "error": "path"}, 400)
                    return
                part = dest.with_name(dest.name + ".part")
                item = {
                    "id": key,
                    "name": dest.name,
                    "size": size,
                    "received": 0,
                    "speed": 0.0,
                    "t": now,
                    "part": str(part),
                    "dest": str(dest),
                    "done": False,
                }
                transfers[key] = item
        part_path = Path(item["part"])
        dest_path = Path(item["dest"])
        if not inside(root, part_path) or not inside(root, dest_path):
            self.send_json({"ok": False, "error": "path"}, 400)
            return
        part_path.parent.mkdir(parents=True, exist_ok=True)
        finished = False
        with fl:
            if not part_path.exists():
                with open(part_path, "wb") as fh:
                    if size > 0:
                        fh.seek(max(0, size - 1))
                        fh.write(b"\0")
            with open(part_path, "r+b") as fh:
                fh.seek(offset)
                fh.write(body)
            with lock:
                item["received"] = min(size, int(item["received"]) + len(body))
                dt = max(0.001, now - float(item["t"]))
                item["speed"] = len(body) / dt
                item["t"] = now
                finished = size > 0 and int(item["received"]) >= size
                if finished:
                    item["done"] = True
                    item["received"] = size
                    transfers.pop(key, None)
                    done.append(
                        {
                            "name": dest_path.name,
                            "size": size,
                            "speed": item["speed"],
                        }
                    )
            if finished:
                if dest_path.exists():
                    dest_path = unique_dest(root, dest_path.name)
                part_path.replace(dest_path)
        self.send_json({"ok": True, "received": item["received"], "done": finished})

    def serve_static(self, path: str) -> None:
        if path == "/":
            path = "/index.html"
        rel = path.lstrip("/").replace("\\", "/")
        target = (ROOT / rel).resolve()
        if not inside(ROOT, target) or target.suffix.lower() not in STATIC_EXT or not target.is_file():
            self.send_json({"error": "not found"}, 404)
            return
        if "data" in target.parts or target.name == "server.py":
            self.send_json({"error": "not found"}, 404)
            return
        data = target.read_bytes()
        types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
        }
        self.send_response(200)
        self.send_header("Content-Type", types.get(target.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    load_config()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Links receiver http://{lan_ip()}:{PORT}")
    print(f"Save path {save_root()}")
    server.serve_forever()


if __name__ == "__main__":
    main()
