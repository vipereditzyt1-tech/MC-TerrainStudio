import type { IntegrationMode, ValidationIssue } from '../minecraft/minecraftExport';
import type { WorldSettings } from '../engine/terrainEngine';
import { worldPresets, type WorldPreset } from '../minecraft/worldPresets';

type WorldSettingsPanelProps = {
    world: WorldSettings;
    inputs: { minY: string; maxY: string; seaLevel: string };
    onEdit: (field: 'minY' | 'maxY' | 'seaLevel', text: string) => void;
    onBlur: (field: 'minY' | 'maxY' | 'seaLevel') => void;
    onDimensionChange: (patch: Partial<WorldSettings>) => void;
    onPreset: (preset: WorldPreset) => void;
    mode: IntegrationMode;
    issues: ValidationIssue[];
};

/**
 * Global world settings. The build range and sea level drive the preview, the exported noise settings
 * and the generated density function; the dimension fields below them are written into the
 * dimension_type JSON for custom dimensions and world presets.
 */
export default function WorldSettingsPanel({
    world, inputs, onEdit, onBlur, onDimensionChange, onPreset, mode, issues,
}: WorldSettingsPanelProps) {
    const height = Math.max(1, Math.round(world.maxY - world.minY + 1));
    const dimensionMode = mode !== 'overworld';
    const worldIssues = issues.filter((issue) => ['overworld-bounds', 'height', 'height-range', 'min-y', 'sea-level', 'logical-height', 'coordinate-scale', 'ambient-light'].includes(issue.code));

    return (
        <div className="settings-panel">
            <div className="settings-panel-inner">
                <div className="world-view-heading">
                    <div>
                        <span className="eyebrow">Project · World settings</span>
                        <h2>World Settings</h2>
                        <p>
                            The vertical build range and sea level are global: the preview, the exported heightmap and
                            the generated Minecraft density function all read them. Dimension fields are written into
                            the <code>dimension_type</code> resource and apply to custom dimensions and world presets.
                        </p>
                    </div>
                </div>

                <div className="mc-section">
                    <div className="mc-section-title">Build range</div>
                    <div className="preset-row">
                        {worldPresets.map((preset) => (
                            <button
                                key={preset.id}
                                className={`preset-chip ${world.minY === preset.world.minY && world.maxY === preset.world.maxY && world.seaLevel === preset.world.seaLevel ? 'active' : ''}`}
                                onClick={() => onPreset(preset.id)}
                                title={`Apply ${preset.label}: ${preset.detail}`}
                            >
                                <strong>{preset.label}</strong>
                                <span>{preset.detail}</span>
                            </button>
                        ))}
                    </div>
                    <div className="mc-grid">
                        <label className="mc-field">
                            Minimum Y
                            <input type="number" step="16" value={inputs.minY} onChange={(event) => onEdit('minY', event.target.value)} onBlur={() => onBlur('minY')} />
                        </label>
                        <label className="mc-field">
                            Maximum Y
                            <input type="number" step="16" value={inputs.maxY} onChange={(event) => onEdit('maxY', event.target.value)} onBlur={() => onBlur('maxY')} />
                        </label>
                        <label className="mc-field">
                            Sea level
                            <input type="number" step="1" value={inputs.seaLevel} onChange={(event) => onEdit('seaLevel', event.target.value)} onBlur={() => onBlur('seaLevel')} />
                        </label>
                        <label className="mc-field">
                            Build height
                            <input value={`${Math.max(0, Math.round(world.maxY - world.minY + 1))} blocks`} readOnly />
                        </label>
                    </div>
                    <p className="mc-note">
                        Overworld replacement needs vanilla bounds (-64 → 319). Custom dimensions need a minimum Y
                        that is a multiple of 16 and a height that is a multiple of 16, up to 4064.
                    </p>
                </div>

                <div className={`mc-section ${dimensionMode ? '' : 'is-muted'}`}>
                    <div className="mc-section-title">Dimension type</div>
                    <div className="mc-grid">
                        <label className="mc-field">
                            Logical height
                            <input
                                type="number" step="16" disabled={!dimensionMode}
                                value={world.logicalHeight ?? height}
                                onChange={(event) => onDimensionChange({ logicalHeight: Number(event.target.value) })}
                            />
                        </label>
                        <label className="mc-field">
                            Coordinate scale
                            <input
                                type="number" step="0.5" disabled={!dimensionMode}
                                value={world.coordinateScale ?? 1}
                                onChange={(event) => onDimensionChange({ coordinateScale: Number(event.target.value) })}
                            />
                        </label>
                        <label className="mc-field">
                            Ambient light
                            <input
                                type="number" step="0.05" min="0" max="1" disabled={!dimensionMode}
                                value={world.ambientLight ?? 0}
                                onChange={(event) => onDimensionChange({ ambientLight: Number(event.target.value) })}
                            />
                        </label>
                        <label className="mc-field checkbox-field">
                            <input
                                type="checkbox" disabled={!dimensionMode}
                                checked={world.hasSkylight ?? true}
                                onChange={(event) => onDimensionChange({ hasSkylight: event.target.checked })}
                            />
                            Has skylight
                        </label>
                        <label className="mc-field checkbox-field">
                            <input
                                type="checkbox" disabled={!dimensionMode}
                                checked={world.hasCeiling ?? false}
                                onChange={(event) => onDimensionChange({ hasCeiling: event.target.checked })}
                            />
                            Has bedrock ceiling
                        </label>
                    </div>
                    <p className="mc-note">
                        {dimensionMode
                            ? 'Logical height limits portals and chorus fruit; it cannot exceed the build height. Coordinate scale multiplies coordinates when leaving the dimension (the Nether uses 8).'
                            : 'These fields only apply to Custom dimension and World preset exports. Overworld replacement keeps the vanilla dimension type.'}
                    </p>
                </div>

                {worldIssues.length > 0 && (
                    <div className="mc-section">
                        <div className="mc-section-title">Validation</div>
                        <ul className="mc-issues">
                            {worldIssues.map((issue, index) => (
                                <li key={`${issue.code}-${index}`} className={`mc-issue is-${issue.severity}`}>
                                    <span>{issue.severity}</span>
                                    {issue.message}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}
