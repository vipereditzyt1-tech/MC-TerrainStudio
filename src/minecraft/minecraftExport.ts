import { compileGraph, flattenCustomTextures, type CustomTextureGraph, type EngineNode, type TerrainGraph, type WorldSettings } from '../engine/terrainEngine.ts';

export type MinecraftTarget = 'neoforge-1.21.1' | 'neoforge-26.1.2';
export type IntegrationMode = 'overworld' | 'dimension' | 'preset';
export type BiomeSourceMode = 'vanilla' | 'fixed';
export type CaveMode = 'none' | 'vanilla-approximate';
export type SurfaceMode = 'vanilla' | 'terrain-studio';
export type PerformanceProfile = 'fast' | 'balanced' | 'detail' | 'maximum';

export interface MinecraftConfig {
    target: MinecraftTarget;
    mode: IntegrationMode;
    dimensionId: string;
    dimensionName: string;
    biomeSource: BiomeSourceMode;
    biome: string;
    caves: CaveMode;
    surface: SurfaceMode;
    seed: number;
    performance: PerformanceProfile;
    /** Dimension-type settings; only written for custom dimensions and world presets. */
    logicalHeight?: number;
    coordinateScale?: number;
    ambientLight?: number;
    hasSkylight?: boolean;
    hasCeiling?: boolean;
}

export const DEFAULT_MINECRAFT_CONFIG: MinecraftConfig = {
    target: 'neoforge-1.21.1',
    mode: 'overworld',
    dimensionId: 'terrainstudio:highlands',
    dimensionName: 'Highlands',
    biomeSource: 'vanilla',
    biome: 'minecraft:plains',
    caves: 'none',
    surface: 'vanilla',
    seed: 0,
    performance: 'balanced',
};

export const targetProfiles: Array<{
    id: MinecraftTarget;
    label: string;
    minecraft: string;
    loader: 'neoforge';
    loaderVersion: string;
    java: number;
}> = [
    { id: 'neoforge-1.21.1', label: 'NeoForge 1.21.1', minecraft: '1.21.1', loader: 'neoforge', loaderVersion: '21.1', java: 21 },
    { id: 'neoforge-26.1.2', label: 'NeoForge 26.1.2', minecraft: '26.1.2', loader: 'neoforge', loaderVersion: '26.1', java: 25 },
];

export interface ValidationIssue {
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    nodeId?: string;
}

export interface NodeCompatibility {
    nodeId: string;
    title: string;
    kind: string;
    status: 'runtime' | 'unsupported';
    reason: string;
}

export interface PerformanceEstimate {
    nodes: number;
    runtimeOperations: number;
    expensiveNodes: number;
    label: 'Light' | 'Moderate' | 'Heavy';
    detail: string;
}

const runtimeKinds = new Set([
    'coordinates', 'noise', 'add', 'multiply', 'output',
    'clamp', 'remap', 'curve', 'blend', 'terrace', 'warp', 'erosion',
    'min', 'max', 'subtract', 'divide', 'power', 'abs', 'invert',
    'smoothstep', 'threshold', 'offset', 'ridge', 'sine', 'triangle',
    'quantize', 'contrast', 'radial', 'swirl',
]);
const resourceLocation = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const biomeLocation = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

export function targetProfile(target: MinecraftTarget) {
    return targetProfiles.find((profile) => profile.id === target) ?? targetProfiles[0];
}

/** Classify every node for the selected target. Nothing is silently dropped. */
export function analyzeCompatibility(graph: TerrainGraph, textures: CustomTextureGraph[] = []): NodeCompatibility[] {
    return graph.nodes.map((node) => {
        if (!runtimeKinds.has(node.kind)) {
            return { nodeId: node.id, title: node.title, kind: node.kind, status: 'unsupported', reason: `Node kind "${node.kind}" is not implemented by the Minecraft runtime.` };
        }
        if (node.kind === 'noise' && node.noiseType === 'custom') {
            // A custom texture is inlined into the compiled graph, so it exports like any other node -
            // but only when the texture it points at actually exists in the project.
            const texture = textures.find((candidate) => candidate.id === node.textureId);
            return texture
                ? { nodeId: node.id, title: node.title, kind: node.kind, status: 'runtime', reason: `Custom texture "${texture.name}" is inlined into the generated density function.` }
                : { nodeId: node.id, title: node.title, kind: node.kind, status: 'unsupported', reason: 'This node points at a custom texture that is missing from the project. Choose one in the inspector.' };
        }
        if (node.kind === 'noise' && (!node.noiseType || !['value', 'ridged', 'perlin', 'simplex', 'cellular', 'wave', 'minecraft-continentalness', 'minecraft-erosion', 'minecraft-weirdness', 'minecraft-temperature'].includes(node.noiseType))) {
            return { nodeId: node.id, title: node.title, kind: node.kind, status: 'unsupported', reason: `Noise model "${node.noiseType}" is not implemented by the Minecraft runtime.` };
        }
        return {
            nodeId: node.id,
            title: node.title,
            kind: node.kind,
            status: 'runtime',
            reason: 'Compiled into the generated terrain runtime (Java density function).',
        };
    });
}

export function estimatePerformance(graph: TerrainGraph): PerformanceEstimate {
    const expensive = graph.nodes.filter((node) => node.kind === 'noise' || node.kind === 'warp' || node.kind === 'erosion').length;
    const runtimeOperations = graph.nodes.reduce((total, node) => {
        if (node.kind === 'noise') return total + 13;
        if (node.kind === 'warp') return total + 9;
        if (node.kind === 'erosion') return total + 9;
        if (node.kind === 'coordinates' || node.kind === 'output') return total + 1;
        return total + 2;
    }, 0);
    const label: PerformanceEstimate['label'] = runtimeOperations > 160 ? 'Heavy' : runtimeOperations > 60 ? 'Moderate' : 'Light';
    return {
        nodes: graph.nodes.length,
        runtimeOperations,
        expensiveNodes: expensive,
        label,
        detail: 'Estimated from graph structure only; no per-chunk timing is claimed.',
    };
}

export function validateMinecraftExport(graph: TerrainGraph, world: WorldSettings, config: MinecraftConfig, textures: CustomTextureGraph[] = []): {
    issues: ValidationIssue[];
    compatibility: NodeCompatibility[];
    performance: PerformanceEstimate;
} {
    const issues: ValidationIssue[] = [];
    const profile = targetProfile(config.target);
    const compatibility = analyzeCompatibility(graph, textures);
    const performance = estimatePerformance(graph);

    if (!targetProfiles.some((entry) => entry.id === config.target)) {
        issues.push({ severity: 'error', code: 'target', message: 'Choose a supported Minecraft target.' });
    }
    if (!Number.isInteger(config.seed)) {
        issues.push({ severity: 'error', code: 'seed', message: 'The graph seed must be a whole number.' });
    }
    if (!['overworld', 'dimension', 'preset'].includes(config.mode)) {
        issues.push({ severity: 'error', code: 'mode', message: 'Choose a supported integration mode.' });
    }

    for (const node of compatibility) {
        if (node.status === 'unsupported') {
            issues.push({ severity: 'error', code: 'unsupported-node', nodeId: node.nodeId, message: `${node.title}: ${node.reason}` });
        }
    }

    try {
        compileGraph(graph, textures);
    } catch (error) {
        issues.push({ severity: 'error', code: 'graph-invalid', message: error instanceof Error ? error.message : 'The graph is invalid.' });
    }

    if (config.mode === 'overworld') {
        if (world.minY !== -64 || world.maxY !== 319) {
            issues.push({ severity: 'error', code: 'overworld-bounds', message: 'Overworld replacement uses the vanilla build range. Set Min height to -64 and Max height to 319, or choose Custom dimension / World preset.' });
        }
        if (!Number.isInteger(world.seaLevel) || world.seaLevel < world.minY || world.seaLevel > world.maxY) {
            issues.push({ severity: 'error', code: 'sea-level', message: 'Overworld replacement needs an integer sea level inside the build range.' });
        }
    } else {
        if (!resourceLocation.test(config.dimensionId)) {
            issues.push({ severity: 'error', code: 'dimension-id', message: 'Dimension ID must look like terrainstudio:highlands (lowercase namespace:path).' });
        }
        if (config.dimensionName.trim().length === 0) {
            issues.push({ severity: 'error', code: 'dimension-name', message: 'Enter a display name for the dimension or world preset.' });
        }
        const height = world.maxY - world.minY + 1;
        if ((world.minY % 16) !== 0) {
            issues.push({ severity: 'error', code: 'min-y', message: 'Minecraft requires the minimum Y to be a multiple of 16.' });
        }
        if (height % 16 !== 0 || height < 16 || height > 4064) {
            issues.push({ severity: 'error', code: 'height', message: `Dimension height must be a multiple of 16 between 16 and 4064 (currently ${height}).` });
        }
        if (world.minY < -2032 || world.maxY > 2031) {
            issues.push({ severity: 'error', code: 'height-range', message: 'Custom dimensions support Y between -2032 and 2031.' });
        }
        if (!Number.isInteger(world.seaLevel) || world.seaLevel < world.minY || world.seaLevel > world.maxY) {
            issues.push({ severity: 'error', code: 'sea-level', message: 'Sea level must be a whole block height inside the dimension build range.' });
        }
        const logical = config.logicalHeight ?? height;
        if (!Number.isInteger(logical) || logical < 1 || logical > height) {
            issues.push({ severity: 'error', code: 'logical-height', message: `Logical height must be a whole number between 1 and ${height}.` });
        }
        if (config.coordinateScale !== undefined && (!Number.isFinite(config.coordinateScale) || config.coordinateScale < 0.00001 || config.coordinateScale > 30000000)) {
            issues.push({ severity: 'error', code: 'coordinate-scale', message: 'Coordinate scale must be between 0.00001 and 30000000.' });
        }
        if (config.ambientLight !== undefined && (!Number.isFinite(config.ambientLight) || config.ambientLight < 0 || config.ambientLight > 1)) {
            issues.push({ severity: 'error', code: 'ambient-light', message: 'Ambient light must be between 0 and 1.' });
        }
    }

    if (config.biomeSource === 'fixed' && !biomeLocation.test(config.biome)) {
        issues.push({ severity: 'error', code: 'biome', message: 'Fixed biome must be a resource location such as minecraft:plains.' });
    }

    if (config.caves === 'vanilla-approximate') {
        issues.push({ severity: 'warning', code: 'caves', message: 'Vanilla cave noise is kept through the vanilla density router; surfaces can sit up to about 7 blocks away from the preview. Use "No density caves" for exact heights.' });
    } else {
        issues.push({ severity: 'warning', code: 'carvers', message: 'No density caves removes cave noise, but vanilla biome carvers can still cut the surface. For exact heights use a fixed biome without carvers, such as minecraft:the_void.' });
    }
    if (config.surface === 'terrain-studio' && config.mode === 'overworld') {
        issues.push({ severity: 'info', code: 'surface-overworld', message: 'Terrain Studio surface rules replace vanilla surface rules in the Overworld.' });
    }
    issues.push({ severity: 'info', code: 'seed-fixed', message: `The graph seed is fixed at ${config.seed}. A Minecraft world seed cannot reach a custom density function, so different worlds from this export share terrain unless you change the graph seed and re-export.` });
    if (performance.label === 'Heavy') {
        issues.push({ severity: 'warning', code: 'performance', message: `This graph has ${performance.runtimeOperations} estimated runtime operations across ${performance.expensiveNodes} expensive nodes. Expect slower chunk generation than a simple graph.` });
    }
    if (config.mode === 'preset') {
        issues.push({ severity: 'info', code: 'preset-select', message: `World preset registered as ${config.dimensionId}. Choose it at world creation, or set level-type=${config.dimensionId} on a dedicated server.` });
    }
    if (config.mode === 'dimension') {
        issues.push({ severity: 'info', code: 'dimension-entry', message: `The dimension is registered as ${config.dimensionId}. Travel with /execute in ${config.dimensionId} run tp @s 0 100 0 after building the mod.` });
    }
    issues.push({ severity: 'info', code: 'target', message: `Target: ${profile.label}, Java ${profile.java}, generated density function.` });
    return { issues, compatibility, performance };
}

/** Stable across sessions: the same project name and graph produce the same project ID. */
export function projectIdFor(name: string, graph: TerrainGraph): string {
    let hash = 2166136261;
    const text = `${name}|${JSON.stringify(graph.nodes.map((node) => [node.id, node.kind, node.noiseType ?? '', node.scale ?? 0, node.amplitude ?? 0, node.seed ?? 0, node.factor ?? 0, node.rotation ?? 0]))}`;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function plannedFiles(config: MinecraftConfig): string[] {
    const source = 'src/main/java/net/terrainstudio/generated/TerrainStudioWorldgen.java';
    if (config.mode === 'overworld') {
        return [
            source,
            'src/main/resources/data/minecraft/worldgen/noise_settings/overworld.json',
            'src/main/resources/data/minecraft/worldgen/noise_settings/large_biomes.json',
            'src/main/resources/data/minecraft/worldgen/noise_settings/amplified.json',
        ];
    }
    const [namespace, path] = config.dimensionId.split(':');
    const base = `src/main/resources/data/${namespace}/worldgen`;
    const files = [
        source,
        `${base}/noise_settings/${path}.json`,
        `src/main/resources/data/${namespace}/dimension_type/${path}.json`,
        `src/main/resources/data/${namespace}/dimension/${path}.json`,
    ];
    if (config.mode === 'preset') files.push(`${base}/world_preset/${path}.json`);
    return files;
}

export interface IntegrationPackage {
    format: 'terrain-studio-minecraft';
    version: 1;
    generator: { name: 'Terrain Studio'; version: string };
    project: { id: string; name: string };
    target: { generator: MinecraftTarget; minecraft: string; loader: string; loaderVersion: string; java: number };
    mode: IntegrationMode;
    dimension: { id: string; name: string; biomeSource: BiomeSourceMode; biome: string };
    caves: CaveMode;
    surface: SurfaceMode;
    performance: PerformanceProfile;
    world: {
        minY: number; maxY: number; seaLevel: number; seed: number;
        logicalHeight: number; coordinateScale: number; ambientLight: number;
        hasSkylight: boolean; hasCeiling: boolean;
    };
    graph: { nodes: Array<{ id: string; data: Record<string, unknown> }>; edges: Array<{ id: string; source: string; target: string }> };
    validation: { errors: string[]; warnings: string[] };
    manifest: { managed: string[]; note: string };
}

const generatorVersion = '0.2.0';

function packageNode(node: EngineNode) {
    return {
        id: node.id,
        data: {
            kind: node.kind,
            title: node.title,
            noiseType: node.noiseType,
            scale: node.scale,
            amplitude: node.amplitude,
            seed: node.seed,
            factor: node.factor,
            min: node.min,
            max: node.max,
            inMin: node.inMin,
            inMax: node.inMax,
            outMin: node.outMin,
            outMax: node.outMax,
            gamma: node.gamma,
            steps: node.steps,
            strength: node.strength,
            rotation: node.rotation,
            threshold: node.threshold,
            exponent: node.exponent,
            bias: node.bias,
            contrast: node.contrast,
        },
    };
}

export function buildIntegrationPackage(name: string, graph: TerrainGraph, world: WorldSettings, config: MinecraftConfig, textures: CustomTextureGraph[] = []): IntegrationPackage {
    const { issues } = validateMinecraftExport(graph, world, config, textures);
    const errors = issues.filter((issue) => issue.severity === 'error').map((issue) => `[${issue.code}] ${issue.message}`);
    if (errors.length > 0) throw new Error(`Cannot export: ${errors[0]}`);
    const profile = targetProfile(config.target);
    // Custom textures are inlined here, so the plugin only ever sees node kinds it already compiles.
    const flat = flattenCustomTextures({ ...graph, nodes: graph.nodes.map((node) => ({ ...node })) }, textures);
    const compiled = compileGraph(flat);
    return {
        format: 'terrain-studio-minecraft',
        version: 1,
        generator: { name: 'Terrain Studio', version: generatorVersion },
        project: { id: projectIdFor(name, graph), name },
        target: { generator: profile.id, minecraft: profile.minecraft, loader: profile.loader, loaderVersion: profile.loaderVersion, java: profile.java },
        mode: config.mode,
        dimension: { id: config.dimensionId, name: config.dimensionName, biomeSource: config.biomeSource, biome: config.biome },
        caves: config.caves,
        surface: config.surface,
        performance: config.performance,
        world: {
            minY: world.minY, maxY: world.maxY, seaLevel: world.seaLevel, seed: config.seed,
            logicalHeight: config.logicalHeight ?? (world.maxY - world.minY + 1),
            coordinateScale: config.coordinateScale ?? 1,
            ambientLight: config.ambientLight ?? 0,
            hasSkylight: config.hasSkylight ?? true,
            hasCeiling: config.hasCeiling ?? false,
        },
        graph: {
            nodes: compiled.map((node) => packageNode(node)),
            // The compiled order only contains nodes that reach the output; keep edges inside it.
            edges: flat.edges
                .filter((edge) => compiled.some((node) => node.id === edge.source) && compiled.some((node) => node.id === edge.target))
                .map(({ id, source, target }) => ({ id, source, target })),
        },
        validation: {
            errors,
            warnings: issues.filter((issue) => issue.severity === 'warning').map((issue) => `[${issue.code}] ${issue.message}`),
        },
        manifest: {
            managed: plannedFiles(config),
            note: 'The MCreator plugin writes only these files, records their SHA-256 hashes in .terrain-studio/installed.json, backs up files before replacing them, and refuses to overwrite files edited outside Terrain Studio.',
        },
    };
}

export function serializeIntegrationPackage(pkg: IntegrationPackage): string {
    return `${JSON.stringify(pkg, null, 2)}\n`;
}
