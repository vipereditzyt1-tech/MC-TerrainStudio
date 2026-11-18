/**
 * The one place IPC channels are named. `main.ts`, `preload.ts` and the renderer's `Window` type all
 * import from here, so adding a capability means adding one entry plus its handler — a typo in a
 * channel name is a compile error instead of a silently dead bridge method.
 */
export const IPC = {
    projectOpen: 'project:open',
    projectAcceptOpen: 'project:accept-open',
    projectSave: 'project:save',
    projectNew: 'project:new',
    projectDirty: 'project:dirty',
    recoveryWrite: 'recovery:write',
    recoveryRead: 'recovery:read',
    recoveryClear: 'recovery:clear',
    terrainExportPng: 'terrain:export-png',
    minecraftExportPackage: 'minecraft:export-package',
} as const

export type OpenedProject = { path: string; text: string }

/** The surface `preload.ts` exposes as `window.terrainProjects`. */
export type TerrainStudioBridge = {
    open: () => Promise<OpenedProject | null>
    acceptOpen: (path: string) => Promise<void>
    save: (text: string, saveAs: boolean, name: string) => Promise<string | null>
    newProject: () => Promise<void>
    exportPng: (bytes: Uint8Array, name: string) => Promise<boolean>
    exportPackage: (text: string, name: string) => Promise<boolean>
    /** Absent in plain-browser builds: Electron reports the dirty flag to the main process. */
    setDirty?: (dirty: boolean) => void
    /** Absent in plain-browser builds: unattended crash-recovery snapshots. */
    recovery?: {
        write: (text: string) => Promise<void>
        read: () => Promise<string | null>
        clear: () => Promise<void>
    }
}
