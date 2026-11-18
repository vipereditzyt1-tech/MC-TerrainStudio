/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  terrainProjects: {
    open(): Promise<{ path: string; text: string } | null>
    acceptOpen(path: string): Promise<void>
    save(text: string, saveAs: boolean, name: string): Promise<string | null>
    newProject(): Promise<void>
    exportPng(bytes: Uint8Array, name: string): Promise<boolean>
    exportPackage(text: string, name: string): Promise<boolean>
    /** Absent in plain-browser builds: Electron reports the dirty flag to the main process. */
    setDirty?(dirty: boolean): void
    /** Absent in plain-browser builds: unattended crash-recovery snapshots. */
    recovery?: {
      write(text: string): Promise<void>
      read(): Promise<string | null>
      clear(): Promise<void>
    }
  }
}
