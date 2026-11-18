/// <reference types="vite-plugin-electron/electron-env" />

import type { TerrainStudioBridge } from './ipc'

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * The built directory structure
       *
       * ```tree
       * ├─┬─┬ dist
       * │ │ └── index.html
       * │ │
       * │ ├─┬─┬ dist-electron
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

  // Exposed by `preload.ts`.
  interface Window {
    terrainProjects: TerrainStudioBridge
  }
}
