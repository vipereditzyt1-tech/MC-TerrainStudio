/**
 * Copies the MCreator plugin zip that ships with the app into MCreator's per-user plugin folder.
 *
 * MCreator's `PluginLoader` reads `plugin.json` straight out of any zip dropped in
 * `<home>/.mcreator/plugins` (checked against the 2026.2 loader, which also recurses into
 * subfolders — so an extracted copy left behind by a manual install has to be reported, or MCreator
 * would load the same plugin twice). Nothing here calls MCreator: it is a file copy, which means it
 * still works when MCreator is closed, and does nothing at all when MCreator was never installed.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const PLUGIN_ID = 'terrain-studio'

export type PluginInstallOutcome = {
  /**
   * installed: the zip was written. already-current: an identical copy was already in place.
   * no-mcreator: the user has no `~/.mcreator`, so nothing was touched. locked: a running MCreator
   * holds the zip open, which Windows will not let us replace until it exits.
   */
  status: 'installed' | 'already-current' | 'no-mcreator' | 'locked'
  /** Absolute path of the zip inside MCreator's plugin folder. */
  target: string
  /** An extracted copy of this same plugin that would make MCreator load it twice. */
  staleFolder?: string
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate)
    return true
  } catch {
    return false
  }
}

/** True when `folder` is an extracted copy of this plugin rather than some other plugin's folder. */
async function isExtractedCopyOfThisPlugin(folder: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(path.join(folder, 'plugin.json'), 'utf8')) as { id?: unknown }
    return manifest.id === PLUGIN_ID
  } catch {
    return false
  }
}

export async function installMcreatorPlugin(options: {
  pluginZip: string
  /** The user's home directory; a parameter so tests never touch the real one. */
  homeDirectory: string
  /** MCreator's per-user folder name, overridable for tests. */
  configFolder?: string
}): Promise<PluginInstallOutcome> {
  const config = path.join(options.homeDirectory, options.configFolder ?? '.mcreator')
  const pluginsDirectory = path.join(config, 'plugins')
  const target = path.join(pluginsDirectory, `${PLUGIN_ID}.zip`)

  // Only touch a machine that already runs MCreator: creating `.mcreator` for everyone would leave a
  // stray folder on the computers of people who never install MCreator.
  if (!(await exists(config))) return { status: 'no-mcreator', target }

  const extracted = path.join(pluginsDirectory, PLUGIN_ID)
  const staleFolder = (await isExtractedCopyOfThisPlugin(extracted)) ? extracted : undefined

  const bundled = await readFile(options.pluginZip)
  const current = await readFile(target).catch(() => null)
  if (current?.equals(bundled)) return { status: 'already-current', target, staleFolder }

  await mkdir(pluginsDirectory, { recursive: true })
  // Write beside the target and rename: MCreator must never open a half-written zip.
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, bundled)
  try {
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    // MCreator keeps the zip open while it runs, and Windows refuses to replace an open file. The
    // next launch installs it, so leave the old copy alone rather than half-applying an update.
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') return { status: 'locked', target, staleFolder }
    throw error
  }
  return { status: 'installed', target, staleFolder }
}
