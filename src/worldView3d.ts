import type { HeightField } from './terrainEngine';

export type SurfaceCamera = { yaw: number; pitch: number; zoom: number; exaggeration: number; water: boolean; seaLevel: number };

/**
 * Orthographic projection for the surface view. Coordinates go in as nx / nz in [-0.5, 0.5] and a
 * height normalised to 0..1, and come out in canvas pixels plus a depth that grows with distance
 * from the camera. Pitch is the camera's elevation above the ground plane: 8° is almost level with
 * the terrain, 88° is nearly straight down. Ground that is further away sits higher on the canvas,
 * and a summit is nearer the camera than the ground it stands on — turning either of those around
 * paints the low cells over the summits, so the relief reads inside out, as a bowl instead of hills.
 */
export function surfaceProjector(size: number, camera: SurfaceCamera) {
    const yaw = (camera.yaw * Math.PI) / 180;
    const pitch = (camera.pitch * Math.PI) / 180;
    const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
    const vertical = 0.55 * camera.exaggeration;
    return (nx: number, nz: number, height: number) => {
        const rx = nx * cosYaw - nz * sinYaw;
        const rz = nx * sinYaw + nz * cosYaw;
        const screenY = -(rz * sinPitch + height * vertical * cosPitch);
        const depth = rz * cosPitch - height * vertical * sinPitch;
        return { x: size / 2 + rx * size * 0.86 * camera.zoom, y: size / 2 + screenY * size * 0.86 * camera.zoom + size * 0.08, depth };
    };
}

/**
 * Painter's-algorithm surface renderer for the World View. Pure canvas 2D so it works in the packaged
 * Electron build with no WebGL context and no extra dependency.
 */
export function drawSurface3D(canvas: HTMLCanvasElement, field: HeightField, camera: SurfaceCamera): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    const size = canvas.width;
    context.clearRect(0, 0, size, size);

    const background = context.createLinearGradient(0, 0, 0, size);
    background.addColorStop(0, '#0b141f');
    background.addColorStop(1, '#05070a');
    context.fillStyle = background;
    context.fillRect(0, 0, size, size);

    // Sample at most 110 cells per side: enough for readable relief, cheap enough for a drag frame.
    const cells = Math.min(110, field.size - 1);
    const step = (field.size - 1) / cells;
    const span = Math.max(1e-6, field.max - field.min);

    const heightAt = (ix: number, iz: number) => {
        const x = Math.min(field.size - 1, Math.round(ix * step));
        const z = Math.min(field.size - 1, Math.round(iz * step));
        return Math.max(0, Math.min(1, (field.values[z * field.size + x] - field.min) / span));
    };

    const sea = Math.max(0, Math.min(1, (camera.seaLevel - field.min) / span));
    const project = surfaceProjector(size, camera);

    type Quad = { points: { x: number; y: number }[]; depth: number; shade: string };
    const quads: Quad[] = [];
    const heights = new Float32Array((cells + 1) * (cells + 1));
    for (let iz = 0; iz <= cells; iz += 1) {
        for (let ix = 0; ix <= cells; ix += 1) heights[iz * (cells + 1) + ix] = heightAt(ix, iz);
    }

    const lightX = -0.42, lightY = -0.48, lightZ = 0.77;
    for (let iz = 0; iz < cells; iz += 1) {
        for (let ix = 0; ix < cells; ix += 1) {
            const h00 = heights[iz * (cells + 1) + ix];
            const h10 = heights[iz * (cells + 1) + ix + 1];
            const h01 = heights[(iz + 1) * (cells + 1) + ix];
            const h11 = heights[(iz + 1) * (cells + 1) + ix + 1];
            const nx = (ix / cells - 0.5), nz = (iz / cells - 0.5);
            const cell = 1 / cells;
            const slopeX = (h10 + h11 - h00 - h01) * 0.5;
            const slopeZ = (h01 + h11 - h00 - h10) * 0.5;
            const length = Math.hypot(-slopeX, -slopeZ, cell * 2);
            const lambert = ((-slopeX) * lightX + (-slopeZ) * lightY + cell * 2 * lightZ) / Math.max(1e-6, length);
            const light = Math.max(0.18, Math.min(1, 0.55 + 0.55 * lambert));
            const average = (h00 + h10 + h01 + h11) / 4;

            let red: number, green: number, blue: number;
            if (camera.water && average < sea) {
                const depthMix = Math.min(1, (sea - average) / Math.max(1e-6, sea));
                red = 28 - 10 * depthMix;
                green = 92 - 30 * depthMix;
                blue = 152 - 30 * depthMix;
            } else {
                // Snow, exposed rock, sand at the shoreline, grass elsewhere: the same reading as the 2D view.
                if (average > 0.72) { red = 232; green = 240; blue = 247; }
                else if (Math.hypot(slopeX, slopeZ) > 0.09 || average > 0.58) { red = 126; green = 126; blue = 129; }
                else if (camera.water && average < sea + 0.02) { red = 214; green = 198; blue = 146; }
                else { red = 92; green = 146; blue = 78; }
                red *= light; green *= light; blue *= light;
            }

            const points = [
                project(nx, nz, h00),
                project(nx + cell, nz, h10),
                project(nx + cell, nz + cell, h11),
                project(nx, nz + cell, h01),
            ];
            const depth = (points[0].depth + points[1].depth + points[2].depth + points[3].depth) / 4;
            quads.push({
                points,
                depth,
                shade: `rgb(${Math.round(Math.max(0, Math.min(255, red)))},${Math.round(Math.max(0, Math.min(255, green)))},${Math.round(Math.max(0, Math.min(255, blue)))})`,
            });
        }
    }

    // Far geometry first, so nearer cells paint over it.
    quads.sort((a, b) => b.depth - a.depth);
    for (const quad of quads) {
        context.beginPath();
        context.moveTo(quad.points[0].x, quad.points[0].y);
        context.lineTo(quad.points[1].x, quad.points[1].y);
        context.lineTo(quad.points[2].x, quad.points[2].y);
        context.lineTo(quad.points[3].x, quad.points[3].y);
        context.closePath();
        context.fillStyle = quad.shade;
        // A hair of overlap closes the seams between neighbouring quads.
        context.strokeStyle = quad.shade;
        context.lineWidth = 1;
        context.fill();
        context.stroke();
    }
}
