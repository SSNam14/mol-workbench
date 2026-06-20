# Molecular Viewer Project Memory

Last updated: 2026-06-20 KST

## Purpose

This project is a static, browser-based molecular viewer served from `/home/nam114/test_visualizer` on port 8704.

The Python HTTP server only serves files. Rendering happens in the client browser through 3Dmol.js/WebGL, so interactive performance follows the client browser/GPU/rendering environment, not the file server CPU except for static file delivery.

## Runtime Shape

- `index.html`: static DOM structure only.
- `styles.css`: static UI styling.
- `app.js`: viewer state, 3Dmol integration, selection, settings, mouse actions, API.
- `assets/3Dmol-min.js`: local 3Dmol dependency. Keep this local unless explicitly changed.
- `data/8UCD.pdb` and `data/steap1_complex_seed2.pdb`: built-in local structures.

Serve with:

```bash
python3 -m http.server 8704 --bind 0.0.0.0 --directory /home/nam114/test_visualizer
```

Local check URL:

```text
http://127.0.0.1:8704/
```

User-facing URL:

```text
http://10.36.102.65:8704/
```

## Design Principles

- Keep the app static and local-first. Avoid remote CDN/data dependencies in normal operation.
- Keep markup, static styling, and application logic split by role.
- Prefer dense, work-focused molecular-viewer UI over landing-page or explanatory UI.
- Preserve fast interactive camera behavior. Do not change camera semantics to hide performance problems.
- Keep settings extensible; the settings panel should be able to host future visual/input preferences without restructuring.
- Keep control surfaces explicit. Selection should persist until explicit clear, not disappear because of empty clicks.
- Keep `window.molAgent` as the structured automation/API surface. Do not add free-form natural-language command execution.

## Must-Have Behavior

- Initial load opens local `data/8UCD.pdb`.
- `+ Pred` loads local `data/steap1_complex_seed2.pdb`.
- Default mouse preset is `select-left`:
  - left click selects
  - left drag performs screen-space range selection
  - Shift + click / Shift + drag adds to the existing selection
  - right drag rotates
  - middle-button drag pans
  - wheel zooms
- Custom mouse actions are configurable from Settings and through `molAgent.setMouseActions(...)`.
- The `default` mouse preset passes through to 3Dmol default controls.
- Range selection respects selection mode:
  - `atom`: atoms inside the box
  - `residue` / `range`: whole touched residues
  - `chain`: whole touched chains
  - `model`: all atoms
- Pressing `z` toggles between focusing the current selection and overview.
- Selecting atoms alone must not silently change the rotation/focus pivot. Pivot changes should follow an explicit focus action such as `z`/Focus.
- Selection highlight should remain visible without becoming overly thick; current default is a slim yellow stick highlight.
- FPS overlay is a browser `requestAnimationFrame` indicator, not remote desktop streaming FPS.

## API Contract

`window.molAgent` is expected to expose at least:

```js
molAgent.setSelection(selector, options);
molAgent.clearSelection();
molAgent.focus(selector);
molAgent.style(selector, representation, options);
molAgent.clearStyle();
molAgent.clearStyles();
molAgent.setBaseStyle(representation);
molAgent.setLigandStyle(representation);
molAgent.setMousePreset(preset);
molAgent.getMousePreset();
molAgent.setMouseActions(actions);
molAgent.getMouseActions();
molAgent.selectAtoms(selector);
molAgent.getState();
molAgent.loadUrl(url, fmt, name, title, pdbId);
molAgent.run(commandObject);
molAgent.viewer();
molAgent.model();
```

String commands are intentionally disabled. Use structured objects only.

Common selector examples:

```js
{chain: 'H'}
{chain: 'H', resi: '30-35'}
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
cd /home/nam114/test_visualizer
node --check app.js
git diff --check
curl -sI http://127.0.0.1:8704/ | head
curl -sI http://127.0.0.1:8704/styles.css | head
curl -sI http://127.0.0.1:8704/app.js | head
```

Browser smoke check:

```bash
agbrowse navigate 'http://127.0.0.1:8704/' --wait-until domcontentloaded --timeout 60000
agbrowse wait 3000 --json
agbrowse console --clear --duration 1000 --limit 50
```

Expected:

- no console errors
- `window.molAgent` exists
- initial structure shows `8UCD` with about 8,058 atoms
- `Settings` opens and shows mouse actions
