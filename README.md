# Molecular Viewer 8704

Static browser molecular viewer served from `/home/nam114/test_visualizer` on port 8704.

Runtime layout:

- `index.html`: DOM structure
- `styles.css`: static UI styling
- `app.js`: viewer state, 3Dmol integration, mouse controls, settings, automation API
- `assets/3Dmol-min.js`: local 3Dmol dependency
- `data/8UCD.pdb`, `data/steap1_complex_seed2.pdb`: built-in structures

## Agent Control Overview

Agents should control the frontend through `window.molAgent` whenever possible. Use UI clicks only to smoke-test visible controls such as Settings.

String commands are intentionally disabled. Do not send natural-language commands into the page. Use structured JavaScript objects.

Open the app:

```bash
agbrowse navigate 'http://127.0.0.1:8704/' --wait-until domcontentloaded --timeout 60000
agbrowse wait 3000 --json
```

Check that the API is available:

```bash
agbrowse evaluate 'JSON.stringify({
  ready: !!window.molAgent,
  state: window.molAgent && molAgent.getState()
})' --unsafe-allow evaluate
```

Expected initial state:

- `ready: true`
- `state.file: "8UCD"`
- `state.atoms` around `8058`
- `state.mousePreset: "select-left"`

## Selector Objects

Selectors are plain JavaScript objects matched against atom fields.

Common fields:

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

Notes:

- `{}` means all atoms.
- `resi: "30-35"` means inclusive residue range.
- Arrays match any listed value.
- Numeric and string residue numbers are both accepted where 3Dmol provides numeric values.

## State Inspection

Get full app state:

```bash
agbrowse evaluate 'JSON.stringify(molAgent.getState())' --unsafe-allow evaluate
```

Count atoms matching a selector:

```bash
agbrowse evaluate 'molAgent.selectAtoms({chain:"H"}).length' --unsafe-allow evaluate
```

Inspect a few matching atoms:

```bash
agbrowse evaluate 'JSON.stringify(
  molAgent.selectAtoms({chain:"H", resi:"30-35"}).slice(0, 5)
)' --unsafe-allow evaluate
```

Useful `getState()` fields:

- `file`: current structure name
- `atoms`: total loaded atom count
- `mousePreset`: current mouse preset name
- `mouseActions`: current button/wheel assignment
- `selection`: current selection selector
- `styleRules`: persistent style rules added through `molAgent.style(...)`
- `hiddenRules`: hide rules added through `molAgent.run({type:"hide", ...})`

## Selection Commands

Select a residue range:

```bash
agbrowse evaluate 'molAgent.setSelection(
  {chain:"H", resi:"30-35"},
  {representation:"stick"}
)' --unsafe-allow evaluate
```

Add another selection instead of replacing:

```bash
agbrowse evaluate 'molAgent.setSelection(
  {chain:"L", resi:"90-95"},
  {additive:true, representation:"stick"}
)' --unsafe-allow evaluate
```

Select a whole chain:

```bash
agbrowse evaluate 'molAgent.setSelection({chain:"A"}, {representation:"stick"})' --unsafe-allow evaluate
```

Select all atoms:

```bash
agbrowse evaluate 'molAgent.setSelection({}, {representation:"stick"})' --unsafe-allow evaluate
```

Clear selection:

```bash
agbrowse evaluate 'molAgent.clearSelection()' --unsafe-allow evaluate
```

Selection options currently used by `setSelection`:

- `representation`: `stick`, `line`, `tube`, `sphere`, or `off`
- `additive` / `add`: add to existing selection
- `focus`: focus after setting selection

Focus current selection:

```bash
agbrowse evaluate 'molAgent.focus()' --unsafe-allow evaluate
```

Focus a selector directly:

```bash
agbrowse evaluate 'molAgent.focus({chain:"H", resi:"30-35"})' --unsafe-allow evaluate
```

Keyboard focus toggle, equivalent to user pressing `z`:

```bash
agbrowse press z
```

## Styling Commands

Add a persistent style rule:

```bash
agbrowse evaluate 'molAgent.style(
  {chain:"H", resi:"30-35"},
  "stick",
  {color:"#fdd835", radius:0.08}
)' --unsafe-allow evaluate
```

Style a chain as tube:

```bash
agbrowse evaluate 'molAgent.style(
  {chain:"A"},
  "tube",
  {color:"#4FC3F7", thickness:0.35, linewidth:0.7}
)' --unsafe-allow evaluate
```

Hide a selector through structured compatibility API:

```bash
agbrowse evaluate 'molAgent.run({
  type:"hide",
  selector:{resn:["HOH", "WAT"]}
})' --unsafe-allow evaluate
```

Clear all added style/hide rules:

```bash
agbrowse evaluate 'molAgent.clearStyles()' --unsafe-allow evaluate
```

Change base protein representation:

```bash
agbrowse evaluate 'molAgent.setBaseStyle("cartoon")' --unsafe-allow evaluate
agbrowse evaluate 'molAgent.setBaseStyle("line")' --unsafe-allow evaluate
agbrowse evaluate 'molAgent.setBaseStyle("stick")' --unsafe-allow evaluate
agbrowse evaluate 'molAgent.setBaseStyle("sphere")' --unsafe-allow evaluate
agbrowse evaluate 'molAgent.setBaseStyle("tube")' --unsafe-allow evaluate
```

Change ligand representation:

```bash
agbrowse evaluate 'molAgent.setLigandStyle("stick")' --unsafe-allow evaluate
agbrowse evaluate 'molAgent.setLigandStyle("line")' --unsafe-allow evaluate
agbrowse evaluate 'molAgent.setLigandStyle("sphere")' --unsafe-allow evaluate
```

Supported representations:

- `cartoon`
- `line`
- `stick`
- `sphere`
- `tube`
- `hide` / `off`

Common style options:

- `color`: CSS color string such as `"#fdd835"`
- `opacity`: number, normally `0` to `1`
- `radius`: stick radius
- `scale`: sphere scale
- `thickness`: tube trace thickness
- `linewidth`: line width where supported by the browser/WebGL stack

## Mouse Action Commands

Read current mouse config:

```bash
agbrowse evaluate 'JSON.stringify({
  preset: molAgent.getMousePreset(),
  actions: molAgent.getMouseActions()
})' --unsafe-allow evaluate
```

Restore app default:

```bash
agbrowse evaluate 'molAgent.setMousePreset("select-left")' --unsafe-allow evaluate
```

Pass through to 3Dmol default mouse controls:

```bash
agbrowse evaluate 'molAgent.setMousePreset("default")' --unsafe-allow evaluate
```

Assign custom button actions:

```bash
agbrowse evaluate 'molAgent.setMouseActions({
  buttons:{left:"select", right:"rotate", middle:"pan"},
  wheel:"zoom"
})' --unsafe-allow evaluate
```

Alternative examples:

```bash
agbrowse evaluate 'molAgent.setMouseActions({
  buttons:{left:"rotate", right:"select", middle:"pan"},
  wheel:"zoom"
})' --unsafe-allow evaluate

agbrowse evaluate 'molAgent.setMouseActions({
  buttons:{left:"select", right:"zoom", middle:"pan"},
  wheel:"zoom"
})' --unsafe-allow evaluate
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

Load the built-in 8UCD:

```bash
agbrowse evaluate '(async () => {
  await molAgent.loadUrl("data/8UCD.pdb", "pdb", "8UCD", "8UCD", "8UCD");
  return JSON.stringify(molAgent.getState());
})()' --unsafe-allow evaluate
```

Load the built-in prediction structure:

```bash
agbrowse evaluate '(async () => {
  await molAgent.loadUrl("data/steap1_complex_seed2.pdb", "pdb", "steap1_complex_seed2", "Prediction", "");
  return JSON.stringify(molAgent.getState());
})()' --unsafe-allow evaluate
```

Loading a structure clears current selection/style/interactions and rebuilds Entries/Hierarchy.

## `molAgent.run` Compatibility Commands

Use this only for structured compatibility objects.

Selection:

```bash
agbrowse evaluate 'molAgent.run({
  type:"selection",
  selector:{chain:"H", resi:"30-35"},
  options:{representation:"stick", focus:true}
})' --unsafe-allow evaluate
```

Focus:

```bash
agbrowse evaluate 'molAgent.run({
  type:"focus",
  selector:{chain:"H", resi:"30-35"}
})' --unsafe-allow evaluate
```

Style:

```bash
agbrowse evaluate 'molAgent.run({
  type:"style",
  selector:{chain:"H", resi:"30-35"},
  representation:"stick",
  options:{color:"#00e676", radius:0.08}
})' --unsafe-allow evaluate
```

Hide:

```bash
agbrowse evaluate 'molAgent.run({
  type:"hide",
  selector:{resn:["HOH", "WAT"]}
})' --unsafe-allow evaluate
```

Clear selection:

```bash
agbrowse evaluate 'molAgent.run({type:"clearSelection"})' --unsafe-allow evaluate
```

Forbidden:

```js
molAgent.run("select chain H")
```

## UI Smoke-Test Commands

Prefer API calls for actual manipulation. Use DOM/UI interaction only to verify that visible controls still work.

Open Settings:

```bash
agbrowse snapshot --interactive --max-nodes 60
agbrowse click <SettingsRef>
agbrowse wait 500 --json
agbrowse text --format text
```

Expected Settings text includes:

- `Preferences`
- `MOUSE ACTIONS`
- `Rotate`
- `Pan`
- `Zoom`
- `Select`
- `Done`

Check console:

```bash
agbrowse console --clear --duration 1000 --limit 50
```

Expected:

```text
(no console output captured)
```

## Direct 3Dmol Escape Hatch

Use these only when the structured API is insufficient.

```bash
agbrowse evaluate '!!molAgent.viewer()' --unsafe-allow evaluate
agbrowse evaluate '!!molAgent.model()' --unsafe-allow evaluate
```

`molAgent.viewer()` returns the underlying 3Dmol viewer. `molAgent.model()` returns the current 3Dmol model. Direct calls can bypass app state, so prefer the structured API first.

## Development Notes

- Rendering happens in the browser through WebGL.
- The file server only serves static files.
- Keep normal operation local-first: no CDN and no remote PDB fetches unless explicitly requested.
- Do not commit runtime logs, temporary files, screenshots, zips, or editor workspace files.
- Do not delete `.cpu_prj.code-workspace`; it is the user's VS Code workspace and is intentionally gitignored.
