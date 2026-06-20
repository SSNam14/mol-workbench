# Molecular Viewer Project Memory

Last updated: 2026-06-20 KST

## Purpose

This project is a browser-based molecular viewer. Serve it from the repository root with `server.py`; choose the port at launch.

Rendering happens in the client browser through 3Dmol.js/WebGL, so interactive performance follows the client browser/GPU/rendering environment. The server serves files and persists runtime state such as the loaded viewer session and interaction indexes.

## Runtime Shape

- `index.html`: static DOM structure only.
- `styles.css`: static UI styling.
- `app.js`: viewer state, 3Dmol integration, selection, settings, mouse actions, API.
- `interaction-worker.js`: background nonbonded interaction index builder.
- `wide-lines.js`: screen-space-width line renderer implemented as 3Dmol scene meshes with depth testing.
- `server.py`: static file server plus `/api/session`, compatibility `/api/last-structure`, and `/api/interaction-index/<structureKey>` for server-side runtime state.
- `config/visualization.json`: tracked visual defaults. CPK stick radii, CPK sphere scales, and VDW radii belong here rather than being hardcoded.
- `assets/3Dmol-min.js`: local 3Dmol dependency. Keep this local unless explicitly changed.
- `data/`: optional bundled sample structures.

Serve with:

```bash
PORT=8704
python3 server.py --port "$PORT" --bind 0.0.0.0
```

## Design Principles

- Keep the app static and local-first. Avoid remote CDN/data dependencies in normal operation.
- Keep markup, static styling, and application logic split by role.
- Prefer dense, work-focused molecular-viewer UI over landing-page or explanatory UI.
- Preserve fast interactive camera behavior. Do not change camera semantics to hide performance problems.
- Keep settings extensible; the settings panel should be able to host future visual/input preferences without restructuring.
- Keep control surfaces explicit. Empty select clicks and empty range-select drags in the viewer clear the current selection.
- Find/search misses should not clear the current selection; they should report no match and leave selection state unchanged.
- Keep `window.molAgent` as the structured automation/API surface. Do not add free-form natural-language command execution.

## Must-Have Behavior

- Initial load restores the full viewer session from server storage when available; otherwise it opens the bundled sample structure.
- Loading a structure from the UI or `molAgent.loadUrl(...)` updates the server-side session without dropping existing entries, so browser refresh keeps the entry list and included-entry state.
- Loading a new structure adds or replaces an entry and includes it in the displayed set. Existing included entries remain visible until their Entries `In` checkbox is turned off.
- Entry rows mark the active UI context; the `In` checkbox controls display inclusion. Multiple entries must be displayable at the same time.
- `/api/last-structure` is compatibility-only. Writes to it must upsert the supplied entry into the session rather than replacing the whole entry list.
- Loading/displaying exactly one entry starts nonbonded interaction indexing in a Web Worker. The finished index is cached on the server by structure key so switching back to a previously loaded single entry does not recompute interactions.
- When multiple entries are displayed, nonbonded interaction indexing/rendering is disabled to avoid accidental cross-entry interactions.
- Structure loading must preserve explicit hydrogens (`keepH:true` for 3Dmol loads), otherwise H-bond indexing becomes meaningless.
- Optional sample/predicted-structure shortcuts should load bundled local data without remote dependencies.
- Default mouse preset is `select-left`:
  - left click selects
  - left drag performs screen-space range selection
  - Shift + click / Shift + drag adds to the existing selection
  - right drag rotates
  - middle-button drag pans
  - wheel zooms
- Custom mouse actions are configurable from Settings and through `molAgent.setMouseActions(...)`.
- The `default` mouse preset passes through to 3Dmol default controls.
- Box selection respects selection mode:
  - `atom`: atoms inside the box
  - `residue` / legacy internal `range`: whole touched residues
  - `chain`: whole touched chains
  - `model`: all atoms in touched entries
- Pressing `z` toggles between focusing the current selection and overview.
- Selecting atoms alone must not silently change the rotation/focus pivot. Pivot changes should follow an explicit focus action such as `z`/Focus.
- Selection highlight should remain visible without becoming overly thick; current default is a yellow `line` highlight.
- With protein atom display `off`, selected protein atoms are highlighted as app-managed wide lines over the cartoon. If selected atoms are already displayed as atom-level `line`, `stick`, `sphere`, or `cpk`, selection follows that visible representation using the selection color.
- Selection highlight controls should not be exposed in the normal GUI. It is fixed by default, but agents may adjust it through `molAgent.setSelectionHighlight(...)` when explicitly requested.
- Selection changes must stay incremental. Default line selection uses the `wide-lines.js` selection collection for atom-level `none`/`line` groups and temporary 3Dmol style overlays for visible stick/sphere/cpk groups. Explicit non-line highlight modes may still use removable shapes for small selections and a temporary style overlay for large selections. Do not trigger full protein/ligand restyling on every selection event.
- Large range selections must avoid O(atom count * selector size) matching. Large `serial: [...]` selectors use cached Set lookup and reuse the selected atom list for highlight/status updates.
- `line` rendering is handled by `wide-lines.js`, not native WebGL line width. Protein atom lines, ligand lines, style-rule lines/tube side lines, selection line highlights, and interaction lines are converted to camera-facing mesh quads inside the 3Dmol scene, so they keep pixel-like width while participating in depth testing. Dashed wide lines are for interaction guide rendering only, not molecular representation styling.
- All nonbonded interaction guide lines are dashed.
- Nonbonded pair interactions are drawn only when both endpoint atoms are currently displayed by atom-level representation (`line`, `stick`, `sphere`, or `cpk`). Cartoon-only protein atoms do not count as visible endpoints for interaction rendering.
- Hydrogen-bond guide lines must connect `H -> acceptor`; the donor heavy atom is stored for classification/scope but is not the displayed line endpoint.
- H-bond and salt UI sliders filter the precomputed interaction index; changing those cutoffs must not trigger full reindexing.
- The custom select mouse action uses screen-space nearest-atom picking instead of 3Dmol's general `handleClickSelection` raycast to avoid click-time frame drops.
- Protein backbone display and protein atom-level display are separate controls. Default is backbone `cartoon` with protein atoms `off`. Atom-level `cpk` means one combined 3Dmol style containing both `stick` and `sphere`; do not implement it as two separate style rules. CPK sphere size uses configured VDW radii times a configured scale, so H/He remain smaller than C/N/O/etc.
- FPS overlay is a browser `requestAnimationFrame` indicator, not remote desktop streaming FPS.

## API Contract

`window.molAgent` is expected to expose at least:

```js
molAgent.setSelection(selector, options);
molAgent.setSelectionHighlight(options);
molAgent.clearSelection();
molAgent.focus(selector);
molAgent.style(selector, representation, options);
molAgent.clearStyle();
molAgent.clearStyles();
molAgent.setBaseStyle(representation);
molAgent.setProteinBackboneStyle(representation);
molAgent.setProteinAtomStyle(representation);
molAgent.setLigandStyle(representation);
molAgent.setMousePreset(preset);
molAgent.getMousePreset();
molAgent.setMouseActions(actions);
molAgent.getMouseActions();
molAgent.selectAtoms(selector);
molAgent.getState();
molAgent.getVisualConfig();
molAgent.reloadVisualConfig();
molAgent.getInteractionIndex();
molAgent.rebuildInteractionIndex();
molAgent.loadUrl(url, fmt, name, title, pdbId);
molAgent.run(commandObject);
molAgent.viewer();
molAgent.model();
molAgent.models();
```

String commands are intentionally disabled. Use structured objects only. `setSelection` accepts a selector object, an array of selector objects, or `null` to clear selection; invalid selector types should throw. `setMouseActions` should validate supported actions and reject duplicate non-`none` button actions.

Common selector examples:

```js
{chain: 'H'}
{chain: 'H', resi: '30-35'}
{_entryName: 'proteinprep_10AY', chain: 'H'}
{serial: [1, 2, 3]}
{not: {chain: 'A'}}
{or: [{chain: 'H', resi: '30-35'}, {chain: 'L', resi: '90-95'}]}
```

## Development Workflow

- Work on feature branches.
- Merge into `master` only when the user explicitly asks.
- Commit after each completed work item.
- Do not commit local runtime files, logs, screenshots, temporary zips, or editor workspace files.
- Never delete `.cpu_prj.code-workspace`. The user commonly works with the agent through the VS Code addon, this file is the workspace for that flow, and it must stay ignored by git.

## Verification

Run focused checks after edits:

```bash
cd <repo-root>
PORT=8704
node --check app.js
node --check interaction-worker.js
python3 -m py_compile server.py
git diff --check
curl -sI "http://127.0.0.1:${PORT}/" | head
curl -sI "http://127.0.0.1:${PORT}/styles.css" | head
curl -sI "http://127.0.0.1:${PORT}/app.js" | head
curl -s "http://127.0.0.1:${PORT}/api/session" | head -c 200
```

Optional local browser debugging only, when `agbrowse` is installed:

```bash
agbrowse navigate "http://127.0.0.1:${PORT}/" --wait-until domcontentloaded --timeout 60000
agbrowse wait 3000 --json
agbrowse console --clear --duration 1000 --limit 50
```

Expected:

- no console errors
- `window.molAgent` exists
- initial structure name is populated and atom count is greater than zero
- `Settings` opens and shows mouse actions
