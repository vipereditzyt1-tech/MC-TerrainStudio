import type { Edge, Node } from '@xyflow/react';
import type { EngineNode, TerrainGraph, TerrainKind, WorldSettings } from './terrainEngine';
import type { MinecraftConfig } from './minecraftExport';

export type ProjectNodeData = {
    title: string; category: string; description: string; value: string; accent: string;
    kind?: TerrainKind; noiseType?: string; textureId?: string;
    scale?: number; amplitude?: number; seed?: number; factor?: number;
    min?: number; max?: number; inMin?: number; inMax?: number; outMin?: number; outMax?: number;
    gamma?: number; steps?: number; strength?: number; rotation?: number;
    threshold?: number; exponent?: number; bias?: number; contrast?: number;
};
export type ProjectNode = Node<ProjectNodeData>;
export type ProjectTexture = { id: string; name: string; nodes: ProjectNode[]; edges: Edge[] };
export interface ProjectDocument {
    format: 'terrain-studio'; version: 1; name: string;
    graph: { nodes: ProjectNode[]; edges: Edge[] };
    world: WorldSettings;
    customTextures: ProjectTexture[];
    preview: { resolution: 128 | 256 | 512; extent: 512 | 1024 | 4096 };
    minecraft?: MinecraftConfig;
}

export function toTerrainGraph(nodes: ProjectNode[], edges: Edge[]): TerrainGraph {
    return {
        version: 1,
        nodes: nodes.map((node) => ({
            id: node.id, kind: node.data.kind as TerrainKind, title: node.data.title,
            noiseType: node.data.noiseType, scale: node.data.scale, amplitude: node.data.amplitude,
            seed: node.data.seed, factor: node.data.factor,
            min: node.data.min, max: node.data.max, inMin: node.data.inMin, inMax: node.data.inMax,
            outMin: node.data.outMin, outMax: node.data.outMax, gamma: node.data.gamma,
            steps: node.data.steps, strength: node.data.strength, rotation: node.data.rotation,
            threshold: node.data.threshold, exponent: node.data.exponent, bias: node.data.bias,
            contrast: node.data.contrast,
        } as EngineNode)),
        edges: edges.map(({ id, source, target }) => ({ id, source, target })),
    };
}

// Store durable graph state, not transient selection, measured dimensions or drag state.
export function projectGraph(nodes: ProjectNode[], edges: Edge[]) {
    return {
        nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
        edges: edges.map(({ id, source, target, sourceHandle, targetHandle, animated }) => ({ id, source, target, sourceHandle, targetHandle, animated })),
    };
}

export function parseProject(text: string): ProjectDocument {
    const raw: unknown = JSON.parse(text);
    const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
    const fail = (message: string): never => { throw new Error(`Invalid project: ${message}`); };
    if (!object(raw) || raw.format !== 'terrain-studio' || raw.version !== 1) fail('unsupported format or version.');
    const doc = raw as Record<string, unknown>;
    if (typeof doc.name !== 'string' || doc.name.length > 500) fail('invalid project name.');
    if (!object(doc.world) || !['minY', 'maxY', 'seaLevel'].every((key) => typeof (doc.world as Record<string, unknown>)[key] === 'number' && Number.isFinite((doc.world as Record<string, unknown>)[key]))) fail('invalid world settings.');
    const worldSettings = doc.world as Record<string, number>;
    if (worldSettings.maxY <= worldSettings.minY) fail('maximum height must exceed minimum height.');
    const worldRecord = doc.world as Record<string, unknown>;
    if (worldRecord.seed !== undefined && (typeof worldRecord.seed !== 'number' || !Number.isInteger(worldRecord.seed))) fail('world seed must be an integer.');
    const dimensionNumbers = ['logicalHeight', 'coordinateScale', 'ambientLight'];
    if (!dimensionNumbers.every((key) => worldRecord[key] === undefined || typeof worldRecord[key] === 'number' && Number.isFinite(worldRecord[key]))) fail('invalid dimension settings.');
    const dimensionFlags = ['hasSkylight', 'hasCeiling'];
    if (!dimensionFlags.every((key) => worldRecord[key] === undefined || typeof worldRecord[key] === 'boolean')) fail('invalid dimension flags.');
    if (worldRecord.logicalHeight !== undefined) {
        const height = (worldSettings.maxY as number) - (worldSettings.minY as number) + 1;
        if (!Number.isInteger(worldRecord.logicalHeight) || (worldRecord.logicalHeight as number) < 1 || (worldRecord.logicalHeight as number) > height) fail('logical height must be a whole number inside the build range.');
    }
    if (worldRecord.coordinateScale !== undefined && ((worldRecord.coordinateScale as number) < 0.00001 || (worldRecord.coordinateScale as number) > 30000000)) fail('coordinate scale is out of range.');
    if (worldRecord.ambientLight !== undefined && ((worldRecord.ambientLight as number) < 0 || (worldRecord.ambientLight as number) > 1)) fail('ambient light must be between 0 and 1.');
    const validKinds = new Set([
        'coordinates', 'noise', 'add', 'multiply', 'output',
        'clamp', 'remap', 'curve', 'blend', 'terrace', 'warp', 'erosion',
        'min', 'max', 'subtract', 'divide', 'power', 'abs', 'invert',
        'smoothstep', 'threshold', 'offset', 'ridge', 'sine', 'triangle',
        'quantize', 'contrast', 'radial', 'swirl',
    ]);
    const numericFields = ['scale', 'amplitude', 'seed', 'factor', 'min', 'max', 'inMin', 'inMax', 'outMin', 'outMax', 'gamma', 'steps', 'strength', 'rotation', 'threshold', 'exponent', 'bias', 'contrast'];
    const validateGraph = (value: unknown) => {
        if (!object(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) fail('invalid graph.');
        const graph = value as { nodes: unknown[]; edges: unknown[] };
        if (graph.nodes.length > 10000 || graph.edges.length > 50000) fail('graph exceeds safety limits.');
        const ids = new Set<string>(), edgeIds = new Set<string>();
        for (const entry of graph.nodes) {
            if (!object(entry) || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || entry.type !== 'terrain' || !object(entry.position) || !object(entry.data)) fail('invalid node.');
            const node = entry as Record<string, unknown>, position = node.position as Record<string, unknown>, data = node.data as Record<string, unknown>;
            if (!['x', 'y'].every((key) => typeof position[key] === 'number' && Number.isFinite(position[key]))) fail('invalid node position.');
            if (!['title', 'category', 'description', 'value', 'accent'].every((key) => typeof data[key] === 'string')) fail('invalid node data.');
            if (data.kind !== undefined && (typeof data.kind !== 'string' || !validKinds.has(data.kind))) fail('unknown node type.');
            if (!numericFields.every((key) => data[key] === undefined || typeof data[key] === 'number' && Number.isFinite(data[key]))) fail('invalid node parameter.');
            if (!['noiseType', 'textureId'].every((key) => data[key] === undefined || typeof data[key] === 'string')) fail('invalid node configuration.');
            if (data.kind === 'noise' && (typeof data.noiseType !== 'string' || typeof data.scale !== 'number' || data.scale <= 0 || typeof data.amplitude !== 'number' || !Number.isInteger(data.seed))) fail('invalid noise parameters.');
            if (data.kind === 'multiply' && typeof data.factor !== 'number') fail('invalid multiplication factor.');
            ids.add(node.id as string);
        }
        for (const entry of graph.edges) {
            if (!object(entry) || typeof entry.id !== 'string' || !entry.id || edgeIds.has(entry.id) || typeof entry.source !== 'string' || typeof entry.target !== 'string' || !ids.has(entry.source) || !ids.has(entry.target)) fail('invalid connection.');
            const edge = entry as Record<string, unknown>;
            if (!['sourceHandle', 'targetHandle'].every((key) => edge[key] === undefined || edge[key] === null || typeof edge[key] === 'string') || (edge.animated !== undefined && typeof edge.animated !== 'boolean')) fail('invalid connection configuration.');
            edgeIds.add(edge.id as string);
        }
    };
    validateGraph(doc.graph);
    if (doc.preview === undefined) doc.preview = { resolution: 256, extent: 1024 };
    if (!object(doc.preview) || ![128, 256, 512].includes(doc.preview.resolution as number) || ![512, 1024, 4096].includes(doc.preview.extent as number)) fail('invalid preview settings.');
    if (!Array.isArray(doc.customTextures) || doc.customTextures.length > 1000) fail('invalid custom textures.');
    const textureIds = new Set<string>();
    for (const texture of doc.customTextures as unknown[]) {
        if (!object(texture) || typeof texture.id !== 'string' || !texture.id || textureIds.has(texture.id) || typeof texture.name !== 'string') fail('invalid custom texture.');
        textureIds.add((texture as Record<string, unknown>).id as string);
        validateGraph(texture);
    }
    const minecraftValue = doc.minecraft;
    if (minecraftValue !== undefined) {
        if (!object(minecraftValue)) fail('invalid Minecraft settings.');
        const minecraft = minecraftValue as Record<string, unknown>;
        if (!['neoforge-1.21.1', 'neoforge-26.1.2'].includes(minecraft.target as string)) fail('invalid Minecraft target.');
        if (!['overworld', 'dimension', 'preset'].includes(minecraft.mode as string)) fail('invalid Minecraft mode.');
        if (typeof minecraft.dimensionId !== 'string' || typeof minecraft.dimensionName !== 'string') fail('invalid dimension settings.');
        if (!['vanilla', 'fixed'].includes(minecraft.biomeSource as string) || typeof minecraft.biome !== 'string') fail('invalid biome settings.');
        if (!['none', 'vanilla-approximate'].includes(minecraft.caves as string)) fail('invalid cave setting.');
        if (!['vanilla', 'terrain-studio'].includes(minecraft.surface as string)) fail('invalid surface setting.');
        if (!Number.isInteger(minecraft.seed)) fail('Minecraft seed must be an integer.');
        if (!['fast', 'balanced', 'detail', 'maximum'].includes(minecraft.performance as string)) fail('invalid performance profile.');
        if (minecraft.logicalHeight !== undefined && (typeof minecraft.logicalHeight !== 'number' || !Number.isInteger(minecraft.logicalHeight) || minecraft.logicalHeight < 1 || minecraft.logicalHeight > worldSettings.maxY - worldSettings.minY + 1)) fail('invalid logical height.');
        if (minecraft.coordinateScale !== undefined && (typeof minecraft.coordinateScale !== 'number' || !Number.isFinite(minecraft.coordinateScale) || minecraft.coordinateScale < 0.00001 || minecraft.coordinateScale > 30000000)) fail('invalid coordinate scale.');
        if (minecraft.ambientLight !== undefined && (typeof minecraft.ambientLight !== 'number' || !Number.isFinite(minecraft.ambientLight) || minecraft.ambientLight < 0 || minecraft.ambientLight > 1)) fail('invalid ambient light.');
        for (const flag of ['hasSkylight', 'hasCeiling']) {
            if (minecraft[flag] !== undefined && typeof minecraft[flag] !== 'boolean') fail('invalid dimension flag.');
        }
    }
    return doc as unknown as ProjectDocument;
}
