import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { installMcreatorPlugin, PLUGIN_ID } from '../electron/mcreatorPlugin.ts'

async function sandbox(t: TestContext, payload = 'plugin-zip-v1') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'terrain-studio-plugin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const zip = path.join(root, 'bundled.zip')
  await writeFile(zip, payload)
  const home = path.join(root, 'home')
  await mkdir(home, { recursive: true })
  return { root, zip, home, mcreator: path.join(home, '.mcreator') }
}

test('installs the bundled plugin into MCreator and creates the plugins folder', async (t) => {
  const { zip, home, mcreator } = await sandbox(t)
  await mkdir(mcreator)

  const outcome = await installMcreatorPlugin({ pluginZip: zip, homeDirectory: home })

  assert.equal(outcome.status, 'installed')
  assert.equal(outcome.target, path.join(mcreator, 'plugins', `${PLUGIN_ID}.zip`))
  assert.equal(await readFile(outcome.target, 'utf8'), 'plugin-zip-v1')
})

test('leaves an identical copy alone so relaunching does not rewrite MCreator files', async (t) => {
  const { zip, home, mcreator } = await sandbox(t)
  await mkdir(mcreator)

  await installMcreatorPlugin({ pluginZip: zip, homeDirectory: home })
  const second = await installMcreatorPlugin({ pluginZip: zip, homeDirectory: home })

  assert.equal(second.status, 'already-current')
})

test('replaces an older copy when the bundled plugin changes', async (t) => {
  const { zip, home, mcreator } = await sandbox(t)
  await mkdir(mcreator)
  await installMcreatorPlugin({ pluginZip: zip, homeDirectory: home })

  const newer = path.join(path.dirname(zip), 'bundled-v2.zip')
  await writeFile(newer, 'plugin-zip-v2')
  const outcome = await installMcreatorPlugin({ pluginZip: newer, homeDirectory: home })

  assert.equal(outcome.status, 'installed')
  assert.equal(await readFile(outcome.target, 'utf8'), 'plugin-zip-v2')
})

test('leaves a machine without MCreator untouched', async (t) => {
  const { zip, home } = await sandbox(t)

  const outcome = await installMcreatorPlugin({ pluginZip: zip, homeDirectory: home })

  assert.equal(outcome.status, 'no-mcreator')
  assert.deepEqual(await readdir(home), [])
})

test('reports an extracted copy that would make MCreator load the plugin twice', async (t) => {
  const { zip, home, mcreator } = await sandbox(t)
  const extracted = path.join(mcreator, 'plugins', PLUGIN_ID)
  await mkdir(extracted, { recursive: true })
  await writeFile(path.join(extracted, 'plugin.json'), JSON.stringify({ id: PLUGIN_ID }))

  const outcome = await installMcreatorPlugin({ pluginZip: zip, homeDirectory: home })

  assert.equal(outcome.status, 'installed')
  assert.equal(outcome.staleFolder, extracted)
  // The folder is the user's; it is reported, not deleted.
  assert.equal(await readFile(path.join(extracted, 'plugin.json'), 'utf8'), JSON.stringify({ id: PLUGIN_ID }))
})

test('does not mistake another plugin folder for ours', async (t) => {
  const { zip, home, mcreator } = await sandbox(t)
  const other = path.join(mcreator, 'plugins', PLUGIN_ID)
  await mkdir(other, { recursive: true })
  await writeFile(path.join(other, 'plugin.json'), JSON.stringify({ id: 'someone-elses-plugin' }))

  const outcome = await installMcreatorPlugin({ pluginZip: zip, homeDirectory: home })

  assert.equal(outcome.staleFolder, undefined)
})

test('leaves no temporary file behind after installing', async (t) => {
  const { zip, home, mcreator } = await sandbox(t)
  await mkdir(mcreator)

  await installMcreatorPlugin({ pluginZip: zip, homeDirectory: home })

  assert.deepEqual(await readdir(path.join(mcreator, 'plugins')), [`${PLUGIN_ID}.zip`])
})
