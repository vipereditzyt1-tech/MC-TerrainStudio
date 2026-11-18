import { evaluateHeightField, type CustomTextureGraph, type TerrainGraph, type WorldSettings } from './terrainEngine';

self.onmessage = (event: MessageEvent<{
    graph: TerrainGraph;
    world: WorldSettings;
    size: number;
    extent: number;
    textures?: CustomTextureGraph[];
}>) => {
    try {
        const { graph, world, size, extent, textures } = event.data;
        const result = evaluateHeightField(graph, world, size, extent, textures ?? []);
        self.postMessage({ ok: true, result }, { transfer: [result.values.buffer] });
    } catch (error) {
        self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Terrain generation failed.' });
    }
};
