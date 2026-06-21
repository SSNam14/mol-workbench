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

- `file`: current structure name
- `entries`: loaded entries with `name`, `title`, `included`, and `active`
- `includedEntries`: entry names currently displayed in the viewer
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

Remove an entry from the current viewer session:

```js
molAgent.removeEntry("structure-id");
molAgent.removeEntry("Display Title");
```

Supported format inference in the UI includes common molecular files such as `pdb`, `sdf`, `mol`, `mol2`, `xyz`, and `cif`. For API calls, pass the format explicitly when known.

Loading a structure clears current selection/style rules for the active viewer context, rebuilds Entries/Hierarchy, and starts or reuses background interaction indexing for displayed entries. The normal loader preserves hydrogens because hydrogen-bond indexing depends on explicit hydrogen atoms.

Loading a new structure adds or replaces an entry and includes it in the displayed set. Existing included entries remain displayed. In the Entries panel, the `In` checkbox controls whether each loaded entry is currently shown. Clicking an entry row makes it the active entry for UI context without excluding the others. The row `X` button deletes that entry, disposes its cached 3Dmol model, and updates the persisted server session.

The viewer starts background interaction indexing for each displayed entry. When multiple entries are displayed, each ready entry's own interactions can be rendered at the same time; cross-entry interactions are intentionally not generated.

The viewer stores the loaded entry list on the server through `/api/session`; included-entry state and active entry are also mirrored in small server-side state/meta files. A browser refresh restores the full session first. If no saved session exists, the viewer stays empty until a user or agent loads a structure.

Entries checkbox toggles update only `includedEntries` and `activeEntry` through lightweight `/api/session-state`. This endpoint updates small state/meta files and does not rewrite full structure payloads. The viewer keeps loaded 3Dmol models cached and toggles display with model `show()`/`hide()` rather than clearing and reparsing all entries.

An explicit empty display set is valid. `includedEntries: []` means no entries are displayed, and `activeEntry` should be an empty string. Agents must not treat an empty array as "show all"; only a missing `includedEntries` field is legacy fallback.

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

## Development Notes

- Rendering happens in the browser through WebGL.
- `server.py` serves static files plus `/api/session`, `/api/session-entry`, lightweight `/api/session-state` and `/api/session-meta`, `/api/preferences`, compatibility `/api/last-structure`, and `/api/interaction-index/<structureKey>`.
- Static serving intentionally blocks dot-directories, `.viewer_state`, git metadata, logs, pid files, server source, and project memory/docs. Do not bypass this with a generic static server for normal use.
- Keep normal operation local-first: no CDN and no remote PDB fetches unless explicitly requested.
- Do not commit runtime logs, temporary files, screenshots, zips, or editor workspace files.
