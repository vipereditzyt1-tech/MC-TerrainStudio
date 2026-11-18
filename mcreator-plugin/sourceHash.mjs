/**
 * A digest of everything that goes into the plugin: Java sources plus resources.
 *
 * The installers embed a committed copy of the built zip, and the plugin is assembled by `jar`, which
 * stamps entry timestamps — so two builds of identical sources never produce identical bytes. Hashing
 * the inputs instead is what can actually answer "is the shipped zip older than the plugin?".
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Directories whose contents are compiled or copied into the zip. */
const INPUTS = [path.join('mcreator-plugin', 'src'), path.join('mcreator-plugin', 'resources')]

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

export function sourceDigest(root) {
  const hash = crypto.createHash('sha256')
  const files = INPUTS.flatMap((directory) => walk(path.join(root, directory)))
    .map((file) => ({ file, relative: path.relative(root, file).split(path.sep).join('/') }))
    .sort((left, right) => left.relative.localeCompare(right.relative))
  for (const { file, relative } of files) {
    hash.update(relative)
    hash.update('\0')
    hash.update(fs.readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}
