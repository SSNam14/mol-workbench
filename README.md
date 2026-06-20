# Molecular Viewer 8704

Static browser molecular viewer for local serving on port 8704. The runtime is split by role: `index.html` holds markup, `styles.css` holds static UI styles, and `app.js` holds viewer/application logic. Local assets and sample data remain under `assets/` and `data/`.

## Agent API

The app is intended to be controlled by structured browser API calls through `window.molAgent`. Natural-language command input and command-log UI are intentionally not included.

```js
// Style residues or ranges.
molAgent.style({chain:'H', resi:'30-35'}, 'tube', {color:'#fdd835', persist:true});
molAgent.style({chain:'H', resi:'30-35'}, 'stick', {color:'#fdd835'});
molAgent.style({chain:'A'}, 'hide');
molAgent.clearStyles();

// Selection and focus.
molAgent.setSelection({chain:'H', resi:'30-35'}, {representation:'stick', color:'#fdd835'});
molAgent.setSelection({chain:'L', resi:'90-95'}, {additive:true});
molAgent.focus({chain:'H', resi:'30-35'});
molAgent.clearSelection();

// Load local or user-served structures.
molAgent.loadUrl('data/steap1_complex_seed2.pdb', 'pdb', 'steap1_complex_seed2');

// Mouse presets can be changed immediately.
molAgent.setMousePreset('select-left');
molAgent.setMousePreset('default');
molAgent.setMouseActions({buttons:{left:'select', right:'rotate', middle:'pan'}, wheel:'zoom'});
```

`molAgent.run({...})` remains available for structured compatibility objects only. String commands are disabled by design.

## Selector model

Selectors are plain objects compatible with common 3Dmol-style atom fields plus local boolean composition:

```js
{chain:'H'}
{chain:'H', resi:'30-35'}
{serial:[1,2,3]}
{not:{chain:'A'}}
{or:[{chain:'H', resi:'30-35'}, {chain:'L', resi:'90-95'}]}
```

Supported representation names are `cartoon`, `line`, `stick`, `sphere`, `tube`, and `hide`.

## Mouse and keyboard behavior

Mouse behavior is selectable from the topbar `Settings` panel or through `molAgent.setMousePreset(...)` and `molAgent.setMouseActions(...)`.

`select-left` is the default for this app: left click selects according to the selection mode, left drag creates a screen-space range box, right drag rotates the camera, wheel-button drag moves the model, and wheel up zooms in. Hold Shift while clicking or drag-selecting to add the new selection to the current selection. Drag range selection respects the selection mode: `atom` selects atoms in the box, `residue`/`range` selects whole residues touched by the box, `chain` selects whole chains touched by the box, and `model` selects all atoms. `default` passes mouse and wheel events through to 3Dmol.js default controls. Custom button actions support `select`, `rotate`, `pan`, `zoom`, and `none`; wheel supports `zoom` and `none`. Empty clicks do not clear the selection. Press `z` to focus the current selection and `Esc` to clear it.

## Notes

Default background is black. Protein carbon atoms in line/stick/tube styles use stable chain-specific colors; hetero atoms use element colors by default. Hover information is written into a fixed panel without floating tooltip layout churn.
