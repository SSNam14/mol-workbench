# Molecular Viewer

Static browser molecular viewer for protein and molecular structure inspection.

Runtime layout:

- `index.html`: DOM structure
- `styles.css`: static UI styling
- `app.js`: viewer state, 3Dmol integration, mouse controls, settings, automation API
- `interaction-worker.js`: background nonbonded interaction index builder
- `wide-lines.js`: 3Dmol scene-mesh renderer for screen-space-width line representations
- `server.py`: static file server plus persisted structure and interaction-index APIs
- `config/visualization.json`: tracked visual defaults, including CPK radii and scales
- `assets/3Dmol-min.js`: local 3Dmol dependency

## Purpose Of This Manual

This README is a tool-agnostic operation manual for agents. It assumes only that the agent can open the page and execute JavaScript in the page context, for example through a browser console, browser automation framework, extension, or test runner.

Tool-specific debugging commands are intentionally not included here.

## Serving The App

Run the project server from the repository root:

```bash
PORT=8704
python3 server.py --port "$PORT" --bind 0.0.0.0
```

Use this server instead of `python3 -m http.server`; the generic static server cannot persist the last loaded structure or server-side interaction indexes.

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

Expected initial state:

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

The exact object also includes current `selection`, `selectionHighlight`, `styleRules`, and `hiddenRules`.

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
- `resi: "30-35"` means an inclusive residue range.
- Arrays match any listed value.
- Numeric and string residue numbers are both accepted where the loaded model provides numeric residue values.

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

- `file`: current structure name
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

The viewer builds a nonbonded interaction index in a Web Worker when a structure is loaded. The completed index is stored on the server by structure key and reused when switching back to the same loaded molecule.

Inspect index status:

```js
molAgent.getInteractionIndex();
```

Expected fields:

- `status`: `empty`, `loading-cache`, `ready`, `unavailable`, or `error`
- `source`: `worker` or `server` when ready
- `structureKey`: server cache key for the current structure
- `counts`: precomputed interaction counts by type
- `elapsedMs`: worker build time when available

Force a rebuild:

```js
molAgent.rebuildInteractionIndex();
```

Rendering rules:

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

Selection highlight is intentionally not exposed in the visible GUI. The default is a yellow `line` highlight. With protein atom display set to `off`, selected atoms are drawn as app-managed wide lines over the cartoon. If selected atoms are already displayed as `line`, `stick`, or `sphere`, the highlight follows that atom-level representation using the selection color. Agents may still change highlight options programmatically:

```js
molAgent.setSelectionHighlight({
  representation: "line",
  color: "#fdd835",
  linewidth: 2
});
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
- `linewidth`: line width in screen pixels for app-managed `line` render paths
- For `cpk`, `radius` controls stick radius and `scale` controls the VDW sphere multiplier. Atom sizes remain element-dependent through the configured VDW radii.

Line rendering note:

- App-managed `line` paths do not rely on browser `gl.lineWidth`. They are converted to camera-facing mesh quads in the 3Dmol scene, so they are depth-tested against the molecule and avoid the platform line-width limit.
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

Default `select-left` behavior:

- left click: select
- left drag: range select
- Shift + click / Shift + drag: additive selection
- right drag: rotate
- middle drag: pan
- wheel: zoom

## Loading Structures

Load any structure URL that the deployed server makes available:

```js
await molAgent.loadUrl("path/to/structure.pdb", "pdb", "structure-id", "Display Title", "");
molAgent.getState();
```

Supported format inference in the UI includes common molecular files such as `pdb`, `sdf`, `mol`, `mol2`, `xyz`, and `cif`. For API calls, pass the format explicitly when known.

Loading a structure clears current selection/style/interactions, rebuilds Entries/Hierarchy, and starts background interaction indexing. The normal loader preserves hydrogens because hydrogen-bond indexing depends on explicit hydrogen atoms.

The viewer stores the last loaded structure on the server through `/api/last-structure`. A browser refresh restores that structure first; the bundled sample structure is only used when no saved structure exists.

Interaction indexes are stored through `/api/interaction-index/<structureKey>`. They are runtime cache files, not source files.

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
3. Verify `molAgent.getState().file` is populated.
4. Verify `molAgent.getState().atoms` is greater than `0`.
5. Open the visible `Settings` button.
6. Confirm the Settings panel contains mouse action choices: `Rotate`, `Pan`, `Zoom`, `Select`.
7. Confirm the browser console has no errors.

## Direct 3Dmol Escape Hatch

Use these only when the structured API is insufficient.

```js
molAgent.viewer();
molAgent.model();
```

`molAgent.viewer()` returns the underlying 3Dmol viewer. `molAgent.model()` returns the current 3Dmol model. Direct calls can bypass app state, so prefer the structured API first.

## Development Notes

- Rendering happens in the browser through WebGL.
- `server.py` serves static files plus `/api/last-structure` and `/api/interaction-index/<structureKey>`.
- Keep normal operation local-first: no CDN and no remote PDB fetches unless explicitly requested.
- Do not commit runtime logs, temporary files, screenshots, zips, or editor workspace files.
