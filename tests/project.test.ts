import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProject, projectGraph } from '../src/project/project.ts'

const coordinatesNode = {
  id: 'coordinates',
  type: 'terrain',
  position: { x: 0, y: 0 },
  data: { title: 'Coordinates', category: 'INPUT', description: 'World position.', value: 'World Position', accent: '#56aaff' },
}

const baseDocument = () => ({
  format: 'terrain-studio',
  version: 1,
  name: 'Test Terrain',
  graph: { nodes: [structuredClone(coordinatesNode)], edges: [] },
  world: { minY: -64, maxY: 319, seaLevel: 63 },
  customTextures: [],
  preview: { resolution: 256, extent: 1024 },
})

test('parses a minimal document', () => {
  const doc = parseProject(JSON.stringify(baseDocument()))
  assert.equal(doc.name, 'Test Terrain')
  assert.equal(doc.graph.nodes.length, 1)
  assert.deepEqual(doc.preview, { resolution: 256, extent: 1024 })
})

test('fills a missing preview block with the documented defaults', () => {
  const document: Record<string, unknown> = baseDocument()
  delete document.preview
  const doc = parseProject(JSON.stringify(document))
  assert.deepEqual(doc.preview, { resolution: 256, extent: 1024 })
})

test('rejects a world whose maximum height does not exceed its minimum', () => {
  const document = baseDocument()
  document.world = { minY: 100, maxY: 100, seaLevel: 63 }
  assert.throws(() => parseProject(JSON.stringify(document)), /maximum height must exceed minimum height/)
})

test('rejects unsupported format and version', () => {
  assert.throws(() => parseProject(JSON.stringify({ ...baseDocument(), version: 2 })), /unsupported format or version/)
  assert.throws(() => parseProject(JSON.stringify({ ...baseDocument(), format: 'other' })), /unsupported format or version/)
})

test('rejects duplicate node ids', () => {
  const document = baseDocument()
  document.graph.nodes.push(structuredClone(coordinatesNode))
  assert.throws(() => parseProject(JSON.stringify(document)), /invalid node/)
})

test('rejects an edge that references a missing node', () => {
  const document = baseDocument()
  document.graph.edges.push({ id: 'e1', source: 'coordinates', target: 'missing' })
  assert.throws(() => parseProject(JSON.stringify(document)), /invalid connection/)
})

test('rejects non-finite world values', () => {
  const document = baseDocument()
  document.world = { minY: -64, maxY: Number.POSITIVE_INFINITY, seaLevel: 63 }
  assert.throws(() => parseProject(JSON.stringify(document)), /invalid world settings/)
})

test('rejects a preview resolution the app cannot render', () => {
  const document: Record<string, unknown> = baseDocument()
  document.preview = { resolution: 1024, extent: 1024 }
  assert.throws(() => parseProject(JSON.stringify(document)), /invalid preview settings/)
})

test('accepts shaping nodes and the Minecraft export configuration', () => {
  const document: Record<string, unknown> = baseDocument()
  ;(document.graph as { nodes: unknown[] }).nodes.push({
    id: 'warp',
    type: 'terrain',
    position: { x: 100, y: 100 },
    data: { title: 'Warp', category: 'SHAPING', description: 'Warp.', value: 'Warp', accent: '#6fd8ff', kind: 'warp', scale: 0.004, strength: 20, seed: 1, rotation: 15 },
  })
  document.minecraft = {
    target: 'neoforge-26.1.2', mode: 'dimension', dimensionId: 'terrainstudio:highlands', dimensionName: 'Highlands',
    biomeSource: 'vanilla', biome: 'minecraft:plains', caves: 'none', surface: 'vanilla', seed: 12, performance: 'balanced',
  }
  const doc = parseProject(JSON.stringify(document))
  assert.equal(doc.graph.nodes[1].data.kind, 'warp')
  assert.equal(doc.minecraft?.mode, 'dimension')
  assert.equal(doc.minecraft?.seed, 12)
})

test('rejects invalid Minecraft export settings', () => {
  const document: Record<string, unknown> = baseDocument()
  document.minecraft = { target: 'fabric-1.21.1', mode: 'overworld' }
  assert.throws(() => parseProject(JSON.stringify(document)), /invalid Minecraft target/)
  const seed: Record<string, unknown> = baseDocument()
  seed.minecraft = { target: 'neoforge-1.21.1', mode: 'overworld', dimensionId: 'a:b', dimensionName: 'B', biomeSource: 'vanilla', biome: 'minecraft:plains', caves: 'none', surface: 'vanilla', seed: 1.2, performance: 'balanced' }
  assert.throws(() => parseProject(JSON.stringify(seed)), /Minecraft seed must be an integer/)
})

test('projectGraph keeps durable state and drops transient state', () => {
  const node = { ...structuredClone(coordinatesNode), selected: true, dragging: true, measured: { width: 10, height: 10 } }
  const edge = { id: 'e1', source: 'a', target: 'b', selected: true, style: { stroke: 'red' } }
  const graph = projectGraph([node] as never, [edge] as never)
  assert.deepEqual(Object.keys(graph.nodes[0]).sort(), ['data', 'id', 'position', 'type'])
  assert.deepEqual(Object.keys(graph.edges[0]).sort(), ['animated', 'id', 'source', 'sourceHandle', 'target', 'targetHandle'])
})
