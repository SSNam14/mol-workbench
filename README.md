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
molAgent.focus({chain:'H', resi:'30-35'});
molAgent.clearSelection();
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

3Dmol.js default camera controls are used. No custom translate/rotate/wheel handler is installed. Left click selects according to the selection mode; left drag remains available for normal 3Dmol rotation. Empty clicks do not clear the selection. Press `z` to focus the current selection and `Esc` to clear it.

## Notes

Default background is black. Protein carbon atoms in line/stick/tube styles use stable chain-specific colors; hetero atoms use element colors by default. Hover information is written into a fixed panel without floating tooltip layout churn.
