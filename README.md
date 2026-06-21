# MolWorkbench

Local-first browser molecular viewer for protein-ligand inspection, multi-entry visualization, selection workflows, and agent-driven automation.

MolWorkbench is a static WebGL viewer with a small Python persistence server. It is designed to run locally or on a trusted workstation/server, then be controlled either by the visible UI or through the structured `window.molAgent` browser API.

## Features

- Multi-entry molecular visualization with independent show/hide state per entry.
- Protein backbone and atom-level representation controls.
- Selection, range selection, Shift-additive viewer selection, Ctrl/Shift hierarchy selection, and selected-atom actions.
- Server-persisted viewer sessions, preferences, colors, and interaction indexes.
- Background nonbonded interaction indexing with dashed guide-line rendering.
- Shader-backed wide-line rendering for molecular and interaction lines.
- Agent-facing JavaScript API for deterministic browser automation.

## Repository Contents

- `index.html`, `styles.css`, `app.js`: browser UI and viewer logic.
- `server.py`: static file server plus persisted session/preference/interaction APIs.
- `maestro_convert.py`: pure-Python MAE/MAEGZ to PDB converter used by the loader.
- `interaction-worker.js`: background interaction index builder.
- `wide-lines.js`: 3Dmol-integrated wide-line renderer.
- `assets/`: local 3Dmol bundle and UI icons.
- `config/visualization.json`: tracked visualization defaults.
- `tests/`: focused regression tests for server-side session contracts.
- `AGENT_README.md`: detailed operation manual for browser automation agents.

No molecular structures are bundled in this repository. Load structures through the UI `Open file` control, through `molAgent.loadUrl(...)`, or by serving your own ignored local `data/` directory.

## Quick Start

```bash
python3 server.py --bind 127.0.0.1 --port 8704
```

Open:

```text
http://127.0.0.1:8704/
```

The first launch starts with an empty viewer unless a previous server-side session exists. In that clean state, legacy `/api/last-structure` requests return `404 {"error":"not_found"}` rather than a server error. Use `Open file` to load a local `pdb`, `cif`, `sdf`, `mol`, `mol2`, `xyz`, `mae`, or `maegz` file. MAE/MAEGZ loading uses the bundled pure-Python converter and does not require a Schrodinger installation. Each load gets a unique internal entry id, so loading the same filename again creates another entry while preserving the filename as the display title. Double-click an entry title in the Entries panel to rename that displayed title.

## Agent Control

Agents should use the structured API exposed in the page:

```js
const entry = await molAgent.loadUrl("path/to/structure.pdb", "pdb", "entry-name", "Display title", "");
await molAgent.renameEntry(entry.name, "New display title");
molAgent.setSelection({chain: "A", resi: "30-35"});
molAgent.focus();
molAgent.setProteinAtomStyle("line");
molAgent.getState();
```

See `AGENT_README.md` for the full command surface, selector syntax, persistence contract, and verification workflow.

## Verification

```bash
python3 -m unittest tests.test_session_state tests.test_maestro_conversion
python3 -m py_compile server.py
node --check app.js
node --check interaction-worker.js
node --check wide-lines.js
git diff --check
```

## Notes

Runtime files are intentionally ignored:

- `.viewer_state/`
- `data/`
- server logs and pid files
- editor workspace files such as `.cpu_prj.code-workspace`

`assets/3Dmol-min.js` is vendored so the app can run without a CDN dependency.
