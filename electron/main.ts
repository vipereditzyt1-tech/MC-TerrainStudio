import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { open, writeFile, rename, unlink, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const APP_ID = 'com.terrainstudio.app'

let win: BrowserWindow | null
let currentProjectPath: string | null = null
let pendingProjectPath: string | null = null
let projectDirty = false
const projectFilter = [{ name: 'Terrain Studio project', extensions: ['terrain'] }]

// Illegal file-name characters, control characters included. Matching control characters is
// the point of this pattern, so the lint rule has to stand aside for it.
// eslint-disable-next-line no-control-regex -- control characters are what we strip
const illegalFileNameCharacters = /[<>:"/\\|?*\x00-\x1f]/g
const safeFileName = (name: string, fallback: string) => name.replace(illegalFileNameCharacters, '_') || fallback

ipcMain.handle('project:open', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('Project window is unavailable.')
  pendingProjectPath = null
  const result = await dialog.showOpenDialog(owner, { title: 'Open Terrain Studio Project', filters: projectFilter, properties: ['openFile'] })
  if (result.canceled || !result.filePaths[0]) return null
  const filePath = result.filePaths[0]
  if (!filePath) return null
  const handle = await open(filePath, 'r')
  let text: string
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('Project must be a file smaller than 20 MB.')
    text = await handle.readFile('utf8')
    if (Buffer.byteLength(text, 'utf8') > 20 * 1024 * 1024) throw new Error('Project file exceeds the 20 MB limit.')
  } finally { await handle.close() }
  pendingProjectPath = filePath
  return { path: filePath, text }
})

ipcMain.handle('project:accept-open', (_event, filePath: string) => {
  if (filePath !== pendingProjectPath) throw new Error('The selected project has changed.')
  currentProjectPath = filePath
  pendingProjectPath = null
})

ipcMain.handle('project:save', async (event, text: string, saveAs: boolean, name: string) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('Project window is unavailable.')
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 20 * 1024 * 1024) throw new Error('Project exceeds the 20 MB limit.')
  let filePath = currentProjectPath
  if (saveAs || !filePath) {
    const result = await dialog.showSaveDialog(owner, { title: 'Save Terrain Studio Project', defaultPath: `${safeFileName(name, 'Terrain Project')}.terrain`, filters: projectFilter })
    if (result.canceled || !result.filePath) return null
    filePath = result.filePath
  }
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, filePath)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  currentProjectPath = filePath
  return filePath
})

ipcMain.handle('project:new', () => { currentProjectPath = null; pendingProjectPath = null })

// The renderer owns the notion of "unsaved"; the main process only needs the flag so it can
// ask before a window close throws that work away.
ipcMain.on('project:dirty', (_event, dirty: unknown) => { projectDirty = dirty === true })

// Crash recovery lives in userData, never beside the project and never inside the .terrain payload.
const recoveryFile = () => path.join(app.getPath('userData'), 'recovery', 'session.terrain')

ipcMain.handle('recovery:read', async () => {
  try {
    const handle = await open(recoveryFile(), 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null
      return await handle.readFile('utf8')
    } finally { await handle.close() }
  } catch { return null }
})

ipcMain.handle('recovery:write', async (_event, text: unknown) => {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 20 * 1024 * 1024) throw new Error('Recovery snapshot exceeds the 20 MB limit.')
  const target = recoveryFile()
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  try {
    await writeFile(temporary, text, { encoding: 'utf8' })
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
})

ipcMain.handle('recovery:clear', async () => { await unlink(recoveryFile()).catch(() => {}) })

ipcMain.handle('terrain:export-png', async (event, bytes: Uint8Array, name: string) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('Project window is unavailable.')
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 20 * 1024 * 1024) throw new Error('Invalid heightmap data.')
  const result = await dialog.showSaveDialog(owner, { title: 'Export Heightmap', defaultPath: `${safeFileName(name, 'Terrain')}-heightmap.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] })
  if (result.canceled || !result.filePath) return false
  const temporary = `${result.filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, result.filePath)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return true
})

// The renderer owns graph semantics; the main process only writes the package it is given.
ipcMain.handle('minecraft:export-package', async (event, text: unknown, name: string) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('Project window is unavailable.')
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 20 * 1024 * 1024) throw new Error('Integration package exceeds the 20 MB limit.')
  const result = await dialog.showSaveDialog(owner, {
    title: 'Export Minecraft Integration Package',
    defaultPath: `${safeFileName(name, 'Terrain')}.tsmc`,
    filters: [{ name: 'Terrain Studio Minecraft package', extensions: ['tsmc'] }],
  })
  if (result.canceled || !result.filePath) return false
  const temporary = `${result.filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, result.filePath)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return true
})

/** Trusted origins: the dev server in development, packaged files otherwise. */
function isTrustedNavigation(target: string): boolean {
  try {
    const url = new URL(target)
    if (VITE_DEV_SERVER_URL) return url.origin === new URL(VITE_DEV_SERVER_URL).origin
    return url.protocol === 'file:'
  } catch {
    return false
  }
}

function createWindow() {
  // A recreated window (macOS activate) starts clean until the renderer says otherwise.
  projectDirty = false
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Electron ignores beforeunload silently, so an unsaved project would just refuse to close.
  // Ask here instead, and only close once the user has chosen to discard the changes.
  win.on('close', (event) => {
    if (!projectDirty || !win) return
    event.preventDefault()
    const target = win
    void dialog.showMessageBox(target, {
      type: 'warning',
      buttons: ['Keep editing', 'Discard and close'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Unsaved changes',
      message: 'Close Terrain Studio and lose unsaved changes?',
      detail: 'The current project has changes that have not been saved.',
    }).then(({ response }) => {
      if (response !== 1) return
      projectDirty = false
      target.destroy()
    })
  })

  // The renderer never navigates away from itself: a stray link must not replace the editor.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedNavigation(url)) event.preventDefault()
  })

  // External links open in the user's browser instead of a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('closed', () => { win = null })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// A single editor instance owns the project file, so a second launch focuses the first window
// instead of opening a second writer for the same path.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.setName('Terrain Studio')
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(createWindow)
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
