import type { TerrainKind } from './terrainEngine';

export type NoiseType =
    | 'perlin'
    | 'simplex'
    | 'cellular'
    | 'value'
    | 'ridged'
    | 'wave'
    | 'minecraft-continentalness'
    | 'minecraft-erosion'
    | 'minecraft-weirdness'
    | 'minecraft-temperature'
    | 'custom';

/** One palette entry: exactly the node data the editor stamps onto a new node. */
export type LibraryNode = {
    title: string;
    kind: TerrainKind;
    category: string;
    description: string;
    value: string;
    accent: string;
    noiseType?: NoiseType;
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
    threshold?: number;
    exponent?: number;
    bias?: number;
    contrast?: number;
};

export type LibraryGroup = {
    id: string;
    name: string;
    hint: string;
    accent: string;
    nodes: LibraryNode[];
};

const SOURCE = '#56aaff';
const GEN = '#c18aff';
const MATH = '#ffb45c';
const SHAPE = '#f0a35e';
const DISTORT = '#6fd8ff';
const OUT = '#62d6a5';

/** The node palette. Every entry compiles into both the preview engine and the generated Java. */
export const libraryGroups: LibraryGroup[] = [
    {
        id: 'input',
        name: 'Input',
        hint: 'Where the graph reads world space',
        accent: SOURCE,
        nodes: [
            { title: 'Coordinates', kind: 'coordinates', category: 'INPUT', description: 'World-space position supplied by Minecraft or the preview.', value: 'World Position', accent: SOURCE },
            { title: 'Radial Distance', kind: 'radial', category: 'INPUT', description: 'Distance from the origin, scaled into a signal.', value: 'Scale: 0.01', accent: SOURCE, scale: 0.01 },
        ],
    },
    {
        id: 'generation',
        name: 'Generation',
        hint: 'Noise fields sampled from coordinates',
        accent: GEN,
        nodes: [
            { title: 'Noise Texture', kind: 'noise', category: 'GENERATION', description: 'Classic, Minecraft or custom noise field.', value: 'Value noise', accent: GEN, scale: 0.004, amplitude: 1, seed: 17, noiseType: 'value' },
            { title: 'Wave Texture', kind: 'noise', category: 'GENERATION', description: 'Crossed sine swell for dune and ocean fields.', value: 'Wave', accent: GEN, scale: 0.004, amplitude: 1, seed: 17, noiseType: 'wave' },
        ],
    },
    {
        id: 'combine',
        name: 'Combine',
        hint: 'Arithmetic between two or more signals',
        accent: MATH,
        nodes: [
            { title: 'Combine Fields', kind: 'add', category: 'COMBINE', description: 'Adds every connected signal.', value: 'Method: Add', accent: MATH },
            { title: 'Multiply', kind: 'multiply', category: 'COMBINE', description: 'Multiplies every connected signal by a factor.', value: 'Factor: 1.0', accent: MATH, factor: 1 },
            { title: 'Minimum', kind: 'min', category: 'COMBINE', description: 'Keeps the lowest of its inputs.', value: 'Lowest input', accent: MATH },
            { title: 'Maximum', kind: 'max', category: 'COMBINE', description: 'Keeps the highest of its inputs.', value: 'Highest input', accent: MATH },
            { title: 'Subtract', kind: 'subtract', category: 'COMBINE', description: 'Subtracts the second input from the first.', value: 'A − B', accent: MATH },
            { title: 'Divide', kind: 'divide', category: 'COMBINE', description: 'Divides A by B; a zero divisor yields 0.', value: 'A ÷ B', accent: MATH },
            { title: 'Power', kind: 'power', category: 'COMBINE', description: 'Raises a signal to an exponent, keeping its sign.', value: 'Exponent: 2', accent: MATH, exponent: 2 },
            { title: 'Blend', kind: 'blend', category: 'COMBINE', description: 'Mixes two signals by a factor.', value: 'Mix: 0.5', accent: MATH, factor: 0.5 },
        ],
    },
    {
        id: 'shape',
        name: 'Shape',
        hint: 'Remap, bias and quantise a signal',
        accent: SHAPE,
        nodes: [
            { title: 'Clamp', kind: 'clamp', category: 'SHAPE', description: 'Bounds a signal between two values.', value: '0.0 → 1.0', accent: SHAPE, min: 0, max: 1 },
            { title: 'Remap', kind: 'remap', category: 'SHAPE', description: 'Moves a signal from one range into another.', value: '0..1 → 0..1', accent: SHAPE, inMin: 0, inMax: 1, outMin: 0, outMax: 1 },
            { title: 'Curve', kind: 'curve', category: 'SHAPE', description: 'Gamma curve for valley and peak bias.', value: 'Gamma: 1.0', accent: SHAPE, gamma: 1 },
            { title: 'Contrast', kind: 'contrast', category: 'SHAPE', description: 'Pushes a signal away from the mid point.', value: 'Contrast: 1.5', accent: SHAPE, contrast: 1.5 },
            { title: 'Smoothstep', kind: 'smoothstep', category: 'SHAPE', description: 'S-shaped ramp between two edges.', value: '0.0 → 1.0', accent: SHAPE, inMin: 0, inMax: 1 },
            { title: 'Threshold', kind: 'threshold', category: 'SHAPE', description: 'Step at a level, with an optional soft edge.', value: 'Level: 0.5', accent: SHAPE, threshold: 0.5, strength: 0.02 },
            { title: 'Terrace', kind: 'terrace', category: 'SHAPE', description: 'Quantises a signal into steps, keeping its shape.', value: '4 steps', accent: SHAPE, steps: 4, strength: 0.8 },
            { title: 'Quantize', kind: 'quantize', category: 'SHAPE', description: 'Rounds a signal onto a fixed number of levels.', value: '8 levels', accent: SHAPE, steps: 8 },
            { title: 'Ridge', kind: 'ridge', category: 'SHAPE', description: 'Folds a signal into a sharp crest at 0.5.', value: '1 − |2a − 1|', accent: SHAPE },
            { title: 'Absolute', kind: 'abs', category: 'SHAPE', description: 'Drops the sign of a signal.', value: '|a|', accent: SHAPE },
            { title: 'Invert', kind: 'invert', category: 'SHAPE', description: 'Flips a signal around 0.5 (1 − a).', value: '1 − a', accent: SHAPE },
            { title: 'Offset', kind: 'offset', category: 'SHAPE', description: 'Multiplies then shifts a signal.', value: '×1.0 +0.0', accent: SHAPE, factor: 1, bias: 0 },
        ],
    },
    {
        id: 'distort',
        name: 'Distort',
        hint: 'Coordinates and wave shaping',
        accent: DISTORT,
        nodes: [
            { title: 'Domain Warp', kind: 'warp', category: 'DISTORT', description: 'Warps coordinates before sampling.', value: 'Strength: 30', accent: DISTORT, scale: 0.004, strength: 30, seed: 91 },
            { title: 'Swirl', kind: 'swirl', category: 'DISTORT', description: 'Rotates coordinates by their distance from the origin.', value: '180° per block', accent: DISTORT, strength: 180, scale: 0.01 },
            { title: 'Erosion Detail', kind: 'erosion', category: 'DISTORT', description: 'Adds approximate erosion detail to a signal.', value: 'Strength: 0.4', accent: DISTORT, scale: 0.012, strength: 0.4, seed: 53 },
            { title: 'Sine', kind: 'sine', category: 'DISTORT', description: 'Turns a signal into a sine wave.', value: 'Frequency: 2', accent: DISTORT, scale: 2, seed: 0 },
            { title: 'Triangle', kind: 'triangle', category: 'DISTORT', description: 'Turns a signal into a triangle wave.', value: 'Frequency: 2', accent: DISTORT, scale: 2, seed: 0 },
        ],
    },
    {
        id: 'output',
        name: 'Output',
        hint: 'The single resolved height field',
        accent: OUT,
        nodes: [
            { title: 'Terrain Output', kind: 'output', category: 'OUTPUT', description: 'Defines the final terrain height.', value: 'Height Field', accent: OUT },
        ],
    },
];

export const nodeLibrary: LibraryNode[] = libraryGroups.flatMap((group) => group.nodes);

export const noiseOptions: { value: NoiseType; label: string; group: string }[] = [
    { value: 'value', label: 'Value', group: 'Classic' },
    { value: 'perlin', label: 'Perlin', group: 'Classic' },
    { value: 'simplex', label: 'Simplex', group: 'Classic' },
    { value: 'cellular', label: 'Cellular / Voronoi', group: 'Classic' },
    { value: 'ridged', label: 'Ridged multifractal', group: 'Classic' },
    { value: 'wave', label: 'Wave (crossed sine)', group: 'Waves' },
    { value: 'minecraft-continentalness', label: 'Continentalness', group: 'Minecraft 1.21' },
    { value: 'minecraft-erosion', label: 'Erosion', group: 'Minecraft 1.21' },
    { value: 'minecraft-weirdness', label: 'Weirdness', group: 'Minecraft 1.21' },
    { value: 'minecraft-temperature', label: 'Temperature', group: 'Minecraft 1.21' },
    { value: 'custom', label: 'Custom texture…', group: 'Custom' },
];

export function noiseTypeLabel(type?: string) {
    return noiseOptions.find((option) => option.value === type)?.label ?? 'Noise Texture';
}

/** Human-readable summary of the parameters that matter for a node kind. */
export function describeParameters(data: {
    kind?: TerrainKind; noiseType?: string; scale?: number; amplitude?: number; factor?: number;
    min?: number; max?: number; gamma?: number; steps?: number; strength?: number; threshold?: number;
    exponent?: number; bias?: number; contrast?: number; inMin?: number; inMax?: number;
}): string {
    switch (data.kind) {
        case 'noise': return `${noiseTypeLabel(data.noiseType)} · scale ${data.scale ?? 0.004} · amp ${data.amplitude ?? 1}`;
        case 'multiply': return `Factor ${data.factor ?? 1}`;
        case 'clamp': return `${data.min ?? 0} → ${data.max ?? 1}`;
        case 'curve': return `Gamma ${data.gamma ?? 1}`;
        case 'terrace': return `${data.steps ?? 4} steps · strength ${data.strength ?? 0.8}`;
        case 'quantize': return `${data.steps ?? 8} levels`;
        case 'power': return `Exponent ${data.exponent ?? 2}`;
        case 'contrast': return `Contrast ${data.contrast ?? 1.5}`;
        case 'threshold': return `Level ${data.threshold ?? 0.5} · width ${data.strength ?? 0.02}`;
        case 'offset': return `×${data.factor ?? 1} ${(data.bias ?? 0) >= 0 ? '+' : '−'}${Math.abs(data.bias ?? 0)}`;
        case 'sine':
        case 'triangle': return `Frequency ${data.scale ?? 2}`;
        case 'warp': return `Strength ${data.strength ?? 30}`;
        case 'swirl': return `${data.strength ?? 180}° · scale ${data.scale ?? 0.01}`;
        case 'erosion': return `Strength ${data.strength ?? 0.4}`;
        case 'radial': return `Scale ${data.scale ?? 0.01}`;
        default: return '';
    }
}
