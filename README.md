# Molecular Viewer 8704

Static browser molecular viewer served from `/home/nam114/test_visualizer` on port 8704.

Runtime layout:

- `index.html`: DOM structure
- `styles.css`: static UI styling
- `app.js`: viewer state, 3Dmol integration, mouse controls, settings, automation API
- `assets/3Dmol-min.js`: local 3Dmol dependency
- `data/8UCD.pdb`, `data/steap1_complex_seed2.pdb`: built-in structures

## Purpose Of This Manual

This README is a tool-agnostic operation manual for agents. It assumes only that the agent can open the page and execute JavaScript in the page context, for example through a browser console, browser automation framework, extension, or test runner.

Tool-specific debugging commands are intentionally not included here.

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
  file: "8UCD",
  atoms: 8058,
  mousePreset: "select-left",
  mouseActions: {
    buttons: {left: "select", right: "rotate", middle: "pan"},
    wheel: "zoom"
  }
}
```

The exact object also includes current `selection`, `styleRules`, and `hiddenRules`.

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
- `mousePreset`: current mouse preset name
- `mouseActions`: current button/wheel assignment
- `selection`: current selection selector
- `styleRules`: persistent style rules added through `molAgent.style(...)`
- `hiddenRules`: hide rules added through `molAgent.run({type: "hide", ...})`

## Selection Commands

Select a residue range:

```js
molAgent.setSelection(
  {chain: "H", resi: "30-35"},
  {representation: "stick"}
);
```

Add another selection instead of replacing:

```js
molAgent.setSelection(
  {chain: "L", resi: "90-95"},
  {additive: true, representation: "stick"}
);
```

Select a whole chain:

```js
molAgent.setSelection({chain: "A"}, {representation: "stick"});
```

Select all atoms:

```js
molAgent.setSelection({}, {representation: "stick"});
```

Clear selection:

```js
molAgent.clearSelection();
```

Selection options currently used by `setSelection`:

- `representation`: `stick`, `line`, `tube`, `sphere`, or `off`
- `additive` / `add`: add to existing selection
- `focus`: focus after setting selection

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
molAgent.setSelection({chain: "A"}, {representation: "stick"});
```

If the user asks to change application behavior rather than manipulate the currently open viewer, modify source code instead of executing page commands.

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

Change base protein representation:

```js
molAgent.setBaseStyle("cartoon");
molAgent.setBaseStyle("line");
molAgent.setBaseStyle("stick");
molAgent.setBaseStyle("sphere");
molAgent.setBaseStyle("tube");
```

Change ligand representation:

```js
molAgent.setLigandStyle("stick");
molAgent.setLigandStyle("line");
molAgent.setLigandStyle("sphere");
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

Load the built-in 8UCD:

```js
await molAgent.loadUrl("data/8UCD.pdb", "pdb", "8UCD", "8UCD", "8UCD");
molAgent.getState();
```

Load the built-in prediction structure:

```js
await molAgent.loadUrl(
  "data/steap1_complex_seed2.pdb",
  "pdb",
  "steap1_complex_seed2",
  "Prediction",
  ""
);
molAgent.getState();
```

Loading a structure clears current selection/style/interactions and rebuilds Entries/Hierarchy.

## `molAgent.run` Compatibility Commands

Use `molAgent.run(...)` only for structured compatibility objects.

Selection:

```js
molAgent.run({
  type: "selection",
  selector: {chain: "H", resi: "30-35"},
  options: {representation: "stick", focus: true}
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
3. Verify `molAgent.getState().file === "8UCD"`.
4. Verify `molAgent.getState().atoms` is about `8058`.
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
- The file server only serves static files.
- Keep normal operation local-first: no CDN and no remote PDB fetches unless explicitly requested.
- Do not commit runtime logs, temporary files, screenshots, zips, or editor workspace files.
- Do not delete `.cpu_prj.code-workspace`; it is the user's VS Code workspace and is intentionally gitignored.
