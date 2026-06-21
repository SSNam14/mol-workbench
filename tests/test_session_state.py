import unittest
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


def entry(name):
    return {"name": name, "title": name, "pdbId": "", "fmt": "pdb", "data": "ATOM\n"}


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


if __name__ == "__main__":
    unittest.main()
