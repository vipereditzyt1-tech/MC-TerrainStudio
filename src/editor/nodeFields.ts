import type { TerrainKind } from '../engine/terrainEngine.ts'

/** One numeric control in a node's inspector section. */
export type ParameterField = {
    field: string
    label: string
    step: number
    fallback: number
    min?: number
    max?: number
}

/**
 * Parameter editors for the node kinds whose inspector sections are data-driven: the inspector
 * renders whatever is listed here, so a new numeric parameter is an entry in this table plus the
 * default on the palette entry in `nodeCatalog.ts`. Kinds that predate the table keep their hand
 * written sections in `App.tsx`.
 */
export const parameterFields: Partial<Record<TerrainKind, ParameterField[]>> = {
    power: [{ field: 'exponent', label: 'Exponent', step: 0.1, fallback: 2, min: 0.01 }],
    smoothstep: [
        { field: 'inMin', label: 'Edge 0', step: 0.05, fallback: 0 },
        { field: 'inMax', label: 'Edge 1', step: 0.05, fallback: 1 },
    ],
    threshold: [
        { field: 'threshold', label: 'Level', step: 0.05, fallback: 0.5 },
        { field: 'strength', label: 'Soft width', step: 0.01, fallback: 0.02, min: 0 },
    ],
    offset: [
        { field: 'factor', label: 'Multiplier', step: 0.1, fallback: 1 },
        { field: 'bias', label: 'Bias', step: 0.05, fallback: 0 },
    ],
    contrast: [{ field: 'contrast', label: 'Contrast', step: 0.1, fallback: 1.5 }],
    quantize: [{ field: 'steps', label: 'Levels', step: 1, fallback: 8, min: 1, max: 1024 }],
    sine: [
        { field: 'scale', label: 'Frequency', step: 0.1, fallback: 2, min: 0 },
        { field: 'seed', label: 'Phase seed', step: 1, fallback: 0 },
    ],
    triangle: [
        { field: 'scale', label: 'Frequency', step: 0.1, fallback: 2, min: 0 },
        { field: 'seed', label: 'Phase seed', step: 1, fallback: 0 },
    ],
    radial: [{ field: 'scale', label: 'Scale', step: 0.005, fallback: 0.01, min: 0.0001 }],
    swirl: [
        { field: 'strength', label: 'Degrees', step: 15, fallback: 180 },
        { field: 'scale', label: 'Scale', step: 0.005, fallback: 0.01, min: 0.0001 },
    ],
}
