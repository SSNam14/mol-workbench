#!/usr/bin/env python3
"""Static file server with a tiny persisted viewer-state API."""

import argparse
import json
import os
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from maestro_convert import MaestroConversionError, infer_structure_format, is_maestro_format, maestro_bytes_to_pdb


ROOT = Path(__file__).resolve().parent
STATE_DIR = ROOT / ".viewer_state"
LAST_STRUCTURE_PATH = STATE_DIR / "last_structure.json"
SESSION_PATH = STATE_DIR / "session.json"
SESSION_STATE_PATH = STATE_DIR / "session_state.json"
SESSION_META_PATH = STATE_DIR / "session_meta.json"
PREFERENCES_PATH = STATE_DIR / "preferences.json"
INTERACTION_INDEX_DIR = STATE_DIR / "interaction_indexes"
MAX_STRUCTURE_BYTES = 200 * 1024 * 1024
MAX_SESSION_BYTES = 500 * 1024 * 1024
MAX_SESSION_STATE_BYTES = 64 * 1024
MAX_SESSION_TITLE_BYTES = 16 * 1024
MAX_PREFERENCES_BYTES = 1024 * 1024
MAX_INTERACTION_INDEX_BYTES = 200 * 1024 * 1024
SESSION_SCHEMA = "viewer-session-v1"
PREFERENCES_SCHEMA = "viewer-preferences-v1"
INTERACTION_INDEX_SCHEMA = "interaction-index-v6"
STATE_LOCK = threading.RLock()
BLOCKED_STATIC_NAMES = {"server.py", "HANDOFF.md", "README.md"}
BLOCKED_STATIC_SUFFIXES = {".log", ".pid", ".pyc"}
MOUSE_BUTTON_ACTIONS = {"rotate", "pan", "zoom", "select", "none"}
MOUSE_WHEEL_ACTIONS = {"zoom", "none"}
MOUSE_PRESETS = {"select-left", "custom", "default"}
BACKBONE_REPRESENTATIONS = {"cartoon", "tube", "off"}
ATOM_REPRESENTATIONS = {"line", "stick", "sphere", "cpk"}
ATOM_REPRESENTATIONS_WITH_OFF = ATOM_REPRESENTATIONS | {"off"}
CHAIN_IDS = tuple("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
ELEMENT_IDS = (
    "H", "B", "C", "N", "O", "F", "SI", "P", "S", "CL", "BR", "I",
    "LI", "NA", "K", "RB", "CS", "FR", "BE", "MG", "CA", "SR", "BA", "RA",
    "HE", "NE", "AR", "KR", "XE", "RN",
    "AL", "GA", "GE", "IN", "SN", "SB", "TL", "PB", "BI", "PO",
    "AS", "SE", "TE", "AT",
    "SC", "TI", "V", "CR", "MN", "FE", "CO", "NI", "CU", "ZN",
    "Y", "ZR", "NB", "MO", "TC", "RU", "RH", "PD", "AG", "CD",
    "HF", "TA", "W", "RE", "OS", "IR", "PT", "AU", "HG",
    "LA", "CE", "PR", "ND", "PM", "SM", "EU", "GD", "TB", "DY", "HO", "ER", "TM", "YB", "LU",
    "AC", "TH", "PA", "U", "NP", "PU", "AM", "CM", "BK", "CF", "ES", "FM", "MD", "NO", "LR",
    "RF", "DB", "SG",
)


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


def truthy(value):
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on", "replace"}


def unique_entry_name(name, entries):
    names = {entry.get("name") for entry in entries}
    if name not in names:
        return name
    base = str(name or "structure").strip() or "structure"
    stamp = str(time.time_ns())
    counter = 1
    while True:
        candidate = f"{base}__{stamp}-{counter}"
        if candidate not in names:
            return candidate
        counter += 1


def normalize_entry_title(value):
    title = str(value or "").strip()
    return title or None


def convert_structure_bytes(payload, filename="", fmt=None, title=None, pdb_id=""):
    source_fmt = infer_structure_format(filename, fmt)
    if not is_maestro_format(source_fmt) and bytes(payload or b"")[:2] == b"\x1f\x8b":
        source_fmt = "maegz"
    if not is_maestro_format(source_fmt):
        raise MaestroConversionError("unsupported_format")
    pdb_data, meta = maestro_bytes_to_pdb(payload, filename, source_fmt)
    name = str(filename or "structure.pdb").strip() or "structure.pdb"
    if name.lower().endswith((".maegz", ".mae.gz", ".mae")):
        name = name.rsplit(".", 1)[0] + ".pdb"
        if name.lower().endswith(".mae.pdb"):
            name = name[:-8] + ".pdb"
    entry = normalize_entry({
        "name": name,
        "title": title or name,
        "pdbId": pdb_id,
        "data": pdb_data,
        "fmt": "pdb",
    })
    if not entry:
        raise MaestroConversionError("conversion_failed")
    return entry, {"sourceFormat": source_fmt, "convertedFormat": "pdb", **meta}


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
    return {
        "schema": SESSION_SCHEMA,
        "entries": entries,
        "includedEntries": included_entries,
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

    representations = value.get("representations")
    if representations is not None:
        if not isinstance(representations, dict):
            return None
        normalized_representations = {}
        protein_backbone = str(
            representations.get("proteinBackbone", representations.get("baseProtein", ""))
        ).strip().lower()
        if protein_backbone:
            if protein_backbone == "hide":
                protein_backbone = "off"
            if protein_backbone not in BACKBONE_REPRESENTATIONS:
                return None
            normalized_representations["proteinBackbone"] = protein_backbone
        for key in ("proteinAtoms", "ligand", "solvent", "other"):
            rep = str(representations.get(key, "")).strip().lower()
            if not rep:
                continue
            if rep == "hide":
                rep = "off"
            if rep not in ATOM_REPRESENTATIONS_WITH_OFF:
                return None
            normalized_representations[key] = rep
        if normalized_representations:
            out["representations"] = normalized_representations

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

    atom_colors = value.get("atomColors")
    if atom_colors is not None:
        if not isinstance(atom_colors, dict):
            return None
        normalized_atom_colors = {}
        for element in ELEMENT_IDS:
            if element not in atom_colors:
                continue
            color = normalize_hex_color(atom_colors[element])
            if color is None:
                return None
            normalized_atom_colors[element] = color
        out["atomColors"] = normalized_atom_colors

    if "carbonByChain" in value:
        out["carbonByChain"] = bool(value.get("carbonByChain"))
    if "backgroundColor" in value:
        color = normalize_hex_color(value.get("backgroundColor"))
        if color is None:
            return None
        out["backgroundColor"] = color
    return out


def load_json(path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f"{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def legacy_last_structure_session():
    try:
        payload = load_json(LAST_STRUCTURE_PATH)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return None
    entry = normalize_entry(payload.get("entry") if isinstance(payload, dict) and "entry" in payload else payload)
    if not entry:
        return None
    return normalize_session({"entries": [entry], "includedEntries": [entry["name"]]})


def normalize_session_state(value, entries, fallback=None):
    fallback = fallback or {}
    names = {entry["name"] for entry in entries}
    included = value.get("includedEntries") if isinstance(value, dict) else None
    if isinstance(included, list):
        included_entries = [str(name) for name in included if str(name) in names]
    else:
        included_entries = [name for name in fallback.get("includedEntries", []) if name in names]
    if not isinstance(included, list) and not included_entries:
        included_entries = [entry["name"] for entry in entries]
    return {"schema": SESSION_SCHEMA, "includedEntries": included_entries}


def apply_session_state(session):
    if not session:
        return session
    try:
        state = load_json(SESSION_STATE_PATH)
    except FileNotFoundError:
        return session
    except (OSError, json.JSONDecodeError):
        raise
    normalized = normalize_session_state(state, session.get("entries", []), session)
    session["includedEntries"] = normalized["includedEntries"]
    return session


def load_session_or_legacy():
    with STATE_LOCK:
        try:
            session = normalize_session(load_json(SESSION_PATH))
            if session:
                return apply_session_state(session)
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
    current = file_revision(SESSION_META_PATH)
    if current:
        return current
    current = file_revision(SESSION_PATH)
    if current:
        return current
    legacy = file_revision(LAST_STRUCTURE_PATH)
    return f"legacy-{legacy}" if legacy else "empty"


def session_meta(session=None):
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
    }


def write_session_state(session):
    state = normalize_session_state(session, session.get("entries", []), session)
    write_json_atomic(SESSION_STATE_PATH, state)


def write_session_meta(session):
    meta = session_meta(session)
    meta.pop("revision", None)
    write_json_atomic(SESSION_META_PATH, meta)


def normalize_stored_session_meta(value):
    if not isinstance(value, dict):
        return None
    entries = []
    for raw in value.get("entries", []):
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        entries.append({
            "name": name,
            "title": str(raw.get("title") or name).strip() or name,
            "pdbId": str(raw.get("pdbId") or "").strip(),
            "fmt": str(raw.get("fmt") or "").strip().lower(),
        })
    names = {entry["name"] for entry in entries}
    included = value.get("includedEntries")
    included_entries = [str(name) for name in included if str(name) in names] if isinstance(included, list) else []
    if entries and not isinstance(included, list) and not included_entries:
        included_entries = [entry["name"] for entry in entries]
    return {
        "schema": SESSION_SCHEMA,
        "revision": session_revision(),
        "entries": entries,
        "includedEntries": included_entries,
    }


def load_session_meta():
    with STATE_LOCK:
        try:
            meta = normalize_stored_session_meta(load_json(SESSION_META_PATH))
        except FileNotFoundError:
            meta = None
        except (OSError, json.JSONDecodeError):
            raise
        if meta:
            return meta
        session = load_session_or_legacy()
        if session:
            write_session_meta(session)
            return session_meta(session)
        return session_meta(None)


def load_preferences():
    with STATE_LOCK:
        return normalize_preferences(load_json(PREFERENCES_PATH))


def write_preferences(preferences):
    with STATE_LOCK:
        write_json_atomic(PREFERENCES_PATH, preferences)


def static_request_blocked(path):
    norm = unquote(path or "")
    segments = [seg for seg in norm.split("/") if seg]
    if any(seg.startswith(".") or seg == "__pycache__" for seg in segments):
        return True
    name = segments[-1] if segments else ""
    if name in BLOCKED_STATIC_NAMES:
        return True
    return any(name.endswith(suffix) for suffix in BLOCKED_STATIC_SUFFIXES)


def write_session(session):
    with STATE_LOCK:
        write_json_atomic(SESSION_PATH, session)
        write_session_state(session)
        if session.get("entries"):
            write_json_atomic(LAST_STRUCTURE_PATH, {"entry": session["entries"][0]})
        write_session_meta(session)


def clear_session():
    with STATE_LOCK:
        for path in (SESSION_PATH, SESSION_STATE_PATH, SESSION_META_PATH, LAST_STRUCTURE_PATH):
            try:
                path.unlink()
            except FileNotFoundError:
                pass


def upsert_session_entry(entry, replace=False):
    with STATE_LOCK:
        session = load_session_or_legacy()
        if not session:
            session = {"schema": SESSION_SCHEMA, "entries": [], "includedEntries": []}
        entries = session["entries"]
        stored_entry = dict(entry)
        existing_idx = next((idx for idx, existing in enumerate(entries) if existing.get("name") == stored_entry["name"]), None)
        if existing_idx is not None and replace:
            entries[existing_idx] = stored_entry
        else:
            stored_entry["name"] = unique_entry_name(stored_entry["name"], entries)
            entries.append(stored_entry)
        included = [name for name in session.get("includedEntries", []) if any(e["name"] == name for e in entries)]
        if stored_entry["name"] not in included:
            included.append(stored_entry["name"])
        session = normalize_session({"entries": entries, "includedEntries": included})
        write_session(session)
        return session, stored_entry


def remove_session_entry(name):
    with STATE_LOCK:
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
        next_session = normalize_session({"entries": entries, "includedEntries": included})
        write_session(next_session)
        return next_session


def update_session_entry_title(name, title):
    with STATE_LOCK:
        session = load_session_or_legacy()
        if not session:
            return None
        target = str(name or "").strip()
        next_title = normalize_entry_title(title)
        if not target or not next_title:
            return None
        for entry in session.get("entries", []):
            if entry.get("name") == target:
                entry["title"] = next_title
                normalized = normalize_session(session)
                write_session(normalized)
                stored = next(item for item in normalized["entries"] if item.get("name") == target)
                return normalized, stored
        return None


def update_session_state(value):
    with STATE_LOCK:
        if not isinstance(value, dict):
            return None
        session = load_session_or_legacy()
        if not session:
            return None
        entries = session.get("entries", [])
        state = normalize_session_state(value, entries, session)
        next_session = normalize_session({"entries": entries, "includedEntries": state["includedEntries"]})
        write_session_state(next_session)
        write_session_meta(next_session)
        return next_session


class ViewerHandler(SimpleHTTPRequestHandler):
    server_version = "MolecularViewerHTTP/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        buffered_headers = b"".join(getattr(self, "_headers_buffer", [])).lower()
        if b"cache-control:" not in buffered_headers:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

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
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if static_request_blocked(path):
            self.send_error(404)
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
        if path == "/api/session-entry-title":
            self.handle_put_session_entry_title()
            return
        if path == "/api/session-state":
            self.handle_put_session_state()
            return
        if path == "/api/preferences":
            self.handle_put_preferences()
            return
        if path == "/api/convert-structure":
            self.handle_convert_structure()
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
        if path == "/api/session-entry-title":
            self.handle_put_session_entry_title()
            return
        if path == "/api/session-state":
            self.handle_put_session_state()
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
            try:
                clear_session()
            except OSError:
                self.send_json(500, {"error": "state_write_failed"})
                return
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

    def read_raw_body(self, max_bytes):
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "0")
        except ValueError:
            self.send_json(400, {"error": "invalid_content_length"})
            return None
        if length <= 0 or length > max_bytes:
            self.send_json(413 if length > max_bytes else 400, {"error": "invalid_body_size"})
            return None
        return self.rfile.read(length)

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
            meta = load_session_meta()
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_read_failed"})
            return
        self.send_json(200, meta)

    def handle_put_session(self):
        payload = self.read_json_body(MAX_SESSION_BYTES)
        if payload is None:
            return
        session = normalize_session(payload)
        if not session:
            self.send_json(400, {"error": "invalid_session"})
            return
        try:
            write_session(session)
        except OSError:
            self.send_json(500, {"error": "state_write_failed"})
            return
        self.send_json(200, {"ok": True, "entries": len(session["entries"]), "session": session_meta(session)})

    def handle_put_session_entry(self):
        payload = self.read_json_body(MAX_STRUCTURE_BYTES)
        if payload is None:
            return
        raw_entry = payload.get("entry") if isinstance(payload, dict) and "entry" in payload else payload
        query = parse_qs(urlparse(self.path).query)
        replace = truthy((payload if isinstance(payload, dict) else {}).get("replace")) or truthy((query.get("replace") or [""])[0])
        entry = normalize_entry(raw_entry)
        if not entry:
            self.send_json(400, {"error": "invalid_structure"})
            return
        try:
            session, stored_entry = upsert_session_entry(entry, replace=replace)
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_write_failed"})
            return
        self.send_json(200, {"ok": True, "entry": stored_entry, "entries": len(session["entries"]), "session": session_meta(session)})

    def handle_put_session_entry_title(self):
        payload = self.read_json_body(MAX_SESSION_TITLE_BYTES)
        if payload is None:
            return
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "invalid_title_update"})
            return
        name = str(payload.get("name") or payload.get("entry") or "").strip()
        title = normalize_entry_title(payload.get("title", payload.get("newTitle", "")))
        if not name or not title:
            self.send_json(400, {"error": "invalid_title_update"})
            return
        try:
            result = update_session_entry_title(name, title)
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_write_failed"})
            return
        if not result:
            self.send_json(404, {"error": "not_found"})
            return
        session, entry = result
        self.send_json(200, {"ok": True, "entry": entry, "entries": len(session["entries"]), "session": session_meta(session)})

    def handle_put_session_state(self):
        payload = self.read_json_body(MAX_SESSION_STATE_BYTES)
        if payload is None:
            return
        try:
            session = update_session_state(payload)
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_write_failed"})
            return
        if not session:
            self.send_json(404, {"error": "not_found"})
            return
        self.send_json(200, {"ok": True, "entries": len(session["entries"]), "session": session_meta(session)})

    def handle_get_preferences(self):
        try:
            preferences = load_preferences()
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
            write_preferences(preferences)
        except OSError:
            self.send_json(500, {"error": "preferences_write_failed"})
            return
        self.send_json(200, {"ok": True, "preferences": preferences})

    def handle_convert_structure(self):
        payload = self.read_raw_body(MAX_STRUCTURE_BYTES)
        if payload is None:
            return
        query = parse_qs(urlparse(self.path).query)
        name = (query.get("name") or ["structure"])[0]
        title = (query.get("title") or [name])[0]
        fmt = (query.get("fmt") or [""])[0]
        pdb_id = (query.get("pdbId") or [""])[0]
        try:
            entry, meta = convert_structure_bytes(payload, name, fmt, title, pdb_id)
        except MaestroConversionError as exc:
            error = str(exc) or "conversion_failed"
            status = 400 if error in {"unsupported_format", "invalid_maegz", "no_atoms"} else 500
            self.send_json(status, {"error": error})
            return
        self.send_json(200, {"ok": True, "entry": entry, **meta})

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
            entries = session.get("entries", [])
            by_name = {item.get("name"): item for item in entries}
            for name in session.get("includedEntries", []):
                entry = by_name.get(name)
                if entry:
                    break
            if not entry and entries:
                entry = entries[0]
        if not entry:
            self.send_json(404, {"error": "not_found"})
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
        try:
            session, stored_entry = upsert_session_entry(entry, replace=True)
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_write_failed"})
            return
        self.send_json(200, {"ok": True, "entry": stored_entry, "entries": len(session["entries"]), "session": session_meta(session)})

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
        try:
            write_json_atomic(path, payload)
        except OSError:
            self.send_json(500, {"error": "cache_write_failed"})
            return
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
