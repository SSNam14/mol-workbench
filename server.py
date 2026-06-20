#!/usr/bin/env python3
"""Static file server with a tiny persisted viewer-state API."""

import argparse
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / ".viewer_state"
LAST_STRUCTURE_PATH = STATE_DIR / "last_structure.json"
MAX_STRUCTURE_BYTES = 200 * 1024 * 1024


def normalize_entry(value):
    if not isinstance(value, dict):
        return None
    data = value.get("data")
    if not isinstance(data, str) or not data.strip():
        return None
    name = str(value.get("name") or "structure").strip() or "structure"
    title = str(value.get("title") or name).strip() or name
    pdb_id = str(value.get("pdbId") or "").strip()
    fmt = str(value.get("fmt") or "pdb").strip().lower() or "pdb"
    return {"name": name, "title": title, "pdbId": pdb_id, "data": data, "fmt": fmt}


class ViewerHandler(SimpleHTTPRequestHandler):
    server_version = "MolecularViewerHTTP/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path == "/api/last-structure":
            self.handle_get_last_structure()
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path == "/api/last-structure":
            self.handle_put_last_structure()
            return
        self.send_error(404)

    def do_PUT(self):
        if urlparse(self.path).path == "/api/last-structure":
            self.handle_put_last_structure()
            return
        self.send_error(404)

    def handle_get_last_structure(self):
        try:
            with LAST_STRUCTURE_PATH.open("r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except FileNotFoundError:
            self.send_json(404, {"error": "not_found"})
            return
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_read_failed"})
            return
        entry = normalize_entry(payload.get("entry") if isinstance(payload, dict) and "entry" in payload else payload)
        if not entry:
            self.send_json(500, {"error": "invalid_state"})
            return
        self.send_json(200, {"entry": entry})

    def handle_put_last_structure(self):
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "0")
        except ValueError:
            self.send_json(400, {"error": "invalid_content_length"})
            return
        if length <= 0 or length > MAX_STRUCTURE_BYTES:
            self.send_json(413 if length > MAX_STRUCTURE_BYTES else 400, {"error": "invalid_body_size"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "invalid_json"})
            return
        entry = normalize_entry(payload.get("entry") if isinstance(payload, dict) and "entry" in payload else payload)
        if not entry:
            self.send_json(400, {"error": "invalid_structure"})
            return
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        tmp_path = LAST_STRUCTURE_PATH.with_suffix(".json.tmp")
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump({"entry": entry}, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp_path, LAST_STRUCTURE_PATH)
        self.send_json(200, {"ok": True})


def main():
    parser = argparse.ArgumentParser(description="Serve the molecular viewer and persisted structure API.")
    parser.add_argument("--bind", default="0.0.0.0", help="address to bind")
    parser.add_argument("--port", type=int, default=8704, help="port to listen on")
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.bind, args.port), ViewerHandler)
    print(f"Serving {ROOT} on http://{args.bind}:{args.port}/", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
