# Potential future upgrades — Terrain Studio

Review-only backlog. **Nothing in this file is implemented.** It was written by the 4th agent
(audit / review) on 2026-11-18 from a full read of `src/**`, `electron/**`, `mcreator-plugin/**`
and the project/tooling config, then refreshed after the integration noise release and the
performance agent's first pass landed. No code was changed to produce it.

Line references were accurate against `src/App.tsx` at 1,809 lines, `src/terrainEngine.ts` at 232
and `src/project.ts` at 71. Other agents are editing those files, so **anchor on the function name**
if a number has drifted.

Sibling document: `FIXES_AND_OPTIMIZATIONS.md` (defects, regressions and speed work).

How to use this file:

1. Pick an item by id (`U…`).
2. Check its **Area** against the ownership table in `AGENT_SYNC.md` before starting.
3. Claim it in `AGENT_SYNC.md`, then move the item into the fixes file or a normal issue once it
   is scheduled.

Effort is a rough size, not an estimate: **S** ≈ under a day, **M** ≈ a few days,
**L** ≈ a week or more, **XL** ≈ needs a design pass first.

Items that would desync the TypeScript evaluator from `mcreator-plugin`'s generated Java are
marked **[parity]**: they are only safe with the integration agent's sign-off and a rerun of the
bit-identical parity harness.

---

## Shortlist (best value first)

Ids point at the detailed entry in this file, or at the sibling document where the item is really
a defect/optimization rather than a feature.

| Item | Why now | Impact | Effort | Area |
| --- | --- | --- | --- | --- |
| **O1** (fixes doc) — inspector preview from the real sampler | It is a *third* noise implementation that disagrees with the output | High | S | UI + integration **[gated]** |
| **U16** — graph validation panel with jump-to-node | Errors arrive as one status string; users can't find the bad node | High | M | Integration (enabler) + UI |
| **U30** — export at engine resolution, independent of preview | Export is silently capped at 512² | High | S | Performance |
| **U26** — sea level in the World View | **Done** — water tint plus a Water cover metric | High | S/M | UI |
| **U27** — hillshade + hypsometric tint | Flat greyscale hides relief; in-game looks nothing like the preview | High | M | UI |
| **F6** (fixes doc) — debounced last-good-frame preview | **Already delivered**; residual R1 still wastes a regeneration per display-only edit | High | S | Performance |
| **U41** — graph-level seed with deterministic reseed | Every project is frozen to its node seeds; the world seed has no effect | Medium | M | Integration **[parity]** |
| **U14** — remap / clamp / terrace nodes | Cheapest route from linear maths to terrain that reads as shaped | Medium | M | Integration **[parity]** |
| **U23** — `npm`-runnable golden parity harness | Parity currently runs through a bespoke script in another agent's workflow | Medium | M | Integration |
| **U22** — 3D density (caves, overhangs) | The plugin deletes vanilla caves; this is the real feature gap | Very high | XL | Integration + engine + UI |

---

## 1. Editor and authoring

### U11 — Node duplication, align and distribute
Multi-select + copy/paste already exist (`copySelected` / `pasteClipboard`). What is missing is the
everyday editing layer: duplicate-selection in place, align left/centre/right, distribute
horizontally/vertically, and "tidy graph" (simple layered layout by hop distance from
`coordinates`). All of it is presentation of existing graph data; nothing to mirror in Java.
**S/M — UI agent.**

### U12 — Reusable subgraphs (macros / custom node types)
`customTextures` is already a stored subgraph with its own nodes and edges
(`src/project.ts`, `ProjectTexture`). The obvious upgrade is to make it a real macro node:
compile the subgraph once, expose it in the noise model dropdown, and inline it at export time.
That is a strict superset of the half-built custom texture feature and removes the reason the
noise inspector has a "Custom texture…" option that leads nowhere. Requires an engine entry point
for subgraph evaluation and a mirrored Java inliner. **L — integration + UI. [parity]**

### U13 — Finish or remove custom textures
Today `createCustomTexture` (`src/App.tsx:1198`) creates two nodes **without `data.kind`**, the
tab is read-only, textures can't be renamed or deleted, and save is blocked only while a texture
tab is open. Whatever is decided, the current half-state is the worst of both options:
finish it (U12) or drop it from the node library until it works. **S to remove, L to finish — UI.**

### U14 — Remap and shaping nodes
`add` and `multiply` are the only shapers. Practical graph work needs `clamp`, `remap
(inMin..inMax → outMin..outMax)`, `abs`, `terrace(steps, offset)` and `pow(exponent)`. Each is a
few lines in `sampleTerrainNoise`'s neighbour switch *and* a mirrored branch in
`TerrainCompiler`'s expression switch — trivial maths, but it must land in both files in the same
commit. **M — integration. [parity]**

### U15 — Node mute / solo
Previewing a subtree without deleting it is the single most requested graph-editor affordance.
Mute = exclude from `compileGraph`'s output walk (engine already walks only from the output
node), solo = force the target node to be the output temporarily. UI-only if the session state
stays out of the saved document. **S/M — UI + integration.**

### U16 — Validation panel instead of a status string
There is no place in the UI that lists *all* problems: `compileGraph` throws on the first one,
and the app renders it through `projectMessage` in the bottom bar (`src/App.tsx`, ~L1560). A
panel listing `{nodeId, message, severity}` with click-to-select would make broken graphs
self-service. Enabler: make `compileGraph` optionally collect errors instead of throwing
(`compileGraphDetailed`), keeping the throwing version as a thin wrapper so nothing else changes.
**M — integration + UI.**

### U17 — Comments, notes and canvas frames
Free-text notes attached to a node or a canvas region, stored in the document as a new optional
array (`notes: []`). Must be ignored by the plugin and by `parseProject`'s graph validator so old
files keep loading. **S — UI.**

### U18 — Per-document undo/redo and coalesced transactions
Undo/redo stacks live in `src/App.tsx` only, so custom-texture tabs share nothing, and a single
user action can push more than one entry (see `FIXES_AND_OPTIMIZATIONS.md`, F8). A small
`History<T>` helper keyed by tab would fix both, plus an explicit `transaction()` wrapper for
multi-field edits. **M — UI + performance.**

### U19 — Named checkpoints / in-app version history
Snapshot the current document (and a PNG thumbnail) under `.terrain-studio/history/` next to the
project on save. Pure custom-format work in `electron/**` + a sidebar list; no graph maths.
**M — unclaimed.**
- _Note:_ do **not** add this to the `.terrain` payload — it would break byte compatibility for
  the plugin's reader and for the format contract in `AGENT_SYNC.md`.

---

## 2. Engine and noise

### U20 — Real Minecraft parity for the climate noises
Both implementations rely on the `default` branch for `minecraft-continentalness`
(`src/terrainEngine.ts` `sampleTerrainNoise`, and the `default ->` case in `TerrainCompiler`),
so continentalness, erosion, weirdness and temperature are all "some fractal" today. The plugin
README is honest about this, but it is the biggest gap between "Minecraft-labelled" and
"Minecraft-shaped". Real parity means the continentalness/erosion/peaks-and-valleys splines and
the noise routers used by 1.21.1+, which is a substantial but high-value body of work.
**L/XL — integration. [parity]**

### U21 — Terrain presets
One-click starter graphs that already look like something: "Continental archipelago",
"Ridged highlands", "Rolling plains", "Volcanic islands". Data only — a `presets.ts` module that
returns `{nodes, edges}` and a menu entry that loads it into the current project. Nothing to
mirror in Java because presets are just graphs. **S — UI, with a noise-heavy review by integration.**

### U22 — 3D density (caves and overhangs)
`evaluateHeightField` returns an absolute-Y surface; the plugin turns it into
`height(x,z) - y` and, as a consequence, vanilla caves are removed. Supporting a second output
kind (`density`) that returns a value for `(x, y, z)` would let the plugin keep caves and
overhangs. This is the one upgrade that changes the product category, so it needs a design pass:
node model, `.terrain` version bump, worker protocol, and the plugin's density router.
**XL — integration + engine + UI. [parity]**

### U23 — Golden-file parity harness on the app side
`mcreator-plugin/tests/NoiseParityTool.java` exists, but nothing in `package.json` exercises the
TypeScript evaluator. A `npm run test:parity` that evaluates a fixed set of graphs at fixed
coordinates and diffs against checked-in expected values would catch an engine edit that silently
breaks Java agreement *before* the plugin build. **M — integration.**

### U24 — Cache noise octaves across nodes
`fractal`/`gradientFractal` recompute `valueNoise`/`perlin` for every octave; graphs with several
noise nodes at the same scale and seed repeat identical work. A small memo keyed by
`(noiseType-family, seed, scale, cell)` per pixel row would help dense graphs. Must be a
cache-only change: identical inputs, identical output, so parity is preserved by construction.
**M — integration sign-off required. [parity-safe]**

### U25 — Explicit numerical contract
Document (and test) the float rules both implementations rely on: `double` everywhere, octave
loop order, `Math.imul`/int overflow equivalence, and the fact that **input order is part of the
result** for `add` (float addition is not associative). Right now that contract lives only in
comments. **S — integration.**

---

### U41 — Graph-level seed and "reseed"
Every noise node carries its own integer seed, so a project is frozen: the Minecraft world seed has
no effect (the plugin README lists this as a limitation). A graph-level seed mixed with each node's
seed (`seed ^ graphSeed`, or an additive offset) gives one control that reshuffles a whole terrain
without touching the graph, plus a "lock seed" flag per node for deterministic features. It needs a
new optional document field, an engine parameter, and the same expression in `TerrainCompiler` — so
it is a format change and must be agreed before it is built. **M — integration. [parity]**

---

## 3. Preview and visualisation

### U26 — Sea-level plane and coastline metrics — **done** (water tint + Water cover tile; coastline length not built)
`seaLevel` is written to the file and to `noise_settings.overworld.json` but the app never shows
it: `evaluateHeightField` only validates it. Drawing a translucent plane at
`seaLevel`, plus "land % / water % / coastline length" in `world-metrics`, makes the setting
legible. **S/M — UI.**

### U27 — Shaded relief — **done**
The canvas is flat greyscale (`WorldView`, `onmessage` handler ~L575). A hillshade pass (Sobel gradient + NW light)
and a hypsometric tint make a 10× perceptual difference for the same data, and are cheap: one
extra pass over the already-computed `Float32Array`. Colour belongs to the UI agent, the data
stays put. **M — UI.**

### U28 — 3D terrain preview
`TexturePreview` (`src/App.tsx:403`) already has a "Relief sketch" mode that rotates a mesh of lines,
and the sampled field is now cached per `type:size`, so the rotate/zoom redraw is already cheap. Extending the
same interaction to the real heightfield (WebGL or a wireframe on a 2D canvas) would let users see
what the plugin will build without launching Minecraft. **L — UI.**

### U29 — Preview only what is visible — **not needed** (WorldView unmounts off-tab; performance agent verified)
The World View recomputes on every graph change regardless of which tab is showing. Evaluating
only when the tab is active (and invalidating lazily on return) is a straightforward saving.
**S — performance agent.**

---

## 4. Export and the MCreator bridge

### U30 — Export resolution independent of preview — **format-gated** (`preview.resolution` is part of the shared contract; needs integration)
`exportHeightmap` (`src/App.tsx`, `exportHeightmap` ~L973) posts `size: previewResolution`, so a 512² export is the ceiling even though the engine accepts up to 1024 (`evaluateHeightField` guard). Add an export
resolution control (or an "export at max" option) and widen `ProjectDocument.preview.resolution`
plumbing carefully — note `parseProject` currently hard-rejects anything except `128 | 256 | 512`.
**S — performance agent.**

### U31 — Export a small bundle, not one PNG
The plugin needs the `.terrain` file; users need a PNG preview; a README with the graph summary
would save support round-trips. A "Export pack" action writing `name.terrain`, `name-heightmap.png`
and `name-graph.json` (normalised node list) into one chosen folder is a small main-process
feature. **M — unclaimed.**

### U32 — World-painter / schematic bridge
Beyond `noise_settings`, the natural next integrations are exporting the heightfield into a
schematic or a datapack `worldgen/biome` set. Both are plugin-side and out of scope for the app
format. **XL — integration.**

### U33 — Plugin compatibility surface
`mcreator-plugin/resources/plugin.json` pins `supportedversions` to the single build
`202600233518`, while `TerrainStudioPlugin` guards on `getMCreatorVersion() <= 202500220614L`.
Widening the supported build range (and stating the tested range in `mcreator-plugin/README.md`)
would remove the most likely "plugin silently doesn't appear" report. **S — integration.**

---

## 5. Platform, packaging and workflow

### U34 — Packaging metadata and first-run polish — **done** (appId/productName/icon; still unsigned)
`electron-builder.json5` still ships the template values `appId: "YourAppID"` and
`productName: "YourAppName"`; the window icon points at `electron-vite.svg`. Installer artefact
names, the app ID used for user-data paths and OS integration all derive from those. **S —
unclaimed.**

### U35 — Keyboard surface — **done** (Ctrl/Cmd+S, Shift+S, O, N; Meta everywhere; tooltips updated)
Only `Ctrl+Z/X/C/V` are bound, `Ctrl+X` is *redo*, and nothing binds `Ctrl+S`, `Ctrl+Shift+S`,
`Ctrl+O` or `Ctrl+N` — the four shortcuts every user will try first. Also, the handler reads
`event.ctrlKey` only, so macOS `Cmd` does nothing. Bind both (`event.metaKey || event.ctrlKey`),
add save/open/new, and put the shortcuts in the buttons' tooltips. **S — UI + performance (handler
lives in the keydown effect).**

### U36 — Native menu and window-close flow — **close flow done, menu still missing**
There is no `Menu` in `electron/main.ts`; the app has a File/Edit menu bar with nothing in it, and
closing the window with unsaved changes triggers `beforeunload` in a packaged Electron app, where
Chromium does not show a confirm dialog — the window can appear to refuse to close. A real
`close` handler in the main process with a `dialog.showMessageBox` (Save / Discard / Cancel) is the
correct fix and enables menu accelerators for U35. **M — unclaimed.**

### U37 — Security hardening
`BrowserWindow` has no `sandbox: true`, no `setWindowOpenHandler`, no `will-navigate` guard, and
`index.html` has no CSP. The renderer is local-only today, but a single pasted URL (or a future
"open documentation" link) would navigate the app window away from the app. Add a CSP meta tag, a
navigation guard that defers to `shell.openExternal`, and `sandbox: true` if the preload tolerates
it (it should — it only uses `ipcRenderer` and `contextBridge`). **S — unclaimed.**

### U38 — Automatic recovery / autosave — **claimed by performance agent, in progress**
`beforeunload` is the only protection against loss. A debounced autosave to
`%APPDATA%/Terrain Studio/recovery/<session>.terrain` (written by the main process, offered on
next launch) is standard desktop hygiene and touches no graph code. **M — unclaimed.**

### U39 — Replace the stock README — **done**
`README.md` is still the stock Vite template text. It does not mention the app, the `.terrain`
format, the plugin, the dev commands or the build. This is the cheapest repo-quality win available
and needs no code. **S — unclaimed.**

### U40 — CI that actually gates — **done** (`.github/workflows/ci.yml` runs typecheck, lint, test and build:renderer)
`npm run lint` currently exits non-zero (see `FIXES_AND_OPTIMIZATIONS.md`, F1), there is no
`typecheck` script, no test script and no workflow. A minimal job — install, `tsc --noEmit`,
`vite build`, lint — would have caught every regression listed in the fixes file. **S — unclaimed.**

---

## 6. Explicitly not recommended (yet)

These come up naturally while reading the code; each is listed so it doesn't get re-litigated.

- **A second renderer framework or a state library.** The app's problems are component size and
  recomputation, not state plumbing; see the fixes file F9. Introducing a store now would move the
  churn, not remove it.
- **Bumping React Flow / Vite / Electron "for freshness".** `isValidConnection` and the cut tool
  depend on React Flow internals (`src/App.tsx` queries `.react-flow__edge[data-id]` in the DOM).
  Upgrade deliberately, with the cut tool as an explicit test.
- **Serialising view state (zoom, pan, tab) into `.terrain`.** It would change the format contract
  for no user benefit and force the plugin reader to tolerate new keys.
- **Rendering the preview on the GPU before the sampling shape is fixed.** The bottleneck is the
  per-pixel node walk and object churn, not the draw call.
