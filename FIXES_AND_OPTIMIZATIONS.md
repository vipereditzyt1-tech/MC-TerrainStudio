# Potential fixes, changes and optimizations — Terrain Studio

Review-only. **No code was changed to produce this file.** Written by the 4th agent
(audit / review) on 2026-11-18, then **re-verified after the integration agent's noise release and
the performance agent's first pass landed** — everything below reflects the tree as it stands in
that second read, including what has since been fixed.

Sibling document: `POTENTIAL_UPGRADES.md` (feature backlog).

Line numbers were accurate against `src/App.tsx` at 1,809 lines, `src/terrainEngine.ts` at 232
and `src/project.ts` at 71. Other agents are editing the same files, so **anchor on the named
function, not the number** if they have drifted; the function name is always given.

## What was actually run (second read)

| Check | Result |
| --- | --- |
| `npx tsc -p tsconfig.json --noEmit` | **passes** (exit 0) |
| `npx eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0` | **fails** (exit 1): **3 errors, 2 warnings** — see F1 |
| `node .freebuff/plugin-build/run-parity.mjs` | not run by me (integration agent reports all 9 noise types PASS, max delta ≈ 2e-8) |
| `npm run build` | not run — it invokes `electron-builder`, i.e. it packages the app |
| Running app / workers / GUI | not exercised. All runtime claims are read from source |

Severity: **P0** broken or loses data · **P1** wrong behaviour the user will hit · **P2** rough
edge · **P3** hygiene.

Ownership is per `AGENT_SYNC.md`: the integration agent released `src/terrainEngine.ts` on
2026-11-18 23:05 with the condition that the height field stays numerically identical
(`run-parity.mjs` before and after); `src/terrainWorker.ts`'s message shape is frozen; `src/App.tsx`
is shared between the UI and performance agents; `src/App.css` is UI-only. Items marked
**[gated]** still need that owner's agreement.

---

## Status board

| Id | Item | Status |
| --- | --- | --- |
| F1 | `npm run lint` cannot pass | **Open, worse** — a third error appeared at `App.tsx:981` |
| F2 | Fresh launch / New project instantly "dirty" | **Open** |
| F3 | Custom texture subgraphs saved but never evaluable | **Open** |
| F4 | Save validates parseability, not exportability | **Fixed** — `compileGraph` now runs on save |
| F5 | Dirty detection is key-order sensitive | **Open** |
| F6 | Preview regenerates on every keystroke | **Closed** — residuals R1/R2 closed by performance agent |
| F7 | Worker failures wedge preview/export | **Closed** — residual R4 closed; R3 (onmessageerror) still open |
| F8 | Noise-model switch = two undo steps + stale `textureId` | **Fixed** — one transaction, stale id cleared |
| F9 | `Ctrl+X` is redo; `Cmd` does nothing | **Closed** — metaKey + Ctrl+Y/Ctrl+Shift+Z added |
| F10 | `WorldView` exhaustive-deps warning | **Open** (same root as R1) |
| F11 | `projectDocument` recreated every render | **Open** |
| F12 | Parameter validation skips unreachable nodes | **Open** **[gated]** |
| F13 | `.terrain` accepts world bounds the engine rejects | **Fixed** — parse rejects `maxY <= minY` |
| F14 | `main.tsx` crashes outside Electron | **Fixed** — template IPC call removed |
| F15 | `beforeunload` is not a close prompt in Electron | **Closed** — main-process dialog; deduplicated by audit |
| F16 | Export silently capped at preview resolution | **Closed** — success message names the size |
| F17 | `seaLevel` has no in-app effect | **Closed** — water tint + Water cover metric |
| O1 | Inspector preview: third maths implementation | Sampling cost **fixed**; maths duplication **open** |
| O2–O10 | Optimizations | **Open** |

---

## P0 — data integrity

### F1 — `npm run lint` cannot pass, so the repo has no working gate
Verbatim from the second read:

```
electron/main.ts
  63:124  error  Unexpected control character(s) in regular expression: \x00, \x1f  no-control-regex
  85:111  error  Unexpected control character(s) in regular expression: \x00, \x1f  no-control-regex

src/App.tsx
  613:8   warning  React Hook useEffect has a missing dependency: 'world'  react-hooks/exhaustive-deps
  805:11  warning  The 'projectDocument' object makes the dependencies of useCallback Hook (at line 937) change on every render  react-hooks/exhaustive-deps
  981:13  error    'watchdog' is never reassigned. Use 'const' instead  prefer-const

✖ 5 problems (3 errors, 2 warnings)
```

`package.json` passes `--max-warnings 0`, so the warnings are fatal too.

Two of the errors are original (`electron/main.ts`, the filename sanitising regex — the character
class is intentional, so this wants a targeted `// eslint-disable-next-line no-control-regex` on
those two lines **or** an equivalent `replace(/[^\w.\- ]/g, '_')` rewrite, not a rule change).

The third is **new**: the performance agent's export watchdog declares `let watchdog` and assigns
it exactly once (`exportHeightmap`, `App.tsx:981`). `prefer-const` is right — the initialiser can
move below the `settle` closure because `settle` only reads it when invoked. Worth telling them,
since their note reports `tsc` and `vite build` clean but not lint.

**P0 — electron/** (unclaimed) + App.tsx (performance agent).**

### F2 — A new or freshly opened project is immediately "dirty"
`App.tsx:776` initialises `savedProject` to `null`; `projectDirty = savedProject !== projectText`
(L~813) is therefore `true` before the user touches anything — unsaved dot, "Unsaved changes" in
the status bar, `beforeunload` armed. `newProject` re-creates it explicitly: `setSavedProject(null)`
at L968.

Fix: seed the baseline once on mount with the same string `projectText` would produce, and in
`newProject` set it to the stringified fresh document instead of `null`. **P0 — performance agent
(state lives in App.tsx).**

### F3 — Custom texture subgraphs are saved but can never be evaluated
`createCustomTexture` (`App.tsx:1198`) builds two nodes whose `data` has **no `kind`**
(`texture-coordinates` and `custom-noise-output`), plus one edge. `projectGraph` serialises them,
`parseProject` accepts `kind === undefined` (`src/project.ts` L~43), and `saveProject` only refuses
while a *texture tab* is active (L~924) — so saving from the graph tab persists an unusable
subgraph. Selecting that texture then sets `noiseType: "custom"`, which `compileGraph` rejects
(`supportedNoise` has no `"custom"`), so the World View errors and PNG export fails.

Either give the texture graph real kinds and wire it into the engine (`POTENTIAL_UPGRADES.md`
U12/U13) or stop writing it into the document. Either way, fix F4 so saving proves exportability.
**P0 — UI (creation path) + integration (engine side).**

### F4 — Save validates parseability, not exportability — **fixed**
`saveProject` (L~923) runs `parseProject(JSON.stringify(projectDocument))` then writes. That proves
the file round-trips; it does not prove the graph compiles. A `custom` noise type, a `noise` node
with `scale: 0`, an output with no input, or `maxY <= minY` all save without complaint and fail
later in the World View or in the plugin.

Fix: also run `compileGraph(toTerrainGraph(nodes, edges))` inside the `try` and surface its
message. No engine edit needed — only the integration agent's confirmation that throwing is the
contract. **P0 — performance agent owns the save path.**

### F5 — Dirty detection compares JSON text, so key order decides
`openProject` (L~953) rebuilds the baseline by spreading the parsed document
(`{...doc, graph: projectGraph(...), customTextures: ...}`) while `projectDocument` is built from a
fixed object literal (L~805). For a `.terrain` file whose top-level keys are in a different order —
hand-edited, or written by another tool — the strings differ although the documents are identical,
so the project opens flagged modified and the first discard prompt fires on an untouched project.

Fix: build the baseline through the *same* function used for `projectDocument`, i.e. a single
`buildDocument(...) → JSON.stringify` path (F11's `useMemo` gives you that for free).
**P1 — performance agent.**

---

## P1 — behaviour users will hit

### F6 — Preview regenerated per keystroke — **closed**
The performance agent's first pass addresses the core problem: debounce
(`PREVIEW_DEBOUNCE_MS = 160`), a `cancelled` flag checked in every callback, `release()` on
cleanup, a 20 s watchdog, `worker.onerror` terminating the worker, and no more `clearRect`, so the
last good heightmap stays visible. `generatedRef` also makes the first mount immediate. Verified by
reading `WorldView` (`App.tsx:~535–620`).

Residuals, both cheap:

- **R1 — display-only edits still regenerate.** The effect depends on the `nodes`/`edges` **array
  identities** (`App.tsx:613`), so editing a node's *title, description, category, value* or
  *position* spawns a worker and evaluates up to 512² pixels even though `toTerrainGraph` output —
  and therefore the height field — is unchanged. Dragging nodes inside a custom-texture tab has the
  same effect. A signature over the compiled graph (`JSON.stringify(toTerrainGraph(nodes, edges))`
  plus world/size/extent) as the dependency would make the preview respond only to things that
  change the terrain, and would also silence the `F10` lint warning honestly.
- **R2 — status flickers.** `setStatus("Regenerating…")` runs at *every* effect invocation, so a
  burst of keystrokes flips the overlay text repeatedly even though only one generation will run.

**R1 is a P2 — performance agent.**

### F7 — Worker failures — **closed except R3**
`exportHeightmap` now has a single idempotent `settle()` (clears the watchdog, terminates the
worker, nulls `exportWorkerRef` only if it is still *this* worker, always resets `exporting`), a
60 s watchdog, `settled` guards on both handlers, and unmount cleanup. `WorldView` has
`release()` + watchdog + `onerror`. The "late message from a replaced worker nulls the new worker's
ref" hazard is gone via the `exportWorkerRef.current === worker` identity check.

Residuals:

- **R3 — no `onmessageerror`.** A structured-clone/transfer failure posts nothing and fires
  `onmessageerror`, not `onerror`; the watchdog catches it eventually (20 s / 60 s), which is a long
  silent wait for a failure that is usually instant. One handler each.
- **R4 — the watchdog can be overwritten mid-flight.** If the 60 s export timeout fires while
  `await canvas.toBlob(...)` or `await exportPng(...)` is still pending, `settle()` resets state and
  shows the timeout message; the awaited continuation then completes and its `finally { settle(); }`
  plus `setProjectMessage(saved ? "Heightmap exported" : "Export cancelled")` overwrite that message.
  The write may actually have happened, so this is a *message* bug, not a data bug — guard the
  post-await branch on `settled`.

**P2 — performance agent.**

### F8 — One action, two undo steps when switching noise model — **fixed**
`changeNoiseType` (`App.tsx:1222`) calls `updateSelectedNode("noiseType", …)` then
`updateSelectedNode("textureId", …)`. `propertyEditRef` is keyed `nodeId:field` (L~1160), so the
second call records a second history entry. Picking a custom texture costs two undos.

Also, switching **from** a custom texture back to a standard noise updates only `noiseType`
(L~1236), leaving the stale `textureId` on the node — written to the file, and it decides what the
inspector dropdown shows for a node that is no longer custom.

Fix: clear `textureId` when the value is not a custom id, and set both fields inside one history
transaction. **P1 — UI (edit path) + performance (history helper).**

### F9 — `Ctrl+X` is redo, and the shortcut set is Windows-only — **closed**
The keydown effect (L~1385–1425) maps `Ctrl+Z`→undo, `Ctrl+X`→redo, `Ctrl+C`→copy, `Ctrl+V`→paste.
`Ctrl+X` conventionally cuts; here it is the only redo binding and it is advertised in the tooltip.
No `Ctrl+Y`/`Ctrl+Shift+Z` fallback exists.

Every check reads `event.ctrlKey` only, so on macOS — and `electron-builder.json5` builds a `dmg` —
the entire shortcut set is dead because `Cmd` sets `metaKey`.

Fix: accept `ctrlKey || metaKey`, add `Ctrl+Y`/`Ctrl+Shift+Z`, and keep `Ctrl+X` as an alias only
until a real cut action exists (U35). Note the ownership wrinkle: the handler is in `App.tsx` but
the tooltips advertising the keys are UI JSX, and the UI agent's rules say shortcuts must not
change — so this needs an explicit agreement in `AGENT_SYNC.md`, not a silent edit. **P1.**

### F10 — `WorldView` hides a real dependency (`react-hooks/exhaustive-deps`)
The effect reads `world.minY/maxY/seaLevel` but depends on those primitives instead of `world`,
which is a fresh object literal from the parent on every render. Listing `world` would re-run work
on every render; listing the primitives is *correct* but leaves the warning. F6's R1 signature
fixes the root cause and the warning together. **P1 — performance agent.**

### F11 — `projectDocument`/`projectText` rebuilt on every render
`App.tsx:805–812` builds the document and `JSON.stringify`s it on every render, so `saveProject`'s
dependencies (`L937`) change on every keystroke — `JSON.stringify` of the whole graph per keystroke,
on top of whatever the preview does.

Fix: `useMemo` the document on `[nodes, edges, minY, maxY, seaLevel, customTextures, projectName,
previewResolution, previewExtent]`, then `useMemo` the string on the document. Gives F5 its
canonical baseline as a side effect. **P1 — performance agent.**

### F12 — Parameter validation only covers the reachable subgraph
`compileGraph` (`terrainEngine.ts:26`) cycle-checks **all** nodes (`graph.nodes.forEach(checkCycle)`)
but the type/parameter checks live in `visit`, which only walks what the output depends on. A
disconnected `noise` node with `scale: -1` or `seed: 1.5` compiles cleanly and only explodes when
wired in. Inconsistent, and it weakens F4's save-time validation. **P2 — integration
[gated: parity-neutral, but their file].**

### F13 — `.terrain` accepts world settings the engine rejects — **fixed**
`parseProject` (`src/project.ts:~33`) checks only that `minY/maxY/seaLevel` are finite numbers, so
`maxY === minY` or `maxY < minY` parses; `evaluateHeightField` then throws "World height settings
are invalid", and the plugin refuses the project outright (it requires `-64/319` and an integer sea
level). Add the ordering/integer checks at parse time so the message names the file.
**P2 — performance agent (`project.ts` is unclaimed) or integration by agreement.**

### F14 — `main.tsx` crashes outside Electron — **fixed**
`src/main.tsx:14` calls `window.ipcRenderer.on(...)` unconditionally, so a plain browser (bare
`vite dev`, a preview harness, or any future web build) throws before React mounts — a white screen.
Guard with `window.ipcRenderer?.on?.(...)`, or drop the template-residue `main-process-message`
handshake entirely (it only logs a timestamp, `electron/main.ts` `did-finish-load`). **P2 —
unclaimed, one line.**

### F15 — `beforeunload` is not a close prompt in packaged Electron — **closed**
`projectDirty` arms a `beforeunload` listener (`App.tsx:~814–821`). Electron honours the prevention
**silently**: the user clicks X, the window does not close, nothing explains why. There is no
main-process `close` handler and no `dialog.showMessageBox`. Fix belongs with U36 and cannot be done
from the renderer alone. **P2 — unclaimed.**

### F16 — Export silently downgrades resolution — **closed**
`exportHeightmap` posts `size: previewResolution`, i.e. 128/256/512, although
`evaluateHeightField` accepts up to 1024 and the button tooltip says "at the World View resolution".
There is no hint the PNG is at preview resolution. See U30. **P2 — performance agent.**

### F17 — `seaLevel` has no in-app effect — **closed**
Verified by search: `seaLevel` is stored, finiteness-checked (`terrainEngine.ts:~206`), restored,
saved, forwarded to the plugin — and never used in rendering or sampling. In the app it is a form
field with zero feedback; in Minecraft it matters. Draw it (U4/U26) or label it "export only".
**P2 — UI.**

---

## Optimizations

### O1 — Inspector preview is a third maths implementation — **cost fixed, duplication open**
Two problems in `TexturePreview` (`App.tsx:403`).

**Fixed:** the sampled field is now cached in `fieldRef` per `type:size` (L~451–464), so dragging or
zooming the relief sketch redraws the cached field instead of resampling 32,400 points per pointer
move. That was the main-thread jank; it is gone. Verified by reading the effect.

**Open — duplication.** `sampleNoise` (L~337–401) is still a separate noise implementation: its own
`Math.sin` hash (`hash2d`), its own octave structure, and a `climate(frequency, seed)` blend for the
Minecraft types. The integration agent has since raised the climate sample's frequency so the
"flat blue block" is gone, but the underlying truth remains: the inspector teaches different maths
from the evaluator, and every noise change now has to be made in three places
(`terrainEngine.ts`, the Java template, and this function).

Fix: export the engine's per-type sampler (or a thin `sampleNoiseForPreview` wrapper) and use it
here — the preview becomes honest by construction, `hash2d`/`smoothNoise` become dead code (O9),
and no node-graph behaviour changes. **[gated: exporting from `terrainEngine.ts` is integration's
file; the call-site swap in `App.tsx` is UI/performance's.]**

### O2 — `isValidConnection` is O(E) per pointer move, three times over
`isValidConnection` (L~1030) runs during a connection drag, i.e. on every pointer move: two full
`edgesRef.current.some(...)` scans plus a BFS over every edge for the cycle test, with a fresh `Set`
per call. On a 500-edge graph that is thousands of operations and a garbage object per pointer
sample.

Fix: keep an adjacency `Map<source, target[]>` and a per-target input count in a ref, rebuilt when
`edges` changes, and use it for both the duplicate check and reachability. Same return value.
**P1 perf — performance agent.**

### O3 — The engine allocates a `Map<string, number>` per pixel
`evaluateHeightField` (`terrainEngine.ts:~212`) reuses one `samples` Map but keys it by node **id
strings**: a hash + bucket lookup for every input of every node of every pixel, millions of string
hashes per 512² preview. The Java side uses plain locals (`v0`, `v1`, …) precisely because it runs
inside chunk generation.

`compileGraph` already returns a topologically sorted node array. Assign each node a numeric index
and use a `Float64Array` register file: same arithmetic, same order, no string traffic. Parity is
preserved by construction and provable with `run-parity.mjs`. **Measured correction:** the
performance agent timed a 512² render at **61 ms**, so this is a real but modest win, not the
"millions of hashes per preview" cost I implied in v1 — and `O4`/`O5` are smaller still. Size it
accordingly; it is not urgent. **P2 perf — integration [released claim, parity condition applies].**

### O4 — Per-sample closure allocation in the gradient noises
`perlinSample` creates a `dot` closure and `simplexSample` a `corner` closure on every call — four
per octave, sixteen per sample — and `gradientIndex` re-hashes to pick a gradient used immediately.
Inline them and hoist the lookup. Mechanical, no arithmetic change.
**P2 perf — integration [gated].**

### O5 — `cellularSample` does 18 hashes where 9 would do
Each of the 9 neighbour cells hashes `hash(cx, cz, seed)` and `hash(cx, cz, seed + 1)`, repeated per
octave. Cache the pair per cell per octave in locals before the distance loop. **P2 — integration
[gated].**

### O6 — Heightfield → `ImageData` conversion runs on the main thread
`WorldView`'s `onmessage` loops over `values.length` doing two divisions and three writes per pixel,
then `putImageData` — 262k iterations at 512² immediately after a worker message, i.e. a dropped
frame exactly when the user is watching. The worker already owns the array; transferring a filled
`Uint8ClampedArray` (or filling `ImageData` in the worker via `OffscreenCanvas`) removes the
main-thread pass. **P2 perf — performance agent + integration (protocol) [gated].**

### O7 — Undo history stores 100 full deep copies
`recordHistory` (L~855) `structuredClone`s the whole graph, capped at 100 entries (L860).
`parseProject` permits 10,000 nodes and 50,000 edges, so the realistic worst case is gigabytes of
retained snapshots. Cap by estimated bytes, and store `projectGraph()`-shaped minimal objects rather
than full React Flow nodes. **P2 — performance agent.**

### O8 — The cut tool measures every edge path
`finishCut` (L~1320) calls `getTotalLength()` and walks each edge path in 4-px steps at mouse-up,
for all edges, regardless of where the stroke went; `cutStrokeRef` also accumulates a point per
`pointermove`. Cull by bounding box against the stroke's bbox, decimate the stroke to ~4 px, cap its
length. **P3 — performance agent.**

### O9 — `hash2d`/`smoothNoise` should not exist
Once O1 lands, the `Math.sin` hash, `smoothNoise` and `sampleNoise` (~L337–401) are dead code that
duplicates the engine with different constants — and invites "fixing" the preview by editing the
wrong maths. **P3 — UI.**

### O10 — One 1,809-line component re-renders everything
`App.tsx` holds all state: graph, project I/O, history, clipboard, cut tool, world settings,
preview, export, inspector, and all JSX. Every keystroke re-renders the tree, including the React
Flow canvas, the library list and both sidebars — which is why F6/F11 hurt more than their
algorithmic cost suggests.

Minimal split, no new dependencies, no behaviour change: extract `WorldView`, `TexturePreview` and
the inspector as memoised components with narrow props, and hoist the world-settings/history refs
into hooks. Do this **after** F11 and R1, and coordinate with both agents since the file is shared.
**M — UI + performance.**

---

## Tooling, docs and repo hygiene

### T1 — No `typecheck` or `test` script — **fixed** (`typecheck`, `build:renderer`, `test`)
`package.json` has `dev`, `build`, `lint`, `preview`. Add
`"typecheck": "tsc -p tsconfig.json --noEmit"` — the exact command everyone types by hand — so CI
and hooks can use it. **P2.**

### T2 — Java tests are not wired to npm — **partly fixed** (`mcreator-plugin/tests/run-parity.mjs` now exists in-repo)
`mcreator-plugin/tests/TerrainCompilerTest.java` and `NoiseParityTool.java` only run through the
disposable workspace workflow (now `node .freebuff/plugin-build/run-parity.mjs`). A
`npm run test:plugin` would make the parity contract checkable from the app repo root. **P2 —
integration.**

### T3 — `README.md` is the stock Vite template — **fixed** (real project docs)
It documents neither the app, the scripts, the `.terrain` format, the plugin, nor the known
limitations. **P2 — unclaimed.**

### T4 — `mcreator-plugin/README.md` is stale about noise types
Its Limitations section still says only `value`, `ridged` and `minecraft-continentalness` export,
while `TerrainCompiler.NOISE_TYPES` accepts nine and the integration agent reports all nine passing
parity. As of this read the README has not been updated. **P2 — integration.**

### T5 — Packaging metadata is still placeholder — **fixed** (appId, productName, icon)
`electron-builder.json5`: `appId: "YourAppID"`, `productName: "YourAppName"`; the window icon is
`electron-vite.svg` (`electron/main.ts`). Installer artefact names, user-data paths and OS
integration all derive from those. **P2 — unclaimed.**

### T6 — `.gitignore` misses the Electron build output — **fixed**
`dist` is ignored; `dist-electron` and `release` are not, so a local package build leaves untracked
build products that look like sources. Add `dist-electron`, `release`, and `mcreator-plugin/dist`.
**P3 — unclaimed.**

### T7 — `noUncheckedIndexedAccess` would pay for itself
The hot loops index `values[i]`, `GRADIENTS[...]`, `image.data[i*4]` and `samples.get(id)!` with
non-null assertions that are correct today but unverified. Enabling the flag finds the real ones;
expect a handful of mechanical fixes in `terrainEngine.ts`. **P3 — integration [gated].**

---

## Cross-cutting risk worth stating once

There are **three** implementations of the same noise maths:

1. `src/terrainEngine.ts` — reference evaluator (preview + PNG export).
2. `TerrainCompiler` + `TerrainStudioWorldgen.java.template` — the in-game result.
3. `App.tsx`'s `sampleNoise` — the inspector thumbnail.

(1) and (2) are held together by review plus `run-parity.mjs`. (3) is checked against nothing, and
it is the one users stare at while tuning a node. Closing O1 (drive it from the engine) and T2
(run the parity tool from npm) retires the class of bug behind "the preview doesn't look like my
world" — the most expensive bug this project can ship, because it looks like a physics problem and
is actually a duplication problem.

---

## Changelog of this file

- **v1** — first read: `tsc` clean, lint failing with 2 errors + 2 warnings. F1–F17, O1–O10 as open.
- **v2 (this version)** — re-read after the integration noise release and the performance first
  pass. `tsc` still clean; lint now **3 errors + 2 warnings**, including a new `prefer-const` error
  at `App.tsx:981`. F6, F7 and the cost half of O1 are marked fixed with named residuals. All line
  anchors refreshed against `App.tsx` at 1,809 lines, `terrainEngine.ts` at 232, `project.ts` at 71.
  Ownership note updated: `terrainEngine.ts` claim released with the parity condition.
- **v3** — platform pass by the audit agent. Fixed: **F1** (lint gate green), **F4** (save compiles
  the graph), **F8** (one undo step + stale `textureId` cleared), **F13** (`maxY <= minY` rejected at
  parse), **F14** (`main.tsx` safe outside Electron), **T1**, **T3**, **T5**, **T6**, and `F2`/`F5`/
  `F11` (performance agent). `F6`/`F7` remain fixed-with-residuals. Re-verified: `npm run typecheck`
  exit 0, `npm run lint` exit 0, `npm run build:renderer` exit 0. Not verified: packaged app,
  Electron window, parity harness.
- **v4** — packaging verified end-to-end with `electron-builder --dir`: exit 0, `Terrain Studio.exe`
  produced, no default-icon warning after adding `build/icon.png` (512², generated from the app's
  mountain mark) and `public/icon.png` for the window. 19 `node:test` cases added (`npm test`), and
  `.github/workflows/ci.yml` now runs typecheck, lint, test and `build:renderer` on every push/PR.
  `T5`, `T2` and `U40` closed or partly closed accordingly; `release/` was deleted after the check
  because it is a 262 MB regenerable artifact and is gitignored.
- **v5** — re-audited after the UI agent's shaded-relief and sea-level batch. `U4`/`U26`/`U27`
  and `F17` closed (water tint plus a Water cover metric; coastline length not built), `U5`, `U27`,
  `U35` done, `U29` pruned as already true, `U30` re-scoped to format-gated, `U38` claimed by the
  performance agent. `F6`/`F7`/`F9`/`F15`/`F16`/`F17` and `T1`/`T3`/`T5`/`T6` are all closed. Still
  open: `F3`, `F7-R3`, `F12`, `O1`–`O6`, `O9`, `O10`, `T2`, `T4`, `T7`.
- **v6** — full NSIS packaging verified: `electron-builder --win nsis` exit 0, producing
  `release/0.1.0/Terrain Studio-Windows-0.1.0-Setup.exe` (78 MB, unsigned). The first attempt failed
  inside 7-Zip with every entry reported as missing; the files and `7za` were both fine, and the
  retry succeeded, so it was a transient file lock (the stale `.7z` was still held when the
  directory was removed). Also removed a duplicate `typecheck` script key that had crept in from
  concurrent edits.
