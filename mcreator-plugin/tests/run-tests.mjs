#!/usr/bin/env node
/**
 * One command for every plugin check:
 *   1. build mcreator-plugin/dist/terrain-studio.zip with MCreator's bundled JDK
 *   2. compile and run TerrainCompilerTest (validation, presets, install, update, conflicts)
 *   3. run the TypeScript ↔ generated-Java parity harness for every noise type
 *
 * Usage: node mcreator-plugin/tests/run-tests.mjs [--mcreator "<MCreator install>"]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function fail(message) {
  console.error(`test:plugin: ${message}`)
  process.exit(1)
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', cwd: root })
  if (result.status !== 0) fail(`${path.basename(command)} exited with ${result.status}`)
}

// The repo keeps an unpacked MCreator runtime for local verification; prefer it over system installs
// so the harness always builds against the version the tests were written for.
const unpacked = path.join(root, '.freebuff', 'mcreator-runtime', 'unpacked')
const localRuntimes = fs.existsSync(unpacked)
  ? fs.readdirSync(unpacked).map((entry) => path.join(unpacked, entry)).filter((dir) => fs.existsSync(path.join(dir, 'mcreator.exe')))
  : []
const install = [
  argValue('--mcreator'),
  process.env.MCREATOR_HOME,
  ...localRuntimes,
  'C:\\Program Files\\MCreator',
  'C:\\Program Files (x86)\\MCreator',
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'MCreator'),
].filter(Boolean)
  .map((directory) => path.resolve(directory))
  .find((directory) => fs.existsSync(path.join(directory, 'mcreator.exe')))
if (!install) fail('MCreator installation not found. Pass --mcreator "<directory containing mcreator.exe>" or set MCREATOR_HOME.')

const executable = (name) => path.join(install, 'jdk', 'bin', process.platform === 'win32' ? `${name}.exe` : name)
const zip = path.join(root, 'mcreator-plugin', 'dist', 'terrain-studio.zip')
const classpath = [zip, path.join(install, 'lib', '*')].join(path.delimiter)

run(process.execPath, [path.join(root, 'mcreator-plugin', 'build.mjs'), '--mcreator', install])

const classes = path.join(root, '.freebuff', 'plugin-build', 'test-run', 'classes')
const workspace = path.join(root, '.freebuff', 'plugin-build', 'test-run', 'workspace')
fs.rmSync(path.dirname(classes), { recursive: true, force: true })
fs.mkdirSync(classes, { recursive: true })
fs.mkdirSync(workspace, { recursive: true })

const tests = ['TerrainCompilerTest.java', 'NoiseParityTool.java'].map((file) => path.join(root, 'mcreator-plugin', 'tests', file))
run(executable('javac'), ['-encoding', 'UTF-8', '-classpath', classpath, '-d', classes, ...tests])
run(executable('java'), ['-classpath', [classes, classpath].join(path.delimiter), 'TerrainCompilerTest', workspace])
run(process.execPath, [path.join(root, 'mcreator-plugin', 'tests', 'run-parity.mjs')])

console.log('\ntest:plugin — all checks passed')
