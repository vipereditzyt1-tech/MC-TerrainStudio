import { ipcRenderer, contextBridge } from 'electron'

contextBridge.exposeInMainWorld('terrainProjects', {
  open: (): Promise<{ path: string; text: string } | null> => ipcRenderer.invoke('project:open'),
  acceptOpen: (path: string): Promise<void> => ipcRenderer.invoke('project:accept-open', path),
  save: (text: string, saveAs: boolean, name: string): Promise<string | null> => ipcRenderer.invoke('project:save', text, saveAs, name),
  newProject: (): Promise<void> => ipcRenderer.invoke('project:new'),
  exportPng: (bytes: Uint8Array, name: string): Promise<boolean> => ipcRenderer.invoke('terrain:export-png', bytes, name),
  exportPackage: (text: string, name: string): Promise<boolean> => ipcRenderer.invoke('minecraft:export-package', text, name),
  setDirty: (dirty: boolean): void => ipcRenderer.send('project:dirty', dirty),
  recovery: {
    write: (text: string): Promise<void> => ipcRenderer.invoke('recovery:write', text),
    read: (): Promise<string | null> => ipcRenderer.invoke('recovery:read'),
    clear: (): Promise<void> => ipcRenderer.invoke('recovery:clear'),
  },
})

