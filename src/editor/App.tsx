import {
    useState,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    type CSSProperties,
} from "react";

import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    Handle,
    Position,
    addEdge,
    useNodesState,
    useEdgesState,
    type Node,
    type Edge,
    type Connection,
    type NodeProps,
    type NodeChangeset,
    type EdgeChangeset,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./App.css";
import "./design.css";
import { compileGraph } from "../engine/terrainEngine.ts";
import type { CustomTextureGraph, TerrainKind, WorldSettings } from "../engine/terrainEngine.ts";
import { parseProject, projectGraph, toTerrainGraph, type ProjectDocument } from "../project/project.ts";
import {
    describeParameters,
    libraryGroups,
    nodeLibrary,
    noiseOptions,
    noiseTypeLabel,
    type LibraryNode,
    type NoiseType,
} from "./nodeCatalog.ts";
import { parameterFields } from "./nodeFields.ts";
import { categoryAccent } from "./nodeCatalog.ts";
import WorldView from "../world/WorldView.tsx";
import WorldSettingsPanel from "../world/WorldSettingsPanel.tsx";
import { worldPresets, type WorldPreset } from "../minecraft/worldPresets.ts";
import {
    DEFAULT_MINECRAFT_CONFIG,
    buildIntegrationPackage,
    serializeIntegrationPackage,
    targetProfiles,
    validateMinecraftExport,
    type MinecraftConfig,
} from "../minecraft/minecraftExport.ts";

type TerrainNodeData = {
    title: string;
    category: string;
    description: string;
    value: string;
    accent: string;
    noiseType?: NoiseType;
    textureId?: string;
    kind?: TerrainKind;
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

type CustomTexture = {
    id: string;
    name: string;
    nodes: TerrainNode[];
    edges: Edge[];
};

type TerrainNode = Node<TerrainNodeData>;

type GraphSnapshot = {
    nodes: TerrainNode[];
    edges: Edge[];
    worldSettings: WorldSettings;
    customTextures: CustomTexture[];
};

type CutPoint = {
    x: number;
    y: number;
};

const initialNodes: TerrainNode[] = [
    {
        id: "coordinates",
        type: "terrain",
        position: { x: 60, y: 220 },
        data: {
            title: "Coordinates",
            kind: "coordinates",
            category: "INPUT",
            description: "Provides world-space coordinates.",
            value: "World Position",
            accent: categoryAccent.INPUT,
        },
    },
    {
        id: "continental",
        type: "terrain",
        position: { x: 370, y: 80 },
        data: {
            title: "Continental Noise",
            kind: "noise",
            scale: 0.0015,
            amplitude: 0.55,
            seed: 101,
            category: "GENERATION",
            description: "Generates broad continental landforms.",
            value: "Scale: 0.0015",
            accent: categoryAccent.GENERATION,
            noiseType: "minecraft-continentalness",
        },
    },
    {
        id: "ridged",
        type: "terrain",
        position: { x: 370, y: 350 },
        data: {
            title: "Noise Texture",
            kind: "noise",
            scale: 0.008,
            amplitude: 0.35,
            seed: 7,
            category: "GENERATION",
            description: "Generates ridge-like terrain structures.",
            value: "Scale: 0.008",
            accent: categoryAccent.GENERATION,
            noiseType: "ridged",
        },
    },
    {
        id: "combine",
        type: "terrain",
        position: { x: 720, y: 220 },
        data: {
            title: "Combine Terrain",
            kind: "add",
            category: "OPERATIONS",
            description: "Combines terrain signals.",
            value: "Method: Add",
            accent: categoryAccent.OPERATIONS,
        },
    },
    {
        id: "output",
        type: "terrain",
        position: { x: 1050, y: 220 },
        data: {
            title: "Terrain Output",
            kind: "output",
            category: "OUTPUT",
            description: "Defines the final terrain height.",
            value: "Height Field",
            accent: categoryAccent.OUTPUT,
        },
    },
];

const initialEdges: Edge[] = [
    { id: "e1", source: "coordinates", target: "continental", animated: true },
    { id: "e2", source: "coordinates", target: "ridged", animated: true },
    { id: "e3", source: "continental", target: "combine", animated: true },
    { id: "e4", source: "ridged", target: "combine", animated: true },
    { id: "e5", source: "combine", target: "output", animated: true },
];

type IconName =
    | "doc"
    | "filePlus"
    | "folder"
    | "save"
    | "saveAs"
    | "undo"
    | "redo"
    | "reset"
    | "export"
    | "search"
    | "graph"
    | "world"
    | "wave"
    | "chevron"
    | "settings"
    | "plus"
    | "library"
    | "sliders"
    | "close";

function Icon({ name }: { name: IconName }) {
    const shared = {
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.6,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        "aria-hidden": true,
    };

    switch (name) {
        case "doc":
            return (
                <svg {...shared}>
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5" />
                </svg>
            );
        case "filePlus":
            return (
                <svg {...shared}>
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5" />
                    <path d="M12 12v5M9.5 14.5h5" />
                </svg>
            );
        case "folder":
            return (
                <svg {...shared}>
                    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
                </svg>
            );
        case "save":
            return (
                <svg {...shared}>
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10.5L21 8.5V19a2 2 0 0 1-2 2z" />
                    <path d="M8 3v5.5h6.5" />
                    <path d="M8 21v-6h8v6" />
                </svg>
            );
        case "saveAs":
            return (
                <svg {...shared}>
                    <rect x="9" y="9" width="11" height="11" rx="2.5" />
                    <path d="M15 5.5V5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2H6" />
                </svg>
            );
        case "undo":
            return (
                <svg {...shared}>
                    <path d="M9 14 4 9l5-5" />
                    <path d="M4 9h9.5a6 6 0 0 1 0 12H9" />
                </svg>
            );
        case "redo":
            return (
                <svg {...shared}>
                    <path d="M15 14l5-5-5-5" />
                    <path d="M20 9h-9.5a6 6 0 0 0 0 12H15" />
                </svg>
            );
        case "reset":
            return (
                <svg {...shared}>
                    <path d="M3.2 12a8.8 8.8 0 1 0 2.6-6.2" />
                    <path d="M3 4v5h5" />
                </svg>
            );
        case "export":
            return (
                <svg {...shared}>
                    <path d="M12 15V4" />
                    <path d="M8 8l4-4 4 4" />
                    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
                </svg>
            );
        case "search":
            return (
                <svg {...shared}>
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="M16 16l4.5 4.5" />
                </svg>
            );
        case "graph":
            return (
                <svg {...shared}>
                    <circle cx="6" cy="6" r="2.3" />
                    <circle cx="18" cy="12" r="2.3" />
                    <circle cx="6" cy="18" r="2.3" />
                    <path d="M8.3 7 15.7 11M8.3 17 15.7 13" />
                </svg>
            );
        case "world":
            return (
                <svg {...shared}>
                    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
                    <path d="M3 16.5l4.6-5.2 3.4 3.4 2.9-3.5L21 17" />
                </svg>
            );
        case "wave":
            return (
                <svg {...shared}>
                    <path d="M3 14.5c2.2-6 4.4-6 6.6 0s4.4 6 6.6 0 4.4-6 6.6 0" />
                </svg>
            );
        case "chevron":
            return (
                <svg {...shared}>
                    <path d="M6 9.5l6 6 6-6" />
                </svg>
            );
        case "settings":
            return (
                <svg {...shared}>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
                </svg>
            );
        case "plus":
            return (
                <svg {...shared}>
                    <path d="M12 5v14M5 12h14" />
                </svg>
            );
        case "library":
            return (
                <svg {...shared}>
                    <path d="M4 6h16M4 12h16M4 18h16" />
                    <circle cx="8" cy="6" r="1.6" />
                    <circle cx="15" cy="12" r="1.6" />
                    <circle cx="10" cy="18" r="1.6" />
                </svg>
            );
        case "sliders":
            return (
                <svg {...shared}>
                    <path d="M4 7h16M4 17h16" />
                    <circle cx="9" cy="7" r="2.2" />
                    <circle cx="15" cy="17" r="2.2" />
                </svg>
            );
        case "close":
            return (
                <svg {...shared}>
                    <path d="M6 6l12 12M18 6L6 18" />
                </svg>
            );
        default:
            return null;
    }
}

function TerrainNodeComponent({
    data,
    selected,
}: NodeProps<TerrainNode>) {
    // Selection is a flat outline in the node's own category colour — no glow, no elevation.
    const nodeStyle: CSSProperties = selected ? { borderColor: data.accent } : {};

    return (
        <div className="terrain-node" style={nodeStyle}>
            {data.kind !== "coordinates" && <Handle type="target" position={Position.Left} />}

            <div className="terrain-node-header">
                <span className="terrain-node-dot" style={{ background: data.accent }} />
                <span className="terrain-node-category">{data.category}</span>
            </div>

            <div className="terrain-node-title">{data.title}</div>
            <div className="terrain-node-description">{data.description}</div>
            <div className="terrain-node-value">
                {data.noiseType ? noiseTypeLabel(data.noiseType) : data.value}
            </div>

            {data.kind !== "output" && <Handle type="source" position={Position.Right} />}
        </div>
    );
}

function hash2d(x: number, y: number, seed = 17) {
    const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return value - Math.floor(value);
}

function smoothNoise(x: number, y: number, seed = 17) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const fade = (value: number) => value * value * (3 - 2 * value);
    const sx = fade(tx);
    const sy = fade(ty);
    const a = hash2d(x0, y0, seed);
    const b = hash2d(x0 + 1, y0, seed);
    const c = hash2d(x0, y0 + 1, seed);
    const d = hash2d(x0 + 1, y0 + 1, seed);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

function sampleNoise(type: NoiseType = "perlin", x: number, y: number) {
    const scale = type.startsWith("minecraft-") ? 1.35 : type === "cellular" ? 3.2 : type === "wave" ? 1.6 : 2.4;
    const nx = x * scale;
    const ny = y * scale;
    if (type === "wave") {
        const primary = Math.sin(nx * 6.283185307179586);
        const secondary = Math.sin(ny * 6.283185307179586 * 0.5);
        return Math.max(0, Math.min(1, 0.5 + 0.5 * (primary * 0.65 + secondary * 0.35)));
    }
    if (type === "custom") return sampleNoise("perlin", x, y);
    if (type === "cellular") {
        let nearest = 1;
        for (let ix = -1; ix <= 1; ix += 1) {
            for (let iy = -1; iy <= 1; iy += 1) {
                const px = Math.floor(nx) + ix + hash2d(Math.floor(nx) + ix, Math.floor(ny) + iy, 31);
                const py = Math.floor(ny) + iy + hash2d(Math.floor(nx) + ix, Math.floor(ny) + iy, 47);
                nearest = Math.min(nearest, Math.hypot(nx - px, ny - py));
            }
        }
        return 1 - Math.min(1, nearest);
    }
    if (type === "ridged" || type === "minecraft-weirdness") {
        return 1 - Math.abs(smoothNoise(nx, ny, type === "ridged" ? 7 : 19) * 2 - 1);
    }
    const climate = (frequency: number, seed: number) => {
        const coarse = smoothNoise(nx * frequency, ny * frequency, seed);
        const detail = smoothNoise(nx * frequency * 2.3, ny * frequency * 2.3, seed + 41);
        return Math.max(0, Math.min(1, coarse * 0.68 + detail * 0.32));
    };
    if (type === "minecraft-continentalness") return climate(2.4, 101);
    if (type === "minecraft-erosion") return climate(1.9, 203);
    if (type === "minecraft-temperature") return climate(1.5, 307);
    if (type === "value") return smoothNoise(nx, ny, 83);
    return (smoothNoise(nx, ny, type === "simplex" ? 53 : 17) + smoothNoise(nx * 2, ny * 2, 29)) / 2;
}

function TexturePreview({ type = "perlin", mode = "2d", large = false }: { type?: NoiseType; mode?: "2d" | "3d"; large?: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fieldRef = useRef<{ key: string; values: Float32Array } | null>(null);
    const [azimuth, setAzimuth] = useState(45);
    const [elevation, setElevation] = useState(30);
    const [zoom, setZoom] = useState(1.0);
    const dragStateRef = useRef<{ startX: number; startY: number; startAzimuth: number; startElevation: number } | null>(null);

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (mode !== "3d") return;
        dragStateRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            startAzimuth: azimuth,
            startElevation: elevation,
        };
    };

    const frameRef = useRef<number | null>(null);
    const pendingViewRef = useRef<{ azimuth: number; elevation: number } | null>(null);

    useEffect(() => () => {
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    }, []);

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!dragStateRef.current || mode !== "3d") return;
        const deltaX = e.clientX - dragStateRef.current.startX;
        const deltaY = e
            .clientY - dragStateRef.current.startY;
        // Pointer events can outpace the display; coalesce to one redraw per frame.
        pendingViewRef.current = {
            azimuth: dragStateRef.current.startAzimuth + deltaX * 0.5,
            elevation: Math.max(-89, Math.min(89, dragStateRef.current.startElevation - deltaY * 0.5)),
        };
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
            frameRef.current = null;
            const pending = pendingViewRef.current;
            if (!pending) return;
            setAzimuth(pending.azimuth);
            setElevation(pending.elevation);
        });
    };

    const handleMouseUp = () => {
        dragStateRef.current = null;
    };

    const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
        if (mode !== "3d") return;
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.1 : 0.9;
        setZoom((current) => Math.max(0.3, Math.min(3.0, current * factor)));
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const size = large ? 560 : 180;
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = size;
        canvas.height = size;
        const image = context.createImageData(size, size);
        // Sampling depends only on the noise model and size, so reuse the field when just
        // the view changes (3D drag, zoom) instead of resampling on every frame.
        const fieldKey = `${type}:${size}`;
        if (fieldRef.current?.key !== fieldKey) {
            const sampled = new Float32Array(size * size);
            for (let y = 0; y < size; y += 1) {
                for (let x = 0; x < size; x += 1) {
                    sampled[y * size + x] = sampleNoise(type, x / size, y / size);
                }
            }
            fieldRef.current = { key: fieldKey, values: sampled };
        }
        const values = fieldRef.current.values;
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const value = values[y * size + x];
                const height = mode === "3d" ? value * 0.75 + 0.15 : value;
                const index = (y * size + x) * 4;
                // Ink on paper, not a blue heat map: the sample belongs to the same surface as the app.
                image.data[index] = Math.round(246 - height * 208);
                image.data[index + 1] = Math.round(243 - height * 201);
                image.data[index + 2] = Math.round(236 - height * 191);
                image.data[index + 3] = 255;
            }
        }
        context.putImageData(image, 0, 0);
        if (mode === "3d") {
            context.globalAlpha = 0.3;
            context.strokeStyle = "#262a2c";
            const azRad = (azimuth * Math.PI) / 180;
            const elRad = (elevation * Math.PI) / 180;
            for (let y = 0; y < size; y += Math.max(12, Math.floor(size / 18))) {
                context.beginPath();
                for (let x = 0; x < size; x += 4) {
                    const normalizedX = (x / size - 0.5) * 2;
                    const normalizedY = (y / size - 0.5) * 2;
                    const rotX = normalizedX * Math.cos(azRad) - normalizedY * Math.sin(azRad);
                    const rotY = normalizedX * Math.sin(azRad) + normalizedY * Math.cos(azRad);
                    const heightAtPoint = values[y * size + x];
                    const screenY = rotY * Math.cos(elRad) + heightAtPoint * Math.sin(elRad);
                    const screenHeight = heightAtPoint * Math.cos(elRad) - rotY * Math.sin(elRad);
                    const plotX = (rotX * 0.5 + 0.5) * size * zoom + size * (1 - zoom) / 2;
                    const plotY = (screenY * 0.5 + 0.5) * size * zoom + size * (1 - zoom) / 2 - screenHeight * size * 0.12 * zoom;
                    context.lineTo(plotX, plotY);
                }
                context.stroke();
            }
            context.globalAlpha = 1;
        }
    }, [type, mode, large, azimuth, elevation, zoom]);

    return (
        <canvas
            ref={canvasRef}
            className="texture-preview-canvas"
            aria-label={`${noiseTypeLabel(type)} ${mode} preview`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
            style={{ cursor: mode === "3d" ? "grab" : "default" }}
        />
    );
}

const EXPORT_TIMEOUT_MS = 60000;
// Unsaved work is snapshotted to the app's userData directory: shortly after typing stops, and again
// on a slow timer so a long uninterrupted session still has a recent copy.
const RECOVERY_DEBOUNCE_MS = 3000;
const RECOVERY_INTERVAL_MS = 20000;

const nodeTypes = {
    terrain: TerrainNodeComponent,
};

// React Flow 13 documents applyNodeChanges/applyEdgeChanges but does not export them from its
// type declarations, so a custom-texture canvas applies the change set itself.
function applyNodePatch(changes: NodeChangeset<TerrainNode>, current: TerrainNode[]): TerrainNode[] {
    let next = current;
    for (const change of changes) {
        if (change.type === "position" && change.position) {
            next = next.map((node) => (node.id === change.id
                ? { ...node, position: change.position!, dragging: change.dragging ?? false }
                : node));
        } else if (change.type === "select") {
            next = next.map((node) => (node.id === change.id ? { ...node, selected: change.selected } : node));
        } else if (change.type === "remove") {
            next = next.filter((node) => node.id !== change.id);
        } else if (change.type === "dimensions" && change.dimensions) {
            const dimensions = change.dimensions;
            next = next.map((node) => (node.id === change.id
                ? { ...node, measured: { ...node.measured, ...dimensions }, width: dimensions.width, height: dimensions.height }
                : node));
        } else if (change.type === "replace") {
            next = next.map((node) => (node.id === change.id ? change.item : node));
        } else if (change.type === "add") {
            next = [...next, change.item];
        }
    }
    return next;
}

function applyEdgePatch(changes: EdgeChangeset<Edge>, current: Edge[]): Edge[] {
    let next = current;
    for (const change of changes) {
        if (change.type === "select") {
            next = next.map((edge) => (edge.id === change.id ? { ...edge, selected: change.selected } : edge));
        } else if (change.type === "remove") {
            next = next.filter((edge) => edge.id !== change.id);
        } else if (change.type === "replace") {
            next = next.map((edge) => (edge.id === change.id ? change.item : edge));
        } else if (change.type === "add") {
            next = [...next, change.item];
        }
    }
    return next;
}

function cloneGraph(nodes: TerrainNode[], edges: Edge[], worldSettings: WorldSettings, customTextures: CustomTexture[]): GraphSnapshot {
    return {
        nodes: structuredClone(nodes),
        edges: structuredClone(edges),
        worldSettings: { ...worldSettings },
        customTextures: structuredClone(customTextures),
    };
}

function segmentsIntersect(a: CutPoint, b: CutPoint, c: CutPoint, d: CutPoint): boolean {
    const cross = (p: CutPoint, q: CutPoint, r: CutPoint) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const onSegment = (p: CutPoint, q: CutPoint, r: CutPoint) =>
        q.x >= Math.min(p.x, r.x) - 0.001 && q.x <= Math.max(p.x, r.x) + 0.001 &&
        q.y >= Math.min(p.y, r.y) - 0.001 && q.y <= Math.max(p.y, r.y) + 0.001;
    const abC = cross(a, b, c), abD = cross(a, b, d);
    const cdA = cross(c, d, a), cdB = cross(c, d, b);
    if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
        ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
    return (Math.abs(abC) < 0.001 && onSegment(a, c, b)) ||
        (Math.abs(abD) < 0.001 && onSegment(a, d, b)) ||
        (Math.abs(cdA) < 0.001 && onSegment(c, a, d)) ||
        (Math.abs(cdB) < 0.001 && onSegment(c, b, d));
}

// Sample the actual rendered SVG path in screen coordinates, so variable node
// dimensions, reversed edges, zoom and pan all use the geometry the user sees.
function pathIntersectsCut(path: SVGPathElement, stroke: CutPoint[]): boolean {
    const matrix = path.getScreenCTM();
    if (!matrix || stroke.length < 2) return false;
    const length = path.getTotalLength();
    const scale = Math.hypot(matrix.a, matrix.b);
    const steps = Math.max(1, Math.ceil(length * scale / 4));
    const screenPoint = (distance: number): CutPoint => {
        const point = path.getPointAtLength(distance).matrixTransform(matrix);
        return { x: point.x, y: point.y };
    };
    let previous = screenPoint(0);
    for (let i = 1; i <= steps; i++) {
        const current = screenPoint(length * i / steps);
        for (let j = 1; j < stroke.length; j++) {
            if (segmentsIntersect(stroke[j - 1], stroke[j], previous, current)) return true;
        }
        previous = current;
    }
    return false;
}

// Bound undo history by retained nodes as well as step count: `parseProject` accepts
// 10,000 nodes, and 100 deep copies of that is not a sane amount of memory.
const HISTORY_NODE_BUDGET = 20000;

type ProjectSource = {
    name: string;
    nodes: TerrainNode[];
    edges: Edge[];
    world: WorldSettings;
    customTextures: CustomTexture[];
    resolution: 128 | 256 | 512;
    extent: 512 | 1024 | 4096;
    minecraft: MinecraftConfig;
};

// One builder for both the live document and the "saved" baseline, so a fresh launch or a
// freshly opened project is not reported as modified.
function buildProjectDocument(source: ProjectSource): ProjectDocument {
    return {
        format: "terrain-studio", version: 1, name: source.name,
        graph: projectGraph(source.nodes, source.edges),
        world: { minY: source.world.minY, maxY: source.world.maxY, seaLevel: source.world.seaLevel },
        customTextures: source.customTextures.map((texture) => ({ id: texture.id, name: texture.name, ...projectGraph(texture.nodes, texture.edges) })),
        preview: { resolution: source.resolution, extent: source.extent },
        minecraft: source.minecraft,
    };
}

const initialProjectText = JSON.stringify(buildProjectDocument({
    name: "Appalachian Terrain",
    nodes: initialNodes,
    edges: initialEdges,
    world: { minY: -64, maxY: 319, seaLevel: 63 },
    customTextures: [],
    resolution: 256,
    extent: 1024,
    minecraft: DEFAULT_MINECRAFT_CONFIG,
}));

type MinecraftPanelProps = {
    config: MinecraftConfig;
    onChange: (patch: Partial<MinecraftConfig>) => void;
    validation: ReturnType<typeof validateMinecraftExport>;
    message: string;
    exporting: boolean;
    onExport: () => void;
    sending: boolean;
    onSend: () => void;
    world: WorldSettings;
};

function MinecraftPanel({ config, onChange, validation, message, exporting, onExport, sending, onSend, world }: MinecraftPanelProps) {
    const errors = validation.issues.filter((issue) => issue.severity === "error");
    const unsupported = validation.compatibility.filter((node) => node.status === "unsupported");
    const runtime = validation.compatibility.length - unsupported.length;
    const dimensionMode = config.mode !== "overworld";

    return (
        <div className="minecraft-panel">
            <div className="minecraft-panel-inner">
                <div className="world-view-heading">
                    <div>
                        <span className="eyebrow">Export · MCreator integration</span>
                        <h2>Minecraft Integration</h2>
                        <p>
                            The graph is compiled into a generated Java density function, then imported into a supported
                            NeoForge MCreator workspace. The same evaluator drives the preview and the exported terrain.
                        </p>
                    </div>
                </div>

                <div className="mc-section">
                    <div className="mc-section-title">Target</div>
                    <div className="mc-grid">
                        <label className="mc-field">
                            Minecraft target
                            <select value={config.target} onChange={(event) => onChange({ target: event.target.value as MinecraftConfig["target"] })}>
                                {targetProfiles.map((profile) => (
                                    <option key={profile.id} value={profile.id}>{profile.label} · Java {profile.java}</option>
                                ))}
                            </select>
                        </label>
                        <label className="mc-field">
                            Generation mode
                            <select value={config.mode} onChange={(event) => onChange({ mode: event.target.value as MinecraftConfig["mode"] })}>
                                <option value="overworld">Overworld replacement</option>
                                <option value="dimension">Custom dimension</option>
                                <option value="preset">World preset</option>
                            </select>
                        </label>
                    </div>
                    <p className="mc-note">
                        {config.mode === "overworld"
                            ? "Replaces vanilla Overworld terrain for Default, Large Biomes and Amplified. Biomes, ores and structures stay vanilla; cave noise is removed unless enabled below."
                            : config.mode === "dimension"
                                ? "Registers a separate dimension with its own height range, sea level and biome source. Enter it with /execute in <id> run tp."
                                : "Registers a data-driven world preset. The save stays vanilla-compatible, and the preset is selectable where Minecraft lists world presets."}
                    </p>
                </div>

                <div className="mc-section">
                    <div className="mc-section-title">World configuration</div>
                    <div className="mc-grid">
                        <label className="mc-field">
                            Dimension ID
                            <input value={config.dimensionId} disabled={!dimensionMode} onChange={(event) => onChange({ dimensionId: event.target.value })} placeholder="terrainstudio:highlands" />
                        </label>
                        <label className="mc-field">
                            Package label
                            <input value={config.dimensionName} disabled={!dimensionMode} onChange={(event) => onChange({ dimensionName: event.target.value })} />
                        </label>
                        <label className="mc-field">
                            Biome source
                            <select value={config.biomeSource} disabled={config.mode === "overworld"} onChange={(event) => onChange({ biomeSource: event.target.value as MinecraftConfig["biomeSource"] })}>
                                <option value="vanilla">Vanilla Overworld biomes</option>
                                <option value="fixed">Single fixed biome</option>
                            </select>
                        </label>
                        <label className="mc-field">
                            Fixed biome
                            <input value={config.biome} disabled={config.mode === "overworld" || config.biomeSource !== "fixed"} onChange={(event) => onChange({ biome: event.target.value })} placeholder="minecraft:plains" />
                        </label>
                        <label className="mc-field">
                            Caves
                            <select value={config.caves} onChange={(event) => onChange({ caves: event.target.value as MinecraftConfig["caves"] })}>
                                <option value="none">No density caves</option>
                                <option value="vanilla-approximate">Vanilla cave noise (approximate heights)</option>
                            </select>
                        </label>
                        <label className="mc-field">
                            Surface rules
                            <select value={config.surface} onChange={(event) => onChange({ surface: event.target.value as MinecraftConfig["surface"] })}>
                                <option value="vanilla">Vanilla surface rules</option>
                                <option value="terrain-studio">Terrain Studio basic rules</option>
                            </select>
                        </label>
                        <label className="mc-field">
                            Graph seed
                            <input type="number" step="1" value={config.seed} onChange={(event) => onChange({ seed: Number(event.target.value) })} />
                        </label>
                    </div>
                    <p className="mc-note">
                        Build range {world.minY} → {world.maxY}, sea level {world.seaLevel}. Change these in World settings.
                        {" "}No density caves removes cave noise; vanilla biome carvers can still cut the surface. Use a fixed
                        carver-free biome such as minecraft:the_void for exact heights.
                    </p>
                </div>

                <div className="mc-section">
                    <div className="mc-section-title">Compatibility</div>
                    <div className="mc-summary">
                        <span className="mc-pill is-ok">{runtime} runtime-compatible</span>
                        <span className={`mc-pill ${unsupported.length ? "is-error" : "is-ok"}`}>{unsupported.length} unsupported</span>
                        <span className={`mc-pill is-${validation.performance.label === "Heavy" ? "warn" : "ok"}`}>Graph: {validation.performance.label}</span>
                    </div>
                    <p className="mc-note">
                        {validation.performance.runtimeOperations} estimated runtime operations · {validation.performance.expensiveNodes} expensive nodes. {validation.performance.detail}
                    </p>
                    {unsupported.length > 0 && (
                        <ul className="mc-compat">
                            {unsupported.map((node) => (
                                <li key={node.nodeId}><strong>{node.title}</strong> — {node.reason}</li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="mc-section">
                    <div className="mc-section-title">Validation</div>
                    <ul className="mc-issues">
                        {validation.issues.map((issue, index) => (
                            <li key={`${issue.code}-${index}`} className={`mc-issue is-${issue.severity}`}>
                                <span>{issue.severity}</span>
                                {issue.message}
                            </li>
                        ))}
                    </ul>
                    {message && <p className="mc-status" role="status">{message}</p>}
                    <button className="export-button" onClick={onSend} disabled={sending || exporting || errors.length > 0} title="Hand the package to MCreator without a file dialog">
                        <Icon name="export" />
                        <span>{sending ? "Sending…" : "Send to MCreator"}</span>
                    </button>
                    <button className="export-button" onClick={onExport} disabled={exporting || errors.length > 0} title="Write a .tsmc integration package for the MCreator plugin">
                        <Icon name="export" />
                        <span>{exporting ? "Exporting…" : "Export integration package"}</span>
                    </button>
                    <p className="mc-note">
                        Send hands the package to the open MCreator window, which asks for confirmation before writing. Export writes a .tsmc file
                        instead; import it with <strong>Terrain Studio → Import Terrain Studio package…</strong>. Either way the plugin validates the
                        workspace, backs up files it replaces, records SHA-256 hashes and refuses to overwrite files edited outside Terrain Studio.
                    </p>
                </div>
            </div>
        </div>
    );
}

function App() {
    const [nodes, setNodes, onNodesChangeOriginal] =
        useNodesState<TerrainNode>(initialNodes);

    const [edges, setEdges, onEdgesChangeOriginal] =
        useEdgesState(initialEdges);

    const [projectName, setProjectName] =
        useState("Appalachian Terrain");
    const [libraryQuery, setLibraryQuery] = useState("");
    const [projectMenuOpen, setProjectMenuOpen] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    // Narrow screens turn the two sidebars into slide-over sheets. Wide screens ignore this
    // state entirely, so the desktop layout stays exactly as it was.
    const [sheet, setSheet] = useState<"library" | "inspector" | null>(null);

    useEffect(() => {
        if (!sheet) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") setSheet(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [sheet]);
    const [savedProject, setSavedProject] = useState<string | null>(initialProjectText);
    const [projectPath, setProjectPath] = useState<string | null>(null);
    const [projectMessage, setProjectMessage] = useState("");
    const [exporting, setExporting] = useState(false);
    const exportWorkerRef = useRef<Worker | null>(null);
    useEffect(() => () => { exportWorkerRef.current?.terminate(); }, []);

    const [activeTab, setActiveTab] = useState<"graph" | "world" | string>("graph");
    const [customTextures, setCustomTextures] = useState<CustomTexture[]>([]);
    const activeCustomTexture = useMemo(
        () => customTextures.find((texture) => texture.id === activeTab) ?? null,
        [customTextures, activeTab]
    );
    const visibleNodes = useMemo(() => activeCustomTexture?.nodes ?? nodes, [activeCustomTexture, nodes]);
    const visibleEdges = useMemo(() => activeCustomTexture?.edges ?? edges, [activeCustomTexture, edges]);

    // Switching documents must not leave the inspector pointing at a node from the previous one.
    useEffect(() => { setSelectedNode(null); }, [activeTab]);
    const [previewMode, setPreviewMode] = useState<"2d" | "3d">("2d");
    const [previewResolution, setPreviewResolution] = useState<128 | 256 | 512>(256);
    const [previewExtent, setPreviewExtent] = useState<512 | 1024 | 4096>(1024);
    const [minecraftConfig, setMinecraftConfig] = useState<MinecraftConfig>(DEFAULT_MINECRAFT_CONFIG);
    const [minecraftMessage, setMinecraftMessage] = useState("");
    const [minecraftExporting, setMinecraftExporting] = useState(false);
    const [minecraftSending, setMinecraftSending] = useState(false);

    const [selectedNode, setSelectedNode] =
        useState<TerrainNode | null>(initialNodes[0]);

    const [minY, setMinY] = useState(-64);
    const [maxY, setMaxY] = useState(319);
    const [seaLevel, setSeaLevel] = useState(63);
    const [worldInputs, setWorldInputs] = useState({ minY: "-64", maxY: "319", seaLevel: "63" });

    const [ctrlHeld, setCtrlHeld] = useState(false);
    const [cutting, setCutting] = useState(false);
    const [cutLine, setCutLine] = useState<CutPoint[]>([]);
    const [historyCounts, setHistoryCounts] = useState({
        undo: 0,
        redo: 0,
    });

    const projectDocument = useMemo(
        () => buildProjectDocument({
            name: projectName, nodes, edges, world: { minY, maxY, seaLevel },
            customTextures, resolution: previewResolution, extent: previewExtent, minecraft: minecraftConfig,
        }),
        [projectName, nodes, edges, minY, maxY, seaLevel, customTextures, previewResolution, previewExtent, minecraftConfig]
    );
    const projectText = useMemo(() => JSON.stringify(projectDocument), [projectDocument]);
    const projectDirty = savedProject !== projectText;

    useEffect(() => {
        // In Electron the main process owns the close prompt, because `beforeunload` only blocks
        // the close silently and never explains why. A bare browser still needs the listener, and
        // arming both would stop the confirmed close from happening at all.
        if (typeof window.terrainProjects?.setDirty === "function") {
            window.terrainProjects.setDirty(projectDirty);
            return;
        }
        const protectUnsaved = (event: BeforeUnloadEvent) => {
            if (projectDirty) { event.preventDefault(); event.returnValue = ""; }
        };
        window.addEventListener("beforeunload", protectUnsaved);
        return () => window.removeEventListener("beforeunload", protectUnsaved);
    }, [projectDirty]);

    const projectTextRef = useRef(projectText);
    projectTextRef.current = projectText;
    const projectDirtyRef = useRef(projectDirty);
    projectDirtyRef.current = projectDirty;
    const graphCanvasRef = useRef<HTMLDivElement>(null);

    const nodesRef = useRef(nodes);
    const edgesRef = useRef(edges);
    // The graph the user is editing right now: the main graph, or one custom texture.
    const activeNodesRef = useRef(visibleNodes);
    const activeEdgesRef = useRef(visibleEdges);
    activeNodesRef.current = visibleNodes;
    activeEdgesRef.current = visibleEdges;
    const activeCustomTextureRef = useRef(activeCustomTexture);
    activeCustomTextureRef.current = activeCustomTexture;
    const worldSettingsRef = useRef<WorldSettings>({ minY, maxY, seaLevel });
    const customTexturesRef = useRef(customTextures);
    customTexturesRef.current = customTextures;
    // Custom textures reach the engine, the PNG export and the Minecraft package as nested graphs.
    const textureGraphs = useMemo<CustomTextureGraph[]>(() => customTextures.map((texture) => ({
        id: texture.id, name: texture.name, graph: toTerrainGraph(texture.nodes, texture.edges),
    })), [customTextures]);

    const undoStack = useRef<GraphSnapshot[]>([]);
    const redoStack = useRef<GraphSnapshot[]>([]);

    const clipboard = useRef<{
        nodes: TerrainNode[];
        edges: Edge[];
    } | null>(null);
    const pasteCountRef = useRef(0);
    const propertyEditRef = useRef<string | null>(null);

    const cutStrokeRef = useRef<CutPoint[] | null>(null);
    const dragHistoryRef = useRef<GraphSnapshot | null>(null);

    nodesRef.current = nodes;
    edgesRef.current = edges;
    worldSettingsRef.current = { minY, maxY, seaLevel };

    // Adjacency is rebuilt only when the edges actually change, so connection dragging does
    // not rescan the edge list on every pointer move.
    const adjacency = useMemo(() => {
        const targets = new Map<string, string[]>(), inputs = new Map<string, number>();
        for (const edge of visibleEdges) {
            const existing = targets.get(edge.source);
            if (existing) existing.push(edge.target);
            else targets.set(edge.source, [edge.target]);
            inputs.set(edge.target, (inputs.get(edge.target) ?? 0) + 1);
        }
        return { targets, inputs };
    }, [visibleEdges]);
    const adjacencyRef = useRef(adjacency);
    adjacencyRef.current = adjacency;

    const refreshHistoryCounts = useCallback(() => {
        setHistoryCounts({
            undo: undoStack.current.length,
            redo: redoStack.current.length,
        });
    }, []);

    const mutateActiveNodes = useCallback((updater: (current: TerrainNode[]) => TerrainNode[]) => {
        const texture = activeCustomTextureRef.current;
        if (!texture) { setNodes(updater); return; }
        setCustomTextures((current) => current.map((entry) =>
            entry.id === texture.id ? { ...entry, nodes: updater(entry.nodes) } : entry));
    }, [setNodes]);

    const mutateActiveEdges = useCallback((updater: (current: Edge[]) => Edge[]) => {
        const texture = activeCustomTextureRef.current;
        if (!texture) { setEdges(updater); return; }
        setCustomTextures((current) => current.map((entry) =>
            entry.id === texture.id ? { ...entry, edges: updater(entry.edges) } : entry));
    }, [setEdges]);

    const recordHistory = useCallback(() => {
        undoStack.current.push(
            cloneGraph(nodesRef.current, edgesRef.current, worldSettingsRef.current, customTexturesRef.current)
        );

        // Keep the history bounded by retained size as well as by step count.
        let retainedNodes = undoStack.current.reduce((total, snapshot) => total + snapshot.nodes.length, 0);
        while (undoStack.current.length > 1 && (undoStack.current.length > 100 || retainedNodes > HISTORY_NODE_BUDGET)) {
            retainedNodes -= undoStack.current.shift()!.nodes.length;
        }

        redoStack.current = [];
        refreshHistoryCounts();
    }, [refreshHistoryCounts]);

    const applySnapshot = useCallback(
        (snapshot: GraphSnapshot) => {
            const nextNodes = structuredClone(snapshot.nodes);
            const nextEdges = structuredClone(snapshot.edges);

            nodesRef.current = nextNodes;
            edgesRef.current = nextEdges;

            setNodes(nextNodes);
            setEdges(nextEdges);
            worldSettingsRef.current = { ...snapshot.worldSettings };
            customTexturesRef.current = structuredClone(snapshot.customTextures);
            setCustomTextures(structuredClone(snapshot.customTextures));
            setMinY(snapshot.worldSettings.minY);
            setMaxY(snapshot.worldSettings.maxY);
            setSeaLevel(snapshot.worldSettings.seaLevel);
            setWorldInputs({ minY: String(snapshot.worldSettings.minY), maxY: String(snapshot.worldSettings.maxY), seaLevel: String(snapshot.worldSettings.seaLevel) });
            propertyEditRef.current = null;

            setSelectedNode((current) =>
                nextNodes.find((node) => node.selected) ??
                nextNodes.find((node) => node.id === current?.id) ?? null
            );
        },
        [setNodes, setEdges]
    );

    const undo = useCallback(() => {
        if (undoStack.current.length === 0) return;

        redoStack.current.push(
            cloneGraph(nodesRef.current, edgesRef.current, worldSettingsRef.current, customTexturesRef.current)
        );

        const previous = undoStack.current.pop()!;
        applySnapshot(previous);
        refreshHistoryCounts();
    }, [applySnapshot, refreshHistoryCounts]);

    const redo = useCallback(() => {
        if (redoStack.current.length === 0) return;

        undoStack.current.push(
            cloneGraph(nodesRef.current, edgesRef.current, worldSettingsRef.current, customTexturesRef.current)
        );

        const next = redoStack.current.pop()!;
        applySnapshot(next);
        refreshHistoryCounts();
    }, [applySnapshot, refreshHistoryCounts]);

    const clearHistory = useCallback(() => {
        undoStack.current = [];
        redoStack.current = [];
        clipboard.current = null;
        propertyEditRef.current = null;
        refreshHistoryCounts();
    }, [refreshHistoryCounts]);

    const saveProject = useCallback(async (saveAs: boolean) => {
        try {
            parseProject(JSON.stringify(projectDocument));
            // Saving a graph the engine cannot evaluate would fail later, in the preview or in
            // the MCreator import, with no hint that the file itself was the problem.
            compileGraph(toTerrainGraph(nodes, edges), textureGraphs);
            const path = await window.terrainProjects.save(JSON.stringify(projectDocument, null, 2), saveAs, projectName);
            if (path) {
                setProjectPath(path); setSavedProject(projectText);
                setProjectMessage(projectTextRef.current === projectText ? "Project saved" : "Saved; newer changes remain unsaved");
                // The project is safely on disk now, so the crash copy is no longer needed.
                void window.terrainProjects.recovery?.clear().catch(() => {});
            }
        } catch (error) {
            setProjectMessage(`Save failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }, [projectDocument, projectName, projectText, nodes, edges, textureGraphs]);

    // Shared by Open and recovery restore, so a recovered document goes through exactly the same
    // state transition as an opened one.
    const applyDocument = useCallback((doc: ProjectDocument) => {
        setNodes(doc.graph.nodes as TerrainNode[]);
        setEdges(doc.graph.edges);
        setProjectName(doc.name); setMinY(doc.world.minY); setMaxY(doc.world.maxY); setSeaLevel(doc.world.seaLevel);
        setWorldInputs({ minY: String(doc.world.minY), maxY: String(doc.world.maxY), seaLevel: String(doc.world.seaLevel) });
        setCustomTextures(doc.customTextures as CustomTexture[]);
        setPreviewResolution(doc.preview.resolution); setPreviewExtent(doc.preview.extent);
        setMinecraftConfig(doc.minecraft ?? DEFAULT_MINECRAFT_CONFIG);
        setActiveTab("graph"); setSelectedNode(null);
        clearHistory();
    }, [setNodes, setEdges, clearHistory]);

    const openProject = useCallback(async () => {
        if (projectDirty && !window.confirm("Discard unsaved changes and open another project?")) return;
        try {
            const result = await window.terrainProjects.open();
            if (!result) return;
            const doc = parseProject(result.text);
            await window.terrainProjects.acceptOpen(result.path);
            const graphNodes = doc.graph.nodes as TerrainNode[];
            const textures = doc.customTextures as CustomTexture[];
            applyDocument(doc);
            void window.terrainProjects.recovery?.clear().catch(() => {});
            setProjectPath(result.path);
            setSavedProject(JSON.stringify(buildProjectDocument({
                name: doc.name, nodes: graphNodes, edges: doc.graph.edges, world: doc.world,
                customTextures: textures, resolution: doc.preview.resolution, extent: doc.preview.extent,
                minecraft: doc.minecraft ?? DEFAULT_MINECRAFT_CONFIG,
            })));
            setProjectMessage("Project opened");
        } catch (error) {
            setProjectMessage(`Open failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }, [projectDirty, applyDocument]);

    const newProject = useCallback(async () => {
        if (projectDirty && !window.confirm("Discard unsaved changes and start a new project?")) return;
        try {
            await window.terrainProjects.newProject();
            setNodes(structuredClone(initialNodes)); setEdges(structuredClone(initialEdges));
            setProjectName("Untitled Terrain"); setMinY(-64); setMaxY(319); setSeaLevel(63);
            setWorldInputs({ minY: "-64", maxY: "319", seaLevel: "63" });
            setCustomTextures([]); setPreviewResolution(256); setPreviewExtent(1024); setMinecraftConfig(DEFAULT_MINECRAFT_CONFIG); setActiveTab("graph"); setSelectedNode(initialNodes[0]); clearHistory();
            setProjectPath(null);
            setSavedProject(JSON.stringify(buildProjectDocument({
                name: "Untitled Terrain", nodes: initialNodes, edges: initialEdges,
                world: { minY: -64, maxY: 319, seaLevel: 63 },
                customTextures: [], resolution: 256, extent: 1024, minecraft: DEFAULT_MINECRAFT_CONFIG,
            })));
            void window.terrainProjects.recovery?.clear().catch(() => {});
            setProjectMessage("New project");
        } catch (error) {
            setProjectMessage(`New project failed: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }, [projectDirty, setNodes, setEdges, clearHistory]);

    // Offer unsaved work from a crashed or closed session, once, at launch.
    const recoveryCheckedRef = useRef(false);
    useEffect(() => {
        const recovery = window.terrainProjects?.recovery;
        if (!recovery || recoveryCheckedRef.current) return;
        recoveryCheckedRef.current = true;
        void (async () => {
            try {
                const text = await recovery.read();
                if (!text) return;
                const doc = parseProject(text);
                if (!window.confirm("A recovery copy of unsaved work from a previous session was found. Restore it? Choose Cancel to discard it.")) {
                    await recovery.clear().catch(() => {});
                    return;
                }
                applyDocument(doc);
                setProjectPath(null);
                setSavedProject(null);
                setProjectMessage("Recovered unsaved changes");
            } catch {
                // An unreadable snapshot must never block startup.
                await recovery.clear().catch(() => {});
            }
        })();
    }, [applyDocument]);

    // Snapshot shortly after edits stop...
    useEffect(() => {
        const recovery = window.terrainProjects?.recovery;
        if (!recovery || !projectDirty) return;
        const timer = setTimeout(() => { void recovery.write(projectTextRef.current).catch(() => {}); }, RECOVERY_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [projectDirty, projectText]);

    // ...and on a slow timer, so continuous typing still leaves a recent copy.
    useEffect(() => {
        const recovery = window.terrainProjects?.recovery;
        if (!recovery) return;
        const id = setInterval(() => {
            if (projectDirtyRef.current) void recovery.write(projectTextRef.current).catch(() => {});
        }, RECOVERY_INTERVAL_MS);
        return () => clearInterval(id);
    }, []);

    const exportHeightmap = useCallback(() => {
        if (exporting) return;
        setExporting(true);
        setProjectMessage("Generating heightmap…");
        // A stale worker from an interrupted run must not outlive its replacement.
        exportWorkerRef.current?.terminate();
        const worker = new Worker(new URL("../engine/terrainWorker.ts", import.meta.url), { type: "module" });
        exportWorkerRef.current = worker;
        let settled = false;
        // A worker that never answers must not leave the Export button disabled forever.
        const settle = () => {
            settled = true;
            clearTimeout(watchdog);
            worker.terminate();
            if (exportWorkerRef.current === worker) exportWorkerRef.current = null;
            setExporting(false);
        };
        const watchdog = setTimeout(() => {
            if (settled) return;
            settle();
            setProjectMessage("Export timed out. Try a smaller resolution or world extent.");
        }, EXPORT_TIMEOUT_MS);
        worker.onmessage = async (event: MessageEvent<{ ok: boolean; error?: string; result?: { size: number; values: Float32Array } }>) => {
            if (settled) return;
            try {
                if (!event.data.ok || !event.data.result) throw new Error(event.data.error ?? "Terrain generation failed.");
                const { size, values } = event.data.result;
                const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
                const context = canvas.getContext("2d");
                if (!context) throw new Error("Canvas is unavailable.");
                const image = context.createImageData(size, size);
                for (let i = 0; i < values.length; i++) {
                    const shade = Math.round(Math.max(0, Math.min(1, (values[i] - minY) / (maxY - minY))) * 255);
                    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = shade;
                    image.data[i * 4 + 3] = 255;
                }
                context.putImageData(image, 0, 0);
                const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
                if (!blob) throw new Error("PNG encoding failed.");
                const saved = await window.terrainProjects.exportPng(new Uint8Array(await blob.arrayBuffer()), projectName);
                // A watchdog that already fired owns the status message, and the write may still
                // have landed, so a late result must not overwrite it.
                if (settled) return;
                setProjectMessage(saved ? `Heightmap exported (${size} × ${size})` : "Export cancelled");
            } catch (error) {
                if (settled) return;
                setProjectMessage(`Export failed: ${error instanceof Error ? error.message : "Unknown error"}`);
            } finally { settle(); }
        };
        worker.onerror = () => {
            if (settled) return;
            settle();
            setProjectMessage("Export failed: terrain worker failed.");
        };
        worker.onmessageerror = () => {
            if (settled) return;
            settle();
            setProjectMessage("Export failed: the terrain worker returned an unreadable result.");
        };
        worker.postMessage({ graph: toTerrainGraph(nodes, edges), world: { minY, maxY, seaLevel }, size: previewResolution, extent: previewExtent, textures: textureGraphs });
    }, [exporting, nodes, edges, minY, maxY, seaLevel, previewResolution, previewExtent, projectName, textureGraphs]);

    const minecraftGraph = useMemo(() => toTerrainGraph(nodes, edges), [nodes, edges]);
    const minecraftValidation = useMemo(
        () => validateMinecraftExport(minecraftGraph, { minY, maxY, seaLevel, seed: minecraftConfig.seed }, minecraftConfig, textureGraphs),
        [minecraftGraph, minY, maxY, seaLevel, minecraftConfig, textureGraphs]
    );

    const exportMinecraftPackage = useCallback(async () => {
        if (minecraftExporting) return;
        setMinecraftExporting(true);
        setMinecraftMessage("Validating graph for Minecraft…");
        try {
            const pkg = buildIntegrationPackage(projectName, minecraftGraph, { minY, maxY, seaLevel }, minecraftConfig, textureGraphs);
            const text = serializeIntegrationPackage(pkg);
            setMinecraftMessage("Writing integration package…");
            if (window.terrainProjects?.exportPackage) {
                const saved = await window.terrainProjects.exportPackage(text, projectName);
                setMinecraftMessage(saved
                    ? `Integration package exported for ${targetProfiles.find((entry) => entry.id === minecraftConfig.target)?.label ?? minecraftConfig.target}. Import it in MCreator with Terrain Studio → Import Terrain Studio package.`
                    : "Export cancelled");
            } else {
                const blob = new Blob([text], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `${projectName.replace(/[^a-z0-9_-]+/gi, "-") || "terrain"}.tsmc`;
                anchor.click();
                URL.revokeObjectURL(url);
                setMinecraftMessage("Integration package downloaded.");
            }
        } catch (error) {
            setMinecraftMessage(`Export blocked: ${error instanceof Error ? error.message : "Unknown error"}`);
        } finally {
            setMinecraftExporting(false);
        }
    }, [minecraftConfig, minecraftExporting, minecraftGraph, maxY, minY, projectName, seaLevel, textureGraphs]);

    const sendMinecraftPackage = useCallback(async () => {
        const bridge = window.terrainProjects;
        if (minecraftSending || minecraftExporting) return;
        if (!bridge?.handOff) {
            setMinecraftMessage("Sending needs the desktop app. Export the package and import it in MCreator instead.");
            return;
        }
        setMinecraftSending(true);
        setMinecraftMessage("Handing the package to MCreator…");
        try {
            const pkg = buildIntegrationPackage(projectName, minecraftGraph, { minY, maxY, seaLevel }, minecraftConfig, textureGraphs);
            const result = await bridge.handOff(serializeIntegrationPackage(pkg), projectName);
            setMinecraftMessage(
                result.status === "queued"
                    ? "Package handed over. Confirm it in the open MCreator window; if MCreator was closed, it is offered next time a workspace opens."
                    : result.status === "plugin-missing"
                        ? "MCreator has no Terrain Studio plugin yet. Open Terrain Studio once from the download, then reopen MCreator."
                        : "No MCreator installation was found on this computer."
            );
        } catch (error) {
            setMinecraftMessage(`Send blocked: ${error instanceof Error ? error.message : "Unknown error"}`);
        } finally {
            setMinecraftSending(false);
        }
    }, [minecraftConfig, minecraftExporting, minecraftGraph, minecraftSending, maxY, minY, projectName, seaLevel, textureGraphs]);

    const handleNodesChange = useCallback(
        (changes: NodeChangeset<TerrainNode>) => {
            const changeList = [...changes];
            const draggingStart = changeList.some(
                (change) =>
                    change.type === "position" && change.dragging === true
            );

            const draggingEnd = changeList.some(
                (change) =>
                    change.type === "position" && change.dragging === false
            );

            if (draggingStart && !dragHistoryRef.current) {
                dragHistoryRef.current = cloneGraph(
                    nodesRef.current,
                    edgesRef.current,
                    worldSettingsRef.current,
                    customTexturesRef.current
                );
            }

            const texture = activeCustomTextureRef.current;
            if (texture) {
                setCustomTextures((current) => current.map((entry) =>
                    entry.id === texture.id ? { ...entry, nodes: applyNodePatch(changes, entry.nodes) } : entry));
            } else {
                onNodesChangeOriginal(changes);
            }

            if (draggingEnd && dragHistoryRef.current) {
                undoStack.current.push(dragHistoryRef.current);
                dragHistoryRef.current = null;
                redoStack.current = [];
                refreshHistoryCounts();
            }
        },
        [
            onNodesChangeOriginal,
            refreshHistoryCounts,
        ]
    );

    const handleEdgesChange = useCallback(
        (changes: EdgeChangeset<Edge>) => {
            const texture = activeCustomTextureRef.current;
            if (!texture) { onEdgesChangeOriginal(changes); return; }
            setCustomTextures((current) => current.map((entry) =>
                entry.id === texture.id ? { ...entry, edges: applyEdgePatch(changes, entry.edges) } : entry));
        },
        [onEdgesChangeOriginal]
    );

    const handleBeforeDelete = useCallback(async ({ nodes: deletedNodes, edges: deletedEdges }: { nodes: TerrainNode[]; edges: Edge[] }) => {
        if (deletedNodes.length || deletedEdges.length) recordHistory();
        if (deletedNodes.some((node) => node.id === selectedNode?.id)) setSelectedNode(null);
        return true;
    }, [recordHistory, selectedNode]);

    const isValidConnection = useCallback((connection: Connection | Edge) => {
        const source = activeNodesRef.current.find((node) => node.id === connection.source);
        const target = activeNodesRef.current.find((node) => node.id === connection.target);
        if (!source || !target || source.id === target.id) return false;
        const out = source.data.kind === "coordinates" ? "coordinate" : source.data.kind === "output" ? null : "scalar";
        const input = target.data.kind === "noise" ? "coordinate" : target.data.kind === "coordinates" ? null : "scalar";
        if (!out || out !== input || !source.data.kind || !target.data.kind) return false;
        const { targets, inputs } = adjacencyRef.current;
        if ((targets.get(source.id) ?? []).some((id) => id === target.id)) return false;
        if ((target.data.kind === "noise" || target.data.kind === "output") && (inputs.get(target.id) ?? 0) > 0) return false;
        const reachable = new Set([target.id]), queue = [target.id];
        while (queue.length) {
            const id = queue.pop()!;
            for (const next of targets.get(id) ?? []) {
                if (!reachable.has(next)) {
                    reachable.add(next);
                    queue.push(next);
                }
            }
        }
        return !reachable.has(source.id);
    }, []);

    const handleConnect = useCallback(
        (connection: Connection) => {
            if (!isValidConnection(connection)) return;
            recordHistory();

            mutateActiveEdges((currentEdges) =>
                addEdge(
                    {
                        ...connection,
                        animated: true,
                        style: { stroke: "#7c8da8", strokeWidth: 2 },
                    },
                    currentEdges
                )
            );
        },
        [recordHistory, mutateActiveEdges, isValidConnection]
    );

    const addLibraryNode = useCallback(
        (libraryNode: LibraryNode) => {
            recordHistory();

            const id = `${libraryNode.title.toLowerCase().replace(/\s+/g, "-")}-${crypto.randomUUID()}`;

            const newNode: TerrainNode = {
                id,
                type: "terrain",
                position: {
                    x: 250 + Math.random() * 300,
                    y: 150 + Math.random() * 300,
                },
                data: { ...libraryNode },
            };

            mutateActiveNodes((currentNodes) => [
                ...currentNodes,
                newNode,
            ]);

            setSelectedNode(newNode);
        },
        [recordHistory, mutateActiveNodes]
    );

    const updateSelectedNode = useCallback((
        field: keyof TerrainNodeData,
        value: string | number | undefined,
        record = true
    ) => {
        if (!selectedNode) return;
        if (record && propertyEditRef.current !== `${selectedNode.id}:${field}`) {
            recordHistory();
            propertyEditRef.current = `${selectedNode.id}:${field}`;
        }

        mutateActiveNodes((currentNodes) =>
            currentNodes.map((node) =>
                node.id === selectedNode.id
                    ? {
                        ...node,
                        data: {
                            ...node.data,
                            [field]: value,
                        },
                    }
                    : node
            )
        );

        setSelectedNode((current) =>
            current
                ? {
                    ...current,
                    data: {
                        ...current.data,
                        [field]: value,
                    },
                }
                : null
        );
    }, [selectedNode, mutateActiveNodes, recordHistory]);

    const duplicateSelectedNode = useCallback(() => {
        if (!selectedNode) return;
        recordHistory();
        const id = `${selectedNode.data.title.toLowerCase().replace(/\s+/g, "-")}-${crypto.randomUUID()}`;
        const copy: TerrainNode = {
            ...structuredClone(selectedNode),
            id,
            selected: true,
            dragging: false,
            position: { x: selectedNode.position.x + 42, y: selectedNode.position.y + 42 },
        };
        mutateActiveNodes((current) => [...current.map((node) => ({ ...node, selected: false })), copy]);
        setSelectedNode(copy);
    }, [selectedNode, recordHistory, mutateActiveNodes]);

    const deleteSelectedNode = useCallback(() => {
        if (!selectedNode) return;
        recordHistory();
        mutateActiveNodes((current) => current.filter((node) => node.id !== selectedNode.id));
        mutateActiveEdges((current) => current.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id));
        setSelectedNode(null);
    }, [selectedNode, recordHistory, mutateActiveNodes, mutateActiveEdges]);

    const resetSelectedParameters = useCallback(() => {
        if (!selectedNode) return;
        const defaults = nodeLibrary.find((item) => item.kind === selectedNode.data.kind) as unknown as Record<string, unknown> | undefined;
        if (!defaults) return;
        recordHistory();
        const fields = ["scale", "amplitude", "seed", "factor", "min", "max", "inMin", "inMax", "outMin", "outMax",
            "gamma", "steps", "strength", "rotation", "threshold", "exponent", "bias", "contrast"];
        const patched: TerrainNode = { ...selectedNode, data: { ...selectedNode.data } };
        for (const field of fields) (patched.data as unknown as Record<string, unknown>)[field] = defaults[field];
        mutateActiveNodes((current) => current.map((node) => (node.id === selectedNode.id ? { ...node, data: { ...patched.data } } : node)));
        setSelectedNode(patched);
    }, [selectedNode, recordHistory, mutateActiveNodes]);

    const updateWorldSetting = useCallback((field: keyof WorldSettings, value: number) => {
        if (worldSettingsRef.current[field] === value) return;
        if (propertyEditRef.current !== `world:${field}`) {
            recordHistory();
            propertyEditRef.current = `world:${field}`;
        }
        worldSettingsRef.current = { ...worldSettingsRef.current, [field]: value };
        if (field === "minY") setMinY(value);
        else if (field === "maxY") setMaxY(value);
        else setSeaLevel(value);
    }, [recordHistory]);

    const editWorldInput = useCallback((field: keyof WorldSettings, text: string) => {
        setWorldInputs((current) => ({ ...current, [field]: text }));
        if (text.trim() !== "" && Number.isFinite(Number(text))) updateWorldSetting(field, Number(text));
    }, [updateWorldSetting]);
    const finishWorldInput = useCallback((field: keyof WorldSettings) => {
        setWorldInputs((current) => ({ ...current, [field]: String(worldSettingsRef.current[field]) }));
        propertyEditRef.current = null;
    }, []);

    const applyWorldPreset = useCallback((preset: WorldPreset) => {
        const definition = worldPresets.find((entry) => entry.id === preset);
        if (!definition) return;
        recordHistory();
        worldSettingsRef.current = {
            ...worldSettingsRef.current,
            minY: definition.world.minY, maxY: definition.world.maxY, seaLevel: definition.world.seaLevel,
        };
        setMinY(definition.world.minY);
        setMaxY(definition.world.maxY);
        setSeaLevel(definition.world.seaLevel);
        setWorldInputs({
            minY: String(definition.world.minY),
            maxY: String(definition.world.maxY),
            seaLevel: String(definition.world.seaLevel),
        });
        setMinecraftConfig((current) => ({ ...current, logicalHeight: definition.world.logicalHeight }));
        propertyEditRef.current = null;
    }, [recordHistory]);

    const createCustomTexture = useCallback(() => {
        const name = window.prompt("Name this custom noise texture", "Mountain Detail");
        if (!name?.trim()) return null;
        const id = `custom-${Date.now()}`;
        const texture: CustomTexture = {
            id,
            name: name.trim(),
            nodes: [
                {
                    id: `${id}-input`, type: "terrain", position: { x: 120, y: 180 },
                    data: { title: "Texture Coordinates", kind: "coordinates", category: "INPUT", description: "World-space coordinates supplied by the parent graph.", value: "Vector 3", accent: categoryAccent.INPUT },
                },
                {
                    id: `${id}-noise`, type: "terrain", position: { x: 360, y: 180 },
                    data: { title: "Texture Noise", kind: "noise", noiseType: "perlin", scale: 0.02, amplitude: 1, seed: 23, category: "GENERATION", description: "The pattern this texture returns. Add more nodes to shape it.", value: "Perlin", accent: categoryAccent.GENERATION },
                },
                {
                    id: `${id}-output`, type: "terrain", position: { x: 620, y: 180 },
                    data: { title: "Custom Noise Output", kind: "output", category: "OUTPUT", description: "Returns the generated scalar field.", value: "Height Field", accent: categoryAccent.OUTPUT },
                },
            ],
            edges: [
                { id: `${id}-edge-in`, source: `${id}-input`, target: `${id}-noise`, animated: true },
                { id: `${id}-edge`, source: `${id}-noise`, target: `${id}-output`, animated: true },
            ],
        };
        setCustomTextures((current) => [...current, texture]);
        setActiveTab(id);
        return texture;
    }, []);

    const changeNoiseType = useCallback((value: string) => {
        if (!selectedNode) return;
        if (value === "custom") {
            const texture = createCustomTexture();
            if (!texture) return;
            // One user action is one undo step; both fields belong to the same change.
            recordHistory();
            updateSelectedNode("noiseType", "custom", false);
            updateSelectedNode("textureId", texture.id, false);
            return;
        }
        // Check if value is a custom texture ID
        if (value.startsWith("custom-")) {
            recordHistory();
            updateSelectedNode("noiseType", "custom", false);
            updateSelectedNode("textureId", value, false);
        } else {
            // A standard model must not keep a reference to the previous custom texture.
            recordHistory();
            updateSelectedNode("noiseType", value as NoiseType, false);
            updateSelectedNode("textureId", undefined, false);
        }
    }, [createCustomTexture, recordHistory, selectedNode, updateSelectedNode]);

    const copySelected = useCallback(() => {
        const selected = activeNodesRef.current.filter(
            (node) => node.selected
        );

        if (selected.length === 0) return;

        const selectedIds = new Set(selected.map((node) => node.id));

        const internalEdges = activeEdgesRef.current.filter(
            (edge) =>
                selectedIds.has(edge.source) &&
                selectedIds.has(edge.target)
        );

        clipboard.current = {
            nodes: structuredClone(selected),
            edges: structuredClone(internalEdges),
        };
        pasteCountRef.current = 0;
    }, []);

    const pasteClipboard = useCallback(() => {
        if (!clipboard.current) return;

        recordHistory();

        const copied = clipboard.current;
        const offset = 60 * ++pasteCountRef.current;
        const idMap = new Map<string, string>();

        copied.nodes.forEach((node) => {
            idMap.set(
                node.id,
                `${node.id}-copy-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 7)}`
            );
        });

        const pastedNodes: TerrainNode[] = copied.nodes.map(
            (node) => ({
                ...structuredClone(node),
                id: idMap.get(node.id)!,
                selected: true,
                dragging: false,
                position: {
                    x: node.position.x + offset,
                    y: node.position.y + offset,
                },
            })
        );

        const pastedEdges: Edge[] = copied.edges.map(
            (edge) => ({
                ...structuredClone(edge),
                id: `edge-copy-${Date.now()}-${Math.random()
                    .toString(36)
                    .slice(2, 7)}`,
                source: idMap.get(edge.source)!,
                target: idMap.get(edge.target)!,
            })
        );

        mutateActiveNodes((current) => {
            const deselectedNodes: TerrainNode[] = current.map((node) => ({
                ...node,
                selected: false,
            }));

            return deselectedNodes.concat(pastedNodes);
        });

        mutateActiveEdges((current) => current.concat(pastedEdges));

        if (pastedNodes.length > 0) {
            setSelectedNode(pastedNodes[0]);
        }
    }, [recordHistory, mutateActiveNodes, mutateActiveEdges]);

    const resetGraph = useCallback(() => {
        recordHistory();

        setNodes(structuredClone(initialNodes));
        setEdges(structuredClone(initialEdges));
        setSelectedNode(initialNodes[0]);
    }, [recordHistory, setNodes, setEdges]);

    const cancelCut = useCallback(() => {
        cutStrokeRef.current = null;
        setCutting(false);
        setCutLine([]);
    }, []);

    const beginCut = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!(event.ctrlKey || event.metaKey) || event.button !== 0 || activeTab !== "graph") return;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
        const point = { x: event.clientX, y: event.clientY };
        cutStrokeRef.current = [point];
        const rect = event.currentTarget.getBoundingClientRect();
        setCutLine([{ x: point.x - rect.left, y: point.y - rect.top }]);
        setCutting(true);
    }, [activeTab]);

    const moveCut = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const stroke = cutStrokeRef.current;
        if (!stroke) return;
        const point = { x: event.clientX, y: event.clientY };
        // Decimate the stroke: sub-3px spacing adds no intersection information and the
        // hit test walks every segment of this polyline.
        const last = stroke[stroke.length - 1];
        if (stroke.length > 1 && Math.hypot(point.x - last.x, point.y - last.y) < 3) return;
        if (stroke.length >= 2000) return;
        stroke.push(point);
        const rect = event.currentTarget.getBoundingClientRect();
        setCutLine((current) => [...current, { x: point.x - rect.left, y: point.y - rect.top }]);
    }, []);

    const finishCut = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const stroke = cutStrokeRef.current;
        if (!stroke) return;
        stroke.push({ x: event.clientX, y: event.clientY });
        const removeIds = new Set<string>();
        // Cheap bounding-box rejection first: measuring and walking every edge path is far
        // more expensive than comparing a rectangle against the stroke's box.
        const strokeBox = stroke.reduce((box, point) => ({
            minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
            minY: Math.min(box.minY, point.y), maxY: Math.max(box.maxY, point.y),
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
        graphCanvasRef.current?.querySelectorAll<SVGPathElement>(".react-flow__edge[data-id] .react-flow__edge-path").forEach((path) => {
            const id = path.closest<HTMLElement>(".react-flow__edge")?.dataset.id;
            if (!id || removeIds.has(id)) return;
            const box = path.getBoundingClientRect();
            if (box.right < strokeBox.minX || box.left > strokeBox.maxX || box.bottom < strokeBox.minY || box.top > strokeBox.maxY) return;
            if (pathIntersectsCut(path, stroke)) removeIds.add(id);
        });
        if (removeIds.size > 0) {
            recordHistory();
            setEdges((current) => current.filter((edge) => !removeIds.has(edge.id)));
        }
        cancelCut();
    }, [cancelCut, recordHistory, setEdges]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const isTyping =
                target?.tagName === "INPUT" ||
                target?.tagName === "TEXTAREA" ||
                target?.tagName === "SELECT" ||
                target?.isContentEditable;

            // Cmd on macOS, Ctrl elsewhere. Ctrl+X stays an alias for redo so the existing
            // muscle memory and tooltips keep working.
            const primary = event.ctrlKey || event.metaKey;
            const key = event.key.toLowerCase();

            // File shortcuts fire even while a field has focus: saving after typing is the normal
            // thing to want, and none of these collide with a text-editing shortcut.
            if (primary && key === "s") {
                event.preventDefault();
                void saveProject(event.shiftKey);
                return;
            }

            if (primary && key === "o") {
                event.preventDefault();
                void openProject();
                return;
            }

            if (primary && key === "n") {
                event.preventDefault();
                void newProject();
                return;
            }

            if (isTyping) return;
            if (event.key === "Control" || event.key === "Meta") setCtrlHeld(true);
            if (event.key === "Escape") cancelCut();

            if (primary && key === "z" && event.shiftKey) {
                event.preventDefault();
                redo();
            } else if (primary && key === "z") {
                event.preventDefault();
                undo();
            } else if (primary && (key === "y" || key === "x")) {
                event.preventDefault();
                redo();
            } else if (primary && key === "c") {
                event.preventDefault();
                copySelected();
            } else if (primary && key === "v") {
                event.preventDefault();
                pasteClipboard();
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Control" || event.key === "Meta") {
                setCtrlHeld(false);
            }
        };

        const handleBlur = () => {
            setCtrlHeld(false);
            cancelCut();
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, [undo, redo, copySelected, pasteClipboard, cancelCut, saveProject, openProject, newProject]);

    // These arrays are props for React Flow and the library list. Keeping their identities stable
    // means an unrelated state change (inspector keystroke, status message) does not make the
    // canvas re-render every node and edge.
    const libraryFilter = libraryQuery.trim().toLowerCase();
    const matchesLibrary = useCallback((item: LibraryNode) =>
        `${item.title} ${item.category} ${item.description}`.toLowerCase().includes(libraryFilter), [libraryFilter]);
    const libraryMatchCount = useMemo(() => nodeLibrary.filter(matchesLibrary).length, [matchesLibrary]);
    const selectedCount = useMemo(() => visibleNodes.reduce((total, node) => total + (node.selected ? 1 : 0), 0), [visibleNodes]);
    const inspectorInputs = useMemo(() => (selectedNode
        ? visibleEdges.filter((edge) => edge.target === selectedNode.id)
            .map((edge) => visibleNodes.find((node) => node.id === edge.source))
            .filter((node): node is TerrainNode => Boolean(node))
        : []), [selectedNode, visibleEdges, visibleNodes]);
    const inspectorOutputs = useMemo(() => (selectedNode
        ? visibleEdges.filter((edge) => edge.source === selectedNode.id)
            .map((edge) => visibleNodes.find((node) => node.id === edge.target))
            .filter((node): node is TerrainNode => Boolean(node))
        : []), [selectedNode, visibleEdges, visibleNodes]);
    const inspectorFields = selectedNode ? parameterFields[selectedNode.data.kind ?? "noise"] ?? [] : [];

    return (
        <div className="app-shell">
            <header className="top-bar">
                <div className="brand">
                    <div className="brand-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                            <path d="M3 19.5 10.4 7l3.5 5.9 2.6-3.9 4.5 10.5z" />
                        </svg>
                    </div>
                    <span className="brand-name">Terrain Studio</span>
                </div>

                <button
                    className="icon-button narrow-only"
                    onClick={() => setSheet((current) => (current === "library" ? null : "library"))}
                    aria-label="Node library and project"
                    aria-expanded={sheet === "library"}
                    title="Project and node library"
                >
                    <Icon name="library" />
                </button>

                <div className="project-name-container">
                    <Icon name="doc" />
                    <input
                        value={projectName}
                        onChange={(event) => setProjectName(event.target.value)}
                        aria-label="Project name"
                        spellCheck={false}
                    />
                    {projectDirty && <span className="unsaved-dot" title="Unsaved changes" />}
                </div>

                <div className="top-actions">
                    <div className="action-group">
                        <button className="top-button" onClick={() => void newProject()} title="New project" aria-label="New project">
                            <Icon name="filePlus" /><span>New</span>
                        </button>
                        <button className="top-button" onClick={() => void openProject()} title="Open project" aria-label="Open project">
                            <Icon name="folder" /><span>Open</span>
                        </button>
                        <button className="top-button" onClick={() => void saveProject(false)} title="Save project" aria-label="Save project">
                            <Icon name="save" /><span>Save</span>
                        </button>
                        <button className="top-button" onClick={() => void saveProject(true)} title="Save project as…" aria-label="Save project as">
                            <Icon name="saveAs" /><span>Save As</span>
                        </button>
                    </div>

                    <div className="action-group">
                        <button className="icon-button" onClick={undo} disabled={historyCounts.undo === 0} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">
                            <Icon name="undo" />
                        </button>
                        <button className="icon-button" onClick={redo} disabled={historyCounts.redo === 0} title="Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)" aria-label="Redo">
                            <Icon name="redo" />
                        </button>
                        <button className="icon-button" onClick={resetGraph} title="Reset graph to the default layout" aria-label="Reset graph">
                            <Icon name="reset" />
                        </button>
                    </div>

                    <button
                        className="icon-button narrow-only"
                        onClick={() => setSheet((current) => (current === "inspector" ? null : "inspector"))}
                        aria-label="Inspector"
                        aria-expanded={sheet === "inspector"}
                        title="Inspector"
                    >
                        <Icon name="sliders" />
                    </button>

                    <button
                        className="export-button"
                        onClick={exportHeightmap}
                        disabled={exporting}
                        title="Export 8-bit grayscale PNG at the World View resolution and extent"
                    >
                        <Icon name="export" />
                        <span>{exporting ? "Exporting…" : "Export PNG"}</span>
                    </button>
                </div>
            </header>

            <div className="workspace">
                {sheet && (
                    <button
                        className="sheet-backdrop"
                        aria-label="Close panel"
                        onClick={() => setSheet(null)}
                    />
                )}

                <aside className={`left-sidebar ${sheet === "library" ? "is-sheet-open" : ""}`}>
                    <div className="sheet-header">
                        <span>Project · Nodes</span>
                        <button onClick={() => setSheet(null)} aria-label="Close panel"><Icon name="close" /></button>
                    </div>

                    <div className="sidebar-section">
                        <div className="section-heading">Project</div>

                        <div className="project-menu-wrap">
                            <button
                                className={`project-tree-item ${projectMenuOpen ? "is-open" : ""}`}
                                onClick={() => setProjectMenuOpen((open) => !open)}
                                aria-expanded={projectMenuOpen}
                                aria-haspopup="menu"
                                title="Project documents"
                            >
                                <span className={`tree-chevron ${projectMenuOpen ? "is-open" : ""}`}><Icon name="chevron" /></span>
                                <span className="project-tree-name">{projectName}</span>
                            </button>

                            {projectMenuOpen && (
                                <div className="project-menu" role="menu">
                                    <button
                                        role="menuitem"
                                        className={activeTab === "graph" ? "active" : ""}
                                        onClick={() => { setActiveTab("graph"); setProjectMenuOpen(false); setSheet(null); }}
                                    >
                                        <span className="tree-icon"><Icon name="graph" /></span>
                                        <span className="project-menu-text">
                                            <strong>Terrain Graph</strong>
                                            <em>Main graph editor</em>
                                        </span>
                                    </button>
                                    <button
                                        role="menuitem"
                                        className={activeTab === "settings" ? "active" : ""}
                                        onClick={() => { setActiveTab("settings"); setProjectMenuOpen(false); setSheet(null); }}
                                    >
                                        <span className="tree-icon"><Icon name="world" /></span>
                                        <span className="project-menu-text">
                                            <strong>World Settings</strong>
                                            <em>Sea level, height limits, dimension type</em>
                                        </span>
                                    </button>
                                </div>
                            )}
                        </div>

                        <button
                            className={`project-tree-child ${activeTab === "graph" ? "active" : ""}`}
                            onClick={() => { setActiveTab("graph"); setSheet(null); }}
                        >
                            <span className="tree-icon"><Icon name="graph" /></span>
                            Terrain Graph
                        </button>

                        <button
                            className={`project-tree-child ${activeTab === "settings" ? "active" : ""}`}
                            onClick={() => { setActiveTab("settings"); setSheet(null); }}
                        >
                            <span className="tree-icon"><Icon name="world" /></span>
                            World Settings
                        </button>
                    </div>

                    <div className="sidebar-section node-library-section">
                        <div className="section-heading">Node Library</div>

                        <div className="library-search-wrap">
                            <Icon name="search" />
                            <input
                                className="library-search"
                                aria-label="Search nodes"
                                placeholder="Search nodes…"
                                value={libraryQuery}
                                onChange={(event) => setLibraryQuery(event.target.value)}
                            />
                        </div>

                        <div className="node-library-list">
                            {libraryGroups.map((group) => {
                                const items = group.nodes.filter(matchesLibrary);
                                if (items.length === 0) return null;
                                const collapsed = collapsedGroups[group.id] ?? false;
                                return (
                                    <div className="library-group" key={group.id}>
                                        <button
                                            className="library-group-header"
                                            onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !collapsed }))}
                                            aria-expanded={!collapsed}
                                            title={group.hint}
                                        >
                                            <span className="library-group-dot" style={{ background: group.accent }} />
                                            <span className="library-group-name">{group.name}</span>
                                            <span className="library-group-count">{items.length}</span>
                                            <span className={`library-group-chevron ${collapsed ? "" : "is-open"}`}><Icon name="chevron" /></span>
                                        </button>
                                        {!collapsed && (
                                            <div className="library-group-items">
                                                {items.map((item) => (
                                                    <button
                                                        key={item.title}
                                                        className="library-item"
                                                        onClick={() => { addLibraryNode(item); setSheet(null); }}
                                                        title={`Add ${item.title}`}
                                                    >
                                                        <span className="library-dot" style={{ background: item.accent }} />
                                                        <span className="library-item-text">
                                                            <span className="library-item-title">{item.title}</span>
                                                            <span className="library-item-category">{item.description}</span>
                                                        </span>
                                                        <span className="library-add" aria-hidden="true"><Icon name="plus" /></span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {libraryMatchCount === 0 && <div className="library-empty">No matching nodes</div>}
                        </div>
                    </div>

                    <div className="sidebar-bottom">
                        <div className="engine-status">
                            <span className="status-dot" />
                            <span>Terrain Engine</span>
                            <span className="status-text">Prototype</span>
                        </div>
                    </div>
                </aside>

                <main className="main-editor">
                    <div className="editor-toolbar">
                        <div className="editor-tabs">
                            <button className={`editor-tab ${activeTab === "graph" ? "active" : ""}`} onClick={() => setActiveTab("graph")}>
                                <span className="tab-icon"><Icon name="graph" /></span>
                                Graph Editor
                            </button>

                            <button className={`editor-tab ${activeTab === "world" ? "active" : ""}`} onClick={() => setActiveTab("world")}>
                                <span className="tab-icon"><Icon name="world" /></span>
                                World View
                            </button>

                            <button className={`editor-tab ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
                                <span className="tab-icon"><Icon name="settings" /></span>
                                World Settings
                            </button>

                            <button className={`editor-tab ${activeTab === "minecraft" ? "active" : ""}`} onClick={() => setActiveTab("minecraft")}>
                                <span className="tab-icon"><Icon name="export" /></span>
                                Minecraft
                            </button>

                            {customTextures.map((texture) => (
                                <button
                                    key={texture.id}
                                    className={`editor-tab custom-tab ${activeTab === texture.id ? "active" : ""}`}
                                    onClick={() => setActiveTab(texture.id)}
                                >
                                    <span className="tab-icon"><Icon name="wave" /></span>
                                    {texture.name}
                                </button>
                            ))}
                        </div>

                        <div className="toolbar-spacer" />

                        <span className="graph-info">
                            {activeTab === "world"
                                ? "Graph heightmap"
                                : activeTab === "settings"
                                    ? "World settings"
                                    : activeTab === "minecraft"
                                        ? "MCreator export"
                                        : `${visibleNodes.length} nodes · ${visibleEdges.length} connections`}
                            {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
                        </span>
                    </div>

                    <div ref={graphCanvasRef} className={`graph-canvas ${ctrlHeld ? "ctrl-cut-active" : ""}`}>
                        {activeTab === "world" ? (
                            <WorldView nodes={nodes} edges={edges} world={{ minY, maxY, seaLevel, seed: minecraftConfig.seed }} resolution={previewResolution} extent={previewExtent} setResolution={setPreviewResolution} setExtent={setPreviewExtent} textures={textureGraphs} />
                        ) : activeTab === "settings" ? (
                            <WorldSettingsPanel
                                world={{ minY, maxY, seaLevel }}
                                inputs={worldInputs}
                                onEdit={editWorldInput}
                                onBlur={finishWorldInput}
                                onDimensionChange={(patch) => setMinecraftConfig((current) => ({ ...current, ...patch }))}
                                onPreset={applyWorldPreset}
                                mode={minecraftConfig.mode}
                                issues={minecraftValidation.issues}
                            />
                        ) : activeTab === "minecraft" ? (
                            <MinecraftPanel
                                config={minecraftConfig}
                                onChange={(patch) => setMinecraftConfig((current) => ({ ...current, ...patch }))}
                                validation={minecraftValidation}
                                message={minecraftMessage}
                                exporting={minecraftExporting}
                                onExport={() => void exportMinecraftPackage()}
                                sending={minecraftSending}
                                onSend={() => void sendMinecraftPackage()}
                                world={{ minY, maxY, seaLevel }}
                            />
                        ) : (
                            <>
                                <ReactFlow
                                    nodes={visibleNodes}
                                    edges={visibleEdges}
                                    nodeTypes={nodeTypes}
                                    onNodesChange={handleNodesChange}
                                    onEdgesChange={handleEdgesChange}
                                    onBeforeDelete={handleBeforeDelete}
                                    onConnect={handleConnect}
                                    isValidConnection={isValidConnection}
                                    onNodeClick={(_, node) => { setSelectedNode(node as TerrainNode); setSheet("inspector"); }}
                                    onPaneClick={() => setSelectedNode(null)}
                                    fitView
                                    fitViewOptions={{ padding: 0.2 }}
                                    minZoom={0.1}
                                    maxZoom={2}
                                    deleteKeyCode="Delete"
                                    selectionKeyCode="Shift"
                                    multiSelectionKeyCode="Shift"
                                >
                                    <Background gap={22} size={1} color="#c9c2b4" />
                                    <Controls />
                                    <MiniMap
                                        nodeColor={(node) => (node.data as TerrainNodeData)?.accent || "#a8a294"}
                                        maskColor="rgba(246, 243, 236, 0.72)"
                                    />
                                </ReactFlow>

                                {activeTab === "graph" && nodes.length === 0 && (
                                    <div className="canvas-empty">
                                        <div className="canvas-empty-card">
                                            <span className="canvas-empty-eyebrow">Empty graph</span>
                                            <h3 className="canvas-empty-title">Start with coordinates</h3>
                                            <p className="canvas-empty-text">
                                                A terrain graph reads world position, shapes it with noise, then resolves the result into a height field.
                                            </p>
                                            <ol className="canvas-empty-steps">
                                                <li>
                                                    <span className="canvas-empty-step-index">1</span>
                                                    <span className="canvas-empty-step-text">Add a <strong>Coordinates</strong> node from the library.</span>
                                                </li>
                                                <li>
                                                    <span className="canvas-empty-step-index">2</span>
                                                    <span className="canvas-empty-step-text">Wire it into one or more <strong>Noise Textures</strong>.</span>
                                                </li>
                                                <li>
                                                    <span className="canvas-empty-step-index">3</span>
                                                    <span className="canvas-empty-step-text">Combine the fields and connect them to <strong>Terrain Output</strong>.</span>
                                                </li>
                                            </ol>
                                            <div className="canvas-empty-actions">
                                                <button className="canvas-empty-primary" onClick={() => addLibraryNode(nodeLibrary[0])}>
                                                    <Icon name="plus" />
                                                    Add Coordinates
                                                </button>
                                                <button className="canvas-empty-secondary" onClick={resetGraph}>
                                                    Restore starter graph
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {(ctrlHeld || cutting) && activeTab === "graph" && (
                                    <div
                                        className="cut-overlay"
                                        onPointerDown={beginCut}
                                        onPointerMove={moveCut}
                                        onPointerUp={finishCut}
                                        onPointerCancel={cancelCut}
                                    >
                                        <svg className="cut-svg">
                                            {cutLine.length > 1 && (
                                                <polyline
                                                    points={cutLine.map((point) => `${point.x},${point.y}`).join(" ")}
                                                    fill="none"
                                                    stroke="#ff626e"
                                                    strokeWidth="2.5"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            )}
                                        </svg>

                                        <div className="cut-cursor-label">Connection cutter</div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div className="bottom-status-bar">
                        <span>{activeTab === "world" ? "World View" : activeTab === "settings" ? "World Settings" : activeTab === "minecraft" ? "Minecraft Integration" : activeCustomTexture ? activeCustomTexture.name : "Terrain Graph"}</span>
                        <span aria-hidden="true">•</span>
                        <span className="status-message" title={projectPath ?? ""}>
                            {cutting ? "Cutting connections" : projectMessage && !["Project saved", "Project opened", "New project"].includes(projectMessage) ? projectMessage : projectDirty ? "Unsaved changes" : projectMessage || "Saved"}
                        </span>
                        <span className="status-spacer" />
                        <span className="status-hint">
                            {ctrlHeld
                                ? "Drag to cut connections"
                                : activeTab === "world"
                                    ? "Scroll to zoom · drag to pan"
                                    : activeTab === "settings"
                                        ? "Build range and dimension type"
                                        : "Drag nodes · Connect ports · Scroll to zoom"}
                        </span>
                    </div>
                </main>

                <aside className={`right-sidebar ${sheet === "inspector" ? "is-sheet-open" : ""}`}>
                    <div className="sheet-header">
                        <span>Inspector</span>
                        <button onClick={() => setSheet(null)} aria-label="Close panel"><Icon name="close" /></button>
                    </div>
                    <div className="inspector-header">
                        <span>Inspector</span>
                    </div>

                    {selectedNode ? (
                        <div className="inspector-content" onBlurCapture={() => { propertyEditRef.current = null; }}>
                            <div className="inspector-node-preview">
                                <span className="inspector-accent" style={{ background: selectedNode.data.accent }} />
                                <div>
                                    <div className="inspector-node-name">{selectedNode.data.title}</div>
                                    <div className="inspector-node-type">{selectedNode.data.category}</div>
                                </div>
                            </div>

                            <div className="inspector-meta">
                                <span className="inspector-chip">{selectedNode.data.kind ?? "unknown"}</span>
                                <span>{describeParameters(selectedNode.data) || selectedNode.data.value}</span>
                                <span>{inspectorInputs.length} in · {inspectorOutputs.length} out</span>
                            </div>

                            <div className="inspector-actions">
                                <button onClick={duplicateSelectedNode} title="Duplicate this node">Duplicate</button>
                                <button onClick={resetSelectedParameters} title="Restore the palette defaults for this node kind">Reset params</button>
                                <button className="is-danger" onClick={deleteSelectedNode} title="Delete this node and its connections">Delete</button>
                            </div>

                            {(inspectorInputs.length > 0 || inspectorOutputs.length > 0) && (
                                <div className="inspector-section">
                                    <div className="inspector-section-title">Connections</div>
                                    {inspectorInputs.length > 0 && (
                                        <>
                                            <div className="inspector-label">Inputs</div>
                                            <div className="connection-list">
                                                {inspectorInputs.map((node) => (
                                                    <button key={node.id} onClick={() => setSelectedNode(node)}>{node.data.title}</button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                    {inspectorOutputs.length > 0 && (
                                        <>
                                            <div className="inspector-label">Feeds</div>
                                            <div className="connection-list">
                                                {inspectorOutputs.map((node) => (
                                                    <button key={node.id} onClick={() => setSelectedNode(node)}>{node.data.title}</button>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {selectedNode.data.noiseType && (
                                <div className="noise-inspector">
                                    <div className="inspector-section-title">Illustrative sample · not graph output</div>

                                    <label className="inspector-label">Noise model</label>
                                    <select value={selectedNode.data.noiseType === "custom" ? selectedNode.data.textureId || "" : selectedNode.data.noiseType} onChange={(event) => changeNoiseType(event.target.value)}>
                                        {(["Classic", "Waves", "Minecraft 1.21", "Custom"] as const).map((group) => (
                                            <optgroup key={group} label={group}>
                                                {noiseOptions.filter((option) => option.group === group).map((option) => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                                {group === "Custom" && customTextures.map((texture) => (
                                                    <option key={texture.id} value={texture.id}>{texture.name}</option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </select>

                                    <div className="preview-switcher">
                                        <button className={previewMode === "2d" ? "active" : ""} onClick={() => setPreviewMode("2d")} aria-pressed={previewMode === "2d"}>2D field</button>
                                        <button className={previewMode === "3d" ? "active" : ""} onClick={() => setPreviewMode("3d")} aria-pressed={previewMode === "3d"}>Relief sketch</button>
                                    </div>

                                    <div className="texture-preview-frame">
                                        <TexturePreview type={selectedNode.data.noiseType} mode={previewMode} />
                                    </div>
                                </div>
                            )}

                            {(selectedNode.data.kind === "noise" || selectedNode.data.kind === "multiply") && (
                                <div className="inspector-section">
                                    <div className="inspector-section-title">Generation parameters</div>
                                    {selectedNode.data.kind === "noise" && <>
                                        <div className="field-row">
                                            <div className="field">
                                                <label className="inspector-label">Scale</label>
                                                <input type="number" step="0.0001" value={selectedNode.data.scale ?? 0.004} onChange={(event) => updateSelectedNode("scale", Number(event.target.value))} />
                                            </div>
                                            <div className="field">
                                                <label className="inspector-label">Amplitude</label>
                                                <input type="number" step="0.05" value={selectedNode.data.amplitude ?? 1} onChange={(event) => updateSelectedNode("amplitude", Number(event.target.value))} />
                                            </div>
                                            <div className="field">
                                                <label className="inspector-label">Seed</label>
                                                <input type="number" step="1" value={selectedNode.data.seed ?? 17} onChange={(event) => updateSelectedNode("seed", Number(event.target.value))} />
                                            </div>
                                            <div className="field">
                                                <label className="inspector-label">Rotation°</label>
                                                <input type="number" step="5" value={selectedNode.data.rotation ?? 0} onChange={(event) => updateSelectedNode("rotation", Number(event.target.value))} />
                                            </div>
                                        </div>
                                    </>}
                                    {selectedNode.data.kind === "multiply" && <>
                                        <label className="inspector-label">Factor</label>
                                        <input type="number" step="0.1" value={selectedNode.data.factor ?? 1} onChange={(event) => updateSelectedNode("factor", Number(event.target.value))} />
                                    </>}
                                </div>
                            )}

                            {(selectedNode.data.kind === "clamp" || selectedNode.data.kind === "remap" || selectedNode.data.kind === "curve" ||
                                selectedNode.data.kind === "blend" || selectedNode.data.kind === "terrace" ||
                                selectedNode.data.kind === "warp" || selectedNode.data.kind === "erosion") && (
                                <div className="inspector-section">
                                    <div className="inspector-section-title">Shaping parameters</div>
                                    {selectedNode.data.kind === "clamp" && (
                                        <div className="field-row">
                                            <div className="field"><label className="inspector-label">Min</label><input type="number" step="0.05" value={selectedNode.data.min ?? 0} onChange={(event) => updateSelectedNode("min", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">Max</label><input type="number" step="0.05" value={selectedNode.data.max ?? 1} onChange={(event) => updateSelectedNode("max", Number(event.target.value))} /></div>
                                        </div>
                                    )}
                                    {selectedNode.data.kind === "remap" && (
                                        <div className="field-row">
                                            <div className="field"><label className="inspector-label">In min</label><input type="number" step="0.05" value={selectedNode.data.inMin ?? 0} onChange={(event) => updateSelectedNode("inMin", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">In max</label><input type="number" step="0.05" value={selectedNode.data.inMax ?? 1} onChange={(event) => updateSelectedNode("inMax", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">Out min</label><input type="number" step="0.05" value={selectedNode.data.outMin ?? 0} onChange={(event) => updateSelectedNode("outMin", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">Out max</label><input type="number" step="0.05" value={selectedNode.data.outMax ?? 1} onChange={(event) => updateSelectedNode("outMax", Number(event.target.value))} /></div>
                                        </div>
                                    )}
                                    {selectedNode.data.kind === "curve" && (
                                        <div className="field"><label className="inspector-label">Gamma</label><input type="number" step="0.05" value={selectedNode.data.gamma ?? 1} onChange={(event) => updateSelectedNode("gamma", Number(event.target.value))} /></div>
                                    )}
                                    {selectedNode.data.kind === "blend" && (
                                        <div className="field"><label className="inspector-label">Mix (0 = first input)</label><input type="number" step="0.05" min="0" max="1" value={selectedNode.data.factor ?? 0.5} onChange={(event) => updateSelectedNode("factor", Number(event.target.value))} /></div>
                                    )}
                                    {selectedNode.data.kind === "terrace" && (
                                        <div className="field-row">
                                            <div className="field"><label className="inspector-label">Steps</label><input type="number" step="1" min="1" max="64" value={selectedNode.data.steps ?? 4} onChange={(event) => updateSelectedNode("steps", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">Strength</label><input type="number" step="0.05" min="0" max="1" value={selectedNode.data.strength ?? 0.8} onChange={(event) => updateSelectedNode("strength", Number(event.target.value))} /></div>
                                        </div>
                                    )}
                                    {selectedNode.data.kind === "warp" && (
                                        <div className="field-row">
                                            <div className="field"><label className="inspector-label">Scale</label><input type="number" step="0.0005" value={selectedNode.data.scale ?? 0.004} onChange={(event) => updateSelectedNode("scale", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">Strength</label><input type="number" step="0.5" value={selectedNode.data.strength ?? 30} onChange={(event) => updateSelectedNode("strength", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">Seed</label><input type="number" step="1" value={selectedNode.data.seed ?? 91} onChange={(event) => updateSelectedNode("seed", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">Rotation°</label><input type="number" step="5" value={selectedNode.data.rotation ?? 0} onChange={(event) => updateSelectedNode("rotation", Number(event.target.value))} /></div>
                                        </div>
                                    )}
                                    {selectedNode.data.kind === "erosion" && (
                                        <div className="field-row">
                                            <div className="field"><label className="inspector-label">Scale</label><input type="number" step="0.0005" value={selectedNode.data.scale ?? 0.012} onChange={(event) => updateSelectedNode("scale", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">Strength</label><input type="number" step="0.05" value={selectedNode.data.strength ?? 0.4} onChange={(event) => updateSelectedNode("strength", Number(event.target.value))} /></div>
                                            <div className="field"><label className="inspector-label">Seed</label><input type="number" step="1" value={selectedNode.data.seed ?? 53} onChange={(event) => updateSelectedNode("seed", Number(event.target.value))} /></div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {inspectorFields.length > 0 && (
                                <div className="inspector-section">
                                    <div className="inspector-section-title">Parameters</div>
                                    <div className="field-row">
                                        {inspectorFields.map((descriptor) => (
                                            <div className="field" key={descriptor.field}>
                                                <label className="inspector-label">{descriptor.label}</label>
                                                <input
                                                    type="number"
                                                    step={descriptor.step}
                                                    min={descriptor.min}
                                                    max={descriptor.max}
                                                    value={Number((selectedNode.data as unknown as Record<string, unknown>)[descriptor.field] ?? descriptor.fallback)}
                                                    onChange={(event) => updateSelectedNode(descriptor.field as keyof TerrainNodeData, Number(event.target.value))}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="inspector-section">
                                <div className="inspector-section-title">Node properties</div>

                                <label className="inspector-label">Title</label>
                                <input value={selectedNode.data.title} onChange={(event) => updateSelectedNode("title", event.target.value)} />

                                <label className="inspector-label">Category</label>
                                <input value={selectedNode.data.category} onChange={(event) => updateSelectedNode("category", event.target.value)} />

                                <label className="inspector-label">Description</label>
                                <textarea value={selectedNode.data.description} onChange={(event) => updateSelectedNode("description", event.target.value)} rows={3} />

                                <label className="inspector-label">Value</label>
                                <input value={selectedNode.data.value} onChange={(event) => updateSelectedNode("value", event.target.value)} />
                            </div>

                            <div className="inspector-section">
                                <div className="inspector-section-title">Node information</div>

                                <div className="info-row"><span>Node ID</span><span>{selectedNode.id}</span></div>
                                <div className="info-row"><span>Position X</span><span>{Math.round(selectedNode.position.x)}</span></div>
                                <div className="info-row"><span>Position Y</span><span>{Math.round(selectedNode.position.y)}</span></div>
                            </div>
                        </div>
                    ) : (
                        <div className="inspector-empty">
                            <span className="inspector-empty-icon"><Icon name="graph" /></span>
                            <div className="inspector-empty-title">No node selected</div>
                            <p>Select a node on the canvas to edit its properties.</p>
                        </div>
                    )}

                    <div className="world-settings" onBlurCapture={() => { propertyEditRef.current = null; }}>
                        <div className="inspector-section-title">World settings</div>

                        <div className="field-row">
                            <div className="field">
                                <label className="inspector-label">Min height</label>
                                <input type="number" value={worldInputs.minY} onChange={(event) => editWorldInput("minY", event.target.value)} onBlur={() => finishWorldInput("minY")} />
                            </div>
                            <div className="field">
                                <label className="inspector-label">Max height</label>
                                <input type="number" value={worldInputs.maxY} onChange={(event) => editWorldInput("maxY", event.target.value)} onBlur={() => finishWorldInput("maxY")} />
                            </div>
                            <div className="field">
                                <label className="inspector-label">Sea level</label>
                                <input type="number" value={worldInputs.seaLevel} onChange={(event) => editWorldInput("seaLevel", event.target.value)} onBlur={() => finishWorldInput("seaLevel")} />
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}

export default App;