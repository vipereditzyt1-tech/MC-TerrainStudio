import { useEffect, useMemo, useRef, useState } from 'react';
import type { Edge } from '@xyflow/react';
import { toTerrainGraph, type ProjectNode } from '../project/project';
import type { CustomTextureGraph, HeightField, WorldSettings } from '../engine/terrainEngine';
import { drawSurface3D } from './worldView3d.ts';

const PREVIEW_DEBOUNCE_MS = 160;
const PREVIEW_TIMEOUT_MS = 20000;

type WorldViewProps = {
    nodes: ProjectNode[];
    edges: Edge[];
    world: WorldSettings;
    resolution: 128 | 256 | 512;
    extent: 512 | 1024 | 4096;
    setResolution: (value: 128 | 256 | 512) => void;
    setExtent: (value: 512 | 1024 | 4096) => void;
    textures: CustomTextureGraph[];
};

function drawRelief2D(
    canvas: HTMLCanvasElement,
    field: HeightField,
    world: WorldSettings,
    style: 'relief' | 'blocks',
    showChunks: boolean,
    extent: number,
) {
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const size = field.size;
    const image = context.createImageData(size, size);
    const span = Math.max(1e-6, world.maxY - world.minY);
    const altitudes = new Float32Array(size * size);
    for (let i = 0; i < altitudes.length; i += 1) {
        altitudes[i] = Math.max(0, Math.min(1, (field.values[i] - world.minY) / span));
    }
    const relief = 70 * (size / 256);
    const lightX = -0.4, lightY = -0.4, lightZ = 1;
    const seaLevel = Math.max(0, Math.min(1, (world.seaLevel - world.minY) / span));
    let waterPixels = 0;
    for (let y = 0; y < size; y += 1) {
        const rowUp = Math.max(0, y - 1) * size;
        const rowDown = Math.min(size - 1, y + 1) * size;
        const row = y * size;
        for (let x = 0; x < size; x += 1) {
            const altitude = altitudes[row + x];
            const slopeX = (altitudes[row + Math.min(size - 1, x + 1)] - altitudes[row + Math.max(0, x - 1)]) * relief;
            const slopeY = (altitudes[rowDown + x] - altitudes[rowUp + x]) * relief;
            const normalX = -slopeX;
            const normalY = -slopeY;
            const length = Math.hypot(normalX, normalY, lightZ);
            const lambert = (normalX * lightX + normalY * lightY + lightZ) / length;
            const illumination = Math.max(0, Math.min(1, lambert / lightZ));
            const lit = 0.7 + 0.3 * illumination;
            const shade = Math.round(Math.max(0, Math.min(1, 0.08 + 0.92 * Math.pow(altitude, 0.9) * lit)) * 255);
            const offset = (row + x) * 4;
            if (altitude < seaLevel) {
                waterPixels += 1;
                const depth = Math.min(1, (seaLevel - altitude) / Math.max(1e-6, seaLevel));
                const mix = 0.4 + 0.4 * depth;
                if (style === 'blocks') {
                    image.data[offset] = Math.round(38 * (1 - mix) + 30 * mix);
                    image.data[offset + 1] = Math.round(94 * (1 - mix) + 72 * mix);
                    image.data[offset + 2] = Math.round(152 * (1 - mix) + 126 * mix);
                } else {
                    image.data[offset] = Math.round(shade * (1 - mix) + 26 * mix);
                    image.data[offset + 1] = Math.round(shade * (1 - mix) + 60 * mix);
                    image.data[offset + 2] = Math.round(shade * (1 - mix) + 86 * mix);
                }
            } else if (style === 'blocks') {
                const steep = Math.hypot(slopeX, slopeY) > 1.8;
                const tone = 0.72 + 0.28 * illumination;
                let red = 88, green = 140, blue = 72;
                if (altitude > 0.72) { red = 236; green = 242; blue = 248; }
                else if (steep || altitude > 0.58) { red = 122; green = 122; blue = 124; }
                else if (altitude < seaLevel + 0.02) { red = 214; green = 198; blue = 146; }
                image.data[offset] = Math.round(red * tone);
                image.data[offset + 1] = Math.round(green * tone);
                image.data[offset + 2] = Math.round(blue * tone);
            } else {
                image.data[offset] = shade;
                image.data[offset + 1] = shade;
                image.data[offset + 2] = shade;
            }
            image.data[offset + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    if (showChunks) {
        const chunkPixels = (size * 16) / extent;
        if (chunkPixels >= 3) {
            const every = chunkPixels < 6 ? 8 : 1;
            context.strokeStyle = 'rgba(186, 224, 255, 0.32)';
            context.lineWidth = 1;
            for (let chunk = 0; chunk * 16 <= extent; chunk += every) {
                const pixel = Math.round(((chunk * 16) / extent) * size) + 0.5;
                context.beginPath(); context.moveTo(pixel, 0); context.lineTo(pixel, size); context.stroke();
                context.beginPath(); context.moveTo(0, pixel); context.lineTo(size, pixel); context.stroke();
            }
        }
    }
    return waterPixels / (size * size);
}

export default function WorldView({ nodes, edges, world, resolution, extent, setResolution, setExtent, textures }: WorldViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { minY: worldMinY, maxY: worldMaxY, seaLevel: worldSeaLevel } = world;
    const worldSeed = world.seed ?? 0;
    const graph = useMemo(() => toTerrainGraph(nodes, edges), [nodes, edges]);
    const graphRef = useRef(graph);
    graphRef.current = graph;
    const texturesRef = useRef(textures);
    texturesRef.current = textures;
    // Every engine field belongs in the signature: a clamp bound or a warp strength changes the field
    // just as much as a noise seed does.
    const graphSignature = useMemo(() => JSON.stringify({
        nodes: graph.nodes.map(({ id, kind, noiseType, scale, amplitude, seed, factor, min, max, inMin, inMax,
            outMin, outMax, gamma, steps, strength, rotation, threshold, exponent, bias, contrast }) =>
            [id, kind, noiseType, scale, amplitude, seed, factor, min, max, inMin, inMax, outMin, outMax,
                gamma, steps, strength, rotation, threshold, exponent, bias, contrast]),
        edges: graph.edges.map(({ source, target }) => [source, target]),
        textures: textures.map((texture) => [texture.id, JSON.stringify(texture.graph)]),
    }), [graph, textures]);

    const [status, setStatus] = useState('Generating…');
    const [field, setField] = useState<HeightField | null>(null);
    const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
    const [previewStyle, setPreviewStyle] = useState<'relief' | 'blocks'>('relief');
    const [showChunks, setShowChunks] = useState(false);
    const [viewScale, setViewScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [yaw, setYaw] = useState(38);
    const [pitch, setPitch] = useState(52);
    const [surfaceZoom, setSurfaceZoom] = useState(1);
    const [exaggeration, setExaggeration] = useState(1);
    const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
    const orbitRef = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
    const generatedRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        let worker: Worker | null = null;
        let watchdog: ReturnType<typeof setTimeout> | undefined;

        const payload = graphRef.current;
        const texturePayload = texturesRef.current;

        const fail = (message: string) => {
            if (cancelled) return;
            setStatus(message);
        };

        const release = () => {
            clearTimeout(watchdog);
            worker?.terminate();
            worker = null;
        };

        const start = () => {
            if (cancelled) return;
            setStatus(generatedRef.current ? 'Regenerating…' : 'Generating…');
            worker = new Worker(new URL('../engine/terrainWorker.ts', import.meta.url), { type: 'module' });
            watchdog = setTimeout(() => {
                if (cancelled) return;
                release();
                fail('Terrain generation timed out. Showing the last successful preview — try a lower resolution or extent.');
            }, PREVIEW_TIMEOUT_MS);
            worker.onmessage = (event: MessageEvent<{ ok: boolean; error?: string; result?: HeightField }>) => {
                if (cancelled) return;
                clearTimeout(watchdog);
                if (!event.data.ok || !event.data.result) {
                    release();
                    fail(event.data.error ?? 'Terrain generation failed.');
                    return;
                }
                generatedRef.current = true;
                setField(event.data.result);
                setStatus('Ready');
            };
            worker.onerror = () => {
                clearTimeout(watchdog);
                release();
                fail('Terrain preview worker failed. Showing the last successful preview.');
            };
            worker.onmessageerror = () => {
                clearTimeout(watchdog);
                release();
                fail('Terrain preview worker returned an unreadable result. Showing the last successful preview.');
            };
            worker.postMessage({
                graph: payload,
                world: { minY: worldMinY, maxY: worldMaxY, seaLevel: worldSeaLevel, seed: worldSeed },
                size: resolution,
                extent,
                textures: texturePayload,
            });
        };

        const timer = setTimeout(start, generatedRef.current ? PREVIEW_DEBOUNCE_MS : 0);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            release();
        };
    }, [graphSignature, worldMinY, worldMaxY, worldSeaLevel, worldSeed, resolution, extent]);

    // A single draw pass for both views keeps orbit drags off the worker: only the projection changes.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !field) return;
        if (viewMode === '3d') {
            canvas.width = canvas.height = 640;
            drawSurface3D(canvas, field, { yaw, pitch, zoom: surfaceZoom, exaggeration, water: true, seaLevel: worldSeaLevel });
            return;
        }
        canvas.width = canvas.height = field.size;
        drawRelief2D(canvas, field, world, previewStyle, showChunks, extent);
    }, [field, viewMode, yaw, pitch, surfaceZoom, exaggeration, previewStyle, showChunks, world, worldSeaLevel, extent]);

    const waterCover = useMemo(() => {
        if (!field) return null;
        const span = Math.max(1e-6, world.maxY - world.minY);
        const seaLevel = Math.max(0, Math.min(1, (world.seaLevel - world.minY) / span));
        let water = 0;
        for (let i = 0; i < field.values.length; i += 1) {
            if (Math.max(0, Math.min(1, (field.values[i] - world.minY) / span)) < seaLevel) water += 1;
        }
        return water / field.values.length;
    }, [field, world.maxY, world.minY, world.seaLevel]);

    const generating = status === 'Generating…' || status === 'Regenerating…';
    const orbitStyle = { cursor: 'grab' as const };

    return (
        <div className="world-view">
            <div className="world-view-heading">
                <div>
                    <span className="eyebrow">Graph output · Height field</span>
                    <h2>World View</h2>
                    <p>
                        Shaded relief with tinted water below sea level, plus a rotatable 3D surface of the same
                        height field. Exported PNGs stay plain grayscale, one pixel per sample.
                    </p>
                </div>
            </div>

            <div className="world-preview-controls">
                <label>
                    Resolution
                    <select value={resolution} onChange={(event) => setResolution(Number(event.target.value) as 128 | 256 | 512)}>
                        <option value={128}>128 × 128</option>
                        <option value={256}>256 × 256</option>
                        <option value={512}>512 × 512</option>
                    </select>
                </label>
                <label>
                    World extent
                    <select value={extent} onChange={(event) => setExtent(Number(event.target.value) as 512 | 1024 | 4096)}>
                        <option value={512}>512 blocks</option>
                        <option value={1024}>1,024 blocks</option>
                        <option value={4096}>4,096 blocks</option>
                    </select>
                </label>
                <label>
                    Preview style
                    <select value={previewStyle} onChange={(event) => setPreviewStyle(event.target.value as 'relief' | 'blocks')}>
                        <option value="relief">Shaded relief</option>
                        <option value="blocks">Minecraft blocks</option>
                    </select>
                </label>
                <label className="chunk-toggle">
                    <input type="checkbox" checked={showChunks} onChange={(event) => setShowChunks(event.target.checked)} />
                    Chunk grid
                </label>
                <div className="view-mode-switch" role="group" aria-label="World view mode">
                    <button className={viewMode === '2d' ? 'active' : ''} onClick={() => setViewMode('2d')} aria-pressed={viewMode === '2d'}>2D map</button>
                    <button className={viewMode === '3d' ? 'active' : ''} onClick={() => setViewMode('3d')} aria-pressed={viewMode === '3d'}>3D surface</button>
                </div>
                <button onClick={() => { setViewScale(1); setOffset({ x: 0, y: 0 }); setYaw(38); setPitch(52); setSurfaceZoom(1); setExaggeration(1); }}>Reset view</button>
            </div>

            {viewMode === '3d' && (
                <div className="world-preview-controls is-secondary">
                    <label className="slider-field">
                        Exaggeration
                        <input type="range" min="0.4" max="2.6" step="0.1" value={exaggeration} onChange={(event) => setExaggeration(Number(event.target.value))} />
                    </label>
                    <label className="slider-field">
                        Yaw
                        <input type="range" min="-180" max="180" step="1" value={yaw} onChange={(event) => setYaw(Number(event.target.value))} />
                    </label>
                    <label className="slider-field">
                        Pitch
                        <input type="range" min="8" max="88" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} />
                    </label>
                    <button onClick={() => { setYaw(38); setPitch(52); setSurfaceZoom(1); }}>Reset camera</button>
                </div>
            )}

            <div className="world-preview-layout">
                <div
                    className={`world-preview-stage heightmap-stage ${viewMode === "3d" ? "is-3d" : ""}`}
                    onWheel={(event) => {
                        event.preventDefault();
                        if (viewMode === '3d') {
                            setSurfaceZoom((value) => Math.max(0.4, Math.min(3, value * (event.deltaY < 0 ? 1.12 : 1 / 1.12))));
                        } else {
                            setViewScale((value) => Math.max(0.5, Math.min(4, value * (event.deltaY < 0 ? 1.15 : 1 / 1.15))));
                        }
                    }}
                    onPointerDown={(event) => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        if (viewMode === '3d') {
                            orbitRef.current = { x: event.clientX, y: event.clientY, yaw, pitch };
                        } else {
                            dragRef.current = { x: event.clientX, y: event.clientY, left: offset.x, top: offset.y };
                        }
                    }}
                    onPointerMove={(event) => {
                        if (orbitRef.current) {
                            const start = orbitRef.current;
                            setYaw(start.yaw + (event.clientX - start.x) * 0.4);
                            setPitch(Math.max(8, Math.min(88, start.pitch - (event.clientY - start.y) * 0.3)));
                        } else if (dragRef.current) {
                            setOffset({ x: dragRef.current.left + event.clientX - dragRef.current.x, y: dragRef.current.top + event.clientY - dragRef.current.y });
                        }
                    }}
                    onPointerUp={() => { dragRef.current = null; orbitRef.current = null; }}
                    onPointerCancel={() => { dragRef.current = null; orbitRef.current = null; }}
                >
                    <canvas
                        ref={canvasRef}
                        aria-label={viewMode === '3d' ? '3D surface preview' : 'Graph heightmap preview'}
                        style={viewMode === '3d' ? orbitStyle : { transform: `translate(${offset.x}px, ${offset.y}px) scale(${viewScale})` }}
                    />
                    {status !== 'Ready' && (
                        <div className={`preview-message ${generating ? 'is-progress' : 'is-error'}`} role="status">
                            <span>{status}</span>
                        </div>
                    )}
                </div>

                <div className="world-metrics">
                    <div><span>Status</span><strong>{status}</strong></div>
                    <div><span>View</span><strong>{viewMode === '3d' ? '3D surface' : '2D map'}</strong></div>
                    <div><span>Height range</span><strong>{field ? `${field.min.toFixed(1)} → ${field.max.toFixed(1)}` : '—'}</strong></div>
                    <div><span>World bounds</span><strong>{world.minY} → {world.maxY}</strong></div>
                    <div><span>Sea level</span><strong>{world.seaLevel}</strong></div>
                    <div><span>Water cover</span><strong>{waterCover === null ? '—' : `${Math.round(waterCover * 100)}%`}</strong></div>
                    <div><span>Navigation</span><strong>{viewMode === '3d' ? 'Drag to orbit · scroll to zoom' : 'Scroll to zoom · drag to pan'}</strong></div>
                </div>
            </div>
        </div>
    );
}
