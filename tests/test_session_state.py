import unittest
from pathlib import Path
import sys
import tempfile


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def entry(name):
    return {"name": name, "title": name, "pdbId": "", "fmt": "pdb", "data": "ATOM\n"}


class RecordingHandler:
    def __init__(self):
        self.sent = None

    def send_json(self, status, payload):
        self.sent = (status, payload)


class SessionStateTests(unittest.TestCase):
    def setUp(self):
        self.entries = [entry("one"), entry("two")]

    def test_normalize_session_preserves_explicit_empty_included_entries(self):
        payload = {"entries": self.entries, "includedEntries": []}
        session = server.normalize_session(payload)
        self.assertEqual(session["includedEntries"], [])

    def test_normalize_session_missing_included_entries_uses_legacy_all_entries(self):
        payload = {"entries": self.entries}
        session = server.normalize_session(payload)
        self.assertEqual(session["includedEntries"], ["one", "two"])

    def test_normalize_session_preserves_locked_entries_as_included(self):
        payload = {"entries": self.entries, "includedEntries": ["one"], "lockedEntries": ["two", "missing"]}
        session = server.normalize_session(payload)
        self.assertEqual(session["includedEntries"], ["one", "two"])
        self.assertEqual(session["lockedEntries"], ["two"])

    def test_normalize_entry_preserves_deleted_source_serials(self):
        normalized = server.normalize_entry({
            **entry("one"),
            "deletedSourceSerials": [3, "2", "3", "", None],
        })
        self.assertEqual(normalized["deletedSourceSerials"], ["2", "3"])

    def test_normalize_entry_preserves_load_group(self):
        normalized = server.normalize_entry({
            **entry("one"),
            "loadGroup": {"id": "load-1", "title": "multi.maegz", "index": 2, "total": 5},
        })
        self.assertEqual(normalized["loadGroup"], {"id": "load-1", "title": "multi.maegz", "index": 2, "total": 5})

    def test_normalize_entry_preserves_source_path(self):
        normalized = server.normalize_entry({
            **entry("one"),
            "sourcePath": "/tmp/one.pdb",
        })
        self.assertEqual(normalized["sourcePath"], "/tmp/one.pdb")

    def test_apply_entry_load_group_marks_multi_entry_loads(self):
        grouped = server.apply_entry_load_group([entry("one"), entry("two")], "multi.maegz")
        self.assertEqual(grouped[0]["loadGroup"]["title"], "multi.maegz")
        self.assertEqual(grouped[0]["loadGroup"]["total"], 2)
        self.assertEqual(grouped[1]["loadGroup"]["index"], 2)
        self.assertEqual(grouped[0]["loadGroup"]["id"], grouped[1]["loadGroup"]["id"])

    def test_session_meta_includes_source_path(self):
        item = {**entry("one"), "sourcePath": "/tmp/one.pdb"}
        meta = server.session_meta({"entries": [item], "includedEntries": ["one"], "lockedEntries": []})
        self.assertEqual(meta["entries"][0]["sourcePath"], "/tmp/one.pdb")

    def test_normalize_session_state_preserves_explicit_empty_included_entries(self):
        fallback = {"includedEntries": ["one", "two"]}
        state = server.normalize_session_state({"includedEntries": []}, self.entries, fallback)
        self.assertEqual(state["includedEntries"], [])

    def test_normalize_session_state_preserves_explicit_empty_locked_entries(self):
        fallback = {"includedEntries": ["one"], "lockedEntries": ["two"]}
        state = server.normalize_session_state({"lockedEntries": []}, self.entries, fallback)
        self.assertEqual(state["includedEntries"], ["one"])
        self.assertEqual(state["lockedEntries"], [])

    def test_normalize_session_state_keeps_locked_entries_included(self):
        state = server.normalize_session_state({"includedEntries": ["one"], "lockedEntries": ["two"]}, self.entries)
        self.assertEqual(state["includedEntries"], ["one", "two"])
        self.assertEqual(state["lockedEntries"], ["two"])

    def test_normalize_session_state_missing_included_entries_uses_fallback(self):
        fallback = {"includedEntries": ["two"]}
        state = server.normalize_session_state({}, self.entries, fallback)
        self.assertEqual(state["includedEntries"], ["two"])

    def test_normalize_session_state_filters_explicit_names_without_all_entries_fallback(self):
        fallback = {"includedEntries": ["one"]}
        state = server.normalize_session_state({"includedEntries": ["missing"]}, self.entries, fallback)
        self.assertEqual(state["includedEntries"], [])

    def test_normalize_stored_session_meta_preserves_explicit_empty_included_entries(self):
        meta = {
            "entries": [{"name": "one", "title": "one", "pdbId": "", "fmt": "pdb"}],
            "includedEntries": [],
        }
        state = server.normalize_stored_session_meta(meta)
        self.assertEqual(state["includedEntries"], [])

    def test_normalize_stored_session_meta_preserves_locked_entries(self):
        meta = {
            "entries": [{"name": "one", "title": "one", "pdbId": "", "fmt": "pdb"}, {"name": "two", "title": "two", "pdbId": "", "fmt": "pdb"}],
            "includedEntries": ["one"],
            "lockedEntries": ["two"],
        }
        state = server.normalize_stored_session_meta(meta)
        self.assertEqual(state["includedEntries"], ["one", "two"])
        self.assertEqual(state["lockedEntries"], ["two"])

    def test_normalize_preferences_preserves_action_preferences(self):
        prefs = server.normalize_preferences({
            "mousePreset": "custom",
            "mouse": {"buttons": {"left": "select", "right": "rotate", "middle": "pan"}, "wheel": "zoom"},
            "actions": {
                "rotationModifiers": {
                    "ctrl": {"axis": "z", "direction": -1},
                    "shift": {"axis": "y", "direction": 1},
                },
                "keyBindings": {"focus": "z", "cycleLigand": "l", "cycleChain": "c", "nearby": "n"},
            },
        })
        self.assertEqual(prefs["actions"]["rotationModifiers"]["ctrl"], {"axis": "z", "direction": -1})
        self.assertEqual(prefs["actions"]["keyBindings"]["nearby"], "n")

    def test_normalize_preferences_filters_reserved_key_bindings(self):
        prefs = server.normalize_preferences({
            "actions": {
                "keyBindings": {"focus": "Delete", "cycleLigand": "Ctrl+L", "cycleChain": "shift", "nearby": "N"},
            },
        })
        self.assertEqual(prefs["actions"]["keyBindings"], {"nearby": "n"})

    def test_normalize_preferences_deduplicates_key_bindings(self):
        prefs = server.normalize_preferences({
            "actions": {
                "keyBindings": {"focus": "z", "cycleLigand": "z", "cycleChain": "c", "nearby": "c"},
            },
        })
        self.assertEqual(prefs["actions"]["keyBindings"], {
            "focus": "z",
            "cycleLigand": "",
            "cycleChain": "c",
            "nearby": "",
        })

    def test_server_file_listing_filters_to_allowed_root_and_structures(self):
        original_roots = server.SERVER_FILE_ROOTS
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ok.pdb").write_text("ATOM\n", encoding="utf-8")
            (root / "notes.txt").write_text("ignore\n", encoding="utf-8")
            (root / ".hidden").mkdir()
            (root / "child").mkdir()
            (root / "child" / "child.cif").write_text("_atom_site.Cartn_x\n", encoding="utf-8")
            server.SERVER_FILE_ROOTS = [root.resolve()]
            try:
                payload, error = server.list_server_files(str(root))
                self.assertIsNone(error)
                self.assertEqual([item["name"] for item in payload["items"]], ["child", "ok.pdb"])
                outside, outside_error = server.list_server_files(str(root.parent))
                self.assertIsNone(outside)
                self.assertEqual(outside_error, "forbidden")
            finally:
                server.SERVER_FILE_ROOTS = original_roots

    def test_load_server_file_entry_supports_structure_files(self):
        original_roots = server.SERVER_FILE_ROOTS
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdb = root / "one.pdb"
            pdb.write_text("ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00  0.00           N\n", encoding="utf-8")
            server.SERVER_FILE_ROOTS = [root.resolve()]
            try:
                entry, meta = server.load_server_file_entry(str(pdb))
                self.assertEqual(entry["name"], "one.pdb")
                self.assertEqual(entry["fmt"], "pdb")
                self.assertEqual(entry["sourcePath"], str(pdb.resolve()))
                self.assertEqual(meta["sourceFormat"], "pdb")
            finally:
                server.SERVER_FILE_ROOTS = original_roots

    def test_get_last_structure_returns_not_found_without_session(self):
        original = server.load_session_or_legacy
        server.load_session_or_legacy = lambda: None
        try:
            handler = RecordingHandler()
            server.ViewerHandler.handle_get_last_structure(handler)
            self.assertEqual(handler.sent, (404, {"error": "not_found"}))
        finally:
            server.load_session_or_legacy = original

    def test_session_entry_name_conflict_creates_unique_entry(self):
        originals = {
            "STATE_DIR": server.STATE_DIR,
            "LAST_STRUCTURE_PATH": server.LAST_STRUCTURE_PATH,
            "SESSION_PATH": server.SESSION_PATH,
            "SESSION_STATE_PATH": server.SESSION_STATE_PATH,
            "SESSION_META_PATH": server.SESSION_META_PATH,
            "PREFERENCES_PATH": server.PREFERENCES_PATH,
            "INTERACTION_INDEX_DIR": server.INTERACTION_INDEX_DIR,
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server.STATE_DIR = root
            server.LAST_STRUCTURE_PATH = root / "last_structure.json"
            server.SESSION_PATH = root / "session.json"
            server.SESSION_STATE_PATH = root / "session_state.json"
            server.SESSION_META_PATH = root / "session_meta.json"
            server.PREFERENCES_PATH = root / "preferences.json"
            server.INTERACTION_INDEX_DIR = root / "interaction_indexes"
            try:
                first_session, first = server.upsert_session_entry(entry("same"))
                second_session, second = server.upsert_session_entry(entry("same"))
                self.assertEqual(len(first_session["entries"]), 1)
                self.assertEqual(len(second_session["entries"]), 2)
                self.assertEqual(first["name"], "same")
                self.assertNotEqual(second["name"], "same")
                self.assertTrue(second["name"].startswith("same__"))
                self.assertEqual([item["title"] for item in second_session["entries"]], ["same", "same"])
            finally:
                for key, value in originals.items():
                    setattr(server, key, value)

    def test_update_session_entry_title_preserves_entry_id(self):
        originals = {
            "STATE_DIR": server.STATE_DIR,
            "LAST_STRUCTURE_PATH": server.LAST_STRUCTURE_PATH,
            "SESSION_PATH": server.SESSION_PATH,
            "SESSION_STATE_PATH": server.SESSION_STATE_PATH,
            "SESSION_META_PATH": server.SESSION_META_PATH,
            "PREFERENCES_PATH": server.PREFERENCES_PATH,
            "INTERACTION_INDEX_DIR": server.INTERACTION_INDEX_DIR,
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server.STATE_DIR = root
            server.LAST_STRUCTURE_PATH = root / "last_structure.json"
            server.SESSION_PATH = root / "session.json"
            server.SESSION_STATE_PATH = root / "session_state.json"
            server.SESSION_META_PATH = root / "session_meta.json"
            server.PREFERENCES_PATH = root / "preferences.json"
            server.INTERACTION_INDEX_DIR = root / "interaction_indexes"
            try:
                _, stored = server.upsert_session_entry(entry("same"))
                session, renamed = server.update_session_entry_title(stored["name"], "second copy")
                self.assertEqual(renamed["name"], "same")
                self.assertEqual(renamed["title"], "second copy")
                self.assertEqual(session["entries"][0]["name"], "same")
                self.assertEqual(session["entries"][0]["title"], "second copy")
            finally:
                for key, value in originals.items():
                    setattr(server, key, value)

    def test_remove_session_entries_persists_batch_delete(self):
        originals = {
            "STATE_DIR": server.STATE_DIR,
            "LAST_STRUCTURE_PATH": server.LAST_STRUCTURE_PATH,
            "SESSION_PATH": server.SESSION_PATH,
            "SESSION_STATE_PATH": server.SESSION_STATE_PATH,
            "SESSION_META_PATH": server.SESSION_META_PATH,
            "PREFERENCES_PATH": server.PREFERENCES_PATH,
            "INTERACTION_INDEX_DIR": server.INTERACTION_INDEX_DIR,
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server.STATE_DIR = root
            server.LAST_STRUCTURE_PATH = root / "last_structure.json"
            server.SESSION_PATH = root / "session.json"
            server.SESSION_STATE_PATH = root / "session_state.json"
            server.SESSION_META_PATH = root / "session_meta.json"
            server.PREFERENCES_PATH = root / "preferences.json"
            server.INTERACTION_INDEX_DIR = root / "interaction_indexes"
            try:
                session = server.normalize_session({
                    "entries": [entry("one"), entry("two"), entry("three")],
                    "includedEntries": ["one", "two", "three"],
                    "lockedEntries": ["two"],
                })
                server.write_session(session)
                next_session, removed = server.remove_session_entries(["two", "missing"])
                self.assertEqual([item["name"] for item in removed], ["two"])
                self.assertEqual([item["name"] for item in next_session["entries"]], ["one", "three"])
                self.assertEqual(next_session["includedEntries"], ["one", "three"])
                self.assertEqual(next_session["lockedEntries"], [])
                reloaded = server.load_session_or_legacy()
                self.assertEqual([item["name"] for item in reloaded["entries"]], ["one", "three"])
            finally:
                for key, value in originals.items():
                    setattr(server, key, value)

    def test_agent_action_requires_structured_known_type(self):
        self.assertIsNone(server.normalize_agent_action("show ligand"))
        self.assertIsNone(server.normalize_agent_action({"type": "unknown"}))
        action = server.normalize_agent_action({
            "type": "queryWithin",
            "radius": 5,
            "source": {"category": "ligand"},
            "target": {"category": "protein", "level": "residue"},
        }, assign_id=True)
        self.assertEqual(action["type"], "queryWithin")
        self.assertIn("id", action)
        self.assertIn("expiresAt", action)
        action = server.normalize_agent_action({
            "type": "showInteractions",
            "interaction": "hbond",
            "source": {"selector": {"resn": "LIG"}},
        }, assign_id=True)
        self.assertEqual(action["type"], "showInteractions")

    def test_append_agent_action_persists_small_action_log(self):
        originals = {
            "STATE_DIR": server.STATE_DIR,
            "AGENT_ACTIONS_PATH": server.AGENT_ACTIONS_PATH,
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            server.STATE_DIR = root
            server.AGENT_ACTIONS_PATH = root / "agent_actions.json"
            try:
                result = server.append_agent_action({
                    "type": "showWithin",
                    "radius": 7,
                    "source": {"selector": {"chain": "A"}},
                    "target": {"selector": {"chain": "C"}},
                    "level": "atom",
                    "sides": "both",
                })
                self.assertIsNotNone(result)
                action, log = result
                self.assertEqual(action["type"], "showWithin")
                self.assertEqual(len(log["actions"]), 1)
                loaded = server.load_agent_actions()
                self.assertEqual(loaded["actions"][0]["id"], action["id"])
            finally:
                for key, value in originals.items():
                    setattr(server, key, value)


if __name__ == "__main__":
    unittest.main()
