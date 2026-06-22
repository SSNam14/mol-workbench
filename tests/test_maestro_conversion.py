import gzip
import io
import json
import pickle
import tempfile
import unittest
import zipfile
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
  1 1 2 2
 }
}
"""


class MaestroConversionTests(unittest.TestCase):
    def test_maestro_text_to_pdb_emits_atoms_and_bonds(self):
        pdb, meta = maestro_convert.maestro_bytes_to_pdb(SIMPLE_MAE, "simple.mae", "mae")
        self.assertEqual(meta["atomCount"], 2)
        self.assertEqual(meta["bondCount"], 1)
        self.assertEqual(meta["bondOrders"], [{"a": 1, "b": 2, "order": 2}])
        self.assertIn("ATOM      1  CA  ALA A   7", pdb)
        self.assertIn("ATOM      2  O   ALA A   7", pdb)
        self.assertIn("CONECT    1    2", pdb)

    def test_maegz_payload_is_decompressed(self):
        pdb, meta = maestro_convert.maestro_bytes_to_pdb(gzip.compress(SIMPLE_MAE), "simple.maegz", "maegz")
        self.assertEqual(meta["atomCount"], 2)
        self.assertTrue(pdb.endswith("END\n"))

    def test_maestro_multi_ct_returns_multiple_entries(self):
        first = SIMPLE_MAE.replace(b'"simple"', b'"first"')
        second = SIMPLE_MAE.replace(b'"simple"', b'"second"')
        entries = maestro_convert.maestro_bytes_to_pdb_entries(first + second, "bundle.maegz", "mae")
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0][1]["title"], "first")
        self.assertEqual(entries[1][1]["title"], "second")
        self.assertIn("ATOM      1  CA  ALA A   7", entries[1][0])

    def test_server_converter_returns_pdb_entry(self):
        entry, meta = server.convert_structure_bytes(SIMPLE_MAE, "simple.mae", "mae", "Simple", "")
        self.assertEqual(entry["fmt"], "pdb")
        self.assertEqual(entry["name"], "simple.pdb")
        self.assertEqual(entry["title"], "Simple")
        self.assertEqual(entry["bondOrders"], [{"a": "1", "b": "2", "order": 2}])
        self.assertEqual(meta["sourceFormat"], "mae")

    def test_server_converter_detects_gzip_payload(self):
        entry, meta = server.convert_structure_bytes(gzip.compress(SIMPLE_MAE), "uploaded", "", "Uploaded", "")
        self.assertEqual(entry["fmt"], "pdb")
        self.assertEqual(meta["sourceFormat"], "maegz")

    def test_server_converter_returns_multi_maestro_entries(self):
        first = SIMPLE_MAE.replace(b'"simple"', b'"first"')
        second = SIMPLE_MAE.replace(b'"simple"', b'"second"')
        entries, meta = server.convert_structure_bytes_entries(gzip.compress(first + second), "bundle.maegz", "maegz", "Bundle", "")
        self.assertEqual(len(entries), 2)
        self.assertEqual(meta["entryCount"], 2)
        self.assertEqual(entries[0]["name"], "bundle_001.pdb")
        self.assertEqual(entries[1]["name"], "bundle_002.pdb")
        self.assertEqual(entries[0]["title"], "Bundle [1] first")
        self.assertEqual(entries[1]["title"], "Bundle [2] second")

    def test_server_converter_returns_multi_sdf_entries(self):
        payload = b"""mol-one
  viewer

  0  0  0  0  0  0            999 V2000
M  END
$$$$
mol-two
  viewer

  0  0  0  0  0  0            999 V2000
M  END
$$$$
"""
        entries, meta = server.convert_structure_bytes_entries(payload, "ligands.sdf", "sdf", "Ligands", "")
        self.assertEqual(len(entries), 2)
        self.assertEqual(meta["entryCount"], 2)
        self.assertEqual(entries[0]["name"], "ligands_001.sdf")
        self.assertEqual(entries[1]["title"], "Ligands [2] mol-two")

    def test_server_converter_loads_psazip_surface_mesh(self):
        try:
            import h5py
            import numpy as np
        except ImportError:
            self.skipTest("h5py/numpy unavailable")

        with tempfile.NamedTemporaryFile(suffix=".vis") as fh:
            with h5py.File(fh.name, "w") as h5:
                group = h5.create_group("Protein Patches/Protein Patches")
                group.attrs["Dataset Name"] = b"Protein Patches"
                group.attrs["Transparency"] = 20
                group.create_dataset("Coordinates of Vertices", data=np.array([
                    0.0, 0.0, 0.0,
                    1.0, 0.0, 0.0,
                    0.0, 1.0, 0.0,
                    0.0, 0.0, 1.0,
                ], dtype=">f8"))
                group.create_dataset("Normals of Vertices", data=np.array([
                    0.0, 0.0, 1.0,
                    0.0, 0.0, 1.0,
                    0.0, 0.0, 1.0,
                    0.0, 1.0, 0.0,
                ], dtype=">f8"))
                group.create_dataset("Patches", data=np.array([0, 1, 2, 0, 2, 3], dtype=">i4"))
            vis_payload = Path(fh.name).read_bytes()

        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as zf:
            zf.writestr("basename.maegz", gzip.compress(SIMPLE_MAE))
            zf.writestr("basename.vis", vis_payload)
            zf.writestr("basename.pkl", pickle.dumps((
                np.array([0.0, 0.1, 0.2, 0.3], dtype=float),
                np.array([-0.2, 0.0, 0.2, -0.1], dtype=float),
            ), protocol=2))
            zf.writestr("basename_panel_state.json", json.dumps({"settings_trans_front": 25}))
        entry, meta = server.convert_structure_bytes(payload.getvalue(), "surface.psazip", "psazip", "Surface", "")
        self.assertEqual(entry["fmt"], "pdb")
        self.assertEqual(entry["title"], "Surface")
        self.assertEqual(meta["sourceFormat"], "psazip")
        self.assertEqual(meta["surfaceCount"], 1)
        self.assertEqual(entry["surfaces"][0]["vertexCount"], 4)
        self.assertEqual(entry["surfaces"][0]["faceCount"], 2)
        self.assertEqual(entry["surfaces"][0]["opacity"], 0.75)
        self.assertEqual(entry["surfaces"][0]["colorField"], "electrostatic")
        self.assertEqual(entry["surfaces"][0]["valueRange"], [-0.2, 0.2])
        self.assertEqual(len(entry["surfaces"][0]["chunks"][0]["faces"]), 6)
        self.assertEqual(len(entry["surfaces"][0]["chunks"][0]["colors"]), 12)


if __name__ == "__main__":
    unittest.main()
