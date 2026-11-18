import assert from 'node:assert/strict'
import test from 'node:test'
import type { TerrainGraph } from '../src/engine/terrainEngine.ts'
import {
  DEFAULT_MINECRAFT_CONFIG,
  analyzeCompatibility,
  buildIntegrationPackage,
  estimatePerformance,
  plannedFiles,
  projectIdFor,
  serializeIntegrationPackage,
  validateMinecraftExport,
  type MinecraftConfig,
} from '../src/minecraft/minecraftExport.ts'

const world = { minY: -64, maxY: 319, seaLevel: 63 }

function graph(extra: TerrainGraph['nodes'] = []): TerrainGraph {
  return {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'n', kind: 'noise', title: 'Noise', noiseType: 'value', scale: 0.01, amplitude: 1, seed: 7 },
      { id: 'o', kind: 'output', title: 'Output' },
      ...extra,
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'n' },
      { id: 'e2', source: 'n', target: 'o' },
    ],
  }
}

const dimension: MinecraftConfig = {
  ...DEFAULT_MINECRAFT_CONFIG,
  mode: 'dimension',
  dimensionId: 'terrainstudio:highlands',
  dimensionName: 'Highlands',
}
const dimensionWorld = { minY: 0, maxY: 255, seaLevel: 63, seed: 0 }

test('overworld replacement validates against vanilla bounds', () => {
  const valid = validateMinecraftExport(graph(), world, DEFAULT_MINECRAFT_CONFIG)
  assert.equal(valid.issues.filter((issue) => issue.severity === 'error').length, 0)
  assert.equal(valid.compatibility[0].status, 'runtime')

  const invalid = validateMinecraftExport(graph(), { ...world, minY: -128 }, DEFAULT_MINECRAFT_CONFIG)
  assert.ok(invalid.issues.some((issue) => issue.code === 'overworld-bounds'))
})

test('custom dimensions require a resource id and aligned build range', () => {
  const valid = validateMinecraftExport(graph(), dimensionWorld, dimension)
  assert.equal(valid.issues.filter((issue) => issue.severity === 'error').length, 0)
  assert.ok(valid.issues.some((issue) => issue.code === 'dimension-entry'))

  const badId = validateMinecraftExport(graph(), dimensionWorld, { ...dimension, dimensionId: 'Highlands' })
  assert.ok(badId.issues.some((issue) => issue.code === 'dimension-id'))

  const badHeight = validateMinecraftExport(graph(), { minY: 0, maxY: 300, seaLevel: 63 }, dimension)
  assert.ok(badHeight.issues.some((issue) => issue.code === 'height'))
})

test('unsupported nodes are errors, never silently dropped', () => {
  const custom = graph([{ id: 'x', kind: 'noise', title: 'Texture', noiseType: 'custom', scale: 0.01, amplitude: 1, seed: 1 }])
  const validation = validateMinecraftExport(custom, world, DEFAULT_MINECRAFT_CONFIG)
  assert.ok(validation.issues.some((issue) => issue.code === 'unsupported-node' && issue.nodeId === 'x'))
  assert.equal(validation.compatibility.find((node) => node.nodeId === 'x')?.status, 'unsupported')
  assert.throws(() => buildIntegrationPackage('Custom', custom, world, DEFAULT_MINECRAFT_CONFIG), /Cannot export/)
})

test('planned files follow the selected integration mode', () => {
  assert.equal(plannedFiles(DEFAULT_MINECRAFT_CONFIG).length, 4)
  assert.ok(plannedFiles(dimension).some((file) => file.includes('/dimension_type/highlands.json')))
  assert.ok(!plannedFiles(dimension).some((file) => file.includes('world_preset')))
  assert.ok(plannedFiles({ ...dimension, mode: 'preset' }).some((file) => file.includes('world_preset')))
})

test('performance estimates count expensive nodes and stay honest', () => {
  const heavy = graph(Array.from({ length: 13 }, (_, index) => ({
    id: `n${index}`, kind: 'noise' as const, title: `Noise ${index}`, noiseType: 'perlin', scale: 0.01, amplitude: 1, seed: index,
  })))
  const estimate = estimatePerformance(heavy)
  assert.equal(estimate.expensiveNodes, 14)
  assert.ok(estimate.runtimeOperations > 100)
  assert.equal(estimate.label, 'Heavy')
  assert.match(estimate.detail, /no per-chunk timing/)
})

test('packages carry the graph, target, seed and managed files', () => {
  const pkg = buildIntegrationPackage('Highlands', graph(), dimensionWorld, { ...dimension, seed: 42 })
  assert.equal(pkg.format, 'terrain-studio-minecraft')
  assert.equal(pkg.mode, 'dimension')
  assert.equal(pkg.world.seed, 42)
  assert.equal(pkg.target.generator, 'neoforge-1.21.1')
  assert.equal(pkg.graph.nodes.find((node) => node.id === 'n')?.data.kind, 'noise')
  assert.ok(pkg.manifest.managed.some((file) => file.includes('/dimension/highlands.json')))

  const parsed = JSON.parse(serializeIntegrationPackage(pkg))
  assert.equal(parsed.project.id, projectIdFor('Highlands', graph()))
  assert.equal(parsed.validation.errors.length, 0)
})

test('compatibility classifies every supported shaping node as runtime-compatible', () => {
  const shaping: TerrainGraph = {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'w', kind: 'warp', title: 'Warp', scale: 0.004, strength: 20, seed: 1 },
      { id: 'n', kind: 'noise', title: 'Noise', noiseType: 'perlin', scale: 0.01, amplitude: 1, seed: 2 },
      { id: 'cl', kind: 'clamp', title: 'Clamp', min: 0, max: 1 },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'w' },
      { id: 'e2', source: 'w', target: 'n' },
      { id: 'e3', source: 'n', target: 'cl' },
      { id: 'e4', source: 'cl', target: 'o' },
    ],
  }
  const statuses = analyzeCompatibility(shaping)
  assert.ok(statuses.every((node) => node.status === 'runtime'))
})

const detailTexture = {
  id: 'tex-detail',
  name: 'Detail',
  graph: {
    version: 1 as const,
    nodes: [
      { id: 'tc', kind: 'coordinates' as const, title: 'Texture Coordinates' },
      { id: 'tn', kind: 'noise' as const, title: 'Texture Noise', noiseType: 'value', scale: 0.01, amplitude: 1, seed: 7 },
      { id: 'to', kind: 'output' as const, title: 'Texture Output' },
    ],
    edges: [{ id: 't1', source: 'tc', target: 'tn' }, { id: 't2', source: 'tn', target: 'to' }],
  },
}

function customTextureGraph(): TerrainGraph {
  return {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 't', kind: 'noise', title: 'Custom Texture', noiseType: 'custom', textureId: 'tex-detail', scale: 0.004, amplitude: 1, seed: 0 },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [{ id: 'e1', source: 'c', target: 't' }, { id: 'e2', source: 't', target: 'o' }],
  }
}

test('a resolvable custom texture exports instead of being reported unsupported', () => {
  const validation = validateMinecraftExport(customTextureGraph(), world, DEFAULT_MINECRAFT_CONFIG, [detailTexture])
  assert.equal(validation.issues.filter((issue) => issue.severity === 'error').length, 0)
  assert.equal(validation.compatibility.find((node) => node.nodeId === 't')?.status, 'runtime')

  const pkg = buildIntegrationPackage('Texture', customTextureGraph(), world, DEFAULT_MINECRAFT_CONFIG, [detailTexture])
  // The package contains the inlined texture, never a node the compiler cannot compile.
  assert.ok(pkg.graph.nodes.every((node) => node.data.kind !== 'noise' || node.data.noiseType !== 'custom'))
  assert.ok(pkg.graph.nodes.some((node) => node.data.noiseType === 'value'))
})

test('dimension settings travel with the package', () => {
  const pkg = buildIntegrationPackage('Highlands', graph(), dimensionWorld, {
    ...dimension,
    logicalHeight: 128,
    coordinateScale: 8,
    ambientLight: 0.2,
    hasSkylight: false,
    hasCeiling: true,
  })
  assert.equal(pkg.world.logicalHeight, 128)
  assert.equal(pkg.world.coordinateScale, 8)
  assert.equal(pkg.world.ambientLight, 0.2)
  assert.equal(pkg.world.hasSkylight, false)
  assert.equal(pkg.world.hasCeiling, true)
})

test('invalid dimension settings are rejected before export', () => {
  const validation = validateMinecraftExport(graph(), dimensionWorld, {
    ...dimension,
    logicalHeight: 500,
    ambientLight: 2,
  })
  assert.ok(validation.issues.some((issue) => issue.code === 'logical-height'))
  assert.ok(validation.issues.some((issue) => issue.code === 'ambient-light'))
})
