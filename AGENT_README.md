# MolWorkbench Agent Manual

Tool-agnostic operation manual for controlling MolWorkbench through browser automation.

Runtime layout:

- `index.html`: DOM structure
- `styles.css`: static UI styling
- `app.js`: viewer state, 3Dmol integration, mouse controls, settings, automation API
- `interaction-worker.js`: background nonbonded interaction index builder
- `wide-lines.js`: shader-backed 3Dmol scene-mesh renderer for app-managed line representations with screen-pixel width, depth/zoom scaling, screen-pixel clamps, and depth testing
- `server.py`: static file server plus persisted viewer-session, preference, and interaction-index APIs
- `config/visualization.json`: tracked visual defaults, including CPK radii and scales
- `assets/3Dmol-min.js`: local 3Dmol dependency

No molecular structures are bundled. First launch starts empty unless the server has a persisted session.

## Purpose Of This Manual

This README is a tool-agnostic operation manual for agents. It assumes only that the agent can open the page and execute JavaScript in the page context, for example through a browser console, browser automation framework, extension, or test runner.

Tool-specific debugging commands are intentionally not included here.

## Agent Operating Rule

When a user asks for a direct viewer operation, do only the actions required to satisfy that request and then report the result. Examples include loading files, removing entries, renaming entries, selecting atoms, changing visibility, changing representation, or updating preferences.

Do not expand simple operation requests into broad code review, design analysis, browser visual inspection, optimization work, or unrelated cleanup unless the user explicitly asks for that work or the requested operation fails. Prefer the existing structured APIs (`window.molAgent` or the server HTTP APIs) over manual UI clicks for routine session operations.

## Serving The App

Run the project server from the repository root:

```bash
PORT=8704
python3 server.py --port "$PORT" --bind 0.0.0.0
```

Use this server instead of `python3 -m http.server`; the generic static server cannot persist the loaded structure session, preferences, or server-side interaction indexes. The project server also blocks static access to dot-directories, `.viewer_state`, git metadata, logs, server source, and project memory/docs when it is bound to a shared network address.

## Control Surface

Agents should control the viewer through:

```js
window.molAgent
```

Do not send natural-language commands into the page. String commands are intentionally disabled. Use structured JavaScript objects.

Wait until the API exists before issuing commands:

```js
async function waitForMolAgent(timeoutMs = 10000) {
  const start = performance.now();
  while (!window.molAgent) {
    if (performance.now() - start > timeoutMs) {
      throw new Error("window.molAgent was not initialized");
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return window.molAgent;
}
```

Basic readiness check:

```js
const api = await waitForMolAgent();
api.getState();
```

Expected first-run default state:

```js
{
  proteinBackbone: "cartoon",
  proteinAtoms: "off",
  ligand: "stick",
  mousePreset: "select-left",
  mouseActions: {
    buttons: {left: "select", right: "rotate", middle: "pan"},
    wheel: "zoom"
  }
}
```

The exact object also includes current `selection`, `selectionHighlight`, `styleRules`, and `hiddenRules`. If `/api/preferences` already contains saved settings, global representation choices, `mousePreset`, `mouseActions`, chain colors, atom colors, carbon-by-chain coloring, and background color are restored from the server during startup.

## Selector Objects

Selectors are plain JavaScript objects matched against atom fields.

Common selectors:

```js
{chain: "H"}
{resi: 289}
{resi: "30-35"}
{resn: "TYR"}
{atom: "CA"}
{elem: "C"}
{serial: [1, 2, 3]}
{hetflag: true}
{hetflag: false}
{_entryName: "entry-name"}
{}
```

Boolean composition:

```js
{not: {chain: "A"}}
{or: [{chain: "H"}, {chain: "L"}]}
{and: [{chain: "H"}, {resi: "30-35"}]}
```

Selector notes:

- `{}` means all atoms.
- `_entryName` scopes a selector to one loaded entry. This is useful when several entries are displayed at once and chain/residue names overlap.
- `resi: "30-35"` means an inclusive residue range.
- Arrays match any listed value.

The visible Find control mirrors these selector fields. Its input placeholder changes with the selected type: residue number examples are `289` or `300-310`, residue name is `ARG`, atom name is `CA`, chain is `A`, and element is `C`.

- Numeric and string residue numbers are both accepted where the loaded model provides numeric residue values.
- For CIF files without explicit atom group records, standard amino-acid residues with N/CA/C backbone atoms are normalized as protein, so `{hetflag: false}` remains usable for protein selectors.

## Structure Parsing Notes

Some Schrodinger-style CIF exports omit `_atom_site.group_PDB`, which can cause the raw 3Dmol parser to treat every atom as hetero. The viewer normalizes standard amino-acid residues with N/CA/C backbone atoms back to protein after parsing.

If a protein CIF has no HELIX/SHEET or mmCIF secondary-structure annotation, the viewer applies a conservative phi/psi fallback for cartoon helix/sheet/loop display. Structures that already include secondary-structure annotation keep their source-provided assignments.

Line representation uses bond-order metadata when it is available. Double and triple bonds are rendered as parallel wide-line segments. MAE/MAEGZ conversion preserves Maestro `i_m_order` metadata for this purpose; plain PDB `CONECT` records do not encode bond order, so those bonds remain single-line unless another loaded format provides order metadata.

## Large Structure Performance Notes

For very large entries, first display can still take seconds because 3Dmol parsing, atom-map construction, hierarchy building, and initial scene generation run in the browser. After an entry is cached, display inclusion should be much faster.

When changing full-entry visibility or restyling large entries, avoid generating huge selectors such as `{serial: [many thousands of serials]}`. Prefer entry/model-scoped operations, cached model `show()`/`hide()`, model-local selectors, or direct model resets. Large serial-array selectors can force 3Dmol to scan the model once for each serial and can make the browser appear frozen.

## State Inspection

Get full app state:

```js
molAgent.getState();
```

Count atoms matching a selector:

```js
molAgent.selectAtoms({chain: "H"}).length;
```

Inspect a few matching atoms:

```js
molAgent.selectAtoms({chain: "H", resi: "30-35"}).slice(0, 5);
```

Useful `getState()` fields:

- `entries`: loaded entries with unique internal `name`, human-facing `title`, and `included`
- `includedEntries`: unique entry ids currently displayed in the viewer
- `atoms`: total loaded atom count
- `proteinBackbone`: protein backbone representation, usually `cartoon`, `tube`, or `off`
- `proteinAtoms`: protein atom-level representation, usually `off`, `line`, `stick`, `sphere`, or `cpk`
- `ligand`: ligand representation
- `mousePreset`: current mouse preset name
- `mouseActions`: current button/wheel assignment
- `selection`: current selection selector
- `selectionHighlight`: fixed selection highlight style used for selected atoms
- `styleRules`: persistent style rules added through `molAgent.style(...)`
- `hiddenRules`: hide rules added through `molAgent.run({type: "hide", ...})`

## Interaction Index Commands

The viewer builds nonbonded interaction indexes in a Web Worker per displayed entry. Completed indexes are stored on the server by structure key and reused when switching back to the same loaded molecule or adding another displayed entry.

Inspect index status:

```js
molAgent.getInteractionIndex();
```

Expected fields:

- `status`: aggregate status for displayed entries, such as `empty`, `pending`, `loading`, `ready`, `unavailable`, or `error`
- `source`: `entry-indexes` for the aggregate view
- `structureKey`: current displayed-set key
- `counts`: summed precomputed interaction counts for ready displayed entries
- `readyEntries`: number of displayed entries with ready interaction indexes
- `totalEntries`: number of displayed entries
- `entries`: per-entry interaction index status and counts

Force a rebuild:

```js
molAgent.rebuildInteractionIndex();
```

Rendering rules:

- Interaction rendering covers every displayed entry whose index is ready. Cross-entry interactions are not computed or drawn.
- If a newly displayed entry has no ready index yet, indexes that are already ready remain visible while the missing entry builds in the background.
- All nonbonded interaction guide lines are dashed.
- A pair interaction is drawn only when both endpoint atoms are currently displayed by atom-level representation (`line`, `stick`, `sphere`, or `cpk`).
- Protein cartoon alone does not count as atom-level display for interaction endpoints.
- Hydrogen-bond guide lines connect the hydrogen atom to the acceptor atom. The donor heavy atom remains stored in the index for scope/category checks.
- H-bond and salt sliders filter the precomputed index; they do not trigger a full reindex.

## Selection Commands

Select a residue range:

```js
molAgent.setSelection({chain: "H", resi: "30-35"});
```

Add another selection instead of replacing:

```js
molAgent.setSelection(
  {chain: "L", resi: "90-95"},
  {additive: true}
);
```

Select a whole chain:

```js
molAgent.setSelection({chain: "A"});
```

Select all atoms:

```js
molAgent.setSelection({});
```

Clear selection:

```js
molAgent.clearSelection();
```

`molAgent.setSelection(null)` also clears selection. Passing a non-object selector throws; selectors must be an object, an array of selector objects, or `null`.

Selection is based on loaded atoms, not only atoms that currently have an atom-level representation. A selector may target atoms hidden by representation `off` or hide rules; the selection highlight should still make them visible. Use selected-atom show/style actions to recover intentionally hidden atoms.

Selection options currently used by `setSelection`:

- `representation`: `stick`, `line`, `tube`, `sphere`, `cpk`, or `off`
- `additive` / `add`: add to existing selection
- `focus`: focus after setting selection
- `color`, `opacity`, `radius`, `scale`, `thickness`, `linewidth`: optional selection highlight overrides

Focus current selection:

```js
molAgent.focus();
```

Focus a selector directly:

```js
molAgent.focus({chain: "H", resi: "30-35"});
```

For a user request such as "select chain A on the current viewer", the direct page action is:

```js
molAgent.setSelection({chain: "A"});
```

If the user asks to change application behavior rather than manipulate the currently open viewer, modify source code instead of executing page commands.

Selection highlight is intentionally not exposed in the visible GUI. The default is a yellow `line` highlight. With protein atom display set to `off`, selected atoms are drawn as app-managed wide lines over the cartoon. If selected atoms are already displayed as `line`, `stick`, `sphere`, or `cpk`, the highlight follows that atom-level representation using the selection color. For atoms already displayed as `line`, matching base-line bonds are masked from the normal line collection and redrawn in the selection collection to avoid depth fighting. Agents may still change highlight options programmatically:

```js
molAgent.setSelectionHighlight({
  representation: "line",
  color: "#fdd835",
  linewidth: 2
});
```

## Spatial Query And Display Commands

Use `queryWithin` as the primitive for distance-based tasks. The command is generic: `source` and `target` may be selector objects or category aliases. The browser computes distances from the currently displayed entries. By default, distance matching is entry-local so several displayed entries do not get mixed; set `scope: "global"` only when cross-entry distance comparison is intended. The default visualization/query unit is `residue`, not `atom`, because atom-level distance hits often leave isolated dots.

Calculate a selector for protein residues with any atom within 5 A of ligand atoms:

```js
const hits = molAgent.queryWithin({
  radius: 5,
  source: {category: "ligand"},
  target: {category: "protein"}
});

molAgent.style(hits.selector, "line");
molAgent.setSelection(hits.selector);
```

Show protein residues with any atom within 5 A of ligand atoms:

```js
molAgent.showWithin({
  radius: 5,
  source: {category: "ligand"},
  target: {category: "protein"},
  representation: "line"
});
```

Show the atom-level interface between chain A and chain C in one entry:

```js
const entryId = molAgent.getState().entries[0].name;
molAgent.showWithin({
  radius: 7,
  source: {selector: {_entryName: entryId, chain: "A"}},
  target: {selector: {_entryName: entryId, chain: "C"}},
  level: "atom",
  sides: "both",
  representation: "line"
});
```

Useful fields:

- `radius`: positive distance cutoff in Angstrom.
- `source` / `target`: `{selector: {...}}` using normal selector syntax, or `{category: "ligand" | "protein" | "solvent" | "other" | "all"}`.
- `atoms` / `atomFilter`: `all`, `heavyPolarH`, `heavy`, `polarH`, or `hydrogen`. Prefer `all` or `heavyPolarH` for normal inspection; plain `heavy` excludes polar hydrogens and is rarely the intended biological view.
- `entry`, `entryName`, `_entryName`, `title`, or `pdbId` may be placed inside `source` or `target` to restrict entries.
- `level`: `atom`, `residue`, `chain`, or `entry`; default is `residue`.
- `sides`: `target` by default; use `both` for chain-chain or group-group interfaces.
- `excludeSource` / `excludeSourceFromTarget`: defaults to excluding source atoms from target hits so source ligands do not match themselves by distance 0.
- `representation`: atom-level `line`, `stick`, `sphere`, or `cpk`; default is `line`.
- `replace`: defaults to replacing the previous `agent-showWithin` rule with the same `tag`.
- `select`: defaults to selecting the matched atoms as well as displaying them.
- `focus`: set `true` only when the user explicitly asks to move the camera.
- `only` / `hideOthers`: hide atoms outside the matched set after applying the display rule.

`molAgent.showWithin(...)` and `molAgent.selectWithin(...)` are wrappers around `queryWithin`: `showWithin` adds a style rule and selection, while `selectWithin` only changes selection. The compatibility form also works:

```js
molAgent.run({
  type: "showWithin",
  radius: 5,
  source: {category: "ligand"},
  target: {category: "protein"},
  level: "residue"
});
```

## Interaction Query And Display Commands

Use `queryInteractions` when the user asks for already-indexed nonbonded interactions rather than raw distance neighborhoods. The command is generic: `source` and `target` use the same selector/category spec shape as `queryWithin`, and `interaction` may be `hbond`, `halogen`, `salt`, `pipi`, `pication`, `good`, `bad`, `ugly`, or `contacts`.

Show only hydrogen-bond interactions touching a named ligand residue, and display the involved residues:

```js
const ligandResn = "LIG";
molAgent.showInteractions({
  interaction: "hbond",
  source: {selector: {resn: ligandResn}},
  level: "residue",
  representation: "line"
});
```

Show interactions between chain A and chain C in one entry:

```js
const entryId = molAgent.getState().entries[0].name;
molAgent.showInteractions({
  interaction: ["hbond", "salt", "pication"],
  source: {selector: {_entryName: entryId, chain: "A"}},
  target: {selector: {_entryName: entryId, chain: "C"}},
  level: "residue",
  representation: "line"
});
```

Useful fields:

- `interaction` / `interactions` / `interactionTypes`: one type, an array of types, `contacts`, or omitted for all indexed types.
- `source` / `target`: same selector/category specs as `queryWithin`. With no `target`, interactions touching `source` match. With both sides present, matching is bidirectional by default.
- `directed`: set `true` only when side A of the indexed interaction must match `source` and side B must match `target`.
- `level`: `atom`, `residue`, `chain`, or `entry`; default is `residue`.
- `sides`: `both` by default. Use `source`, `target`, `partners`, or `matched` for narrower display selectors.
- `atoms` / `atomFilter` / `resultAtoms`: `all`, `heavyPolarH`, `heavy`, `polarH`, or `hydrogen`; default is `heavyPolarH`.
- `maxDistance` / `cutoff`: optional extra distance cutoff. Without it, hydrogen bonds and salt bridges use the viewer cutoffs.
- `filter`: defaults to `true`, so only matching interaction guide lines are drawn while the global Interactions toggle is on.
- `representation`, `replace`, `select`, `focus`, `only`, and `hideOthers`: behave like `showWithin`.

Manual interaction-panel edits clear the current agent interaction filter. If a user changes an interaction type checkbox or the `All` / `Protein-Ligand` / `Protein-Protein` scope dropdown, the viewer returns to normal GUI-controlled interaction display.

Clear the current interaction filter:

```js
molAgent.clearInteractionFilter();
```

## Styling Commands

Add a persistent style rule:

```js
molAgent.style(
  {chain: "H", resi: "30-35"},
  "stick",
  {color: "#fdd835", radius: 0.08}
);
```

Style a chain as tube:

```js
molAgent.style(
  {chain: "A"},
  "tube",
  {color: "#4FC3F7", thickness: 0.35, linewidth: 0.7}
);
```

Hide a selector through the structured compatibility API:

```js
molAgent.run({
  type: "hide",
  selector: {resn: ["HOH", "WAT"]}
});
```

Clear all added style/hide rules:

```js
molAgent.clearStyles();
```

Change protein backbone representation:

```js
molAgent.setProteinBackboneStyle("cartoon");
molAgent.setProteinBackboneStyle("tube");
molAgent.setProteinBackboneStyle("off");
```

Change protein atom-level representation independently from the backbone:

```js
molAgent.setProteinAtomStyle("off");
molAgent.setProteinAtomStyle("line");
molAgent.setProteinAtomStyle("stick");
molAgent.setProteinAtomStyle("sphere");
molAgent.setProteinAtomStyle("cpk");
```

Change ligand representation:

```js
molAgent.setLigandStyle("stick");
molAgent.setLigandStyle("line");
molAgent.setLigandStyle("sphere");
molAgent.setLigandStyle("cpk");
```

CPK defaults are loaded from `config/visualization.json`. Edit that tracked file to adjust default CPK stick radius, CPK sphere scale, or VDW radii, then reload the page or run:

```js
molAgent.reloadVisualConfig();
```

Supported representations:

- `cartoon`
- `line`
- `stick`
- `sphere`
- `cpk`
- `tube`
- `hide` / `off`

Representation scope:

- Protein backbone GUI/API supports `cartoon`, `tube`, and `off`.
- Protein atom GUI/API supports `off`, `line`, `stick`, `sphere`, and `cpk`.
- Ligand GUI/API supports `stick`, `line`, `sphere`, and `cpk`.
- `molAgent.style(...)` can still apply supported representations to any selector as a persistent style rule.

Common style options:

- `color`: CSS color string such as `"#fdd835"`
- `opacity`: number, normally `0` to `1`
- `radius`: stick radius
- `scale`: sphere scale
- `thickness`: tube trace thickness
- `linewidth`: app-managed `line` width scalar. It is interpreted as a requested screen-pixel width and then scaled by camera depth/zoom inside the wide-line shader, with screen-pixel min/max clamps so far lines remain visible and close lines do not become excessively thick.
- For `cpk`, `radius` controls stick radius and `scale` controls the VDW sphere multiplier. Atom sizes remain element-dependent through the configured VDW radii.

Line rendering note:

- App-managed `line` paths do not rely on browser `gl.lineWidth`. They are converted to static segment/cap mesh geometry in the 3Dmol scene, so they are depth-tested against the molecule and avoid the platform line-width limit.
- Line thickness is screen-pixel based with depth/zoom scaling, so closer lines render thicker and farther lines render thinner while still obeying min/max clamps. `wide-lines.js` expands width in the vertex shader and avoids per-frame JavaScript geometry rewrites.
- `wide-lines.js` maintains separate scene meshes for style, selection, interaction, and primitive/shape line collections. Routine selection updates should update only the selection collection and should not force molecular line collections to be rebuilt.
- Covered paths include protein atom `line`, ligand `line`, `molAgent.style(..., "line", ...)`, tube side lines, selection highlight `representation: "line"`, and interaction guide lines.
- Dashed wide lines are reserved for interaction guide rendering, not molecular representation styling.

## Mouse Action Commands

Read current mouse config:

```js
{
  preset: molAgent.getMousePreset(),
  actions: molAgent.getMouseActions()
}
```

Restore app default:

```js
molAgent.setMousePreset("select-left");
```

Pass through to 3Dmol default mouse controls:

```js
molAgent.setMousePreset("default");
```

Assign custom button actions:

```js
molAgent.setMouseActions({
  buttons: {left: "select", right: "rotate", middle: "pan"},
  wheel: "zoom"
});
```

Alternative examples:

```js
molAgent.setMouseActions({
  buttons: {left: "rotate", right: "select", middle: "pan"},
  wheel: "zoom"
});

molAgent.setMouseActions({
  buttons: {left: "select", right: "zoom", middle: "pan"},
  wheel: "zoom"
});
```

Supported button actions:

- `select`
- `rotate`
- `pan`
- `zoom`
- `none`

Supported wheel actions:

- `zoom`
- `none`

`molAgent.setMouseActions(...)` validates action names and rejects duplicate non-`none` button actions.

Default `select-left` behavior:

- left click: select
- left drag: range select
- Shift + click / Shift + drag: additive selection
- right drag: rotate
- middle drag: pan
- wheel: zoom

Hierarchy panel selection uses list-style modifiers: normal click replaces selection, Ctrl/Cmd-click toggles one row into or out of the current selection, and Shift-click selects the contiguous visible row range from the first selected anchor row to the clicked row. The left disclosure triangle on hierarchy headers is the only collapse/expand target.

Right-clicking a selected Hierarchy row opens a `Delete` context menu. This removes the selected atoms from the loaded entry's persisted server-side session state (`deletedSourceSerials`), so they are absent from Hierarchy, rendering, search, and interaction indexing after rebuild/reload. It does not delete or edit the original source file on disk.

Mouse action changes made through the Preference panel or `molAgent.setMouseActions(...)` are saved to the server through `/api/preferences`. Global representation choices changed through the top toolbar are saved through the same preferences API.

## Preference Commands

Read the current persisted-preference payload shape:

```js
molAgent.getPreferences();
```

Persist the current preference payload immediately:

```js
await molAgent.savePreferences();
```

Set an editable chain color. Chain keys are `A` through `Z`, and colors must be `#RRGGBB` strings. The tracked defaults follow the Maestro chain color scheme:

```js
molAgent.setChainColor("A", "#00cc00");
molAgent.getChainColors();
```

Set an editable atom color. Atom keys are the currently exposed 3Dmol-style uppercase element symbols. The tracked defaults follow the Maestro element color scheme:

```js
molAgent.setAtomColor("C", "#808080");
molAgent.getAtomColors();
```

List editable color keys before changing them:

```js
Object.keys(molAgent.getChainColors());
Object.keys(molAgent.getAtomColors());
```

Reset color schemes to the tracked defaults:

```js
molAgent.resetChainColors();
molAgent.resetAtomColors();
molAgent.resetColorSchemes();
```

Preference persistence covers:

- global representation choices for protein backbone, protein atoms, ligand, solvent, and other atoms
- mouse preset/action assignment
- chain colors `A` through `Z`
- atom colors for the Maestro-derived editable element set returned by `Object.keys(molAgent.getAtomColors())`
- whether protein carbon atoms use chain colors
- background color

The bundled 3Dmol color scheme registry also contains these built-in `colorscheme` names: `default`, `rasmol`, `Jmol`, `greenCarbon`, `cyanCarbon`, `magentaCarbon`, `yellowCarbon`, `whiteCarbon`, `orangeCarbon`, `purpleCarbon`, `blueCarbon`, `ssPyMol`, `ssJmol`, `amino`, `shapely`, `nucleic`, `chain`, and `chainHetatm`. Separately, spectrum coloring uses the gradient registry (`rwb`, `RWB`, `roygb`, `ROYGB`, `sinebow`, `linear`, and `linear_<color>_<color>...` custom gradients).

## Loading Structures

Load any structure URL that the deployed server makes available:

```js
await molAgent.loadUrl("path/to/structure.pdb", "pdb", "structure-id", "Display Title", "");
molAgent.getState();
```

The `name` argument is an identity base, not a guaranteed final id. Every UI or `molAgent.loadUrl(...)` load receives a fresh internal entry id by appending a timestamp-like suffix. The visible filename/title is kept in `title`. If you need to delete or target a newly loaded entry, read the actual id from `molAgent.getState().entries`.

Load a structure that already exists on the server filesystem:

```js
const loaded = await molAgent.loadServerFile("/path/on/server/structure.cif");
const loadedEntries = Array.isArray(loaded) ? loaded : [loaded];
molAgent.getState().entries.find(e => e.name === loadedEntries[0].name);
```

`Open file`, `Open server`, `molAgent.loadUrl(...)`, and `molAgent.loadServerFile(...)` may load more than one viewer entry from one file. Multi-CT MAE/MAEGZ files and multi-record SDF files are split into individual entries. The JS APIs return a single entry object for single-entry files and an array for multi-entry files; normalize with `Array.isArray(...)` before targeting newly loaded entries.

`Open server` and `molAgent.loadServerFile(...)` use `/api/server-files` and `/api/server-file-load`. The visible `Open server` dialog is a Linux-style explorer, but agents should use `molAgent.loadServerFile(...)` or the HTTP APIs for routine loading. Both paths are limited to the server-side roots configured by `server.py --file-root <dir>`; when no root is supplied, the server user's home directory is used. Hidden path segments are not listed or loadable, and only supported molecular structure files are shown. Loading a server file adds one or more new unique entries to the persisted session and does not edit the original source file. Entries loaded from the server filesystem keep their absolute source path as `sourcePath`, visible through `molAgent.getState().entries` and `/api/session-meta`; browser-local uploads and URL loads may not have a server-side `sourcePath`.

Remove an entry from the current viewer session:

```js
molAgent.removeEntry("structure-id");
molAgent.removeEntry("Display Title");
```

Rename one loaded entry title without changing its internal id:

```js
const originalTitle = "Original display title";
const matches = molAgent.getState().entries.filter(e => e.title === originalTitle);
const entry = matches[1] || matches[0];
await molAgent.renameEntry(entry.name, "Reference structure");
```

`molAgent.setEntryTitle(...)` is an alias. Prefer the unique `entry.name` from `molAgent.getState().entries` when two entries share the same title; title lookup is allowed but selects the first match.

Supported format inference in the UI includes common molecular files such as `pdb`, `sdf`, `mol`, `mol2`, `xyz`, `cif`, `mae`, `maegz`, and Maestro `psazip`. For API calls, pass the format explicitly when known. MAE/MAEGZ inputs are converted server-side to PDB text with the bundled pure-Python converter; no Schrodinger runtime is required for normal loading.

Maestro `psazip` inputs are converted server-side as a combined structure + surface entry. The server extracts the embedded structure, converts MAE/MAEGZ content to PDB when needed, parses the `.vis` HDF5 surface mesh, chunks the mesh below the 3Dmol custom-shape index limit, and persists the surface data in the entry. If the PSAZIP includes Bioluminate patch pickle data, the second vertex scalar array is treated as the positive/negative electrostatic field and converted to per-vertex red-white-blue colors using the embedded positive/negative color settings. No Schrodinger runtime is required, but the server Python environment must provide `h5py` and `numpy`. Agents can load these files with either:

```js
await molAgent.loadUrl("path/to/surface.psazip", "psazip", "surface", "Surface", "");
await molAgent.loadServerFile("/path/on/server/surface.psazip");
```

Loaded PSAZIP surface shapes follow the entry display state: hiding or deleting the entry hides or removes its surface together with the molecular model.

Loading a structure clears current selection/style rules for the viewer, rebuilds Entries/Hierarchy, and starts or reuses background interaction indexing for displayed entries. The normal loader preserves hydrogens because hydrogen-bond indexing depends on explicit hydrogen atoms.

Loading a new structure adds a new unique entry and includes it in the displayed set. Loading the same filename again later creates another entry rather than replacing the existing one. Existing included entries remain displayed. In the Entries panel, the `In` checkbox controls whether each loaded entry is currently shown, double-clicking the title renames the display label, and the row `X` button deletes that entry, disposes its cached 3Dmol model, and updates the persisted server session.

The viewer starts background interaction indexing for each displayed entry. When multiple entries are displayed, each ready entry's own interactions can be rendered at the same time; cross-entry interactions are intentionally not generated.

The viewer stores the loaded entry list on the server through `/api/session`; included-entry state is also mirrored in small server-side state/meta files. A browser refresh restores the full session first. If no saved session exists, the viewer stays empty until a user or agent loads a structure.

Entries checkbox toggles update only `includedEntries` through lightweight `/api/session-state`. This endpoint updates small state/meta files and does not rewrite full structure payloads. The viewer keeps loaded 3Dmol models cached and toggles display with model `show()`/`hide()` rather than clearing and reparsing all entries.

An explicit empty display set is valid. `includedEntries: []` means no entries are displayed. Agents must not treat an empty array as "show all"; only a missing `includedEntries` field is legacy fallback.

If a session, entry, preference, or interaction-cache write fails, the app logs a diagnostic. User-visible session and preference failures also update the status text. Large entry saves complete only after the server write finishes; do not assume `loadUrl(...)` persistence succeeded until the returned promise resolves.

Open browser clients poll lightweight `/api/session-meta` revisions and reload the full session only when the revision changes. If a full session reload fails, the client retries the same revision on the next poll rather than marking it handled. This lets agent-side entry additions/deletions appear in already-open browsers without repeatedly downloading structure data.

`/api/last-structure` remains as a compatibility endpoint for older agents. Writing to it upserts that one structure into the server session instead of replacing the whole session. On a clean install with no saved session or legacy structure, reading it returns `404 {"error":"not_found"}`.

Interaction indexes are stored through `/api/interaction-index/<structureKey>`. They are runtime cache files, not source files. Cached interaction serials are stored in entry-local source-serial space so a cached index remains valid even when the browser assigns different global atom serials after loading multiple entries.

## `molAgent.run` Compatibility Commands

Use `molAgent.run(...)` only for structured compatibility objects.

Selection:

```js
molAgent.run({
  type: "selection",
  selector: {chain: "H", resi: "30-35"},
  options: {focus: true}
});
```

Focus:

```js
molAgent.run({
  type: "focus",
  selector: {chain: "H", resi: "30-35"}
});
```

Style:

```js
molAgent.run({
  type: "style",
  selector: {chain: "H", resi: "30-35"},
  representation: "stick",
  options: {color: "#00e676", radius: 0.08}
});
```

Hide:

```js
molAgent.run({
  type: "hide",
  selector: {resn: ["HOH", "WAT"]}
});
```

Clear selection:

```js
molAgent.run({type: "clearSelection"});
```

Forbidden:

```js
molAgent.run("select chain H");
```

## UI Verification Without Tool-Specific Commands

When validating the visible UI manually or through any generic browser automation framework:

1. Open the page.
2. Wait until `window.molAgent` exists.
3. On a fresh server state, confirm `molAgent.getState().includedEntries` is an empty array.
4. Load a structure through `Open file`, `molAgent.loadUrl(...)`, or `/api/session-entry`.
5. Verify `molAgent.getState().file` is populated.
6. Verify `molAgent.getState().atoms` is greater than `0`.
7. Open the visible `Preference` button.
8. Confirm the Preference panel contains mouse action choices: `Rotate`, `Pan`, `Zoom`, `Select`.
9. Load a second entry if available and confirm `molAgent.getState().includedEntries.length` can be greater than `1`.
10. Turn off every Entries `In` checkbox and confirm `molAgent.getState().includedEntries` is an empty array rather than auto-restoring the first entry.
11. Confirm the browser console has no errors.

## Direct 3Dmol Escape Hatch

Use these only when the structured API is insufficient.

```js
molAgent.viewer();
molAgent.model();
molAgent.models();
```

`molAgent.viewer()` returns the underlying 3Dmol viewer. `molAgent.model()` returns the first displayed 3Dmol model for backward compatibility. `molAgent.models()` returns all currently displayed 3Dmol models. Direct calls can bypass app state, so prefer the structured API first.

### Temporary Viewer-Level Shapes

Agents can add temporary geometric annotations directly to the current 3Dmol viewer when the structured API is insufficient. This is useful for tasks such as "draw a 10 A cube centered on a ligand COM" or "draw a guide line between two residue centers".

Example: draw a 10 A cube centered on a named ligand residue:

```js
const ligandResn = "LIG";
const ligand = molAgent.selectAtoms({resn: ligandResn});
if (!ligand.length) throw new Error(`No atoms matched ligand ${ligandResn}`);

const center = ligand.reduce((p, a) => ({
  x: p.x + a.x,
  y: p.y + a.y,
  z: p.z + a.z
}), {x: 0, y: 0, z: 0});
center.x /= ligand.length;
center.y /= ligand.length;
center.z /= ligand.length;

const half = 5; // 10 A cube edge length
const corners = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
].map(([x, y, z]) => ({
  x: center.x + x * half,
  y: center.y + y * half,
  z: center.z + z * half,
}));
const edges = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

const viewer = molAgent.viewer();
const shape = viewer.addShape({});
edges.forEach(([a, b]) => shape.addLine({
  start: corners[a],
  end: corners[b],
  color: "#fdd835",
  linewidth: 2,
  opacity: 0.85,
}));
viewer.render();

// Keep this handle if you need to remove the annotation later:
// viewer.removeShape(shape); viewer.render();
```

Limitations:

- These are viewer-level temporary shapes, not entry-owned objects.
- They are not saved in the server session or preferences.
- They do not automatically hide/delete when an entry is hidden or removed.
- They may be removed by app redraw paths that clear viewer-level overlays.
- There is currently no structured `molAgent.addShape(...)` or entry-scoped persistent annotation API.

## Server-Side Entry Commands

Use these when an agent needs to update the shared viewer session without clicking the UI. Open clients with the current app code will pick up the change through `/api/session-meta`.

Set `VIEWER_URL` to the running viewer server first:

```bash
export VIEWER_URL="http://127.0.0.1:${PORT}"
```

Load or replace one entry:

```bash
python3 - <<'PY'
import json, os, urllib.request
from pathlib import Path

base_url = os.environ["VIEWER_URL"].rstrip("/")
entry = {
    "name": "entry-name",
    "title": "Display title",
    "pdbId": "",
    "fmt": "pdb",
    "data": Path("path/to/structure.pdb").read_text(),
}
body = json.dumps(entry).encode()
req = urllib.request.Request(
    f"{base_url}/api/session-entry",
    data=body,
    method="PUT",
    headers={"Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).read().decode())
PY
```

`/api/session-entry` also treats `name` as an entry id. If the id already exists, the server appends a unique suffix and returns the stored `entry` in the response. To intentionally replace an existing id, send `{"entry": entry, "replace": true}` or add `?replace=1`.

Load one existing server-side structure file without manually reading the file in the agent process:

```bash
python3 - <<'PY'
import json, os, urllib.request

base_url = os.environ["VIEWER_URL"].rstrip("/")
body = json.dumps({"path": "/home/user/project/structure.cif"}).encode()
req = urllib.request.Request(
    f"{base_url}/api/server-file-load",
    data=body,
    method="POST",
    headers={"Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).read().decode())
PY
```

List allowed server directories and supported structure files:

```bash
python3 - <<'PY'
import os, urllib.parse, urllib.request

base_url = os.environ["VIEWER_URL"].rstrip("/")
path = urllib.parse.quote("/home/user/project")
print(urllib.request.urlopen(f"{base_url}/api/server-files?path={path}").read().decode())
PY
```

Rename an entry title from an external agent:

```bash
python3 - <<'PY'
import json, os, urllib.request

base_url = os.environ["VIEWER_URL"].rstrip("/")
body = json.dumps({"name": "entry-id", "title": "New display title"}).encode()
req = urllib.request.Request(
    f"{base_url}/api/session-entry-title",
    data=body,
    method="PUT",
    headers={"Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).read().decode())
PY
```

Remove one entry:

```bash
python3 - <<'PY'
import os, urllib.parse, urllib.request

base_url = os.environ["VIEWER_URL"].rstrip("/")
name = urllib.parse.quote("entry-name", safe="")
req = urllib.request.Request(
    f"{base_url}/api/session-entry/{name}",
    method="DELETE",
)
print(urllib.request.urlopen(req).read().decode())
PY
```

Send a high-level viewer action without directly controlling the browser:

```bash
python3 - <<'PY'
import json, os, urllib.request

base_url = os.environ["VIEWER_URL"].rstrip("/")
action = {
    "type": "showWithin",
    "radius": 5,
    "source": {"category": "ligand"},
    "target": {"category": "protein"},
    "level": "residue",
    "representation": "line",
}
req = urllib.request.Request(
    f"{base_url}/api/agent-actions",
    data=json.dumps(action).encode(),
    method="POST",
    headers={"Content-Type": "application/json"},
)
print(urllib.request.urlopen(req).read().decode())
PY
```

Open browser clients poll `/api/agent-actions` and execute new structured actions through the same logic as `molAgent.run(...)`. The endpoint is an action log, not a natural-language interpreter. It accepts only JSON objects with known `type` values. Clear old pending actions with:

```bash
python3 - <<'PY'
import os, urllib.request

base_url = os.environ["VIEWER_URL"].rstrip("/")
req = urllib.request.Request(f"{base_url}/api/agent-actions", method="DELETE")
print(urllib.request.urlopen(req).read().decode())
PY
```

## Development Notes

- Rendering happens in the browser through WebGL.
- `server.py` serves static files plus `/api/session`, `/api/session-entry`, lightweight `/api/session-state` and `/api/session-meta`, `/api/preferences`, `/api/server-files`, `/api/server-file-load`, `/api/agent-actions`, `/api/convert-structure`, compatibility `/api/last-structure`, and `/api/interaction-index/<structureKey>`.
- Static serving intentionally blocks dot-directories, `.viewer_state`, git metadata, logs, pid files, server source, and project memory/docs. Do not bypass this with a generic static server for normal use.
- Keep normal operation local-first: no CDN and no remote PDB fetches unless explicitly requested.
- Do not commit runtime logs, temporary files, screenshots, zips, or editor workspace files.
