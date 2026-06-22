"""Pure-Python Maestro MAE/MAEGZ to PDB conversion."""

import gzip
import re


MAESTRO_FORMATS = {"mae", "maegz", "mae.gz"}
_TABLE_RE = re.compile(r"^([A-Za-z0-9_]+)\[(\d+)\]\s*\{\s*$")
_CT_RE = re.compile(r"^f_m_ct\b.*\{\s*$")
_EMPTY_VALUES = {"", "<>", "?"}
_STANDARD_RESIDUES = {
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "HID", "HIE", "HIP",
    "ILE", "LEU", "LYS", "MET", "MSE", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
    "SEC", "PYL",
}
_WATER_RESIDUES = {"HOH", "WAT", "DOD", "H2O"}
_ELEMENTS = [
    "", "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
    "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
    "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
    "Ga", "Ge", "As", "Se", "Br", "Kr", "Rb", "Sr", "Y", "Zr",
    "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn",
    "Sb", "Te", "I", "Xe", "Cs", "Ba", "La", "Ce", "Pr", "Nd",
    "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb",
    "Lu", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
    "Tl", "Pb", "Bi", "Po", "At", "Rn", "Fr", "Ra", "Ac", "Th",
    "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm",
    "Md", "No", "Lr", "Rf", "Db", "Sg",
]
_ELEMENT_SET = {symbol.upper() for symbol in _ELEMENTS if symbol}


class MaestroConversionError(ValueError):
    """Raised when a Maestro file cannot be converted into coordinates."""


def is_maestro_format(fmt):
    return str(fmt or "").strip().lower() in MAESTRO_FORMATS


def infer_structure_format(name, fmt=None):
    value = str(fmt or "").strip().lower()
    if value and value != "auto":
        return value
    lower = str(name or "").strip().lower()
    if lower.endswith(".psazip"):
        return "psazip"
    if lower.endswith(".maegz") or lower.endswith(".mae.gz"):
        return "maegz"
    if lower.endswith(".mae"):
        return "mae"
    if lower.endswith(".sdf") or lower.endswith(".mol"):
        return "sdf"
    if lower.endswith(".mol2"):
        return "mol2"
    if lower.endswith(".xyz"):
        return "xyz"
    if lower.endswith(".cif") or lower.endswith(".mmcif"):
        return "cif"
    return "pdb"


def decode_maestro_bytes(payload, filename="", fmt=None):
    source_fmt = infer_structure_format(filename, fmt)
    data = bytes(payload or b"")
    if source_fmt in {"maegz", "mae.gz"} or data[:2] == b"\x1f\x8b":
        try:
            data = gzip.decompress(data)
        except OSError as exc:
            raise MaestroConversionError("invalid_maegz") from exc
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1", errors="replace")


def tokenize_maestro_line(line):
    tokens = []
    text = line.strip()
    i = 0
    while i < len(text):
        if text[i].isspace():
            i += 1
            continue
        if text[i] == '"':
            i += 1
            buf = []
            while i < len(text):
                ch = text[i]
                if ch == "\\" and i + 1 < len(text):
                    buf.append(text[i + 1])
                    i += 2
                    continue
                if ch == '"':
                    i += 1
                    break
                buf.append(ch)
                i += 1
            tokens.append("".join(buf))
            continue
        start = i
        while i < len(text) and not text[i].isspace():
            i += 1
        tokens.append(text[start:i])
    return tokens


def _brace_delta(line):
    delta = 0
    quoted = False
    escaped = False
    for ch in line:
        if escaped:
            escaped = False
            continue
        if ch == "\\" and quoted:
            escaped = True
            continue
        if ch == '"':
            quoted = not quoted
            continue
        if quoted:
            continue
        if ch == "{":
            delta += 1
        elif ch == "}":
            delta -= 1
    return delta


def iter_maestro_ct_blocks(text):
    lines = text.splitlines()
    current = None
    depth = 0
    for line in lines:
        stripped = line.strip()
        if current is None:
            if _CT_RE.match(stripped):
                current = [line]
                depth = _brace_delta(line)
            continue
        current.append(line)
        depth += _brace_delta(line)
        if depth <= 0:
            yield "\n".join(current) + "\n"
            current = None
            depth = 0


def maestro_ct_title(text):
    columns = []
    in_schema = False
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if _TABLE_RE.match(stripped):
            break
        if stripped == ":::":
            in_schema = True
            continue
        if not in_schema:
            if stripped == "}" or _CT_RE.match(stripped):
                continue
            columns.append(stripped)
            continue
        row = tokenize_maestro_line(stripped)
        if not row:
            continue
        if "s_m_title" in columns:
            offset = 1 if len(row) >= len(columns) + 1 else 0
            idx = columns.index("s_m_title") + offset
            if idx < len(row):
                return _clean(row[idx])
        return ""
    return ""


def iter_maestro_tables(text):
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        stripped = lines[i].strip()
        match = _TABLE_RE.match(stripped)
        if not match:
            i += 1
            continue

        table_name, raw_count = match.group(1), match.group(2)
        row_count = int(raw_count)
        i += 1
        columns = []
        while i < len(lines):
            schema_line = lines[i].strip()
            i += 1
            if schema_line == ":::":
                break
            if not schema_line or schema_line.startswith("#"):
                continue
            if schema_line == "}":
                break
            columns.append(schema_line)

        rows = []
        while i < len(lines) and len(rows) < row_count:
            row_line = lines[i]
            stripped_row = row_line.strip()
            if stripped_row == "}":
                break
            if stripped_row and not stripped_row.startswith("#"):
                row = tokenize_maestro_line(row_line)
                if row:
                    rows.append(row)
            i += 1
        yield table_name, columns, rows


def _clean(value):
    value = "" if value is None else str(value).strip()
    return "" if value in _EMPTY_VALUES else value


def _to_int(value, default=None):
    value = _clean(value)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        try:
            return int(float(value))
        except ValueError:
            return default


def _to_float(value, default=None):
    value = _clean(value)
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _row_offset(row, columns):
    return 1 if len(row) >= len(columns) + 1 else 0


def _row_id(row, columns, fallback):
    if _row_offset(row, columns) and row:
        return _to_int(row[0], fallback)
    return fallback


def _row_value(row, columns, col_map, names):
    offset = _row_offset(row, columns)
    for name in names:
        idx = col_map.get(name)
        if idx is None:
            continue
        pos = idx + offset
        if pos < len(row):
            value = _clean(row[pos])
            if value:
                return value
    return ""


def _element_from_atomic_number(value):
    atomic_number = _to_int(value)
    if atomic_number is None or atomic_number <= 0 or atomic_number >= len(_ELEMENTS):
        return ""
    return _ELEMENTS[atomic_number]


def _element_from_name(name):
    letters = "".join(ch for ch in str(name or "") if ch.isalpha())
    if not letters:
        return ""
    first = letters[0].upper()
    if first not in _ELEMENT_SET:
        return ""
    if len(letters) >= 2 and letters[1].islower():
        candidate = (letters[0] + letters[1]).upper()
        if candidate in _ELEMENT_SET:
            return candidate.title()
    return first


def _display_serial(serial):
    if serial is None:
        return 0
    if 0 <= serial <= 99999:
        return serial
    return serial % 100000


def _display_resseq(resseq):
    if resseq is None:
        return 1
    if -999 <= resseq <= 9999:
        return resseq
    return resseq % 10000


def _pdb_chain(chain):
    chain = _clean(chain)
    if not chain:
        return " "
    return chain[-1]


def _pdb_atom_name(raw_name, element):
    raw_name = "" if raw_name is None else str(raw_name).replace("\t", " ")
    if len(raw_name) == 4 and raw_name.strip():
        return raw_name
    name = raw_name.strip() or (element or "X")
    if len(name) >= 4:
        return name[:4]
    if len(str(element or "").strip()) == 1:
        return f" {name:<3}"[:4]
    return f"{name:<4}"[:4]


def _pdb_resname(resname):
    resname = _clean(resname).upper()
    if not resname:
        return "UNK"
    return resname[:3]


def _atom_record_type(resname):
    if resname in _STANDARD_RESIDUES:
        return "ATOM"
    if resname in _WATER_RESIDUES:
        return "HETATM"
    return "HETATM"


def _atom_line(atom):
    record = _atom_record_type(atom["resname"])
    atom_name = _pdb_atom_name(atom["atom_name"], atom["element"])
    return (
        f"{record:<6}{_display_serial(atom['serial']):5d} {atom_name}{' ':1}"
        f"{atom['resname']:>3} {_pdb_chain(atom['chain']):1}{_display_resseq(atom['resi']):4d}{' ':1}"
        f"   {atom['x']:8.3f}{atom['y']:8.3f}{atom['z']:8.3f}"
        f"{atom['occupancy']:6.2f}{atom['bfactor']:6.2f}          {atom['element']:>2}"
    )


def _parse_atom_table(columns, rows, start_serial):
    col_map = {name: idx for idx, name in enumerate(columns)}
    atoms = []
    mae_to_serial = {}
    for pos, row in enumerate(rows, 1):
        x = _to_float(_row_value(row, columns, col_map, ("r_m_x_coord",)))
        y = _to_float(_row_value(row, columns, col_map, ("r_m_y_coord",)))
        z = _to_float(_row_value(row, columns, col_map, ("r_m_z_coord",)))
        if x is None or y is None or z is None:
            continue
        atom_name = _row_value(row, columns, col_map, ("s_m_pdb_atom_name", "s_m_atom_name", "s_m_mmod_atom_name"))
        element = _element_from_atomic_number(_row_value(row, columns, col_map, ("i_m_atomic_number",)))
        if not element:
            element = _element_from_name(atom_name)
        serial = start_serial + len(atoms)
        mae_to_serial[_row_id(row, columns, pos)] = serial
        atoms.append({
            "serial": serial,
            "source_serial": _to_int(_row_value(row, columns, col_map, ("i_pdb_PDB_serial",)), serial),
            "atom_name": atom_name,
            "resname": _pdb_resname(_row_value(row, columns, col_map, ("s_m_pdb_residue_name", "s_m_mmod_res"))),
            "chain": _row_value(row, columns, col_map, ("s_m_chain_name", "s_m_pdb_chain_name")),
            "resi": _to_int(_row_value(row, columns, col_map, ("i_m_residue_number", "i_m_pdb_residue_number")), 1),
            "x": x,
            "y": y,
            "z": z,
            "occupancy": _to_float(_row_value(row, columns, col_map, ("r_m_pdb_occupancy",)), 1.0),
            "bfactor": _to_float(_row_value(row, columns, col_map, ("r_m_pdb_tfactor",)), 0.0),
            "element": element[:2].title() if element else "",
        })
    return atoms, mae_to_serial


def _parse_bond_table(columns, rows, mae_to_serial):
    col_map = {name: idx for idx, name in enumerate(columns)}
    bonds = {}
    for row in rows:
        source = _to_int(_row_value(row, columns, col_map, ("i_m_from", "i_m_from_atom", "i_m_from_atom_number")))
        target = _to_int(_row_value(row, columns, col_map, ("i_m_to", "i_m_to_atom", "i_m_to_atom_number")))
        if source is None or target is None:
            continue
        source_serial = mae_to_serial.get(source)
        target_serial = mae_to_serial.get(target)
        if not source_serial or not target_serial or source_serial == target_serial:
            continue
        order = _to_float(_row_value(row, columns, col_map, ("i_m_order", "i_m_bond_order")), 1.0)
        if order is None or order <= 0:
            order = 1.0
        if float(order).is_integer():
            order = int(order)
        key = tuple(sorted((source_serial, target_serial)))
        bonds[key] = max(order, bonds.get(key, 1))
    return bonds


def maestro_text_to_pdb(text):
    atoms = []
    bonds = {}
    current_mae_to_serial = {}
    for table_name, columns, rows in iter_maestro_tables(text):
        if table_name == "m_atom":
            parsed_atoms, current_mae_to_serial = _parse_atom_table(columns, rows, len(atoms) + 1)
            atoms.extend(parsed_atoms)
            continue
        if table_name == "m_bond" and current_mae_to_serial:
            bonds.update(_parse_bond_table(columns, rows, current_mae_to_serial))

    if not atoms:
        raise MaestroConversionError("no_atoms")

    lines = [_atom_line(atom) for atom in atoms]
    grouped = {}
    for source, target in sorted(bonds):
        grouped.setdefault(source, []).append(target)
    for source, targets in grouped.items():
        for idx in range(0, len(targets), 4):
            chunk = targets[idx:idx + 4]
            lines.append("CONECT" + f"{_display_serial(source):5d}" + "".join(f"{_display_serial(target):5d}" for target in chunk))
    lines.append("END")
    bond_orders = [{"a": source, "b": target, "order": order} for (source, target), order in sorted(bonds.items())]
    return "\n".join(lines) + "\n", {"atomCount": len(atoms), "bondCount": len(bonds), "bondOrders": bond_orders}


def maestro_text_to_pdb_entries(text):
    blocks = list(iter_maestro_ct_blocks(text)) or [text]
    entries = []
    for block in blocks:
        try:
            pdb, meta = maestro_text_to_pdb(block)
        except MaestroConversionError as exc:
            if str(exc) == "no_atoms":
                continue
            raise
        title = maestro_ct_title(block)
        if title:
            meta = {**meta, "title": title}
        entries.append((pdb, meta))
    if not entries:
        raise MaestroConversionError("no_atoms")
    return entries


def maestro_bytes_to_pdb(payload, filename="", fmt=None):
    return maestro_text_to_pdb_entries(decode_maestro_bytes(payload, filename, fmt))[0]


def maestro_bytes_to_pdb_entries(payload, filename="", fmt=None):
    return maestro_text_to_pdb_entries(decode_maestro_bytes(payload, filename, fmt))
