import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  listSessions,
  upsertSession,
  getSession,
  removeSession,
  listPresets,
  upsertPreset,
  removePreset,
  MAX_SESSIONS,
} from '../lib/photo-store.js'

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'photo-test-'))
}

const SCOPE = 'a1b2c3d4e5f60718'

test('会话:创建 / 读取 / 更新 / 删除', async () => {
  const dir = await tmpDir()
  assert.deepEqual(await listSessions(dir, SCOPE), [])

  const created = await upsertSession(dir, SCOPE, { name: '第一张', thumb: 'data:image/jpeg;base64,AAAA', params: { crop: { x: 0, y: 0, w: 1, h: 1 } } })
  assert.ok(created.id.startsWith('s_'))
  assert.equal(created.name, '第一张')

  const got = await getSession(dir, SCOPE, created.id)
  assert.equal(got.name, '第一张')

  const updated = await upsertSession(dir, SCOPE, { id: created.id, name: '改名', thumb: '' })
  assert.equal(updated.id, created.id)
  assert.equal(updated.name, '改名')
  assert.equal(updated.createdAt, created.createdAt)

  const list = await listSessions(dir, SCOPE)
  assert.equal(list.length, 1)

  assert.equal(await removeSession(dir, SCOPE, created.id), true)
  assert.equal(await removeSession(dir, SCOPE, created.id), false)
  assert.deepEqual(await listSessions(dir, SCOPE), [])
})

test('会话:不同 scope 互相隔离', async () => {
  const dir = await tmpDir()
  await upsertSession(dir, SCOPE, { name: 'A', thumb: '' })
  await upsertSession(dir, 'ffffffffffffffff', { name: 'B', thumb: '' })
  assert.equal((await listSessions(dir, SCOPE))[0].name, 'A')
  assert.equal((await listSessions(dir, 'ffffffffffffffff'))[0].name, 'B')
})

test('会话:非法 thumb 被拒绝', async () => {
  const dir = await tmpDir()
  await assert.rejects(() => upsertSession(dir, SCOPE, { name: 'x', thumb: 'http://evil/x.png' }))
})

test('会话:超过上限丢最旧', async () => {
  const dir = await tmpDir()
  for (let i = 0; i < MAX_SESSIONS + 5; i++) {
    await upsertSession(dir, SCOPE, { name: `n${i}`, thumb: '' })
  }
  const list = await listSessions(dir, SCOPE)
  assert.equal(list.length, MAX_SESSIONS)
  assert.equal(list[0].name, `n${MAX_SESSIONS + 4}`) // 最新的在最前
})

test('预设:创建 / 应用 / 删除', async () => {
  const dir = await tmpDir()
  const p = await upsertPreset(dir, SCOPE, { name: '暖调', tone: { exposure: 5, temperature: 20 }, style: 'portrait' })
  assert.ok(p.id.startsWith('p_'))
  assert.equal((await listPresets(dir, SCOPE)).length, 1)
  await upsertPreset(dir, SCOPE, { id: p.id, name: '暖调2', tone: {}, style: 'none' })
  assert.equal((await listPresets(dir, SCOPE))[0].name, '暖调2')
  assert.equal(await removePreset(dir, SCOPE, p.id), true)
  assert.deepEqual(await listPresets(dir, SCOPE), [])
})

test('scopeKey 非 hex 一律归到 owner(防路径穿越)', async () => {
  const dir = await tmpDir()
  await upsertSession(dir, '../../etc/passwd', { name: 'evil', thumb: '' })
  const list = await listSessions(dir, 'owner')
  assert.equal(list.length, 1)
  assert.equal(list[0].name, 'evil')
})
