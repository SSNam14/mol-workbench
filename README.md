# Molecular Viewer 8704

Single-file browser molecular viewer for local serving on port 8704. The runtime source is `index.html`; local assets and sample data remain under `assets/` and `data/`.

## Agent API

The app is intended to be controlled by structured browser API calls through `window.molAgent`. Natural-language command input and command-log UI are intentionally not included.

```js
// Style residues or ranges. The targeted residue/region is all-atom unless sidechainOnly is explicit.
molAgent.style({chain:'H', resi:'30-35'}, 'tube', {color:'#fdd835', persist:true});
molAgent.style({chain:'H', resi:'30-35'}, 'stick', {color:'#fdd835'});
molAgent.style({chain:'A'}, 'hide');

// Named regions are never auto-created. Register them explicitly.
molAgent.setRegions({REGION_NAME:[{chain:'H', resi:'30-35'}]});
molAgent.style({region:'REGION_NAME'}, 'tube', {color:'#fdd835'});

// True side-chain-only is separate and explicit.
molAgent.style({chain:'H', resi:'30-35'}, 'stick', {sidechainOnly:true, color:'#00e676'});

// Interactions with selectors and filters.
molAgent.showInteractions({kind:'hbond', between:[{chain:'A'}, {not:{chain:'A'}}], limit:2000});
molAgent.showInteractions({kind:'salt', between:[{chain:'H'}, {chain:'L'}], limit:500});
molAgent.showInteractions({kind:'pi', between:[{chain:'H'}, {not:{chain:'H'}}], limit:200});

// Selection and focus.
molAgent.setSelection({chain:'H', resi:'30-35'}, {representation:'stick', color:'#fdd835'});
molAgent.setSelection({chain:'L', resi:'90-95'}, {additive:true});
molAgent.focus({chain:'H', resi:'30-35'});
molAgent.clearSelection();

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
{region:'REGION_NAME'}
```

Supported representation names are `cartoon`, `line`, `stick`, `sphere`, `tube`, and `hide`. The `tube` representation includes a trace tube plus all-atom line overlay so targeted residues/regions remain visible as all atoms, not only backbone or side chain.

## Mouse and keyboard behavior

Mouse behavior is selectable from the topbar `Settings` panel or through `molAgent.setMousePreset(...)` and `molAgent.setMouseActions(...)`.

`select-left` is the default for this app: left click selects according to the selection mode, left drag creates a screen-space range box, right drag rotates the camera, wheel-button drag moves the model, and wheel up zooms in. Hold Shift while clicking or drag-selecting to add the new selection to the current selection. Drag range selection respects the selection mode: `atom` selects atoms in the box, `residue`/`range` selects whole residues touched by the box, `chain` selects whole chains touched by the box, and `model` selects all atoms. `default` passes mouse and wheel events through to 3Dmol.js default controls. Custom button actions support `select`, `rotate`, `pan`, `zoom`, and `none`; wheel supports `zoom` and `none`. Empty clicks do not clear the selection. Press `z` to focus the current selection and `Esc` to clear it.

## Notes

Default background is black. Protein carbon atoms in line/stick/tube styles use stable chain-specific colors; hetero atoms use element colors by default. Hover information is written into a fixed panel without floating tooltip layout churn.
