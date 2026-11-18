#!/usr/bin/env node
/**
 * Rebuilds the plugin and refreshes the copy that ships inside the installers.
 *
 * The installers are packaged on machines (and CI runners) without MCreator, so the zip they embed
 * is committed at build/mcreator-plugin/terrain-studio.zip. Run this after touching the plugin's
 * Java, resources or templates; `npm run test:plugin` fails when the committed copy is out of date.
 *
 * Usage: node mcreator-plugin/bundle.mjs [--mcreator "<MCreator install>"]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceDigest } from './sourceHash.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const built = path.join(here, 'dist', 'terrain-studio.zip')
const shippedDirectory = path.join(root, 'build', 'mcreator-plugin')
const shipped = path.join(shippedDirectory, 'terrain-studio.zip')

// Same preference as the test harness: the repo's unpacked runtime wins over a system install, so the
// shipped zip is always built against the MCreator version the tests target.
const passed = process.argv.slice(2)
const unpacked = path.join(root, '.freebuff', 'mcreator-runtime', 'unpacked')
const local = fs.existsSync(unpacked)
  ? fs.readdirSync(unpacked)
    .map((entry) => path.join(unpacked, entry))
    .find((directory) => fs.existsSync(path.join(directory, 'mcreator.exe')))
  : undefined
const buildArgs = local && !passed.includes('--mcreator') ? [...passed, '--mcreator', local] : passed

const build = spawnSync(process.execPath, [path.join(here, 'build.mjs'), ...buildArgs], { stdio: 'inherit', cwd: root })
if (build.status !== 0) {
  console.error('bundle: the plugin build failed, so the shipped copy was left untouched')
  process.exit(build.status ?? 1)
}

fs.mkdirSync(shippedDirectory, { recursive: true })
fs.copyFileSync(built, shipped)
// Recorded so the test suite can tell whether this copy still matches the plugin sources.
fs.writeFileSync(path.join(shippedDirectory, 'source.sha256'), `${sourceDigest(root)}\n`)
console.log(`bundle: installers will ship ${path.relative(root, shipped)} (${(fs.statSync(shipped).size / 1024).toFixed(0)} KiB)`)
