/**
 * Queues an integration package for the MCreator plugin.
 *
 * The plugin watches `<home>/.terrainstudio/handoff` and imports whatever lands there, so sending a
 * package is just a file write: no ports to open, no tokens to share, and a package queued while
 * MCreator is closed is picked up the next time a workspace opens. The package is written under a
 * temporary name and renamed into place, because the plugin treats any visible `.tsmc` as complete.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PLUGIN_ID } from './mcreatorPlugin.ts'

export type HandoffResult =
  | { status: 'queued'; path: string }
  /** No `~/.mcreator`: MCreator has never run here. */
  | { status: 'no-mcreator' }
  /** MCreator is installed but the plugin is not, so nothing would pick the package up. */
  | { status: 'plugin-missing' }

export function handoffDirectory(homeDirectory: string): string {
  return path.join(homeDirectory, '.terrainstudio', 'handoff')
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate)
    return true
  } catch {
    return false
  }
}

export async function queuePackageForMcreator(options: {
  text: string
  name: string
  /** The user's home directory; a parameter so tests never touch the real one. */
  homeDirectory: string
  /** MCreator's per-user folder name, overridable for tests. */
  configFolder?: string
}): Promise<HandoffResult> {
  const config = path.join(options.homeDirectory, options.configFolder ?? '.mcreator')
  if (!(await exists(config))) return { status: 'no-mcreator' }
  if (!(await exists(path.join(config, 'plugins', `${PLUGIN_ID}.zip`)))) return { status: 'plugin-missing' }

  const directory = handoffDirectory(options.homeDirectory)
  await mkdir(directory, { recursive: true })

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const label = options.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'terrain'
  const target = path.join(directory, `${stamp}-${label}-${randomUUID().slice(0, 8)}.tsmc`)
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, options.text, 'utf8')
  await rename(temporary, target)
  return { status: 'queued', path: target }
}
