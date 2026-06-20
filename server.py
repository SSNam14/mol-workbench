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
SESSION_PATH = STATE_DIR / "session.json"
INTERACTION_INDEX_DIR = STATE_DIR / "interaction_indexes"
MAX_STRUCTURE_BYTES = 200 * 1024 * 1024
MAX_SESSION_BYTES = 500 * 1024 * 1024
MAX_INTERACTION_INDEX_BYTES = 200 * 1024 * 1024
SESSION_SCHEMA = "viewer-session-v1"
INTERACTION_INDEX_SCHEMA = "interaction-index-v5"


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


def normalize_session(value):
    if not isinstance(value, dict):
        return None
    raw_entries = value.get("entries")
    if not isinstance(raw_entries, list):
        return None
    entries = []
    by_name = {}
    for raw in raw_entries:
        entry = normalize_entry(raw.get("entry") if isinstance(raw, dict) and "entry" in raw else raw)
        if not entry:
            continue
        if entry["name"] in by_name:
            entries[by_name[entry["name"]]] = entry
        else:
            by_name[entry["name"]] = len(entries)
            entries.append(entry)
    if not entries:
        return None
    names = {entry["name"] for entry in entries}
    included = value.get("includedEntries")
    if isinstance(included, list):
        included_entries = [str(name) for name in included if str(name) in names]
    else:
        included_entries = [entry["name"] for entry in entries]
    if not included_entries:
        included_entries = [entries[0]["name"]]
    active = str(value.get("activeEntry") or value.get("currentName") or included_entries[0]).strip()
    if active not in names:
        active = included_entries[0]
    return {
        "schema": SESSION_SCHEMA,
        "entries": entries,
        "includedEntries": included_entries,
        "activeEntry": active,
    }


def load_json(path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp_path, path)


def legacy_last_structure_session():
    try:
        payload = load_json(LAST_STRUCTURE_PATH)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    entry = normalize_entry(payload.get("entry") if isinstance(payload, dict) and "entry" in payload else payload)
    if not entry:
        return None
    return normalize_session({"entries": [entry], "includedEntries": [entry["name"]], "activeEntry": entry["name"]})


def load_session_or_legacy():
    try:
        session = normalize_session(load_json(SESSION_PATH))
        if session:
            return session
    except FileNotFoundError:
        pass
    except (OSError, json.JSONDecodeError):
        raise
    return legacy_last_structure_session()


def write_session(session):
    write_json_atomic(SESSION_PATH, session)
    active_name = session.get("activeEntry")
    active = next((entry for entry in session.get("entries", []) if entry.get("name") == active_name), None)
    if active:
        write_json_atomic(LAST_STRUCTURE_PATH, {"entry": active})


def clear_session():
    for path in (SESSION_PATH, LAST_STRUCTURE_PATH):
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def upsert_session_entry(entry):
    session = load_session_or_legacy()
    if not session:
        session = {"schema": SESSION_SCHEMA, "entries": [], "includedEntries": [], "activeEntry": entry["name"]}
    entries = session["entries"]
    for idx, existing in enumerate(entries):
        if existing.get("name") == entry["name"]:
            entries[idx] = entry
            break
    else:
        entries.append(entry)
    included = [name for name in session.get("includedEntries", []) if any(e["name"] == name for e in entries)]
    if entry["name"] not in included:
        included.append(entry["name"])
    session = normalize_session({"entries": entries, "includedEntries": included, "activeEntry": entry["name"]})
    write_session(session)
    return session


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
        path = urlparse(self.path).path
        if path == "/api/session":
            self.handle_get_session()
            return
        if path == "/api/last-structure":
            self.handle_get_last_structure()
            return
        if path.startswith("/api/interaction-index/"):
            self.handle_get_interaction_index(path.rsplit("/", 1)[-1])
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/session":
            self.handle_put_session()
            return
        if path == "/api/last-structure":
            self.handle_put_last_structure()
            return
        if path.startswith("/api/interaction-index/"):
            self.handle_put_interaction_index(path.rsplit("/", 1)[-1])
            return
        self.send_error(404)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/session":
            self.handle_put_session()
            return
        if path == "/api/last-structure":
            self.handle_put_last_structure()
            return
        if path.startswith("/api/interaction-index/"):
            self.handle_put_interaction_index(path.rsplit("/", 1)[-1])
            return
        self.send_error(404)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == "/api/session":
            clear_session()
            self.send_json(200, {"ok": True})
            return
        self.send_error(404)

    def read_json_body(self, max_bytes):
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "0")
        except ValueError:
            self.send_json(400, {"error": "invalid_content_length"})
            return None
        if length <= 0 or length > max_bytes:
            self.send_json(413 if length > max_bytes else 400, {"error": "invalid_body_size"})
            return None
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"error": "invalid_json"})
            return None

    def handle_get_session(self):
        try:
            session = load_session_or_legacy()
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_read_failed"})
            return
        if not session:
            self.send_json(404, {"error": "not_found"})
            return
        self.send_json(200, session)

    def handle_put_session(self):
        payload = self.read_json_body(MAX_SESSION_BYTES)
        if payload is None:
            return
        session = normalize_session(payload)
        if not session:
            self.send_json(400, {"error": "invalid_session"})
            return
        write_session(session)
        self.send_json(200, {"ok": True, "entries": len(session["entries"])})

    def handle_get_last_structure(self):
        try:
            session = load_session_or_legacy()
        except FileNotFoundError:
            self.send_json(404, {"error": "not_found"})
            return
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_read_failed"})
            return
        entry = None
        if session:
            active = session.get("activeEntry")
            entry = next((item for item in session.get("entries", []) if item.get("name") == active), None)
        if not entry:
            self.send_json(500, {"error": "invalid_state"})
            return
        self.send_json(200, {"entry": entry})

    def handle_put_last_structure(self):
        payload = self.read_json_body(MAX_STRUCTURE_BYTES)
        if payload is None:
            return
        entry = normalize_entry(payload.get("entry") if isinstance(payload, dict) and "entry" in payload else payload)
        if not entry:
            self.send_json(400, {"error": "invalid_structure"})
            return
        session = upsert_session_entry(entry)
        self.send_json(200, {"ok": True, "entries": len(session["entries"])})

    def interaction_index_path(self, key):
        if not key or not all(ch.isalnum() or ch in "._-" for ch in key):
            return None
        return INTERACTION_INDEX_DIR / f"{key}.json"

    def handle_get_interaction_index(self, key):
        path = self.interaction_index_path(key)
        if path is None:
            self.send_json(400, {"error": "invalid_key"})
            return
        try:
            with path.open("r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except FileNotFoundError:
            self.send_json(404, {"error": "not_found"})
            return
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "cache_read_failed"})
            return
        self.send_json(200, payload)

    def handle_put_interaction_index(self, key):
        path = self.interaction_index_path(key)
        if path is None:
            self.send_json(400, {"error": "invalid_key"})
            return
        payload = self.read_json_body(MAX_INTERACTION_INDEX_BYTES)
        if payload is None:
            return
        if not isinstance(payload, dict) or payload.get("schema") != INTERACTION_INDEX_SCHEMA or payload.get("structureKey") != key:
            self.send_json(400, {"error": "invalid_interaction_index"})
            return
        write_json_atomic(path, payload)
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
