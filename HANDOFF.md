# Molecular Viewer Project Memory

Last updated: 2026-06-21 KST

## Purpose

This project is a browser-based molecular viewer. Serve it from the repository root with `server.py`; choose the port at launch.

Rendering happens in the client browser through 3Dmol.js/WebGL, so interactive performance follows the client browser/GPU/rendering environment. The server serves files and persists runtime state such as the loaded viewer session and interaction indexes.

## Runtime Shape

- `index.html`: static DOM structure only.
- `styles.css`: static UI styling.
- `app.js`: viewer state, 3Dmol integration, selection, settings, mouse actions, API.
- `maestro_convert.py`: pure-Python MAE/MAEGZ to PDB converter. Normal file loading must not depend on Schrodinger being installed.
- `interaction-worker.js`: background nonbonded interaction index builder.
- `wide-lines.js`: shader-backed 3Dmol scene-mesh wide-line renderer. It keeps static segment/cap geometry in the scene and expands screen-pixel width in the vertex shader with depth/zoom scaling, screen-pixel clamps, and depth testing.
- `server.py`: static file server plus `/api/session`, `/api/session-entry`, lightweight `/api/session-state` and `/api/session-meta`, `/api/preferences`, `/api/agent-actions`, `/api/convert-structure`, compatibility `/api/last-structure`, and `/api/interaction-index/<structureKey>` for server-side runtime state.
- `config/visualization.json`: tracked visual defaults. CPK stick radii, CPK sphere scales, and VDW radii belong here rather than being hardcoded.
- `assets/3Dmol-min.js`: local 3Dmol dependency. Keep this local unless explicitly changed.
- `data/`: ignored local-only structures. Do not commit molecular structure files to the public repository.

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
- The project server may be bound to a shared network address for workstation access, so it must not statically expose dot-directories, `.viewer_state`, git metadata, logs, server source, or project memory/docs.
- Keep control surfaces explicit. Empty select clicks and empty range-select drags in the viewer clear the current selection.
- Find/search misses should not clear the current selection; they should report no match and leave selection state unchanged.
- Keep `window.molAgent` and `/api/agent-actions` as structured automation/API surfaces. Do not add free-form natural-language command execution.
- Agent-facing API should expose domain operations directly rather than forcing agents to emulate GUI clicks. For example, distance-based display tasks should use structured `showWithin` commands with source/target selectors and a radius.

## Must-Have Behavior

- Initial load restores the full viewer session from server storage when available; otherwise it starts with an empty viewer and waits for `Open file`, `molAgent.loadUrl(...)`, or `/api/session-entry`.
- Global representation choices, mouse actions, chain/atom colors, carbon-by-chain coloring, and background color are stored in server-side preferences and restored before the initial structure is displayed.
- Loading a structure from the UI or `molAgent.loadUrl(...)` updates the server-side session without dropping existing entries, so browser refresh keeps the entry list and included-entry state.
- Each load must create a unique internal entry id (`entry.name`) while preserving the original filename or requested display name as `entry.title`. Loading the same filename again later must add another entry, not replace the existing one.
- Entry titles are user-editable display labels. Double-clicking an Entries title edits `entry.title` only; it must not change `entry.name`, cached model identity, selection scopes, or included-entry state. Agents can call `molAgent.renameEntry(...)` / `molAgent.setEntryTitle(...)`.
- Supported normal load formats include PDB, CIF/mmCIF, SDF/MOL, MOL2, XYZ, MAE, and MAEGZ. MAE/MAEGZ are converted through `/api/convert-structure` into PDB text before 3Dmol parsing.
- Loading a new structure adds a unique entry and includes it in the displayed set. Existing included entries remain visible until their Entries `In` checkbox is turned off.
- Entry rows do not have an active-entry state. The `In` checkbox controls display inclusion, double-clicking the title edits only the display title, and multiple entries must be displayable at the same time.
- In the Hierarchy panel, entry and section headers select all descendant atoms when clicked. Only the left disclosure triangle collapses or expands that header.
- Hierarchy multi-select uses list semantics: normal click replaces selection, Ctrl/Cmd-click toggles one row into or out of the current selection, and Shift-click selects the contiguous visible row range from the first selected anchor row to the clicked row.
- Right-clicking a selected Hierarchy row opens a small context menu. Its `Delete` action removes the selected atoms from that entry's persisted server-side session state (`deletedSourceSerials`) so they disappear from Hierarchy, rendering, search, and interaction indexing after rebuild/reload. It must not delete or edit the original source structure file on disk.
- Hierarchy row highlighting must be exact to the represented descendant atoms: selecting one ligand/residue must not highlight a chain or section row merely because it shares a chain id; parent rows highlight only when all descendant atoms represented by that row are selected.
- An explicit empty display set is valid session state. `includedEntries: []` means no entries are displayed; only a missing `includedEntries` field uses legacy fallback to all entries.
- Entry inclusion toggles should use cached 3Dmol models and `show()`/`hide()` rather than clearing and reparsing all displayed entries. Persist included-entry state through lightweight `/api/session-state`; it writes small state/meta files and must not rewrite full structure payloads. Large-entry restyling must avoid full-entry `serial: [...]` selectors; prefer model-local selectors and direct model resets such as `model.setStyle({}, {})`.
- Persistence failures must be visible through console diagnostics and, for user-visible session/preference operations, status text. Large entry saves must not report success before the actual server write finishes.
- Entry row `X` buttons delete entries through `/api/session-entry/<name>`, dispose the corresponding 3Dmol model/cache/worker records, and must update the server-side session so deleted entries do not reappear after refresh.
- Open clients should poll lightweight `/api/session-meta` revisions and reload `/api/session` only when the revision changes, so agent-side session edits appear without manual refresh. A failed `/api/session` reload must not mark the revision as handled; retry the same revision on the next poll.
- Open clients should also poll `/api/agent-actions` for structured high-level actions. The server stores only small action objects; the browser executes them against its parsed atoms and current display state. Spatial behavior should be built from generic `queryWithin` source/target selector distance queries plus explicit style/hide/selection operations. `showWithin` is only a thin wrapper around that primitive. Spatial queries default to entry-local matching, require `scope: "global"` for intentional cross-entry distance comparison, and default to `level: "residue"` so one atom-level hit displays the corresponding residue rather than an isolated dot.
- Interaction-specific agent behavior should be built from generic `queryInteractions` / `showInteractions` source-target selector queries over the existing per-entry interaction indexes. These actions must filter only the interaction guide lines that match the query, default display units to residues, and must not compute cross-entry interactions. Manual interaction-panel type/scope edits clear any active agent interaction filter so the GUI can return to normal all/scope-controlled display.
- Spatial source/target specs support `atoms`/`atomFilter` values `all`, `heavyPolarH`, `heavy`, `polarH`, and `hydrogen`. For normal residue/neighborhood inspection, prefer `all` or `heavyPolarH`; plain `heavy` intentionally removes polar hydrogens and is uncommon.
- `/api/last-structure` is compatibility-only. Writes to it must upsert the supplied entry into the session rather than replacing the whole entry list. A clean install with no saved session or legacy structure must return `404 {"error":"not_found"}`, not `500 invalid_state`.
- Loading/displaying entries starts nonbonded interaction indexing per visible entry in a Web Worker. Finished indexes are cached on the server by structure key and retained in memory by entry, so switching entries or adding another displayed entry does not discard existing interaction display.
- When multiple entries are displayed, render the ready interaction indexes for each visible entry and never compute cross-entry interactions. Index worker builds are queued to avoid starting several heavy builds at once.
- Structure loading must preserve explicit hydrogens (`keepH:true` for 3Dmol loads), otherwise H-bond indexing becomes meaningless.
- CIF files that omit `_atom_site.group_PDB` must still classify standard amino-acid residues with N/CA/C backbone atoms as protein. This fallback is required for Schrodinger-style CIF exports where 3Dmol marks every atom as hetero by default.
- If a protein CIF lacks HELIX/SHEET or mmCIF secondary-structure annotations, assign a conservative phi/psi-based `ss` fallback after parsing so cartoon display is not all-loop. Do not override structures that already provide helix/sheet annotation.
- Do not expose hardcoded sample/predicted-structure shortcut buttons in the normal UI. No molecular structure is bundled for empty-session fallback.
- Default mouse preset is `select-left`:
  - left click selects
  - left drag performs screen-space range selection
  - Shift + click / Shift + drag adds to the existing selection
  - right drag rotates
  - middle-button drag pans
  - wheel zooms
- Modifier rotation applies to whichever mouse button is currently assigned to `rotate`: `Ctrl` + left/right drag rolls around the screen Z axis, and `Shift` + left/right drag rotates around the screen Y axis.
- Custom mouse actions are configurable from the Preference panel and through `molAgent.setMouseActions(...)`.
- The `default` mouse preset passes through to 3Dmol default controls.
- Default chain/atom colors are Maestro-derived. The profile selects `ribboncscheme=chain` and `defaultcolorscheme="Element (Chain Name Carbons)"`; the RGB defaults are mirrored from the corresponding Maestro `chain.sch` and element scheme tables.
- Box selection respects selection mode:
  - `atom`: atoms inside the box
  - `residue`: whole touched residues
  - `chain`: whole touched chains
  - `model`: all atoms in touched entries
- Keyboard workspace actions: `L` cycles selection through ligands in the currently displayed workspace, `C` cycles through displayed protein chains, and `Z` refits the camera. `Z` fits the current workspace when nothing is selected and fits selected atoms when a selection exists.
- `N` expands the current selection to nearby atoms within 5A of the selected atoms, scoped entry-locally. Expansion follows the current top-left selection level (`Atoms`, `Residues`, `Chains`, or `Molecules`) and adds to the existing selection.
- `Delete` removes the currently selected atoms from the session, whether the selection came from direct viewer selection or the Hierarchy panel. The source structure file is not modified.
- `Ctrl+Z`/`Cmd+Z` undoes the most recent selected-atom deletion in the current browser session. It restores the atoms to the session and reselects the restored atoms; it is not a general-purpose undo stack for every UI setting.
- Camera refit should use the current screen/camera X/Y bounding box rather than raw coordinate-average centering, with a tight fit that does not leave excessive top/bottom margin. Very small selections must use a minimum visual frame size so ligand/single-residue focus does not become an extreme close-up.
- Workspace `Z` fitting should use atoms that correspond to the currently rendered representations: protein cartoon/tube fits on backbone atoms unless protein atom-level display is enabled, and visible ligand/solvent/other atoms remain part of the fit when their representation is not `off`.
- Selecting atoms alone must not silently change the rotation/focus pivot. Pivot changes should follow an explicit focus action such as `z` or `molAgent.focus(...)`.
- Selection and focus operate on loaded atoms, not only currently atom-level-rendered atoms. Representation `off` or hide rules must not make atoms permanently unselectable; selection highlight and selection-toolbar show/style actions should be able to recover hidden/off atoms while entry/chain/group inclusion still controls whether atoms are in scope.
- Selection highlight should remain visible without becoming overly thick; current default is a yellow `line` highlight.
- With protein atom display `off`, selected protein atoms are highlighted as app-managed wide lines over the cartoon. If selected atoms are already displayed as atom-level `line`, `stick`, `sphere`, or `cpk`, selection follows that visible representation using the selection color.
- Selection highlight controls should not be exposed in the normal GUI. It is fixed by default, but agents may adjust it through `molAgent.setSelectionHighlight(...)` when explicitly requested.
- The visible toolbar should stay compact. Global representation controls are text-label dropdowns, and redundant Fit/Focus/Clear buttons are intentionally omitted because `z`, empty-click/Escape, and `molAgent` cover those actions.
- Selection changes must stay incremental. Default line selection uses the `wide-lines.js` selection collection for atom-level `none`/`line` groups and temporary 3Dmol style overlays for visible stick/sphere/cpk groups. When already-visible `line` bonds are selected, the matching base-line bonds are masked out of the style collection and redrawn only in the selection collection to avoid depth fighting and weak yellow highlights. Explicit non-line highlight modes may still use removable shapes for small selections and a temporary style overlay for large selections. Do not trigger full protein/ligand restyling on every selection event.
- `wide-lines.js` keeps separate scene meshes per collection (`styles`, `selection`, `interactions`, primitive/shape lines) so updating the selection overlay does not rebuild molecular or interaction line meshes. App-side molecular line geometry is cached per visible entry and invalidated by structure/style/visibility generation; targeted selection representation changes should invalidate only touched entries while preserving the same persistent `styleRules` semantics as a full restyle.
- Large range selections must avoid O(atom count * selector size) matching. Large `serial: [...]` selectors use cached Set lookup and reuse the selected atom list for highlight/status updates.
- `line` rendering is handled by `wide-lines.js`, not native WebGL line width. Protein atom lines, ligand lines, style-rule lines/tube side lines, selection line highlights, and interaction lines are converted to static segment/cap mesh geometry inside the 3Dmol scene, so they participate in depth testing. The vertex shader expands the geometry in screen space and scales width by camera depth/zoom, avoiding per-frame JavaScript projection/vertex rewrites. Current screen-pixel clamps keep molecular lines around 2-8 px. Dashed wide lines are for interaction guide rendering only, not molecular representation styling.
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
molAgent.setChainColor(chain, color);
molAgent.getChainColors();
molAgent.setAtomColor(element, color);
molAgent.getAtomColors();
molAgent.resetColorSchemes();
molAgent.setMousePreset(preset);
molAgent.getMousePreset();
molAgent.setMouseActions(actions);
molAgent.getMouseActions();
molAgent.selectAtoms(selector);
molAgent.queryWithin(commandObject);
molAgent.showWithin(commandObject);
molAgent.selectWithin(commandObject);
molAgent.queryInteractions(commandObject);
molAgent.showInteractions(commandObject);
molAgent.clearInteractionFilter(commandObject);
molAgent.getState();
molAgent.getVisualConfig();
molAgent.reloadVisualConfig();
molAgent.getInteractionIndex();
molAgent.rebuildInteractionIndex();
molAgent.loadUrl(url, fmt, name, title, pdbId);
molAgent.renameEntry(nameOrTitleOrEntry, newTitle);
molAgent.setEntryTitle(nameOrTitleOrEntry, newTitle);
molAgent.removeEntry(nameOrTitleOrPdbId);
molAgent.run(commandObject);
molAgent.viewer();
molAgent.model();
molAgent.models();
```

String commands are intentionally disabled. Use structured objects only. `setSelection` accepts a selector object, an array of selector objects, or `null` to clear selection; invalid selector types should throw. `setMouseActions` should validate supported actions and reject duplicate non-`none` button actions.

Server-side entry update endpoints:

```text
PUT /api/session-entry              # add one entry JSON object; duplicate ids get a unique suffix unless replace=true
PUT /api/session-entry-title        # rename one entry title by unique entry id
DELETE /api/session-entry/<name>    # remove one entry by entry name
PUT /api/session-state              # update includedEntries only
GET /api/session-meta               # lightweight revision for open-client sync
POST /api/agent-actions             # append one structured browser action for open clients
DELETE /api/agent-actions           # clear pending action log
POST /api/convert-structure         # raw MAE/MAEGZ bytes to a PDB entry JSON payload
```

`PUT /api/session-state` preserves explicit empty display state:

```json
{"includedEntries": []}
```

Do not convert that payload to "show the first/all entries"; only absent `includedEntries` is legacy fallback.

Common selector examples:

```js
{chain: 'H'}
{chain: 'H', resi: '30-35'}
{_entryName: 'entry-name', chain: 'H'}
{serial: [1, 2, 3]}
{not: {chain: 'A'}}
{or: [{chain: 'H', resi: '30-35'}, {chain: 'L', resi: '90-95'}]}
```

## Development Workflow

- Work on feature branches.
- Merge into `master` only when the user explicitly asks.
- Whenever a feature branch is merged into `master`, update `HANDOFF.md` and `README.md` in the same completed work cycle so project memory and agent-facing operation docs match the merged behavior.
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
python3 -m unittest tests.test_session_state
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
- `Preference` opens and shows mouse actions
