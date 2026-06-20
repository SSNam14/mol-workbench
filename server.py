#!/usr/bin/env python3
"""Static file server with a tiny persisted viewer-state API."""

import argparse
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / ".viewer_state"
LAST_STRUCTURE_PATH = STATE_DIR / "last_structure.json"
SESSION_PATH = STATE_DIR / "session.json"
PREFERENCES_PATH = STATE_DIR / "preferences.json"
INTERACTION_INDEX_DIR = STATE_DIR / "interaction_indexes"
MAX_STRUCTURE_BYTES = 200 * 1024 * 1024
MAX_SESSION_BYTES = 500 * 1024 * 1024
MAX_PREFERENCES_BYTES = 1024 * 1024
MAX_INTERACTION_INDEX_BYTES = 200 * 1024 * 1024
SESSION_SCHEMA = "viewer-session-v1"
PREFERENCES_SCHEMA = "viewer-preferences-v1"
INTERACTION_INDEX_SCHEMA = "interaction-index-v5"
MOUSE_BUTTON_ACTIONS = {"rotate", "pan", "zoom", "select", "none"}
MOUSE_WHEEL_ACTIONS = {"zoom", "none"}
MOUSE_PRESETS = {"select-left", "custom", "default"}
CHAIN_IDS = tuple("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


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


def normalize_hex_color(value):
    color = str(value or "").strip()
    if len(color) != 7 or color[0] != "#":
        return None
    if not all(ch in "0123456789abcdefABCDEF" for ch in color[1:]):
        return None
    return "#" + color[1:].lower()


def normalize_preferences(value):
    if not isinstance(value, dict):
        return None
    out = {"schema": PREFERENCES_SCHEMA}

    mouse_preset = str(value.get("mousePreset") or "custom").strip()
    if mouse_preset not in MOUSE_PRESETS:
        return None
    out["mousePreset"] = mouse_preset

    mouse = value.get("mouse")
    if mouse is not None:
        if not isinstance(mouse, dict):
            return None
        buttons = mouse.get("buttons", mouse)
        if not isinstance(buttons, dict):
            return None
        normalized_buttons = {}
        for button in ("left", "right", "middle"):
            action = str(buttons.get(button) or "").strip().lower()
            if action not in MOUSE_BUTTON_ACTIONS:
                return None
            normalized_buttons[button] = action
        used_actions = [action for action in normalized_buttons.values() if action != "none"]
        if len(used_actions) != len(set(used_actions)):
            return None
        wheel = str(mouse.get("wheel", mouse.get("wheelAction", "zoom")) or "").strip().lower()
        if wheel not in MOUSE_WHEEL_ACTIONS:
            return None
        out["mouse"] = {"buttons": normalized_buttons, "wheel": wheel}

    chain_colors = value.get("chainColors")
    if chain_colors is not None:
        if not isinstance(chain_colors, dict):
            return None
        normalized_colors = {}
        for chain in CHAIN_IDS:
            if chain not in chain_colors:
                continue
            color = normalize_hex_color(chain_colors[chain])
            if color is None:
                return None
            normalized_colors[chain] = color
        out["chainColors"] = normalized_colors

    if "carbonByChain" in value:
        out["carbonByChain"] = bool(value.get("carbonByChain"))
    return out


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


def file_revision(path):
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None
    return f"{stat.st_mtime_ns}-{stat.st_size}"


def session_revision():
    current = file_revision(SESSION_PATH)
    if current:
        return current
    legacy = file_revision(LAST_STRUCTURE_PATH)
    return f"legacy-{legacy}" if legacy else "empty"


def session_meta(session=None):
    session = session or None
    entries = session.get("entries", []) if session else []
    return {
        "schema": SESSION_SCHEMA,
        "revision": session_revision(),
        "entries": [
            {
                "name": entry.get("name", ""),
                "title": entry.get("title", entry.get("name", "")),
                "pdbId": entry.get("pdbId", ""),
                "fmt": entry.get("fmt", ""),
            }
            for entry in entries
        ],
        "includedEntries": session.get("includedEntries", []) if session else [],
        "activeEntry": session.get("activeEntry", "") if session else "",
    }


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


def remove_session_entry(name):
    session = load_session_or_legacy()
    if not session:
        return None
    target = str(name or "").strip()
    entries = [entry for entry in session.get("entries", []) if entry.get("name") != target]
    if len(entries) == len(session.get("entries", [])):
        return session
    if not entries:
        clear_session()
        return None
    names = {entry["name"] for entry in entries}
    included = [entry_name for entry_name in session.get("includedEntries", []) if entry_name in names]
    if not included:
        included = [entries[0]["name"]]
    active = session.get("activeEntry")
    if active not in names:
        active = included[0]
    next_session = normalize_session({"entries": entries, "includedEntries": included, "activeEntry": active})
    write_session(next_session)
    return next_session


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
        if path == "/api/session-meta":
            self.handle_get_session_meta()
            return
        if path == "/api/session":
            self.handle_get_session()
            return
        if path == "/api/preferences":
            self.handle_get_preferences()
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
        if path == "/api/session-entry":
            self.handle_put_session_entry()
            return
        if path == "/api/preferences":
            self.handle_put_preferences()
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
        if path == "/api/session-entry":
            self.handle_put_session_entry()
            return
        if path == "/api/preferences":
            self.handle_put_preferences()
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
            self.send_json(200, {"ok": True, "session": session_meta(None)})
            return
        if path.startswith("/api/session-entry/"):
            self.handle_delete_session_entry(unquote(path.rsplit("/", 1)[-1]))
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
        session["revision"] = session_revision()
        self.send_json(200, session)

    def handle_get_session_meta(self):
        try:
            session = load_session_or_legacy()
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_read_failed"})
            return
        self.send_json(200, session_meta(session))

    def handle_put_session(self):
        payload = self.read_json_body(MAX_SESSION_BYTES)
        if payload is None:
            return
        session = normalize_session(payload)
        if not session:
            self.send_json(400, {"error": "invalid_session"})
            return
        write_session(session)
        self.send_json(200, {"ok": True, "entries": len(session["entries"]), "session": session_meta(session)})

    def handle_put_session_entry(self):
        payload = self.read_json_body(MAX_STRUCTURE_BYTES)
        if payload is None:
            return
        entry = normalize_entry(payload.get("entry") if isinstance(payload, dict) and "entry" in payload else payload)
        if not entry:
            self.send_json(400, {"error": "invalid_structure"})
            return
        session = upsert_session_entry(entry)
        self.send_json(200, {"ok": True, "entries": len(session["entries"]), "session": session_meta(session)})

    def handle_get_preferences(self):
        try:
            preferences = normalize_preferences(load_json(PREFERENCES_PATH))
        except FileNotFoundError:
            self.send_json(404, {"error": "not_found"})
            return
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "preferences_read_failed"})
            return
        if not preferences:
            self.send_json(500, {"error": "invalid_preferences_state"})
            return
        self.send_json(200, preferences)

    def handle_put_preferences(self):
        payload = self.read_json_body(MAX_PREFERENCES_BYTES)
        if payload is None:
            return
        preferences = normalize_preferences(payload)
        if not preferences:
            self.send_json(400, {"error": "invalid_preferences"})
            return
        try:
            write_json_atomic(PREFERENCES_PATH, preferences)
        except OSError:
            self.send_json(500, {"error": "preferences_write_failed"})
            return
        self.send_json(200, {"ok": True, "preferences": preferences})

    def handle_delete_session_entry(self, name):
        if not name:
            self.send_json(400, {"error": "invalid_entry_name"})
            return
        try:
            session = remove_session_entry(name)
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_write_failed"})
            return
        self.send_json(200, {"ok": True, "entries": len(session["entries"]) if session else 0, "session": session_meta(session)})

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
        self.send_json(200, {"ok": True, "entries": len(session["entries"]), "session": session_meta(session)})

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
