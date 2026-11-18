# Terrain Studio

A desktop editor for procedural Minecraft terrain. Build a height graph, preview it as a shaded map or a
rotatable 3D surface, export it as a heightmap PNG, or export a `.tsmc` integration package that Minecraft
evaluates at runtime — for a replaced Overworld, a custom dimension, or a complete world preset.

![CI](https://github.com/vipereditzyt1-tech/MC-TerrainStudio/actions/workflows/ci.yml/badge.svg)

- **Graph editor** — 28 node types across six groups (Input, Generation, Combine, Shape, Distort, Output),
  edited on a pannable canvas with a node library and an inspector.
- **Live preview** — evaluated in a worker, debounced and cancellable, falling back to the last good
  heightmap when generation fails or times out.
- **Two views of the same field** — shaded relief with tinted water below sea level, plus a 3D surface you
  can orbit and zoom.
- **Real exports** — grayscale heightmap PNG (one pixel per sample) and a `.tsmc` package the MCreator
  plugin compiles into a Minecraft density function.
- **Same arithmetic everywhere** — preview, PNG and Minecraft export run identical maths, checked by a
  TypeScript↔Java parity harness.

## Requirements

- Node.js 22.6 or newer for the test suite (it uses `node --test --experimental-strip-types`); Node 18+ is
  enough to build and run the editor.
- Windows to produce the packaged installers. The editor itself is plain Electron and runs anywhere npm does.
- MCreator 2026.2 only if you want to build the MCreator plugin (it compiles against MCreator's own bundled
  JDK).

## Build and run

```bash
npm install
npm run dev              # Electron window with Vite hot reload
npm run build            # typecheck, bundle, package the desktop app
```

`npm run build` writes three Windows artifacts into `release/<version>/`:

| Artifact | Use it when |
| --- | --- |
| `Terrain Studio-Windows-<version>-Setup.exe` | Normal install. NSIS, per-user, changeable install directory, Start-menu entry. |
| `Terrain Studio-Windows-<version>.msi` | Managed deployment (Intune, group policy, `msiexec /i`), and anything that expects a Windows Installer package. |
| `Terrain Studio-Windows-<version>-Portable.exe` | One file, no installation — a USB stick or a locked-down machine. |

The app loads its own `app.asar` bundle, so every artifact runs standalone without Node.js installed.
They are unsigned, so Windows SmartScreen warns on a machine that has not seen them before.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server plus the Electron window |
| `npm run build` | Typecheck, bundle renderer/main/preload, then run electron-builder |
| `npm run build:renderer` | Typecheck and bundle only (no packaging) |
| `npm run typecheck` | `tsc --noEmit` over `src` and `electron` |
| `npm run lint` | ESLint over TypeScript and TSX |
| `npm test` | `node:test` suites: project format, engine invariants, Minecraft export |
| `npm run test:plugin` | Build the MCreator plugin, run the Java compiler/installer test, then TS↔Java parity |
| `npm run preview` | Serve the last bundle with Vite |

## Editor

The node palette is split into six collapsible groups with 28 node types. Ten noise models are available —
`value`, `ridged`, `perlin`, `simplex`, `cellular`, `wave`, and the `minecraft-*` climate approximations —
and every model is mirrored exactly in the MCreator exporter.

| Action | Shortcut |
| --- | --- |
| Undo | `Ctrl+Z` (text fields keep their native undo) |
| Redo | `Ctrl+X` |
| Pan the graph | Drag empty canvas / scroll |
| Orbit the 3D surface | Drag |
| Zoom the preview | Scroll |

Pitch in the World View runs from 8° (almost level with the terrain) to 88° (nearly straight down).
Projects are saved as `.terrain` JSON. **Export PNG** writes a grayscale heightmap with one pixel per
sample.

The project menu in the left sidebar holds two documents: **Terrain Graph** (the graph editor) and
**World Settings**, which owns the global build range, sea level and the dimension-type fields written for
custom dimensions and world presets (logical height, coordinate scale, ambient light, skylight, bedrock
ceiling). Custom textures are saved sub-graphs: a custom-texture noise node inlines the texture's graph into
its parent, so the preview, the PNG and the Minecraft export all run the same arithmetic.

## MCreator integration

The reusable plugin lives in `mcreator-plugin/` and is documented in
[`mcreator-plugin/README.md`](mcreator-plugin/README.md). Build it against your MCreator install:

```bash
node mcreator-plugin/build.mjs --mcreator "<path to MCreator install>"
```

That writes `mcreator-plugin/dist/terrain-studio.zip`; `npm run plugin:bundle` also refreshes the copy the
installers embed at `build/mcreator-plugin/terrain-studio.zip`.

The Windows installers carry that copy as a resource and the app installs it into
`%USERPROFILE%\.mcreator\plugins` on launch (only when a `.mcreator` folder exists, and only when the
copy differs), so a fresh install needs no manual step. Windows will not replace the zip while MCreator
holds it open, so a plugin update lands the next time the app starts with MCreator closed.

From then on the two programs talk directly: **Send to MCreator** in the Minecraft panel hands the package
to the plugin through `%USERPROFILE%\.terrainstudio\handoff`, and the open workspace asks for confirmation
without any file dialog — a package sent while MCreator is closed is offered the next time a workspace
opens. MCreator's own **Terrain Studio → Launch Terrain Studio** menu item starts the editor, and
**Import Terrain Studio package…** remains for files you already have. For a development build, copy
`mcreator-plugin/dist/terrain-studio.zip` into the plugins folder yourself and restart MCreator.

The plugin validates the package, lists the files it will create or replace, backs up anything it replaces,
records SHA-256 hashes and refuses to overwrite files edited outside Terrain Studio. **Roll back last
import** restores the previous state.

Three modes share the same generated density function:

- **Overworld replacement** — replaces the `overworld`, `large_biomes` and `amplified` noise settings.
- **Custom dimension** — writes a dimension, dimension type and noise settings under your namespace.
- **World preset** — writes the same dimension data plus a `world_preset` entry, keeping vanilla Nether
  and End so the preset is a complete world.

Every graph node is either compiled into the runtime or reported as unsupported; nothing is silently
dropped. Legacy `.terrain` projects import as Overworld mode. Display names are package metadata;
Minecraft's dimension name comes from its resource ID.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/editor/` | React app: `App.tsx`, palette (`nodeCatalog.ts`), inspector parameter table (`nodeFields.ts`), styles |
| `src/engine/` | Terrain engine and the preview worker — the single source of terrain semantics |
| `src/project/` | `.terrain` document format, graph conversion and validation |
| `src/minecraft/` | `.tsmc` export compiler, MCreator validation, world presets |
| `src/world/` | World View, 3D surface renderer, World Settings panel |
| `electron/` | Main process, `ipc.ts` contract, preload bridge |
| `mcreator-plugin/` | Reusable MCreator plugin: compiler, installer, Java template, tests |
| `tests/` | Dependency-free `node:test` suites for the engine, project format and export |
| `build/`, `public/` | Packaging icon and renderer assets |
| `.github/workflows/ci.yml` | Typecheck, lint, tests and bundle on every push and pull request |
| `.github/workflows/release.yml` | Tagged builds: all three Windows installers plus `SHA256SUMS.txt`, attached to the release |

## Extending it

The pieces you are most likely to touch are each in one place:

- **A new node kind** — add a palette entry in `src/editor/nodeCatalog.ts` (title, group, defaults), the
  arithmetic in `src/engine/terrainEngine.ts`, and either an inspector section in
  `src/editor/App.tsx` or one row in the `parameterFields` table in `src/editor/nodeFields.ts`. The
  MCreator compiler reports anything it cannot compile as unsupported rather than dropping it.
- **A new desktop capability** — add the channel name and the method signature to `electron/ipc.ts`, the
  handler in `electron/main.ts`, and the forwarding call in `electron/preload.ts`. The renderer's
  `window.terrainProjects` type comes from that same contract, so a mismatch is a compile error.
- **A new world setting** — `WorldSettings` in `src/engine/terrainEngine.ts` plus the panel in
  `src/world/WorldSettingsPanel.tsx`; the project format validates it in `src/project/project.ts`.
- **A visual change** — the palette and type tokens live in `src/editor/index.css`; component rules
  live in `src/editor/design.css`, which loads after `App.css` and overrides it. `App.css` holds the
  original layout layer; new styling belongs in `design.css` so the identity stays in one file.
- **A release** — push a `v*` tag. The release workflow runs the same gates as CI, builds all three
  installers and publishes them with checksums.

## Verification

- `npm run typecheck` and `npm run lint` must both be clean; CI runs them with `npm test` and
  `npm run build:renderer`.
- `npm test` runs the `node:test` suites: format parsing, engine validation/clamping/determinism, the
  extended node set, custom-texture inlining and export-package validation (44 tests).
- `npm run test:plugin` builds the plugin, compiles and runs `TerrainCompilerTest` (all three integration
  modes, install/update and conflict protection), then compares 25 height samples per noise type between
  the TypeScript engine and the generated Java. Add `-- --mcreator "<install>"` when MCreator is not in a
  default location.
- **Live NeoForge 26.1.2 server checks:** all three modes generate Terrain Studio terrain. Overworld
  replacement reports `wired=true`; a custom dimension loads at its own height range and matches
  `TerrainStudioWorldgen.height(x, z)` at positive and negative coordinates; a world preset selected with
  `level-type` drives the real Overworld with vanilla Nether and End present.
- **Not verified live:** 1.21.1 dimensions and presets (compiled and parity-tested, but never generated on
  a running server), world creation through the MCreator GUI, and the plugin's menu action itself (its
  compiler and installer paths are tested). Vanilla biome carvers can still cut a "no density caves" world.
