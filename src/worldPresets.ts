import type { WorldSettings } from './terrainEngine';

export type WorldPreset = 'overworld' | 'amplified' | 'compact';

/**
 * Build-range presets. Sea level and height limits are the settings world-generation mods expose most
 * often, and they have to agree between the preview, the PNG and the exported density function.
 */
export const worldPresets: Array<{
    id: WorldPreset;
    label: string;
    detail: string;
    world: Required<Pick<WorldSettings, 'minY' | 'maxY' | 'seaLevel' | 'logicalHeight'>>;
}> = [
    { id: 'overworld', label: 'Overworld', detail: '-64 → 319 · sea 63', world: { minY: -64, maxY: 319, seaLevel: 63, logicalHeight: 384 } },
    { id: 'amplified', label: 'Amplified', detail: '-64 → 319 · sea 63', world: { minY: -64, maxY: 319, seaLevel: 63, logicalHeight: 384 } },
    { id: 'compact', label: 'Compact', detail: '0 → 255 · sea 63', world: { minY: 0, maxY: 255, seaLevel: 63, logicalHeight: 256 } },
];
