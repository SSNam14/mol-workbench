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
        payload = {"entries": self.entries, "includedEntries": [], "activeEntry": "one"}
        session = server.normalize_session(payload)
        self.assertEqual(session["includedEntries"], [])
        self.assertEqual(session["activeEntry"], "")

    def test_normalize_session_missing_included_entries_uses_legacy_all_entries(self):
        payload = {"entries": self.entries, "activeEntry": "two"}
        session = server.normalize_session(payload)
        self.assertEqual(session["includedEntries"], ["one", "two"])
        self.assertEqual(session["activeEntry"], "two")

    def test_normalize_session_state_preserves_explicit_empty_included_entries(self):
        fallback = {"includedEntries": ["one", "two"], "activeEntry": "two"}
        state = server.normalize_session_state({"includedEntries": [], "activeEntry": "two"}, self.entries, fallback)
        self.assertEqual(state["includedEntries"], [])
        self.assertEqual(state["activeEntry"], "")

    def test_normalize_session_state_missing_included_entries_uses_fallback(self):
        fallback = {"includedEntries": ["two"], "activeEntry": "two"}
        state = server.normalize_session_state({"activeEntry": "one"}, self.entries, fallback)
        self.assertEqual(state["includedEntries"], ["two"])
        self.assertEqual(state["activeEntry"], "two")

    def test_normalize_session_state_filters_explicit_names_without_all_entries_fallback(self):
        fallback = {"includedEntries": ["one"], "activeEntry": "one"}
        state = server.normalize_session_state({"includedEntries": ["missing"], "activeEntry": "missing"}, self.entries, fallback)
        self.assertEqual(state["includedEntries"], [])
        self.assertEqual(state["activeEntry"], "")

    def test_normalize_stored_session_meta_preserves_explicit_empty_included_entries(self):
        meta = {
            "entries": [{"name": "one", "title": "one", "pdbId": "", "fmt": "pdb"}],
            "includedEntries": [],
            "activeEntry": "one",
        }
        state = server.normalize_stored_session_meta(meta)
        self.assertEqual(state["includedEntries"], [])
        self.assertEqual(state["activeEntry"], "")

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


if __name__ == "__main__":
    unittest.main()
