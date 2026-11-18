# Terrain Studio — MCreator plugin

A reusable MCreator 2026.2 Java plugin that imports a Terrain Studio integration package (`.tsmc`) into a
NeoForge workspace. Minecraft evaluates the compiled graph as a runtime density function for one of three
modes: **Overworld replacement**, **custom dimension**, or **world preset**. It is not tied to one
workspace, mod ID or project.

## Requirements

- MCreator `2026.2` (built and tested against `2026.2.33518`)
- A workspace using the `NeoForge 1.21.1` or `NeoForge 26.1.2` generator
- A `.tsmc` package exported from Terrain Studio (legacy `.terrain` projects still import as Overworld mode)

## Build

```bash
node mcreator-plugin/build.mjs --mcreator "C:\path\to\MCreator"
```

The script extracts the core classes from `mcreator.exe`, compiles the plugin with MCreator's bundled JDK
and writes `mcreator-plugin/dist/terrain-studio.zip`. `MCREATOR_HOME` can be used instead of `--mcreator`.

## Install

**From the Terrain Studio installers** — nothing to do: the app ships this zip as a resource and writes it
into `%USERPROFILE%\.mcreator\plugins` on launch, skipping machines without a `.mcreator` folder and
leaving an identical copy untouched. **By hand:**

1. Close MCreator.
2. Copy `terrain-studio.zip` into `%USERPROFILE%\.mcreator\plugins\` (keep it zipped).
3. Start MCreator. If it warns that Java plugins are disabled, allow them in the dialog/Preferences and
   restart — MCreator blocks third-party Java plugins by default.
4. Open the target workspace.
5. Use **Terrain Studio → Import Terrain Studio package…**.

MCreator asks for confirmation before writing anything. The plugin validates the package, lists the files
it will create or replace, backs up replaced files, and refuses to overwrite files it does not own or that
were edited outside Terrain Studio. **Validate package…** checks compatibility without writing, and
**Roll back last import** restores the previous state and clears the manifest.

## What the import writes

| Path | Purpose |
| --- | --- |
| `src/main/java/net/terrainstudio/generated/TerrainStudioWorldgen.java` | Density function that evaluates the graph per column |
| `src/main/resources/data/minecraft/worldgen/noise_settings/{overworld,large_biomes,amplified}.json` | Overworld mode: vanilla settings with the terrain router replaced |
| `src/main/resources/data/<ns>/worldgen/noise_settings/<path>.json` | Dimension/preset mode: same router at the package's height range |
| `src/main/resources/data/<ns>/dimension_type/<path>.json` | Dimension height, sea level and environment |
| `src/main/resources/data/<ns>/dimension/<path>.json` | Noise generator using the graph settings |
| `src/main/resources/data/<ns>/worldgen/world_preset/<path>.json` | Preset mode: custom Overworld plus vanilla Nether and End |
| `.terrain-studio/installed.json` | SHA-256 ownership record, mode and backup path |

Imported files are marked as tracked generated files, so MCreator regenerates them as usual without
deleting them. Re-importing updates owned files; importing after manually editing one fails with a
conflict instead of discarding the edit.

## How the runtime works

`final_density` becomes `height(x, z) - y`, so a block is solid exactly below the graph's surface. The
rest of the vanilla settings file is preserved: biomes, aquifers, ore veins and spawn targets still come
from Minecraft. Minecraft 26.1.2 additionally uses `preliminary_surface_level`, which points at the same
graph so aquifers and surface rules agree with the terrain. All coordinates are world coordinates, so
chunk order, chunk borders and negative coordinates do not change the result.

Minecraft 26.1.2 changed two data schemas used here, and the compiler emits both formats correctly:

- Dimension types require `has_ender_dragon_fight`, use flattened `monster_spawn_light_level`
  (`min_inclusive`/`max_inclusive` at the top level), and no longer need the 1.21.1 bed/raid fields.
- Surface-rule conditions use `then_run` instead of `then`.

The generated surface rule (when selected) is top-layer only: grass above sea level, sand at submerged
tops, three blocks of dirt, then stone.

## Limitations

- **New chunks only.** Existing chunks are never regenerated; a world generated before the import keeps
  its old terrain. Delete the test world (or its dimension folder) when comparing a new export.
- **Covered world types (Overworld mode):** Default, Large Biomes, Amplified and Single Biome resolve to
  one of the replaced settings files. Flat, Debug and Custom world types keep vanilla terrain.
- **NeoForge 1.21.1 and 26.1.2.** 26.1.2 is the live-tested target for dimensions and presets; 1.21.1 is
  compiled against real artifacts and parity-tested. Other generators are rejected.
- **No density caves is not "no carvers".** Replacing `final_density` removes the cave-noise contribution,
  but vanilla biome carvers (and structures/features) can still cut the surface. Use a fixed carver-free
  biome such as `minecraft:the_void` for exact heights. Keeping vanilla cave noise instead
  (`vanilla-approximate`) preserves caves but drifts up to roughly 7 blocks from the preview.
- **The graph seed is fixed.** A Minecraft world seed cannot reach a custom density function, so two
  worlds from the same export share terrain unless you change the graph seed and re-export.
- **Display name is package metadata.** Minecraft names a dimension from its resource ID; the panel's
  package label is not written into a language file, to avoid clobbering a workspace's existing
  `en_us.json`.
- **Performance is estimated, not measured.** The panel reports graph complexity; there is no runtime
  performance preset that silently changes nothing.
- **Export covers only implemented nodes:** `coordinates`, `add`, `multiply`, `output`, `noise` (nine
  deterministic models), `clamp`, `remap`, `curve`, `blend`, `terrace`, `warp` and `erosion`. Custom
  texture noise and unknown types fail with a clear error instead of exporting an approximation.
- The graph's height field matches the app's evaluator to floating-point precision; the `minecraft-*`
  climate noises are deterministic approximations, not Minecraft parity.

## Verification

`npm run test:plugin` builds the zip, compiles and runs `tests/TerrainCompilerTest.java`, then runs the
TS↔Java parity harness — one command for all three. It uses the repo-local unpacked MCreator runtime when
present, otherwise pass `-- --mcreator "<install>"`.

**Supported MCreator build:** `plugin.json` pins `202600233518` (2026.2.33518) deliberately. MCreator
loads a plugin only when its `supportedversions` contains the exact build or the major build number, so
widening the pin would make the plugin appear on 2026.x releases that have never been tested against these
schemas. If the menu is missing, check the installed MCreator build first.

## Verification status

- `mcreator-plugin/build.mjs` produces the zip with MCreator's own bundled JDK; the rebuilt zip was loaded
  by MCreator 2026.2.33518 with no plugin errors.
- Compiler, installer, update and conflict behaviour are covered by `tests/TerrainCompilerTest.java`;
  `npm test` covers package validation and unsupported-node rejection.
- Generated Java for both 26.1.2 and 1.21.1 compiles against real Minecraft/NeoForge artifacts, and every
  supported noise type plus the shaping nodes match the TypeScript preview (max difference ≈2e-8).
- **Live NeoForge 26.1.2 server, all three modes:** Overworld replacement reports `wired=true` and graph
  heights; a custom dimension loads with its own `minY`/`maxY`, exact density, and surfaces at
  `TerrainStudioWorldgen.height(x, z)` for positive and negative coordinates; a world preset selected with
  `level-type` drives the real Overworld at the same heights with vanilla Nether and End present. Fresh
  worlds report `RESULT PASS`.
- **Not verified:** the MCreator menu action has not been clicked in a GUI session (its compiler/installer
  path is tested), and world creation through MCreator itself has not been exercised. The exact-height
  dimension run used a fixed `minecraft:the_void` biome; vanilla-biome dimensions keep carvers and features.
