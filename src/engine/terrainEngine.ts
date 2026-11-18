export type TerrainKind =
    | 'coordinates' | 'noise' | 'add' | 'multiply' | 'output'
    | 'clamp' | 'remap' | 'curve' | 'blend' | 'terrace' | 'warp' | 'erosion'
    | 'min' | 'max' | 'subtract' | 'divide' | 'power' | 'abs' | 'invert'
    | 'smoothstep' | 'threshold' | 'offset' | 'ridge' | 'sine' | 'triangle'
    | 'quantize' | 'contrast' | 'radial' | 'swirl';
export type SignalType = 'coordinate' | 'scalar';

export interface EngineNode {
    id: string;
    kind: TerrainKind;
    title: string;
    noiseType?: string;
    scale?: number;
    amplitude?: number;
    seed?: number;
    factor?: number;
    min?: number;
    max?: number;
    inMin?: number;
    inMax?: number;
    outMin?: number;
    outMax?: number;
    gamma?: number;
    steps?: number;
    strength?: number;
    rotation?: number;
    /** Set on a custom-texture noise node: the saved texture this node samples. */
    textureId?: string;
    threshold?: number;
    exponent?: number;
    bias?: number;
    contrast?: number;
}
export interface EngineEdge { id: string; source: string; target: string }
export interface TerrainGraph { version: 1; nodes: EngineNode[]; edges: EngineEdge[] }
/** A saved custom texture: a nested graph whose output replaces one noise node. */
export interface CustomTextureGraph { id: string; name: string; graph: TerrainGraph }
/**
 * `seed` offsets every node's noise seed; 0 keeps projects saved before it existed identical.
 * The dimension fields only reach the Minecraft export: they describe the dimension type.
 */
export interface WorldSettings {
    minY: number;
    maxY: number;
    seaLevel: number;
    seed?: number;
    logicalHeight?: number;
    coordinateScale?: number;
    ambientLight?: number;
    hasSkylight?: boolean;
    hasCeiling?: boolean;
}
export interface HeightField { size: number; values: Float32Array; min: number; max: number }

const outputType: Record<TerrainKind, SignalType | null> = {
    coordinates: 'coordinate', warp: 'coordinate', swirl: 'coordinate',
    noise: 'scalar', add: 'scalar', multiply: 'scalar', output: 'scalar',
    clamp: 'scalar', remap: 'scalar', curve: 'scalar', blend: 'scalar', terrace: 'scalar', erosion: 'scalar',
    min: 'scalar', max: 'scalar', subtract: 'scalar', divide: 'scalar', power: 'scalar', abs: 'scalar',
    invert: 'scalar', smoothstep: 'scalar', threshold: 'scalar', offset: 'scalar', ridge: 'scalar',
    sine: 'scalar', triangle: 'scalar', quantize: 'scalar', contrast: 'scalar', radial: 'scalar',
};
const expectedType: Partial<Record<TerrainKind, SignalType>> = {
    noise: 'coordinate', warp: 'coordinate', swirl: 'coordinate', radial: 'coordinate',
    add: 'scalar', multiply: 'scalar', output: 'scalar',
    clamp: 'scalar', remap: 'scalar', curve: 'scalar', blend: 'scalar', terrace: 'scalar', erosion: 'scalar',
    min: 'scalar', max: 'scalar', subtract: 'scalar', divide: 'scalar', power: 'scalar', abs: 'scalar',
    invert: 'scalar', smoothstep: 'scalar', threshold: 'scalar', offset: 'scalar', ridge: 'scalar',
    sine: 'scalar', triangle: 'scalar', quantize: 'scalar', contrast: 'scalar',
};
const supportedNoise = new Set([
    'value', 'ridged', 'perlin', 'simplex', 'cellular', 'wave',
    'minecraft-continentalness', 'minecraft-erosion', 'minecraft-weirdness', 'minecraft-temperature',
]);
const exactlyOneInput = new Set<TerrainKind>([
    'noise', 'output', 'clamp', 'remap', 'curve', 'terrace', 'erosion', 'warp', 'swirl', 'radial',
    'power', 'abs', 'invert', 'smoothstep', 'threshold', 'offset', 'ridge', 'sine', 'triangle', 'quantize', 'contrast',
]);
const atLeastOneInput = new Set<TerrainKind>(['add', 'multiply', 'min', 'max']);
const exactlyTwoInputs = new Set<TerrainKind>(['blend', 'subtract', 'divide']);

/**
 * Replaces every custom-texture noise node with the texture's own graph, wired to the same coordinate
 * signal. One implementation therefore serves the preview, the PNG export and the generated Java: the
 * flattened graph only contains node kinds the compiler already knows.
 */
export function flattenCustomTextures(graph: TerrainGraph, textures: CustomTextureGraph[], depth = 0): TerrainGraph {
    if (!graph.nodes.some((node) => node.kind === 'noise' && node.noiseType === 'custom')) return graph;
    if (depth > 6) throw new Error('Custom textures are nested too deeply, or reference each other in a cycle.');
    const nodes: EngineNode[] = [];
    const edges = graph.edges.map((edge) => ({ ...edge }));
    const redirect = new Map<string, string>();
    const consumed = new Set<string>();
    for (const node of graph.nodes) {
        if (!(node.kind === 'noise' && node.noiseType === 'custom')) { nodes.push(node); continue; }
        const texture = textures.find((candidate) => candidate.id === node.textureId);
        if (!texture) throw new Error(`${node.title}: the custom texture it points at is missing. Choose one in the inspector.`);
        const sub = flattenCustomTextures(texture.graph, textures, depth + 1);
        const outputs = sub.nodes.filter((candidate) => candidate.kind === 'output');
        if (outputs.length !== 1) throw new Error(`Custom texture "${texture.name}" needs exactly one Terrain Output node.`);
        const output = outputs[0];
        const feed = sub.edges.find((edge) => edge.target === output.id);
        if (!feed) throw new Error(`Custom texture "${texture.name}": connect a signal to its output.`);
        const coordinate = graph.edges.find((edge) => edge.target === node.id);
        if (!coordinate) throw new Error(`${node.title}: connect a Coordinates node so the texture can be sampled.`);
        const prefix = `${texture.id}::`;
        consumed.add(node.id);
        const feeder = sub.nodes.find((entry) => entry.id === feed.source);
        if (!feeder || feeder.kind === 'coordinates') {
            throw new Error(`Custom texture "${texture.name}": its output must be fed by a signal, not by raw coordinates.`);
        }
        // A texture reads the parent's coordinates: its own coordinate nodes are replaced by the parent's
        // signal, because a Coordinates node is a source and cannot take an input.
        const rootRedirect = new Map<string, string>();
        for (const entry of sub.nodes) {
            if (entry.kind !== 'coordinates') continue;
            rootRedirect.set(prefix + entry.id, coordinate.source);
        }
        for (const entry of sub.nodes) {
            if (entry.id === output.id || entry.kind === 'coordinates') continue;
            if (!entry.kind) throw new Error(`Custom texture "${texture.name}": "${entry.title}" has no node type.`);
            nodes.push({ ...entry, id: prefix + entry.id });
        }
        for (const entry of sub.edges) {
            if (entry.target === output.id) continue;
            edges.push({
                id: `${prefix}${entry.id}`,
                source: rootRedirect.get(prefix + entry.source) ?? prefix + entry.source,
                target: prefix + entry.target,
            });
        }
        let tail = prefix + feed.source;
        const amplitude = node.amplitude ?? 1;
        if (amplitude !== 1) {
            const ampId = `${prefix}amp:${node.id}`;
            nodes.push({ id: ampId, kind: 'multiply', title: `${texture.name} amplitude`, factor: amplitude });
            edges.push({ id: `${ampId}:feed`, source: tail, target: ampId });
            tail = ampId;
        }
        redirect.set(node.id, tail);
    }
    const keep = new Set(nodes.map((node) => node.id));
    const remap = (id: string) => {
        let current = id;
        for (let hop = 0; hop < 8 && redirect.has(current); hop += 1) current = redirect.get(current)!;
        return current;
    };
    const seen = new Set<string>();
    const finalEdges = edges
        .filter((edge) => !consumed.has(edge.target))
        .map((edge) => ({ ...edge, source: remap(edge.source), target: remap(edge.target) }))
        .filter((edge) => {
            if (!keep.has(edge.source) || !keep.has(edge.target) || edge.source === edge.target) return false;
            const key = `${edge.source}>${edge.target}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    return { version: 1, nodes, edges: finalEdges };
}

/** Validate the output dependency tree and return its topological evaluation order. */
export function compileGraph(graph: TerrainGraph, textures: CustomTextureGraph[] = []): EngineNode[] {
    return compileFlatGraph(flattenCustomTextures(graph, textures));
}

function compileFlatGraph(graph: TerrainGraph): EngineNode[] {
    if (graph.version !== 1) throw new Error('Unsupported graph version.');
    const byId = new Map<string, EngineNode>();
    for (const node of graph.nodes) {
        if (byId.has(node.id)) throw new Error(`Duplicate node ID: ${node.id}`);
        if (!(node.kind in outputType)) throw new Error(`Unsupported node: ${node.title}`);
        // Validate every node, not only the subgraph feeding the output: a disconnected node with a bad
        // noise type or parameter would otherwise save fine and fail the moment it is connected.
        validateNode(node);
        byId.set(node.id, node);
    }
    const outputs = graph.nodes.filter((node) => node.kind === 'output');
    if (outputs.length !== 1) throw new Error('The graph needs exactly one Terrain Output node.');
    const incoming = new Map<string, EngineNode[]>();
    const edgeIds = new Set<string>(), pairs = new Set<string>();
    for (const edge of graph.edges) {
        const pair = JSON.stringify([edge.source, edge.target]);
        if (edgeIds.has(edge.id) || pairs.has(pair)) throw new Error(`Duplicate connection: ${edge.id}`);
        edgeIds.add(edge.id); pairs.add(pair);
        const source = byId.get(edge.source), target = byId.get(edge.target);
        if (!source || !target) throw new Error(`Connection ${edge.id} references a missing node.`);
        if (!expectedType[target.kind] || outputType[source.kind] !== expectedType[target.kind]) {
            throw new Error(`Cannot connect ${source.title} to ${target.title}: incompatible signal types.`);
        }
        const inputs = incoming.get(target.id) ?? [];
        inputs.push(source);
        incoming.set(target.id, inputs);
    }
    const cycleVisiting = new Set<string>(), cycleVisited = new Set<string>();
    function checkCycle(node: EngineNode) {
        if (cycleVisiting.has(node.id)) throw new Error(`Cycle detected at ${node.title}.`);
        if (cycleVisited.has(node.id)) return;
        cycleVisiting.add(node.id);
        (incoming.get(node.id) ?? []).forEach(checkCycle);
        cycleVisiting.delete(node.id);
        cycleVisited.add(node.id);
    }
    graph.nodes.forEach(checkCycle);
    const visiting = new Set<string>(), visited = new Set<string>(), order: EngineNode[] = [];
    function visit(node: EngineNode) {
        if (visiting.has(node.id)) throw new Error(`Cycle detected at ${node.title}.`);
        if (visited.has(node.id)) return;
        visiting.add(node.id);
        const inputs = incoming.get(node.id) ?? [];
        if (exactlyOneInput.has(node.kind) && inputs.length !== 1)
            throw new Error(`${node.title} needs exactly one input.`);
        if (atLeastOneInput.has(node.kind) && inputs.length < 1)
            throw new Error(`${node.title} needs at least one input.`);
        if (exactlyTwoInputs.has(node.kind) && inputs.length !== 2)
            throw new Error(`${node.title} needs exactly two inputs.`);
        inputs.forEach(visit);
        visiting.delete(node.id);
        visited.add(node.id);
        order.push(node);
    }
    visit(outputs[0]);
    return order;
}

function finite(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validateNode(node: EngineNode) {
    if (node.kind === 'noise') {
        if (!supportedNoise.has(node.noiseType ?? '')) {
            throw new Error(`${node.title}: ${node.noiseType ?? 'unknown noise'} is not implemented by the terrain engine yet.`);
        }
        if (!Number.isFinite(node.scale) || (node.scale ?? 0) <= 0)
            throw new Error(`${node.title}: scale must be a positive number.`);
        if (!Number.isFinite(node.amplitude))
            throw new Error(`${node.title}: amplitude must be finite.`);
        if (!Number.isInteger(node.seed))
            throw new Error(`${node.title}: seed must be an integer.`);
    }
    if (node.kind === 'multiply' && !Number.isFinite(node.factor))
        throw new Error(`${node.title}: factor must be finite.`);
    if (node.kind === 'clamp') {
        const min = finite(node.min, -1), max = finite(node.max, 1);
        if (!Number.isFinite(node.min ?? -1) || !Number.isFinite(node.max ?? 1) || min > max)
            throw new Error(`${node.title}: clamp minimum must not exceed its maximum.`);
    }
    if (node.kind === 'remap') {
        const inMin = finite(node.inMin, 0), inMax = finite(node.inMax, 1);
        if (!Number.isFinite(inMin) || !Number.isFinite(inMax) || inMax <= inMin)
            throw new Error(`${node.title}: remap input maximum must exceed its minimum.`);
        if (!Number.isFinite(node.outMin ?? 0) || !Number.isFinite(node.outMax ?? 1))
            throw new Error(`${node.title}: remap output bounds must be finite.`);
    }
    if (node.kind === 'smoothstep') {
        const inMin = finite(node.inMin, 0), inMax = finite(node.inMax, 1);
        if (!Number.isFinite(inMin) || !Number.isFinite(inMax) || inMax <= inMin)
            throw new Error(`${node.title}: smoothstep edge 1 must exceed edge 0.`);
    }
    if (node.kind === 'curve' && (!Number.isFinite(node.gamma) || (node.gamma ?? 1) <= 0))
        throw new Error(`${node.title}: curve gamma must be a positive number.`);
    if (node.kind === 'blend' && !Number.isFinite(node.factor))
        throw new Error(`${node.title}: blend factor must be finite.`);
    if (node.kind === 'terrace') {
        if (!Number.isInteger(node.steps) || (node.steps ?? 0) < 1 || (node.steps ?? 0) > 64)
            throw new Error(`${node.title}: terrace steps must be an integer between 1 and 64.`);
        if (!Number.isFinite(node.strength ?? 1))
            throw new Error(`${node.title}: terrace strength must be finite.`);
    }
    if (node.kind === 'warp') {
        if (!Number.isFinite(node.scale) || (node.scale ?? 0) <= 0)
            throw new Error(`${node.title}: warp scale must be a positive number.`);
        if (!Number.isFinite(node.strength ?? 0) || (node.strength ?? 0) < 0)
            throw new Error(`${node.title}: warp strength must be a non-negative number.`);
        if (!Number.isInteger(node.seed))
            throw new Error(`${node.title}: warp seed must be an integer.`);
    }
    if (node.kind === 'erosion') {
        if (!Number.isFinite(node.scale) || (node.scale ?? 0) <= 0)
            throw new Error(`${node.title}: erosion scale must be a positive number.`);
        if (!Number.isFinite(node.strength ?? 0) || (node.strength ?? 0) < 0)
            throw new Error(`${node.title}: erosion strength must be a non-negative number.`);
        if (!Number.isInteger(node.seed))
            throw new Error(`${node.title}: erosion seed must be an integer.`);
    }
    if (node.kind === 'quantize') {
        if (!Number.isInteger(node.steps) || (node.steps ?? 0) < 1 || (node.steps ?? 0) > 1024)
            throw new Error(`${node.title}: quantize steps must be an integer between 1 and 1024.`);
    }
    if (node.kind === 'power' && (!Number.isFinite(node.exponent ?? 2) || (node.exponent ?? 2) <= 0))
        throw new Error(`${node.title}: exponent must be a positive number.`);
    if (node.kind === 'threshold' && (!Number.isFinite(node.threshold ?? 0.5) || !Number.isFinite(node.strength ?? 0.02) || (node.strength ?? 0.02) < 0))
        throw new Error(`${node.title}: threshold value and smoothing width must be finite.`);
    if (node.kind === 'offset' && (!Number.isFinite(node.factor ?? 1) || !Number.isFinite(node.bias ?? 0)))
        throw new Error(`${node.title}: multiplier and bias must be finite.`);
    if (node.kind === 'contrast' && !Number.isFinite(node.contrast ?? 1.5))
        throw new Error(`${node.title}: contrast must be finite.`);
    if (node.kind === 'sine' || node.kind === 'triangle') {
        if (!Number.isFinite(node.scale ?? 1) || !Number.isInteger(node.seed ?? 0))
            throw new Error(`${node.title}: frequency must be finite and phase seed must be an integer.`);
    }
    if (node.kind === 'radial') {
        if (!Number.isFinite(node.scale) || (node.scale ?? 0) <= 0)
            throw new Error(`${node.title}: radial scale must be a positive number.`);
    }
    if (node.kind === 'swirl') {
        if (!Number.isFinite(node.strength ?? 180) || !Number.isFinite(node.scale ?? 0.01) || (node.scale ?? 0.01) <= 0)
            throw new Error(`${node.title}: swirl strength must be finite and scale must be positive.`);
    }
    if (node.rotation !== undefined && !Number.isFinite(node.rotation))
        throw new Error(`${node.title}: rotation must be finite.`);
}

function hash(x: number, z: number, seed: number): number {
    let n = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x: number, z: number, seed: number): number {
    const ix = Math.floor(x), iz = Math.floor(z), tx = x - ix, tz = z - iz;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed);
    const c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
function fractal(x: number, z: number, seed: number, ridged: boolean): number {
    let value = 0, amplitude = 1, total = 0;
    for (let octave = 0; octave < 4; octave++) {
        const sample = valueNoise(x, z, seed + octave * 101);
        value += (ridged ? 1 - Math.abs(sample * 2 - 1) : sample) * amplitude;
        total += amplitude;
        x *= 2; z *= 2; amplitude *= 0.5;
    }
    return value / total;
}

// Gradient table shared with the MCreator compiler; only arithmetic is used so both languages agree exactly.
const GRADIENTS: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [0.7071067811865476, 0.7071067811865476], [-0.7071067811865476, 0.7071067811865476],
    [0.7071067811865476, -0.7071067811865476], [-0.7071067811865476, -0.7071067811865476],
];

function gradientIndex(x: number, z: number, seed: number): number {
    return Math.floor(hash(x, z, seed) * 8) & 7;
}

function perlinSample(x: number, z: number, seed: number): number {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
    const dot = (gx: number, gz: number) => {
        const gradient = GRADIENTS[gradientIndex(gx, gz, seed)];
        return gradient[0] * (x - gx) + gradient[1] * (z - gz);
    };
    const n00 = dot(ix, iz), n10 = dot(ix + 1, iz), n01 = dot(ix, iz + 1), n11 = dot(ix + 1, iz + 1);
    const lower = n00 + (n10 - n00) * u, upper = n01 + (n11 - n01) * u;
    return lower + (upper - lower) * v;
}

const SIMPLEX_F2 = 0.3660254037844386, SIMPLEX_G2 = 0.21132486540518713;

function simplexSample(x: number, z: number, seed: number): number {
    const skew = (x + z) * SIMPLEX_F2, i = Math.floor(x + skew), j = Math.floor(z + skew);
    const unskew = (i + j) * SIMPLEX_G2, x0 = x - (i - unskew), z0 = z - (j - unskew);
    const i1 = x0 > z0 ? 1 : 0, j1 = x0 > z0 ? 0 : 1;
    const x1 = x0 - i1 + SIMPLEX_G2, z1 = z0 - j1 + SIMPLEX_G2, x2 = x0 - 1 + 2 * SIMPLEX_G2, z2 = z0 - 1 + 2 * SIMPLEX_G2;
    const corner = (cx: number, cz: number, gx: number, gz: number) => {
        const falloff = 0.5 - cx * cx - cz * cz;
        if (falloff <= 0) return 0;
        const gradient = GRADIENTS[gradientIndex(gx, gz, seed)], square = falloff * falloff;
        return square * square * (gradient[0] * cx + gradient[1] * cz);
    };
    const total = corner(x0, z0, i, j) + corner(x1, z1, i + i1, j + j1) + corner(x2, z2, i + 1, j + 1);
    return 70 * total;
}

function gradientFractal(x: number, z: number, seed: number, simplex: boolean): number {
    let value = 0, amplitude = 1, total = 0;
    for (let octave = 0; octave < 4; octave++) {
        value += (simplex ? simplexSample(x, z, seed + octave * 101) : perlinSample(x, z, seed + octave * 101)) * amplitude;
        total += amplitude;
        x *= 2; z *= 2; amplitude *= 0.5;
    }
    return Math.max(0, Math.min(1, 0.5 + (0.5 * value) / total));
}

function cellularSample(x: number, z: number, seed: number): number {
    const ix = Math.floor(x), iz = Math.floor(z);
    let nearest = 8;
    for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
            const cellX = ix + dx, cellZ = iz + dz;
            const pointX = cellX + hash(cellX, cellZ, seed), pointZ = cellZ + hash(cellX, cellZ, seed + 1);
            const offsetX = x - pointX, offsetZ = z - pointZ;
            const distance = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
            if (distance < nearest) nearest = distance;
        }
    }
    return Math.max(0, Math.min(1, 1 - nearest));
}

const TAU = 6.283185307179586;

/** Two crossed sine trains: parallel swell plus a cross-swell that bends it into a wave field. */
function waveSample(x: number, z: number, seed: number): number {
    const phase = (seed % 1000) * 0.017;
    const primary = Math.sin(x * TAU + phase);
    const secondary = Math.sin(z * TAU * 0.5 + phase * 0.7);
    return Math.max(0, Math.min(1, 0.5 + 0.5 * (primary * 0.65 + secondary * 0.35)));
}

/**
 * Per-noise sampling. The Minecraft climate noises are deterministic approximations, not Minecraft parity,
 * and every branch here is mirrored exactly by mcreator-plugin's generated Java.
 */
function sampleTerrainNoise(type: string, x: number, z: number, seed: number, scale: number): number {
    const sx = x * scale, sz = z * scale;
    switch (type) {
        case 'ridged': return fractal(sx, sz, seed, true);
        case 'perlin': return gradientFractal(sx, sz, seed, false);
        case 'simplex': return gradientFractal(sx, sz, seed, true);
        case 'cellular': return cellularSample(sx, sz, seed);
        case 'wave': return waveSample(sx, sz, seed);
        case 'minecraft-erosion': return fractal(sx * 1.7, sz * 1.7, (seed + 203) | 0, false);
        case 'minecraft-weirdness': return fractal(sx * 1.3, sz * 1.3, (seed + 19) | 0, true);
        case 'minecraft-temperature': return fractal(sx * 0.8, sz * 0.8, (seed + 307) | 0, false);
        default: return fractal(sx, sz, seed, false);
    }
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

/** Generates an absolute-Y height field. Minecraft-labelled noise is an approximation, not Minecraft parity. */
export function evaluateHeightField(
    graph: TerrainGraph,
    world: WorldSettings,
    size: number,
    extent = 1024,
    textures: CustomTextureGraph[] = [],
): HeightField {
    if (!Number.isInteger(size) || size < 2 || size > 1024) throw new Error('Resolution must be an integer between 2 and 1024.');
    if (!Number.isFinite(extent) || extent <= 0) throw new Error('Preview extent must be positive.');
    if (!Number.isFinite(world.minY) || !Number.isFinite(world.maxY) || world.maxY <= world.minY || !Number.isFinite(world.seaLevel))
        throw new Error('World height settings are invalid: maximum height must exceed minimum height.');
    const worldSeed = world.seed ?? 0;
    if (!Number.isInteger(worldSeed)) throw new Error('World seed must be an integer.');
    // Flatten once: the slot table below indexes the same graph the order was compiled from, so a
    // custom texture cannot desynchronise node ids and edges.
    const flat = flattenCustomTextures(graph, textures);
    const order = compileFlatGraph(flat), slots = new Map<string, number>();
    order.forEach((node, index) => slots.set(node.id, index));
    // Compile once per field: numeric slots and typed arrays keep the per-pixel loop free of string keys and
    // object allocations. Arithmetic order is identical to the generated Java, so output stays bit-identical.
    const inputSlots = order.map((node) => Int32Array.from(flat.edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => slots.get(edge.source)!)));
    const noiseTypes = order.map((node) => node.noiseType ?? '');
    const seeds = Float64Array.from(order.map((node) => (node.seed ?? 0) + worldSeed));
    const scales = Float64Array.from(order.map((node) => finite(node.scale, 0)));
    const amplitudes = Float64Array.from(order.map((node) => finite(node.amplitude, 0)));
    const factors = Float64Array.from(order.map((node) => finite(node.factor, 1)));
    const mins = Float64Array.from(order.map((node) => finite(node.min, -1)));
    const maxs = Float64Array.from(order.map((node) => finite(node.max, 1)));
    const inMins = Float64Array.from(order.map((node) => finite(node.inMin, 0)));
    const inMaxs = Float64Array.from(order.map((node) => finite(node.inMax, 1)));
    const outMins = Float64Array.from(order.map((node) => finite(node.outMin, 0)));
    const outMaxs = Float64Array.from(order.map((node) => finite(node.outMax, 1)));
    const gammas = Float64Array.from(order.map((node) => finite(node.gamma, 1)));
    const steps = Float64Array.from(order.map((node) => finite(node.steps, 4)));
    const strengths = Float64Array.from(order.map((node) => finite(node.strength, 0.5)));
    const cosines = Float64Array.from(order.map((node) => Math.cos(((node.rotation ?? 0) * Math.PI) / 180)));
    const sines = Float64Array.from(order.map((node) => Math.sin(((node.rotation ?? 0) * Math.PI) / 180)));
    const thresholds = Float64Array.from(order.map((node) => finite(node.threshold, 0.5)));
    const exponents = Float64Array.from(order.map((node) => finite(node.exponent, 2)));
    const biases = Float64Array.from(order.map((node) => finite(node.bias, 0)));
    const contrasts = Float64Array.from(order.map((node) => finite(node.contrast, 1.5)));
    const codes = Uint8Array.from(order.map((node) => {
        switch (node.kind) {
            case 'noise': return 1;
            case 'add': return 2;
            case 'multiply': return 3;
            case 'output': return 4;
            case 'clamp': return 5;
            case 'remap': return 6;
            case 'curve': return 7;
            case 'blend': return 8;
            case 'terrace': return 9;
            case 'warp': return 10;
            case 'erosion': return 11;
            case 'min': return 12;
            case 'max': return 13;
            case 'subtract': return 14;
            case 'divide': return 15;
            case 'power': return 16;
            case 'abs': return 17;
            case 'invert': return 18;
            case 'smoothstep': return 19;
            case 'threshold': return 20;
            case 'offset': return 21;
            case 'ridge': return 22;
            case 'sine': return 23;
            case 'triangle': return 24;
            case 'quantize': return 25;
            case 'contrast': return 26;
            case 'radial': return 27;
            case 'swirl': return 28;
            default: return 0;
        }
    }));
    const registers = new Float64Array(order.length);
    const coordX = new Float64Array(order.length), coordZ = new Float64Array(order.length);
    const values = new Float32Array(size * size);
    let min = Infinity, max = -Infinity;
    for (let row = 0; row < size; row++) {
        const z = (row / (size - 1) - 0.5) * extent;
        for (let col = 0; col < size; col++) {
            const x = (col / (size - 1) - 0.5) * extent;
            for (let index = 0; index < order.length; index++) {
                const inputs = inputSlots[index];
                let v = 0;
                switch (codes[index]) {
                    case 1: {
                        const source = inputs[0];
                        const rx = coordX[source] * cosines[index] - coordZ[source] * sines[index];
                        const rz = coordX[source] * sines[index] + coordZ[source] * cosines[index];
                        v = sampleTerrainNoise(noiseTypes[index], rx, rz, seeds[index], scales[index]) * amplitudes[index];
                        break;
                    }
                    case 2: for (let input = 0; input < inputs.length; input++) v += registers[inputs[input]]; break;
                    case 3: v = factors[index]; for (let input = 0; input < inputs.length; input++) v *= registers[inputs[input]]; break;
                    case 4: v = registers[inputs[0]]; break;
                    case 5: v = Math.max(mins[index], Math.min(maxs[index], registers[inputs[0]])); break;
                    case 6:
                        v = outMins[index] + clamp01((registers[inputs[0]] - inMins[index]) / (inMaxs[index] - inMins[index]))
                            * (outMaxs[index] - outMins[index]);
                        break;
                    case 7: v = Math.pow(clamp01(registers[inputs[0]]), gammas[index]); break;
                    case 8: {
                        const a = registers[inputs[0]], b = registers[inputs[1]];
                        v = a + (b - a) * clamp01(factors[index]);
                        break;
                    }
                    case 9: {
                        const original = registers[inputs[0]];
                        const stepped = Math.floor(clamp01(original) * steps[index]) / steps[index];
                        v = original + (stepped - original) * clamp01(strengths[index]);
                        break;
                    }
                    case 10: {
                        const source = inputs[0];
                        const baseX = coordX[source], baseZ = coordZ[source];
                        const rx = baseX * cosines[index] - baseZ * sines[index];
                        const rz = baseX * sines[index] + baseZ * cosines[index];
                        coordX[index] = baseX + (fractal(rx * scales[index], rz * scales[index], seeds[index], false) * 2 - 1) * strengths[index];
                        coordZ[index] = baseZ + (fractal(rx * scales[index], rz * scales[index], seeds[index] + 41, false) * 2 - 1) * strengths[index];
                        v = 0;
                        break;
                    }
                    case 11: {
                        const original = clamp01(registers[inputs[0]]);
                        const detail = fractal(x * scales[index], z * scales[index], seeds[index], false);
                        v = clamp01(original + strengths[index] * (detail * 2 - 1) * original * (1 - original) * 2);
                        break;
                    }
                    case 12: {
                        v = registers[inputs[0]];
                        for (let input = 1; input < inputs.length; input++) v = Math.min(v, registers[inputs[input]]);
                        break;
                    }
                    case 13: {
                        v = registers[inputs[0]];
                        for (let input = 1; input < inputs.length; input++) v = Math.max(v, registers[inputs[input]]);
                        break;
                    }
                    case 14: v = registers[inputs[0]] - registers[inputs[1]]; break;
                    case 15: {
                        const divisor = registers[inputs[1]];
                        v = divisor === 0 ? 0 : registers[inputs[0]] / divisor;
                        break;
                    }
                    case 16: {
                        const base = registers[inputs[0]], power = exponents[index];
                        v = base < 0 ? -Math.pow(-base, power) : Math.pow(base, power);
                        break;
                    }
                    case 17: v = Math.abs(registers[inputs[0]]); break;
                    case 18: v = 1 - registers[inputs[0]]; break;
                    case 19: {
                        const t = clamp01((registers[inputs[0]] - inMins[index]) / (inMaxs[index] - inMins[index]));
                        v = t * t * (3 - 2 * t);
                        break;
                    }
                    case 20: {
                        const width = strengths[index], level = thresholds[index];
                        v = width <= 0
                            ? (registers[inputs[0]] >= level ? 1 : 0)
                            : clamp01((registers[inputs[0]] - level) / (2 * width) + 0.5);
                        break;
                    }
                    case 21: v = registers[inputs[0]] * factors[index] + biases[index]; break;
                    case 22: v = 1 - Math.abs(registers[inputs[0]] * 2 - 1); break;
                    case 23: {
                        const phase = seeds[index] * 0.017;
                        v = clamp01(0.5 + 0.5 * Math.sin(registers[inputs[0]] * scales[index] * TAU + phase));
                        break;
                    }
                    case 24: {
                        const t = registers[inputs[0]] * scales[index] + seeds[index] * 0.37;
                        const fraction = t - Math.floor(t);
                        v = fraction < 0.5 ? fraction * 2 : 2 - fraction * 2;
                        break;
                    }
                    case 25: {
                        const count = steps[index];
                        v = Math.floor(clamp01(registers[inputs[0]]) * count + 0.5) / count;
                        break;
                    }
                    case 26: v = (registers[inputs[0]] - 0.5) * contrasts[index] + 0.5; break;
                    case 27: {
                        const source = inputs[0], ax = coordX[source], az = coordZ[source];
                        v = Math.sqrt(ax * ax + az * az) * scales[index];
                        break;
                    }
                    case 28: {
                        const source = inputs[0], bx = coordX[source], bz = coordZ[source];
                        const angle = strengths[index] * 0.017453292519943295 * Math.sqrt(bx * bx + bz * bz) * scales[index];
                        const cosine = Math.cos(angle), sine = Math.sin(angle);
                        coordX[index] = bx * cosine - bz * sine;
                        coordZ[index] = bx * sine + bz * cosine;
                        v = 0;
                        break;
                    }
                    default: coordX[index] = x; coordZ[index] = z; v = 0;
                }
                registers[index] = v;
            }
            const normalized = clamp01(registers[order.length - 1]);
            const height = world.minY + normalized * (world.maxY - world.minY);
            values[row * size + col] = height;
            min = Math.min(min, height); max = Math.max(max, height);
        }
    }
    return { size, values, min, max };
}
