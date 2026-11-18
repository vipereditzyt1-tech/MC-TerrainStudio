import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type TerrainStudioBridge } from './ipc'

const bridge: TerrainStudioBridge = {
  open: () => ipcRenderer.invoke(IPC.projectOpen),
  acceptOpen: (path: string) => ipcRenderer.invoke(IPC.projectAcceptOpen, path),
  save: (text: string, saveAs: boolean, name: string) => ipcRenderer.invoke(IPC.projectSave, text, saveAs, name),
  newProject: () => ipcRenderer.invoke(IPC.projectNew),
  exportPng: (bytes: Uint8Array, name: string) => ipcRenderer.invoke(IPC.terrainExportPng, bytes, name),
  exportPackage: (text: string, name: string) => ipcRenderer.invoke(IPC.minecraftExportPackage, text, name),
  handOff: (text: string, name: string) => ipcRenderer.invoke(IPC.minecraftHandOff, text, name),
  setDirty: (dirty: boolean): void => ipcRenderer.send(IPC.projectDirty, dirty),
  recovery: {
    write: (text: string): Promise<void> => ipcRenderer.invoke(IPC.recoveryWrite, text),
    read: (): Promise<string | null> => ipcRenderer.invoke(IPC.recoveryRead),
    clear: (): Promise<void> => ipcRenderer.invoke(IPC.recoveryClear),
  },
}

contextBridge.exposeInMainWorld('terrainProjects', bridge)
