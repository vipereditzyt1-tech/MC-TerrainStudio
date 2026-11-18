import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test, { type TestContext } from 'node:test'
import { handoffDirectory, queuePackageForMcreator } from '../electron/mcreatorHandoff.ts'

async function sandbox(t: TestContext, options: { pluginInstalled?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'terrain-studio-handoff-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const mcreator = path.join(home, '.mcreator')
  await mkdir(mcreator, { recursive: true })
  if (options.pluginInstalled !== false) {
    await mkdir(path.join(mcreator, 'plugins'), { recursive: true })
    await writeFile(path.join(mcreator, 'plugins', 'terrain-studio.zip'), 'zip')
  }
  return { root, home, mcreator }
}

test('queues a package where the plugin watches for it', async (t) => {
  const { home } = await sandbox(t)

  const result = await queuePackageForMcreator({ text: '{"version":1}', name: 'Appalachian Terrain', homeDirectory: home })

  assert.equal(result.status, 'queued')
  assert.ok(result.status === 'queued')
  assert.equal(path.dirname(result.path), handoffDirectory(home))
  assert.match(path.basename(result.path), /^[0-9TZ-]+-Appalachian-Terrain-[0-9a-f]{8}\.tsmc$/)
  assert.equal(await readFile(result.path, 'utf8'), '{"version":1}')
})

test('leaves no temporary file behind, so the plugin never sees a partial package', async (t) => {
  const { home } = await sandbox(t)

  const result = await queuePackageForMcreator({ text: '{}', name: 'Coast', homeDirectory: home })

  assert.ok(result.status === 'queued')
  assert.deepEqual(await readdir(path.dirname(result.path)), [path.basename(result.path)])
})

test('gives every send its own name so a quick second send is not overwritten', async (t) => {
  const { home } = await sandbox(t)

  const first = await queuePackageForMcreator({ text: '{"a":1}', name: 'Same Name', homeDirectory: home })
  const second = await queuePackageForMcreator({ text: '{"a":2}', name: 'Same Name', homeDirectory: home })

  assert.ok(first.status === 'queued' && second.status === 'queued')
  assert.notEqual(first.path, second.path)
  assert.equal(await readFile(second.path, 'utf8'), '{"a":2}')
})

test('refuses to queue when MCreator was never installed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'terrain-studio-nomcreator-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = await queuePackageForMcreator({ text: '{}', name: 'Coast', homeDirectory: root })

  assert.equal(result.status, 'no-mcreator')
  assert.deepEqual(await readdir(root), [])
})

test('refuses to queue when the plugin is not installed, since nothing would collect it', async (t) => {
  const { home } = await sandbox(t, { pluginInstalled: false })

  const result = await queuePackageForMcreator({ text: '{}', name: 'Coast', homeDirectory: home })

  assert.equal(result.status, 'plugin-missing')
})
