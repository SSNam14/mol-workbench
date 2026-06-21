import gzip
import unittest
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import maestro_convert  # noqa: E402
import server  # noqa: E402


SIMPLE_MAE = b"""
f_m_ct {
 s_m_title
 :::
 "simple"
 m_atom[2] {
  # First column is atom index #
  i_m_mmod_type
  r_m_x_coord
  r_m_y_coord
  r_m_z_coord
  i_m_residue_number
  s_m_mmod_res
  s_m_chain_name
  s_m_pdb_residue_name
  s_m_pdb_atom_name
  i_m_atomic_number
  i_pdb_PDB_serial
  r_m_pdb_occupancy
  r_m_pdb_tfactor
  :::
  1 1 1.000 2.000 3.000 7 A "A" "ALA " " CA " 6 10 1.00 11.0
  2 1 2.000 2.500 3.500 7 A "A" "ALA " " O  " 8 11 1.00 12.0
 }
 m_bond[1] {
  # First column is bond index #
  i_m_from
  i_m_to
  i_m_order
  :::
  1 1 2 1
 }
}
"""


class MaestroConversionTests(unittest.TestCase):
    def test_maestro_text_to_pdb_emits_atoms_and_bonds(self):
        pdb, meta = maestro_convert.maestro_bytes_to_pdb(SIMPLE_MAE, "simple.mae", "mae")
        self.assertEqual(meta["atomCount"], 2)
        self.assertEqual(meta["bondCount"], 1)
        self.assertIn("ATOM      1  CA  ALA A   7", pdb)
        self.assertIn("ATOM      2  O   ALA A   7", pdb)
        self.assertIn("CONECT    1    2", pdb)

    def test_maegz_payload_is_decompressed(self):
        pdb, meta = maestro_convert.maestro_bytes_to_pdb(gzip.compress(SIMPLE_MAE), "simple.maegz", "maegz")
        self.assertEqual(meta["atomCount"], 2)
        self.assertTrue(pdb.endswith("END\n"))

    def test_server_converter_returns_pdb_entry(self):
        entry, meta = server.convert_structure_bytes(SIMPLE_MAE, "simple.mae", "mae", "Simple", "")
        self.assertEqual(entry["fmt"], "pdb")
        self.assertEqual(entry["name"], "simple.pdb")
        self.assertEqual(entry["title"], "Simple")
        self.assertEqual(meta["sourceFormat"], "mae")

    def test_server_converter_detects_gzip_payload(self):
        entry, meta = server.convert_structure_bytes(gzip.compress(SIMPLE_MAE), "uploaded", "", "Uploaded", "")
        self.assertEqual(entry["fmt"], "pdb")
        self.assertEqual(meta["sourceFormat"], "maegz")


if __name__ == "__main__":
    unittest.main()
