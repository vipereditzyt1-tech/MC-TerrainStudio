import assert from 'node:assert/strict'
import test from 'node:test'
import { compileGraph, evaluateHeightField, flattenCustomTextures, type CustomTextureGraph, type TerrainGraph } from '../src/engine/terrainEngine.ts'

const world = { minY: -64, maxY: 319, seaLevel: 63 }

function graphWith(overrides: Partial<TerrainGraph> = {}, amplitude = 1): TerrainGraph {
  return {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'n', kind: 'noise', title: 'Noise', noiseType: 'value', scale: 0.01, amplitude, seed: 7 },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'n' },
      { id: 'e2', source: 'n', target: 'o' },
    ],
    ...overrides,
  }
}

test('compiles a valid graph into topological order', () => {
  const order = compileGraph(graphWith())
  assert.deepEqual(order.map((node) => node.id), ['c', 'n', 'o'])
})

test('requires exactly one output node', () => {
  const graph = graphWith()
  graph.nodes = graph.nodes.filter((node) => node.id !== 'o')
  assert.throws(() => compileGraph(graph), /exactly one Terrain Output node/)
})

test('rejects a cycle', () => {
  // A cycle has to be type-valid to reach the cycle check: two `add` nodes feeding each other.
  const graph: TerrainGraph = {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'n', kind: 'noise', title: 'Noise', noiseType: 'value', scale: 0.01, amplitude: 1, seed: 7 },
      { id: 'a', kind: 'add', title: 'Add A' },
      { id: 'b', kind: 'add', title: 'Add B' },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'n' },
      { id: 'e2', source: 'n', target: 'a' },
      { id: 'e3', source: 'a', target: 'b' },
      { id: 'e4', source: 'b', target: 'a' },
      { id: 'e5', source: 'b', target: 'o' },
    ],
  }
  assert.throws(() => compileGraph(graph), /Cycle detected/)
})

test('every noise type the inspector offers evaluates to a varied field', () => {
  const types = [
    'value', 'ridged', 'perlin', 'simplex', 'cellular', 'wave',
    'minecraft-continentalness', 'minecraft-erosion', 'minecraft-weirdness', 'minecraft-temperature',
  ]
  for (const noiseType of types) {
    const graph = graphWith()
    graph.nodes[1].noiseType = noiseType
    const field = evaluateHeightField(graph, world, 32, 2048)
    assert.equal(field.values.length, 32 * 32, noiseType)
    for (const value of field.values) assert.ok(Number.isFinite(value) && value >= world.minY && value <= world.maxY, `${noiseType} produced ${value}`)
    assert.ok(field.max > field.min, `${noiseType} produced a flat field`)
  }
})

test('rejects invalid nodes that are not connected to the output', () => {
  const badType = graphWith()
  badType.nodes.push({ id: 'x', kind: 'noise', title: 'Disconnected', noiseType: 'not-a-noise', scale: 0.01, amplitude: 1, seed: 1 })
  assert.throws(() => compileGraph(badType), /not implemented by the terrain engine/)
  const badScale = graphWith()
  badScale.nodes.push({ id: 'x', kind: 'noise', title: 'Disconnected', noiseType: 'perlin', scale: -1, amplitude: 1, seed: 1 })
  assert.throws(() => compileGraph(badScale), /scale must be a positive number/)
  const badFactor = graphWith()
  badFactor.nodes.push({ id: 'x', kind: 'multiply', title: 'Disconnected', factor: Number.NaN })
  assert.throws(() => compileGraph(badFactor), /factor must be finite/)
})

test('rejects a noise node without a supported noise type', () => {
  const graph = graphWith()
  graph.nodes[1].noiseType = 'not-a-noise'
  assert.throws(() => compileGraph(graph), /not implemented by the terrain engine/)
})

test('rejects a non-positive noise scale', () => {
  const graph = graphWith()
  graph.nodes[1].scale = 0
  assert.throws(() => compileGraph(graph), /scale must be a positive number/)
})

test('rejects resolutions outside 2..1024', () => {
  assert.throws(() => evaluateHeightField(graphWith(), world, 1), /between 2 and 1024/)
  assert.throws(() => evaluateHeightField(graphWith(), world, 2048), /between 2 and 1024/)
  assert.throws(() => evaluateHeightField(graphWith(), world, 16.5), /between 2 and 1024/)
})

test('rejects invalid world bounds', () => {
  assert.throws(
    () => evaluateHeightField(graphWith(), { minY: 10, maxY: 10, seaLevel: 0 }, 8),
    /maximum height must exceed minimum height/,
  )
})

test('clamps the normalised field to the world bounds', () => {
  const field = evaluateHeightField(graphWith({}, 10), world, 16)
  assert.equal(field.values.length, 256)
  for (const value of field.values) {
    assert.ok(value >= world.minY && value <= world.maxY, `${value} outside ${world.minY}..${world.maxY}`)
  }
  assert.ok(field.min >= world.minY && field.max <= world.maxY)
})

test('is deterministic for the same graph and settings', () => {
  const first = evaluateHeightField(graphWith(), world, 32)
  const second = evaluateHeightField(graphWith(), world, 32)
  assert.deepEqual(Array.from(first.values), Array.from(second.values))
  assert.equal(first.min, second.min)
  assert.equal(first.max, second.max)
})

test('a different seed changes the field', () => {
  const a = evaluateHeightField(graphWith(), world, 32)
  const graph = graphWith()
  graph.nodes[1].seed = 8
  const b = evaluateHeightField(graph, world, 32)
  assert.notDeepEqual(Array.from(a.values), Array.from(b.values))
})

test('the graph seed offsets every noise seed deterministically', () => {
  const a = evaluateHeightField(graphWith(), { ...world, seed: 0 }, 24)
  const b = evaluateHeightField(graphWith(), { ...world, seed: 19 }, 24)
  const c = evaluateHeightField(graphWith(), { ...world, seed: 19 }, 24)
  assert.notDeepEqual(Array.from(a.values), Array.from(b.values))
  assert.deepEqual(Array.from(b.values), Array.from(c.values))
  assert.throws(() => evaluateHeightField(graphWith(), { ...world, seed: 1.5 }, 8), /World seed must be an integer/)
})

test('clamp pins the field to a chosen normalized height', () => {
  const graph: TerrainGraph = {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'n', kind: 'noise', title: 'Noise', noiseType: 'value', scale: 0.01, amplitude: 1, seed: 3 },
      { id: 'cl', kind: 'clamp', title: 'Clamp', min: 0.4, max: 0.4 },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'n' },
      { id: 'e2', source: 'n', target: 'cl' },
      { id: 'e3', source: 'cl', target: 'o' },
    ],
  }
  const field = evaluateHeightField(graph, world, 16)
  const expected = world.minY + 0.4 * (world.maxY - world.minY)
  for (const value of field.values) assert.ok(Math.abs(value - expected) < 0.01, `${value} != ${expected}`)
})

test('domain warp changes the sampled field and still produces terrain', () => {
  const plain = graphWith()
  const warped: TerrainGraph = {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'w', kind: 'warp', title: 'Warp', scale: 0.004, strength: 40, seed: 11 },
      { id: 'n', kind: 'noise', title: 'Noise', noiseType: 'value', scale: 0.01, amplitude: 1, seed: 7 },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'w' },
      { id: 'e2', source: 'w', target: 'n' },
      { id: 'e3', source: 'n', target: 'o' },
    ],
  }
  const a = evaluateHeightField(plain, world, 24, 2048)
  const b = evaluateHeightField(warped, world, 24, 2048)
  assert.notDeepEqual(Array.from(a.values), Array.from(b.values))
  assert.ok(b.max > b.min)
  assert.ok(Array.from(b.values).every((value) => value >= world.minY && value <= world.maxY))
})

test('shaping nodes evaluate to finite in-bounds terrain', () => {
  const graph: TerrainGraph = {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'a', kind: 'noise', title: 'A', noiseType: 'perlin', scale: 0.006, amplitude: 0.9, seed: 7 },
      { id: 'b', kind: 'noise', title: 'B', noiseType: 'ridged', scale: 0.003, amplitude: 0.5, seed: 9 },
      { id: 'rm', kind: 'remap', title: 'Remap', inMin: 0, inMax: 1, outMin: 0.1, outMax: 0.9 },
      { id: 'cv', kind: 'curve', title: 'Curve', gamma: 1.5 },
      { id: 'bl', kind: 'blend', title: 'Blend', factor: 0.6 },
      { id: 'te', kind: 'terrace', title: 'Terrace', steps: 6, strength: 0.7 },
      { id: 'er', kind: 'erosion', title: 'Erosion', scale: 0.02, strength: 0.4, seed: 31 },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'a' },
      { id: 'e2', source: 'c', target: 'b' },
      { id: 'e3', source: 'a', target: 'rm' },
      { id: 'e4', source: 'rm', target: 'cv' },
      { id: 'e5', source: 'cv', target: 'bl' },
      { id: 'e6', source: 'b', target: 'bl' },
      { id: 'e7', source: 'bl', target: 'te' },
      { id: 'e8', source: 'te', target: 'er' },
      { id: 'e9', source: 'er', target: 'o' },
    ],
  }
  const field = evaluateHeightField(graph, world, 24, 2048)
  for (const value of field.values) assert.ok(Number.isFinite(value) && value >= world.minY && value <= world.maxY)
  assert.ok(field.max > field.min)
})

test('rejects invalid shaping parameters and coordinate wiring', () => {
  const terrace = graphWith()
  terrace.nodes.push({ id: 't', kind: 'terrace', title: 'Terrace', steps: 0, strength: 1 })
  assert.throws(() => compileGraph(terrace), /terrace steps must be an integer between 1 and 64/)

  const curve = graphWith()
  curve.nodes.push({ id: 'cv', kind: 'curve', title: 'Curve', gamma: 0 })
  assert.throws(() => compileGraph(curve), /curve gamma must be a positive number/)

  const blend: TerrainGraph = {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'n', kind: 'noise', title: 'Noise', noiseType: 'value', scale: 0.01, amplitude: 1, seed: 3 },
      { id: 'bl', kind: 'blend', title: 'Blend', factor: 0.5 },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'n' },
      { id: 'e2', source: 'n', target: 'bl' },
      { id: 'e3', source: 'bl', target: 'o' },
    ],
  }
  assert.throws(() => compileGraph(blend), /needs exactly two inputs/)

  const wrongType: TerrainGraph = {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'w', kind: 'warp', title: 'Warp', scale: 0.004, strength: 10, seed: 1 },
      { id: 'a', kind: 'add', title: 'Add' },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [
      { id: 'e1', source: 'c', target: 'w' },
      { id: 'e2', source: 'w', target: 'a' },
      { id: 'e3', source: 'a', target: 'o' },
    ],
  }
  assert.throws(() => compileGraph(wrongType), /incompatible signal types/)
})

const valueTexture: CustomTextureGraph = {
  id: 'tex-detail',
  name: 'Detail',
  graph: {
    version: 1,
    nodes: [
      { id: 'tc', kind: 'coordinates', title: 'Texture Coordinates' },
      { id: 'tn', kind: 'noise', title: 'Texture Noise', noiseType: 'value', scale: 0.01, amplitude: 1, seed: 7 },
      { id: 'to', kind: 'output', title: 'Texture Output' },
    ],
    edges: [{ id: 't1', source: 'tc', target: 'tn' }, { id: 't2', source: 'tn', target: 'to' }],
  },
}

function textureReference(amplitude = 1, textureId = 'tex-detail'): TerrainGraph {
  return {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'n', kind: 'noise', title: 'Custom Texture', noiseType: 'custom', textureId, scale: 0.004, amplitude, seed: 0 },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [{ id: 'e1', source: 'c', target: 'n' }, { id: 'e2', source: 'n', target: 'o' }],
  }
}

test('a custom texture is inlined and matches the equivalent bare noise graph', () => {
  const bare = evaluateHeightField(graphWith(), world, 24, 2048).values
  const inlined = evaluateHeightField(textureReference(), world, 24, 2048, [valueTexture]).values
  assert.deepEqual(Array.from(inlined), Array.from(bare))
})

test('a custom texture amplitude scales the inlined signal', () => {
  const plain = evaluateHeightField(textureReference(1), world, 24, 2048, [valueTexture])
  const scaled = evaluateHeightField(textureReference(0.5), world, 24, 2048, [valueTexture])
  assert.notDeepEqual(Array.from(plain.values), Array.from(scaled.values))
  assert.ok(Array.from(scaled.values).every((value) => value >= world.minY && value <= world.maxY))
})

test('custom textures fail loudly instead of silently returning zero', () => {
  assert.throws(() => compileGraph(textureReference(1, 'missing-texture'), [valueTexture]), /custom texture it points at is missing/)

  const unconnected: CustomTextureGraph = {
    id: 'tex-empty',
    name: 'Empty',
    graph: {
      version: 1,
      nodes: [
        { id: 'tc', kind: 'coordinates', title: 'Texture Coordinates' },
        { id: 'to', kind: 'output', title: 'Texture Output' },
      ],
      edges: [],
    },
  }
  assert.throws(() => compileGraph(textureReference(1, 'tex-empty'), [unconnected]), /connect a signal/)
})

test('flattening leaves a graph without custom nodes byte-identical', () => {
  const graph = graphWith()
  assert.equal(flattenCustomTextures(graph, [valueTexture]), graph)
})

test('the extended arithmetic node set evaluates to a varied bounded field', () => {
  const graph: TerrainGraph = {
    version: 1,
    nodes: [
      { id: 'c', kind: 'coordinates', title: 'Coordinates' },
      { id: 'sw', kind: 'swirl', title: 'Swirl', strength: 140, scale: 0.01 },
      { id: 'rd', kind: 'radial', title: 'Radial', scale: 0.02 },
      { id: 'n1', kind: 'noise', title: 'Noise A', noiseType: 'perlin', scale: 0.006, amplitude: 0.9, seed: 7 },
      { id: 'n2', kind: 'noise', title: 'Wave', noiseType: 'wave', scale: 0.01, amplitude: 0.8, seed: 13 },
      { id: 'mn', kind: 'min', title: 'Minimum' },
      { id: 'mx', kind: 'max', title: 'Maximum' },
      { id: 'sb', kind: 'subtract', title: 'Subtract' },
      { id: 'pw', kind: 'power', title: 'Power', exponent: 1.5 },
      { id: 'ab', kind: 'abs', title: 'Absolute' },
      { id: 'iv', kind: 'invert', title: 'Invert' },
      { id: 'dv', kind: 'divide', title: 'Divide' },
      { id: 'sm', kind: 'smoothstep', title: 'Smoothstep', inMin: 0.2, inMax: 0.8 },
      { id: 'th', kind: 'threshold', title: 'Threshold', threshold: 0.45, strength: 0.1 },
      { id: 'bl', kind: 'blend', title: 'Blend', factor: 0.5 },
      { id: 'of', kind: 'offset', title: 'Offset', factor: 1.7, bias: -0.2 },
      { id: 'rg', kind: 'ridge', title: 'Ridge' },
      { id: 'sn', kind: 'sine', title: 'Sine', scale: 1.5, seed: 3 },
      { id: 'tr', kind: 'triangle', title: 'Triangle', scale: 1.2, seed: 5 },
      { id: 'qz', kind: 'quantize', title: 'Quantize', steps: 12 },
      { id: 'ct', kind: 'contrast', title: 'Contrast', contrast: 1.3 },
      { id: 'te', kind: 'terrace', title: 'Terrace', steps: 5, strength: 0.6 },
      { id: 'o', kind: 'output', title: 'Output' },
    ],
    edges: [
      { id: '1', source: 'c', target: 'sw' }, { id: '2', source: 'sw', target: 'rd' },
      { id: '3', source: 'sw', target: 'n1' }, { id: '4', source: 'c', target: 'n2' },
      { id: '5', source: 'n1', target: 'mn' }, { id: '6', source: 'n2', target: 'mn' },
      { id: '7', source: 'mn', target: 'mx' }, { id: '8', source: 'rd', target: 'mx' },
      { id: '9', source: 'mx', target: 'sb' }, { id: '10', source: 'n2', target: 'sb' },
      { id: '11', source: 'sb', target: 'pw' }, { id: '12', source: 'sb', target: 'ab' },
      { id: '13', source: 'ab', target: 'iv' }, { id: '14', source: 'mx', target: 'dv' },
      { id: '15', source: 'pw', target: 'dv' }, { id: '16', source: 'iv', target: 'sm' },
      { id: '17', source: 'sm', target: 'th' }, { id: '18', source: 'th', target: 'of' },
      { id: '19', source: 'dv', target: 'bl' }, { id: '20', source: 'of', target: 'bl' },
      { id: '21', source: 'bl', target: 'rg' }, { id: '22', source: 'rg', target: 'sn' },
      { id: '23', source: 'sn', target: 'tr' }, { id: '24', source: 'tr', target: 'qz' },
      { id: '25', source: 'qz', target: 'ct' }, { id: '26', source: 'ct', target: 'te' },
      { id: '27', source: 'te', target: 'o' },
    ],
  }
  const field = evaluateHeightField(graph, world, 24, 2048)
  for (const value of field.values) {
    assert.ok(Number.isFinite(value) && value >= world.minY && value <= world.maxY, `${value} outside the world bounds`)
  }
  assert.ok(field.max > field.min)
})

test('the extended node set rejects impossible parameters', () => {
  const power = graphWith()
  power.nodes.push({ id: 'p', kind: 'power', title: 'Power', exponent: 0 })
  assert.throws(() => compileGraph(power), /exponent must be a positive number/)

  const quantize = graphWith()
  quantize.nodes.push({ id: 'q', kind: 'quantize', title: 'Quantize', steps: 0 })
  assert.throws(() => compileGraph(quantize), /quantize steps must be an integer between 1 and 1024/)

  const radial = graphWith()
  radial.nodes.push({ id: 'r', kind: 'radial', title: 'Radial', scale: 0 })
  assert.throws(() => compileGraph(radial), /radial scale must be a positive number/)
})
