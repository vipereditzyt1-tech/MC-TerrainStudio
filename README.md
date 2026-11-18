# Terrain Studio

A desktop editor for procedural Minecraft terrain. Build a height graph, preview it in the app, export it
as a heightmap PNG, or export a `.tsmc` integration package for MCreator. Minecraft then evaluates the
compiled graph at runtime for a replaced Overworld, a custom dimension, or a complete world preset.

## Requirements

- Node.js 18+ and npm.
- Windows with MCreator installed for the plugin build path (the build script compiles against
  MCreator's own bundled JDK). The editor itself is plain Electron and runs anywhere npm does.

## Editor

```bash
npm install
npm run dev      # Electron window with Vite hot reload
npm run build    # type-check, bundle, then package the desktop app with electron-builder
npm run lint
npm run typecheck
npm test         # node:test: .terrain parser + terrain-engine invariants
```

`npm run build` writes two Windows artifacts into `release/<version>/`:
`Terrain Studio-Windows-<version>-Setup.exe` (NSIS installer, per-user, changeable install directory) and
`Terrain Studio-Windows-<version>-Portable.exe` (one file, no installation). The app loads its own
`app.asar` bundle, so either artifact runs standalone without Node.js installed.

The node palette is split into six collapsible groups — **Input**, **Generation**, **Combine**, **Shape**, **Distort** and **Output** — with 28 node types. Ten noise models are available
(`value`, `ridged`, `perlin`, `simplex`, `cellular`, `wave`, and the `minecraft-*` climate approximations);
every model is mirrored exactly in the MCreator exporter. `Ctrl+Z` undoes, `Ctrl+X` redoes, and text
fields keep their native undo. Projects are saved as `.terrain` JSON, and `Export PNG` writes a
grayscale heightmap with one pixel per sample.

Previews are evaluated in a worker (`src/terrainWorker.ts`), debounced, cancellable, and fall back to
the last good heightmap if generation fails or times out. The World View draws shaded relief with
tinted water below sea level and can switch to a rotatable 3D surface of the same field; exported PNGs stay
plain grayscale.

The project menu in the left sidebar holds the two documents: **Terrain Graph** (the graph editor) and
**World Settings**, which owns the global build range, sea level and the dimension-type fields written for
custom dimensions and world presets (logical height, coordinate scale, ambient light, skylight, bedrock
ceiling). Custom textures are saved sub-graphs: a custom-texture noise node inlines the texture's graph into
its parent, so the preview, the PNG and the Minecraft export all run the same arithmetic.

## MCreator integration

The reusable plugin lives in `mcreator-plugin/` and is documented in
[`mcreator-plugin/README.md`](mcreator-plugin/README.md). Build it with:

```bash
node mcreator-plugin/build.mjs --mcreator "<path to MCreator install>"
```

That writes `mcreator-plugin/dist/terrain-studio.zip`. Install it through
`%USERPROFILE%\.mcreator\plugins`, open a NeoForge workspace and use
**Terrain Studio → Import Terrain Studio package…**. The plugin validates the package, shows its files,
backs up anything it replaces, records SHA-256 hashes and refuses to overwrite files edited outside
Terrain Studio. **Roll back last import** restores the previous state.

Three modes share the same generated density function:

- **Overworld replacement** — replaces `overworld`, `large_biomes` and `amplified` noise settings.
- **Custom dimension** — writes a dimension, dimension type and noise settings under your namespace.
- **World preset** — writes the same dimension data plus a `world_preset` entry, keeping vanilla
  Nether and End so the preset is a complete world.

Every graph node is either compiled into the runtime or reported as unsupported; nothing is silently
dropped. Legacy `.terrain` files still import as Overworld mode. Display names are package metadata;
Minecraft's dimension name comes from its resource ID.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | React editor, terrain engine, preview worker, project format |
| `electron/` | Electron main process, preload bridge, file and PNG dialogs |
| `mcreator-plugin/` | Reusable MCreator plugin: compiler, installer, Java template, tests |
| `AGENT_SYNC.md` | Coordination notes and ownership for the agents working in this repo |
| `POTENTIAL_UPGRADES.md`, `FIXES_AND_OPTIMIZATIONS.md` | Audit notes and backlog |

## Verification

- `npm run typecheck` and `npm run lint` must both be clean.
- `npm run test:plugin` builds the plugin, runs the Java compiler/installer test and then the
  TS↔Java parity harness in one go (add `-- --mcreator "<install>"` if MCreator is not in a default
  location).
- `npm test` runs the dependency-free `node:test` suites in `tests/` (format parsing, engine
  validation/clamping/determinism, the extended node set, custom-texture inlining and export-package
  validation; 44 tests). It needs Node 22.6+ for
  native type stripping.
- `node mcreator-plugin/tests/run-parity.mjs` compiles the TypeScript engine and the generated Java for
  every noise type plus the extended node set and an inlined custom texture, comparing 25 height samples
  per case (needs the local MCreator install and
  `.freebuff` Minecraft caches).
- `mcreator-plugin/tests/TerrainCompilerTest.java` covers compiler validation, all three integration
  modes, install/update and conflict protection.
- **Live NeoForge 26.1.2 server:** all three modes generate Terrain Studio terrain. Overworld replacement
  reports `wired=true`; a custom dimension loads at its own height range and matches
  `TerrainStudioWorldgen.height(x, z)` exactly at positive and negative coordinates; a world preset chosen
  with `level-type` drives the real Overworld with vanilla Nether and End present. A fixed carver-free
  biome gives grass-over-dirt-over-stone surfaces at the graph heights.
- **Not verified live:** 1.21.1 dimensions/presets (compiled and parity-tested), world creation through
  the MCreator GUI, and the plugin menu action itself (its compiler/installer path is tested). Vanilla
  biome carvers can still cut a "no density caves" world.
- `.freebuff/` holds disposable MCreator homes, NeoForge workspaces and server probe logs used for
  integration testing. Nothing there is packaged or required to run the app.
