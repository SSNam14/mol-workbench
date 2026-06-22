#!/usr/bin/env python3
"""Static file server with a tiny persisted viewer-state API."""

import argparse
import io
import json
import os
import pickle
import tempfile
import threading
import time
import zipfile
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
AGENT_ACTIONS_PATH = STATE_DIR / "agent_actions.json"
MAX_STRUCTURE_BYTES = 200 * 1024 * 1024
MAX_SESSION_BYTES = 500 * 1024 * 1024
MAX_SESSION_STATE_BYTES = 64 * 1024
MAX_SESSION_TITLE_BYTES = 16 * 1024
MAX_PREFERENCES_BYTES = 1024 * 1024
MAX_INTERACTION_INDEX_BYTES = 200 * 1024 * 1024
MAX_AGENT_ACTION_BYTES = 128 * 1024
MAX_AGENT_ACTIONS = 100
MAX_SERVER_FILE_ITEMS = 1000
MAX_SURFACE_CHUNK_VERTICES = 60000
SESSION_SCHEMA = "viewer-session-v1"
PREFERENCES_SCHEMA = "viewer-preferences-v1"
INTERACTION_INDEX_SCHEMA = "interaction-index-v6"
AGENT_ACTIONS_SCHEMA = "viewer-agent-actions-v1"
STATE_LOCK = threading.RLock()
BLOCKED_STATIC_NAMES = {"server.py", "HANDOFF.md", "README.md"}
BLOCKED_STATIC_SUFFIXES = {".log", ".pid", ".pyc"}
MOUSE_BUTTON_ACTIONS = {"rotate", "pan", "zoom", "select", "none"}
MOUSE_WHEEL_ACTIONS = {"zoom", "none"}
MOUSE_PRESETS = {"select-left", "custom", "default"}
ROTATION_MODIFIERS = ("ctrl", "shift", "alt")
ROTATION_AXES = {"none", "x", "y", "z"}
KEY_BINDING_ACTIONS = ("focus", "cycleLigand", "cycleChain", "nearby")
KEY_BINDING_ALIASES = {
    "space": "Space",
    "spacebar": "Space",
    "del": "Delete",
    "delete": "Delete",
    "backspace": "Backspace",
    "enter": "Enter",
    "return": "Enter",
    "esc": "Escape",
    "escape": "Escape",
    "tab": "Tab",
}
RESERVED_KEY_BINDINGS = {"delete", "control", "ctrl", "shift", "alt", "meta", "cmd", "command"}
BACKBONE_REPRESENTATIONS = {"cartoon", "tube", "off"}
ATOM_REPRESENTATIONS = {"line", "stick", "sphere", "cpk"}
ATOM_REPRESENTATIONS_WITH_OFF = ATOM_REPRESENTATIONS | {"off"}
SERVER_FILE_ROOTS = [Path.home()]
SERVER_STRUCTURE_SUFFIXES = (".pdb", ".ent", ".sdf", ".mol", ".mol2", ".xyz", ".cif", ".mmcif", ".mae", ".maegz", ".mae.gz", ".psazip")
AGENT_ACTION_TYPES = {
    "querywithin",
    "showwithin",
    "selectwithin",
    "queryinteractions",
    "showinteractions",
    "clearinteractionfilter",
    "clearinteractionsfilter",
    "style",
    "hide",
    "selection",
    "setselection",
    "clearselection",
    "clearstyles",
    "focus",
}
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


def normalize_key_binding_value(value):
    key = str(value or "").strip()
    if len(key) > 32:
        return None
    if not key:
        return ""
    if len(key) == 1:
        return key.lower()
    key = KEY_BINDING_ALIASES.get(key.lower(), key)
    if key.lower() in RESERVED_KEY_BINDINGS:
        return None
    if "+" in key:
        return None
    return key


def normalize_server_file_roots(values):
    roots = []
    for value in values or []:
        try:
            path = Path(str(value or "")).expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        if path.is_dir() and path not in roots:
            roots.append(path)
    if not roots:
        roots.append(ROOT)
    return roots


def is_supported_server_structure(path):
    name = path.name.lower()
    return any(name.endswith(suffix) for suffix in SERVER_STRUCTURE_SUFFIXES)


def resolve_server_file_path(value):
    roots = SERVER_FILE_ROOTS or [ROOT]
    raw = str(value or "").strip()
    candidate = Path(raw).expanduser() if raw else roots[0]
    if not candidate.is_absolute():
        candidate = roots[0] / candidate
    try:
        resolved = candidate.resolve()
    except (OSError, RuntimeError):
        return None, None
    for root in roots:
        try:
            rel = resolved.relative_to(root)
        except ValueError:
            continue
        if any(part.startswith(".") for part in rel.parts):
            return None, None
        return resolved, root
    return None, None


def server_file_roots_payload():
    return [{"path": str(root), "name": str(root)} for root in SERVER_FILE_ROOTS]


def server_file_item(path):
    try:
        stat = path.stat()
    except OSError:
        return None
    if path.is_dir():
        return {"name": path.name, "path": str(path), "type": "directory", "size": None, "mtime": stat.st_mtime, "loadable": False}
    if path.is_file() and is_supported_server_structure(path):
        return {"name": path.name, "path": str(path), "type": "file", "size": stat.st_size, "mtime": stat.st_mtime, "loadable": True}
    return None


def list_server_files(value):
    path, root = resolve_server_file_path(value)
    if path is None:
        return None, "forbidden"
    if not path.is_dir():
        return None, "not_directory"
    items = []
    try:
        children = list(path.iterdir())
    except PermissionError:
        return None, "permission_denied"
    except OSError:
        return None, "read_failed"
    for child in children:
        resolved, _ = resolve_server_file_path(str(child))
        if resolved is None:
            continue
        item = server_file_item(resolved)
        if item:
            items.append(item)
        if len(items) >= MAX_SERVER_FILE_ITEMS:
            break
    items.sort(key=lambda item: (item["type"] != "directory", item["name"].lower()))
    parent = ""
    if path != root:
        parent_candidate, _ = resolve_server_file_path(str(path.parent))
        if parent_candidate is not None:
            parent = str(parent_candidate)
    return {
        "ok": True,
        "path": str(path),
        "root": str(root),
        "parent": parent,
        "roots": server_file_roots_payload(),
        "items": items,
        "truncated": len(items) >= MAX_SERVER_FILE_ITEMS,
    }, None


def load_server_file_entry(value):
    path, _ = resolve_server_file_path(value)
    if path is None:
        return None, "forbidden"
    if not path.is_file():
        return None, "not_file"
    if not is_supported_server_structure(path):
        return None, "unsupported_format"
    try:
        size = path.stat().st_size
    except OSError:
        return None, "read_failed"
    if size <= 0 or size > MAX_STRUCTURE_BYTES:
        return None, "invalid_body_size"
    try:
        payload = path.read_bytes()
    except PermissionError:
        return None, "permission_denied"
    except OSError:
        return None, "read_failed"
    filename = path.name
    fmt = infer_structure_format(filename)
    if fmt == "psazip":
        try:
            return convert_structure_bytes(payload, filename, fmt, filename, "")
        except MaestroConversionError as exc:
            return None, str(exc) or "conversion_failed"
    if is_maestro_format(fmt) or payload[:2] == b"\x1f\x8b":
        try:
            entry, meta = convert_structure_bytes(payload, filename, fmt, filename, "")
        except MaestroConversionError as exc:
            return None, str(exc) or "conversion_failed"
        return entry, meta
    try:
        data = payload.decode("utf-8")
    except UnicodeDecodeError:
        return None, "decode_failed"
    entry = normalize_entry({"name": filename, "title": filename, "pdbId": "", "data": data, "fmt": fmt})
    if not entry:
        return None, "invalid_structure"
    return entry, {"sourceFormat": fmt, "convertedFormat": fmt}


def normalize_deleted_source_serials(value):
    if not isinstance(value, list):
        return []
    seen = set()
    out = []
    for item in value:
        if item is None:
            continue
        text = str(item).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)

    def sort_key(text):
        try:
            return (0, float(text), text)
        except ValueError:
            return (1, text)

    return sorted(out, key=sort_key)


def normalize_bond_orders(value):
    if not isinstance(value, list):
        return []
    by_pair = {}
    for item in value:
        if isinstance(item, dict):
            a = item.get("a")
            b = item.get("b")
            order = item.get("order", 1)
        elif isinstance(item, (list, tuple)) and len(item) >= 3:
            a, b, order = item[:3]
        else:
            continue
        if a is None or b is None:
            continue
        a_text = str(a).strip()
        b_text = str(b).strip()
        if not a_text or not b_text or a_text == b_text:
            continue
        try:
            order_value = float(order)
        except (TypeError, ValueError):
            order_value = 1.0
        if order_value <= 0:
            order_value = 1.0
        if order_value.is_integer():
            order_value = int(order_value)
        pair = tuple(sorted((a_text, b_text), key=lambda text: (0, float(text), text) if _is_float_text(text) else (1, text)))
        by_pair[pair] = max(order_value, by_pair.get(pair, 1))
    return [{"a": a, "b": b, "order": order} for (a, b), order in sorted(by_pair.items(), key=lambda item: item[0])]


def _is_float_text(value):
    try:
        float(value)
        return True
    except ValueError:
        return False


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
    entry = {"name": name, "title": title, "pdbId": pdb_id, "data": data, "fmt": fmt}
    bond_orders = normalize_bond_orders(value.get("bondOrders"))
    if bond_orders:
        entry["bondOrders"] = bond_orders
    surfaces = normalize_entry_surfaces(value.get("surfaces"))
    if surfaces:
        entry["surfaces"] = surfaces
    deleted = normalize_deleted_source_serials(value.get("deletedSourceSerials"))
    if deleted:
        entry["deletedSourceSerials"] = deleted
    return entry


def normalize_entry_surfaces(value):
    if not isinstance(value, list):
        return []
    out = []
    for raw in value[:8]:
        if not isinstance(raw, dict):
            continue
        raw_chunks = raw.get("chunks")
        chunks = []
        if isinstance(raw_chunks, list):
            for chunk in raw_chunks:
                if not isinstance(chunk, dict):
                    continue
                vertices = chunk.get("vertices")
                faces = chunk.get("faces")
                normals = chunk.get("normals")
                colors = chunk.get("colors")
                if not isinstance(vertices, list) or not isinstance(faces, list):
                    continue
                clean = {"vertices": vertices, "faces": faces}
                if isinstance(normals, list):
                    clean["normals"] = normals
                if isinstance(colors, list):
                    clean["colors"] = colors
                chunks.append(clean)
        if not chunks:
            continue
        surface = {
            "name": str(raw.get("name") or "Surface")[:120],
            "kind": str(raw.get("kind") or "surface")[:80],
            "color": str(raw.get("color") or "#8ecae6")[:32],
            "opacity": raw.get("opacity", 0.85),
            "colorMode": str(raw.get("colorMode") or "")[:80],
            "colorField": str(raw.get("colorField") or "")[:80],
            "vertexCount": raw.get("vertexCount"),
            "faceCount": raw.get("faceCount"),
            "chunks": chunks,
        }
        if isinstance(raw.get("valueRange"), list):
            surface["valueRange"] = raw.get("valueRange")[:2]
        if raw.get("source"):
            surface["source"] = str(raw.get("source"))[:160]
        out.append(surface)
    return out


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
    if source_fmt == "psazip":
        return psazip_bytes_to_entry(payload, filename, title, pdb_id)
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
        "bondOrders": meta.get("bondOrders"),
    })
    if not entry:
        raise MaestroConversionError("conversion_failed")
    return entry, {"sourceFormat": source_fmt, "convertedFormat": "pdb", **meta}


def _psazip_read_panel_state(zipf, names):
    panel_name = next((name for name in names if name.lower().endswith("_panel_state.json")), "")
    if not panel_name:
        return {}
    try:
        return json.loads(zipf.read(panel_name).decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return {}


def _psazip_structure_name(names):
    for suffix in (".maegz", ".mae.gz", ".mae", ".cif", ".mmcif", ".pdb"):
        found = [name for name in names if name.lower().endswith(suffix)]
        if found:
            return found[0]
    return ""


def _psazip_surface_vis_name(names):
    found = [name for name in names if name.lower().endswith(".vis")]
    return found[0] if found else ""


def _psazip_patch_pickle_name(names):
    found = [name for name in names if name.lower().endswith(".pkl")]
    return found[0] if found else ""


def _round_float(value, digits):
    return round(float(value), digits)


def _flush_surface_chunk(chunks, vertices, normals, colors, faces, include_normals, include_colors):
    if not vertices or not faces:
        return
    chunk = {
        "vertices": [_round_float(coord, 3) for point in vertices for coord in point],
        "faces": [int(idx) for face in faces for idx in face],
    }
    if include_normals:
        chunk["normals"] = [_round_float(coord, 4) for point in normals for coord in point]
    if include_colors:
        chunk["colors"] = [int(value) for point in colors for value in point]
    chunks.append(chunk)


def chunk_surface_mesh(coords, normals, faces, colors=None):
    chunks = []
    vertex_map = {}
    out_vertices = []
    out_normals = []
    out_colors = []
    out_faces = []
    include_normals = normals is not None and len(normals) == len(coords)
    include_colors = colors is not None and len(colors) == len(coords)

    for face in faces:
        needed = [int(idx) for idx in face if int(idx) not in vertex_map]
        if out_faces and len(out_vertices) + len(needed) > MAX_SURFACE_CHUNK_VERTICES:
            _flush_surface_chunk(chunks, out_vertices, out_normals, out_colors, out_faces, include_normals, include_colors)
            vertex_map = {}
            out_vertices = []
            out_normals = []
            out_colors = []
            out_faces = []
        mapped = []
        for raw_idx in face:
            idx = int(raw_idx)
            mapped_idx = vertex_map.get(idx)
            if mapped_idx is None:
                mapped_idx = len(out_vertices)
                vertex_map[idx] = mapped_idx
                out_vertices.append(coords[idx])
                if include_normals:
                    out_normals.append(normals[idx])
                if include_colors:
                    out_colors.append(colors[idx])
            mapped.append(mapped_idx)
        out_faces.append(mapped)
    _flush_surface_chunk(chunks, out_vertices, out_normals, out_colors, out_faces, include_normals, include_colors)
    return chunks


def _decode_hdf_attr(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def _surface_opacity(panel_state, attrs):
    raw = panel_state.get("settings_trans_front", attrs.get("Transparency", 15))
    try:
        transparency = max(0.0, min(100.0, float(raw)))
    except (TypeError, ValueError):
        transparency = 15.0
    return round(1.0 - transparency / 100.0, 3)


class _SafePsazipUnpickler(pickle.Unpickler):
    _dummy_classes = {}
    _allowed = {
        ("numpy.core.multiarray", "_reconstruct"),
        ("numpy.core.multiarray", "scalar"),
        ("numpy", "ndarray"),
        ("numpy", "dtype"),
        ("_codecs", "encode"),
        ("builtins", "set"),
        ("__builtin__", "set"),
        ("builtins", "frozenset"),
        ("__builtin__", "frozenset"),
        ("collections", "OrderedDict"),
    }

    @classmethod
    def _dummy_class(cls, module, name):
        key = (module, name)
        if key in cls._dummy_classes:
            return cls._dummy_classes[key]

        def __new__(dummy_cls, *args, **kwargs):
            obj = object.__new__(dummy_cls)
            obj.__args__ = args
            return obj

        def __init__(self, *args, **kwargs):
            pass

        def __setstate__(self, state):
            if isinstance(state, dict):
                self.__dict__.update(state)
            else:
                self.__state__ = state

        dummy = type(name, (object,), {
            "__module__": module,
            "__new__": __new__,
            "__init__": __init__,
            "__setstate__": __setstate__,
        })
        cls._dummy_classes[key] = dummy
        return dummy

    def find_class(self, module, name):
        if (module, name) in self._allowed:
            return super().find_class(module, name)
        if module == "schrodinger.application.bioluminate.patch_utils.patch_finder" and name in {"ProteinProperties", "ResInfo"}:
            return self._dummy_class(module, name)
        raise pickle.UnpicklingError(f"blocked {module}.{name}")


def parse_psazip_patch_values(pickle_payload):
    if not pickle_payload:
        return {}
    try:
        import numpy as np
    except ImportError:
        return {}
    try:
        obj = _SafePsazipUnpickler(io.BytesIO(pickle_payload)).load()
    except (pickle.UnpicklingError, ValueError, TypeError, EOFError, ImportError):
        return {}
    arrays = []
    if isinstance(obj, (list, tuple)):
        for item in obj:
            if isinstance(item, np.ndarray) and item.ndim == 1 and np.issubdtype(item.dtype, np.number):
                arrays.append(item.astype(float))
    out = {}
    if arrays:
        out["hydrophobic"] = arrays[0]
    if len(arrays) >= 2:
        out["electrostatic"] = arrays[1]
    return out


def _panel_rgb(panel_state, key, fallback):
    value = panel_state.get(key, {}).get("color") if isinstance(panel_state.get(key), dict) else None
    if not isinstance(value, list) or len(value) < 3:
        return fallback
    out = []
    for raw, default in zip(value[:3], fallback):
        try:
            out.append(max(0, min(255, int(round(float(raw))))))
        except (TypeError, ValueError):
            out.append(default)
    return tuple(out)


def _lerp_rgb(a, b, t):
    t = max(0.0, min(1.0, float(t)))
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def electrostatic_vertex_colors(values, panel_state):
    try:
        import numpy as np
    except ImportError:
        return None, None
    if values is None:
        return None, None
    arr = np.asarray(values, dtype=float)
    if arr.ndim != 1 or arr.size == 0:
        return None, None
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        return None, None
    min_value = float(np.nanmin(finite))
    max_value = float(np.nanmax(finite))
    scale = max(abs(min_value), abs(max_value), 1e-9)
    negative = _panel_rgb(panel_state, "settings_negative", (225, 30, 30))
    positive = _panel_rgb(panel_state, "settings_positive", (0, 0, 180))
    neutral = (245, 245, 245)
    colors = []
    for raw in arr:
        if not np.isfinite(raw):
            colors.append(neutral)
        elif raw < 0:
            colors.append(_lerp_rgb(neutral, negative, min(abs(float(raw)) / scale, 1.0)))
        else:
            colors.append(_lerp_rgb(neutral, positive, min(abs(float(raw)) / scale, 1.0)))
    return colors, [round(min_value, 6), round(max_value, 6)]


def parse_maestro_vis_surfaces(vis_payload, panel_state=None, source="", patch_values=None):
    try:
        import h5py
        import numpy as np
    except ImportError as exc:
        raise MaestroConversionError("surface_support_missing_h5py") from exc

    panel_state = panel_state or {}
    surfaces = []
    with h5py.File(io.BytesIO(vis_payload), "r") as h5:
        def visit(name, obj):
            if not hasattr(obj, "keys"):
                return
            if "Coordinates of Vertices" not in obj or "Patches" not in obj:
                return
            coords = np.asarray(obj["Coordinates of Vertices"], dtype=float).reshape(-1, 3)
            faces = np.asarray(obj["Patches"], dtype=np.int64).reshape(-1, 3)
            normals = None
            if "Normals of Vertices" in obj:
                normals = np.asarray(obj["Normals of Vertices"], dtype=float).reshape(-1, 3)
            if coords.size == 0 or faces.size == 0:
                return
            attrs = {key: _decode_hdf_attr(value) for key, value in obj.attrs.items()}
            electrostatic = (patch_values or {}).get("electrostatic")
            colors, value_range = electrostatic_vertex_colors(electrostatic, panel_state) if electrostatic is not None and len(electrostatic) == len(coords) else (None, None)
            chunks = chunk_surface_mesh(coords, normals, faces, colors)
            if not chunks:
                return
            surface = {
                "name": str(attrs.get("Dataset Name") or name.rsplit("/", 1)[-1] or "Surface"),
                "kind": "maestro-psazip-surface",
                "source": source,
                "color": "#8ecae6",
                "opacity": _surface_opacity(panel_state, attrs),
                "vertexCount": int(coords.shape[0]),
                "faceCount": int(faces.shape[0]),
                "chunks": chunks,
            }
            if colors is not None:
                surface["colorMode"] = "red-white-blue"
                surface["colorField"] = "electrostatic"
                surface["valueRange"] = value_range
            surfaces.append(surface)
        h5.visititems(visit)
    return surfaces


def psazip_bytes_to_entry(payload, filename="", title=None, pdb_id=""):
    try:
        zipf = zipfile.ZipFile(io.BytesIO(bytes(payload or b"")))
    except zipfile.BadZipFile as exc:
        raise MaestroConversionError("invalid_psazip") from exc
    with zipf:
        names = [name for name in zipf.namelist() if not name.endswith("/")]
        structure_name = _psazip_structure_name(names)
        vis_name = _psazip_surface_vis_name(names)
        pkl_name = _psazip_patch_pickle_name(names)
        if not structure_name:
            raise MaestroConversionError("psazip_no_structure")
        if not vis_name:
            raise MaestroConversionError("psazip_no_surface")
        panel_state = _psazip_read_panel_state(zipf, names)
        structure_payload = zipf.read(structure_name)
        structure_fmt = infer_structure_format(structure_name)
        if is_maestro_format(structure_fmt) or structure_payload[:2] == b"\x1f\x8b":
            pdb_data, meta = maestro_bytes_to_pdb(structure_payload, structure_name, structure_fmt)
            converted_fmt = "pdb"
        else:
            try:
                pdb_data = structure_payload.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise MaestroConversionError("psazip_structure_decode_failed") from exc
            meta = {"atomCount": None, "bondCount": None}
            converted_fmt = structure_fmt or "pdb"
        patch_values = parse_psazip_patch_values(zipf.read(pkl_name)) if pkl_name else {}
        surfaces = parse_maestro_vis_surfaces(zipf.read(vis_name), panel_state, vis_name, patch_values)

    name = str(filename or "surface.psazip").strip() or "surface.psazip"
    if name.lower().endswith(".psazip"):
        name = name[:-7] + ".pdb"
    entry = normalize_entry({
        "name": name,
        "title": title or filename or name,
        "pdbId": pdb_id,
        "data": pdb_data,
        "fmt": converted_fmt,
        "bondOrders": meta.get("bondOrders"),
        "surfaces": surfaces,
    })
    if not entry:
        raise MaestroConversionError("conversion_failed")
    return entry, {
        "sourceFormat": "psazip",
        "convertedFormat": converted_fmt,
        "surfaceCount": len(surfaces),
        "surfaceVertexCount": sum(int(s.get("vertexCount") or 0) for s in surfaces),
        "surfaceFaceCount": sum(int(s.get("faceCount") or 0) for s in surfaces),
        **meta,
    }


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

    actions = value.get("actions")
    if actions is not None:
        if not isinstance(actions, dict):
            return None
        normalized_actions = {}
        rotation_modifiers = actions.get("rotationModifiers")
        if rotation_modifiers is not None:
            if not isinstance(rotation_modifiers, dict):
                return None
            normalized_modifiers = {}
            for modifier in ROTATION_MODIFIERS:
                raw = rotation_modifiers.get(modifier)
                if raw is None:
                    continue
                if not isinstance(raw, dict):
                    return None
                axis = str(raw.get("axis", "")).strip().lower()
                if axis not in ROTATION_AXES:
                    return None
                try:
                    direction = int(raw.get("direction", 1))
                except (TypeError, ValueError):
                    return None
                if direction not in (-1, 1):
                    return None
                normalized_modifiers[modifier] = {"axis": axis, "direction": direction}
            if normalized_modifiers:
                normalized_actions["rotationModifiers"] = normalized_modifiers
        key_bindings = actions.get("keyBindings")
        if key_bindings is not None:
            if not isinstance(key_bindings, dict):
                return None
            normalized_keys = {}
            seen_keys = set()
            for action in KEY_BINDING_ACTIONS:
                if action not in key_bindings:
                    continue
                key = normalize_key_binding_value(key_bindings.get(action))
                if key is None:
                    continue
                if key and key in seen_keys:
                    key = ""
                normalized_keys[action] = key
                if key:
                    seen_keys.add(key)
            if normalized_keys:
                normalized_actions["keyBindings"] = normalized_keys
        if normalized_actions:
            out["actions"] = normalized_actions

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


def now_ms():
    return int(time.time() * 1000)


def normalize_agent_action_type(value):
    text = str(value or "").strip()
    key = text.replace("-", "").replace("_", "").lower()
    return text if key in AGENT_ACTION_TYPES else None


def normalize_agent_action(value, *, assign_id=False):
    if not isinstance(value, dict):
        return None
    raw = value.get("action") if isinstance(value.get("action"), dict) else value
    action = dict(raw)
    action_type = normalize_agent_action_type(action.get("type", action.get("action")))
    if not action_type:
        return None
    action["type"] = action_type
    action.pop("action", None)
    encoded = json.dumps(action, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_AGENT_ACTION_BYTES:
        return None
    if assign_id:
        created_at = now_ms()
        ttl_seconds = action.get("ttlSeconds", action.get("ttl", 300))
        try:
            ttl_seconds = max(1, min(3600, int(float(ttl_seconds))))
        except (TypeError, ValueError):
            ttl_seconds = 300
        action["id"] = str(action.get("id") or f"act-{time.time_ns()}")
        action["createdAt"] = created_at
        action["expiresAt"] = created_at + ttl_seconds * 1000
    elif not action.get("id"):
        return None
    return action


def normalize_agent_action_log(value):
    actions = []
    if isinstance(value, dict):
        raw_actions = value.get("actions", [])
    elif isinstance(value, list):
        raw_actions = value
    else:
        raw_actions = []
    current = now_ms()
    for raw in raw_actions:
        action = normalize_agent_action(raw)
        if not action:
            continue
        expires_at = action.get("expiresAt")
        if isinstance(expires_at, (int, float)) and expires_at < current:
            continue
        actions.append(action)
    if len(actions) > MAX_AGENT_ACTIONS:
        actions = actions[-MAX_AGENT_ACTIONS:]
    return {"schema": AGENT_ACTIONS_SCHEMA, "actions": actions}


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


def agent_actions_revision():
    return file_revision(AGENT_ACTIONS_PATH) or "empty"


def load_agent_actions():
    with STATE_LOCK:
        try:
            payload = load_json(AGENT_ACTIONS_PATH)
        except FileNotFoundError:
            payload = None
        log = normalize_agent_action_log(payload)
        return {**log, "revision": agent_actions_revision()}


def append_agent_action(value):
    action = normalize_agent_action(value, assign_id=True)
    if not action:
        return None
    with STATE_LOCK:
        try:
            payload = load_json(AGENT_ACTIONS_PATH)
        except FileNotFoundError:
            payload = None
        log = normalize_agent_action_log(payload)
        log["actions"].append(action)
        if len(log["actions"]) > MAX_AGENT_ACTIONS:
            log["actions"] = log["actions"][-MAX_AGENT_ACTIONS:]
        write_json_atomic(AGENT_ACTIONS_PATH, log)
        return action, {**log, "revision": agent_actions_revision()}


def clear_agent_actions():
    with STATE_LOCK:
        try:
            AGENT_ACTIONS_PATH.unlink()
        except FileNotFoundError:
            pass


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
        if path == "/api/agent-actions":
            self.handle_get_agent_actions()
            return
        if path == "/api/session-meta":
            self.handle_get_session_meta()
            return
        if path == "/api/session":
            self.handle_get_session()
            return
        if path == "/api/preferences":
            self.handle_get_preferences()
            return
        if path == "/api/server-files":
            self.handle_get_server_files()
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
        if path == "/api/agent-actions":
            self.handle_post_agent_action()
            return
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
        if path == "/api/server-file-load":
            self.handle_server_file_load()
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
        if path == "/api/agent-actions":
            self.handle_post_agent_action()
            return
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
        if path == "/api/agent-actions":
            try:
                clear_agent_actions()
            except OSError:
                self.send_json(500, {"error": "state_write_failed"})
                return
            self.send_json(200, {"ok": True, "actions": []})
            return
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

    def handle_get_agent_actions(self):
        try:
            actions = load_agent_actions()
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "agent_actions_read_failed"})
            return
        self.send_json(200, actions)

    def handle_post_agent_action(self):
        payload = self.read_json_body(MAX_AGENT_ACTION_BYTES)
        if payload is None:
            return
        try:
            result = append_agent_action(payload)
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "agent_actions_write_failed"})
            return
        if not result:
            self.send_json(400, {"error": "invalid_agent_action"})
            return
        action, log = result
        self.send_json(200, {"ok": True, "action": action, "actions": log["actions"], "revision": log["revision"]})

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

    def handle_get_server_files(self):
        query = parse_qs(urlparse(self.path).query)
        requested = (query.get("path") or [""])[0]
        payload, error = list_server_files(requested)
        if error:
            status = 403 if error == "forbidden" else 404 if error == "not_directory" else 500
            if error == "permission_denied":
                status = 403
            self.send_json(status, {"error": error, "roots": server_file_roots_payload()})
            return
        self.send_json(200, payload)

    def handle_server_file_load(self):
        payload = self.read_json_body(MAX_SESSION_STATE_BYTES)
        if payload is None:
            return
        if not isinstance(payload, dict):
            self.send_json(400, {"error": "invalid_request"})
            return
        entry, meta = load_server_file_entry(payload.get("path"))
        if not entry:
            error = meta or "invalid_structure"
            status = 403 if error in {"forbidden", "permission_denied"} else 413 if error == "invalid_body_size" else 400
            self.send_json(status, {"error": error})
            return
        try:
            session, stored_entry = upsert_session_entry(entry)
        except (OSError, json.JSONDecodeError):
            self.send_json(500, {"error": "state_write_failed"})
            return
        self.send_json(200, {"ok": True, "entry": stored_entry, "entries": len(session["entries"]), "session": session_meta(session), **meta})

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
            client_errors = {"unsupported_format", "invalid_maegz", "invalid_psazip", "psazip_no_structure", "psazip_no_surface", "psazip_structure_decode_failed", "no_atoms"}
            status = 400 if error in client_errors else 500
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
    global SERVER_FILE_ROOTS
    parser = argparse.ArgumentParser(description="Serve the molecular viewer and persisted structure API.")
    parser.add_argument("--bind", default="0.0.0.0", help="address to bind")
    parser.add_argument("--port", type=int, default=8704, help="port to listen on")
    parser.add_argument("--file-root", action="append", help="server-side root directory exposed to the Open server file browser; may be repeated")
    args = parser.parse_args()

    SERVER_FILE_ROOTS = normalize_server_file_roots(args.file_root or [str(Path.home())])
    httpd = ThreadingHTTPServer((args.bind, args.port), ViewerHandler)
    print(f"Serving {ROOT} on http://{args.bind}:{args.port}/", flush=True)
    print("Server file roots: " + ", ".join(str(root) for root in SERVER_FILE_ROOTS), flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
