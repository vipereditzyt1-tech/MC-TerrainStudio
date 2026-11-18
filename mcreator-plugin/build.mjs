#!/usr/bin/env node
/**
 * Builds the Terrain Studio MCreator plugin zip.
 *
 * Usage:
 *   node mcreator-plugin/build.mjs --mcreator "C:\path\to\MCreator"
 *   MCREATOR_HOME="C:\path\to\MCreator" node mcreator-plugin/build.mjs
 *
 * The MCreator distribution keeps its core classes inside mcreator.exe (a self-extracting zip)
 * and its dependencies in lib/. The plugin is compiled against those exact classes with the
 * JDK bundled with MCreator, so no separate Java installation is needed.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const argValue = (name) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function fail(message) {
  console.error(`build: ${message}`)
  process.exit(1)
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...options })
  if (result.status !== 0) {
    console.error(result.stdout ?? '')
    console.error(result.stderr ?? '')
    fail(`${path.basename(command)} ${result.error ? `could not run (${result.error.message})` : `exited with ${result.status}`}`)
  }
  return result
}

const candidates = [
  argValue('--mcreator'),
  process.env.MCREATOR_HOME,
  'C:\\Program Files\\MCreator',
  'C:\\Program Files (x86)\\MCreator',
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'MCreator'),
].filter(Boolean)

const install = candidates.map((directory) => path.resolve(directory)).find((directory) => fs.existsSync(path.join(directory, 'mcreator.exe')))
if (!install) {
  fail('MCreator installation not found. Pass --mcreator "<directory containing mcreator.exe>" or set MCREATOR_HOME.')
}

const jdk = path.join(install, 'jdk', 'bin')
const javac = path.join(jdk, process.platform === 'win32' ? 'javac.exe' : 'javac')
const jar = path.join(jdk, process.platform === 'win32' ? 'jar.exe' : 'jar')
if (!fs.existsSync(javac) || !fs.existsSync(jar)) fail(`The bundled JDK is missing from ${install}`)

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'terrain-studio-plugin-'))
const core = path.join(work, 'core')
const classes = path.join(work, 'classes')
fs.mkdirSync(core, { recursive: true })
fs.mkdirSync(classes, { recursive: true })

run(jar, ['xf', path.join(install, 'mcreator.exe')], { cwd: core })

const sources = fs.readdirSync(path.join(here, 'src', 'net', 'terrainstudio'))
  .filter((file) => file.endsWith('.java'))
  .map((file) => path.join(here, 'src', 'net', 'terrainstudio', file))

const classpath = [core, path.join(install, 'lib', '*')].join(path.delimiter)
run(javac, ['-encoding', 'UTF-8', '--release', '21', '-classpath', classpath, '-d', classes, ...sources])

for (const resource of ['plugin.json', 'templates', 'vanilla']) {
  fs.cpSync(path.join(here, 'resources', resource), path.join(classes, resource), { recursive: true })
}

const outputDirectory = path.join(here, 'dist')
fs.mkdirSync(outputDirectory, { recursive: true })
const output = path.join(outputDirectory, 'terrain-studio.zip')
fs.rmSync(output, { force: true })
run(jar, ['--create', '--file', output, '-C', classes, '.'])

const entries = run(jar, ['tf', output]).stdout.split(/\r?\n/)
for (const required of ['plugin.json', 'net/terrainstudio/TerrainStudioPlugin.class', 'templates/TerrainStudioWorldgen.java.template', 'vanilla/1.21.1.json', 'vanilla/26.1.2.json', 'vanilla/1.21.1-large_biomes.json', 'vanilla/1.21.1-amplified.json', 'vanilla/26.1.2-large_biomes.json', 'vanilla/26.1.2-amplified.json']) {
  if (!entries.includes(required)) fail(`built archive is missing ${required}`)
}

fs.rmSync(work, { recursive: true, force: true })
console.log(`Built ${output} (${(fs.statSync(output).size / 1024).toFixed(0)} KiB) against MCreator in ${install}`)
