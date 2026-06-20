# Test Visualizer Handoff

Last updated: 2026-06-20 KST

## Current State

- Active project: `/home/nam114/test_visualizer`
- Active URL: `http://10.36.102.65:8704/`
- Local check URL: `http://127.0.0.1:8704/`
- Current server command:

```bash
python3 -m http.server 8704 --bind 0.0.0.0 --directory /home/nam114/test_visualizer
```

- Current server PID at handoff: `3132107`
- PID/log files are local runtime files and are ignored by git:
  - `server_8704.pid`
  - `server_8704.log`

## Git

This project is now a git repo.

```bash
cd /home/nam114/test_visualizer
git status --short
git log --oneline -3
```

Initial baseline commit before this handoff document:

```text
f4cd01b Initial molecular visualizer baseline
```

Tracked source/runtime files:

```text
.gitignore
README.md
HANDOFF.md
index.html
styles.css
app.js
assets/3Dmol-min.js
data/8UCD.pdb
data/steap1_complex_seed2.pdb
```

Ignored runtime files:

```text
server_*.log
server_*.pid
*.zip
backup/temp html files
```

## Directory History

- Old visualizer working directory was `/home/nam114/mol_viewer_8704`.
- It was archived, not deleted:

```text
/home/nam114/mol_viewer_8704.archived_after_test_visualizer_20260619_2252
```

- `~/test_ipsae` remains a separate analysis/report workspace. The active visualizer is no longer served from there.

## Restart 8704

Use this if the server is not running or if port 8704 points to the wrong directory.

```bash
cd /home/nam114/test_visualizer

oldpid="$(cat server_8704.pid 2>/dev/null || true)"
if [ -n "$oldpid" ] && kill -0 "$oldpid" 2>/dev/null; then
  kill "$oldpid"
fi

setsid -f python3 -m http.server 8704 \
  --bind 0.0.0.0 \
  --directory /home/nam114/test_visualizer \
  > /home/nam114/test_visualizer/server_8704.log 2>&1 < /dev/null

pid="$(pgrep -f '^python3 -m http\.server 8704 --bind 0\.0\.0\.0 --directory /home/nam114/test_visualizer$' | head -n 1)"
printf '%s\n' "$pid" > /home/nam114/test_visualizer/server_8704.pid

curl -sI http://127.0.0.1:8704/ | head
```

## Implemented Behavior

- Static single-page molecular viewer split across `index.html`, `styles.css`, and `app.js`.
- Uses local `assets/3Dmol-min.js`.
- Loads:
  - `data/8UCD.pdb`
  - `data/steap1_complex_seed2.pdb`
- Black background.
- Chain-specific default coloring for protein carbon atoms.
- Command-line/natural-language UI was removed.
- Main control surface is now the structured browser API `window.molAgent`.
- Mouse controls are selectable from the topbar `Settings` panel or `molAgent.setMousePreset(...)` / `molAgent.setMouseActions(...)`.
- Current app default preset is `select-left`:
  - left click: selection only
  - left drag: screen-space range box selection
  - Shift + click / Shift + drag: add to current selection
  - right drag: rotate
  - wheel-button drag: move/pan
  - right-drag zoom is disabled
- Custom mouse button actions support `select`, `rotate`, `pan`, `zoom`, and `none`; wheel supports `zoom` and `none`.
- In `select-left`, drag range selection respects selection mode:
  - `atom`: atoms inside the box
  - `residue`/`range`: whole residues touched by the box
  - `chain`: whole chains touched by the box
  - `model`: all atoms
- In `select-left`, wheel direction is inverted:
  - wheel up: zoom in
  - wheel down: zoom out
- `default` passes mouse and wheel events through to 3Dmol.js default controls.
- Selection display persists until explicit clear.
- Hover panel is fixed-size to avoid layout flicker.
- FPS overlay is shown at top-left.

## FPS Note

The current FPS overlay measures browser `requestAnimationFrame` callback rate, not remote desktop streaming FPS and not exact 3Dmol render-call FPS.

This means:

- A visible tab can show the compositor/page rAF rate.
- A hidden or throttled tab can show `FPS --`.
- If actual WebGL render cost needs to be measured, wrap `viewer.render()` separately and report render-call FPS.

## Agent API Examples

Use structured calls from the browser console or through CDP/automation:

```js
molAgent.style(
  {chain: 'H', resi: '30-35'},
  'tube',
  {color: '#fdd835', persist: true}
);

molAgent.setSelection(
  {chain: 'H', resi: '30-35'},
  {representation: 'stick', color: '#fdd835'}
);

molAgent.clearSelection();
molAgent.clearStyles();
molAgent.setMousePreset('select-left');
molAgent.setMouseActions({buttons: {left: 'select', right: 'rotate', middle: 'pan'}, wheel: 'zoom'});
molAgent.loadUrl('data/steap1_complex_seed2.pdb', 'pdb', 'steap1_complex_seed2');
```

String commands are intentionally disabled. Use structured objects only.

## Verification Commands

Run after edits:

```bash
cd /home/nam114/test_visualizer

node --check app.js
curl -sI http://127.0.0.1:8704/ | head
curl -sI http://127.0.0.1:8704/styles.css | head
curl -sI http://127.0.0.1:8704/app.js | head
git status --short
```

Browser smoke check:

```bash
agbrowse-agent navigate 'http://127.0.0.1:8704/' --wait-until domcontentloaded --timeout 60000
agbrowse-agent console --clear --reload --duration 3000
```

Expected console result:

```text
(no console output captured)
```

## Relevant External Artifacts

Pro-generated fixed zip that was applied before creating this project:

```text
/home/nam114/Downloads/agbrowse_pro_results/20260619_1715_mol_viewer_mouse_api_fix/mol_viewer_8704_pro_fixed.zip
```

Current user workstation note:

```text
ssh D2407LP6002
```
