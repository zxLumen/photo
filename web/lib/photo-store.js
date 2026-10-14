import crypto from 'node:crypto'
import path from 'node:path'
import { readJsonWithBak, writeJson } from './store.js'

/**
 * 按访客隔离的「编辑会话」与「预设」存储。
 *
 * 只存**降采样缩略图 + 编辑参数 + AI 分析结果**,不存原图(隐私 + 省存储)。
 * 每个数据域(访客 cid / owner)一个 JSON 文件,与 luminari 同款(单机单文件、写入轻)。
 */

export const MAX_SESSIONS = 100
export const MAX_PRESETS = 50
const MAX_THUMB_BYTES = 700 * 1024

const sessFile = (dataDir, scopeKey) => path.join(dataDir, 'sessions', `${safeScope(scopeKey)}.json`)
const presetFile = (dataDir, scopeKey) => path.join(dataDir, 'presets', `${safeScope(scopeKey)}.json`)

/** scopeKey 只可能是 16 位 hex 或 'owner';再做一次白名单防止路径穿越。 */
const safeScope = (scopeKey) => (/^[0-9a-f]{16}$/.test(scopeKey) ? scopeKey : 'owner')

const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`
const now = () => Date.now()

const asString = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

function readList(value, key) {
  const raw = value && typeof value === 'object' && Array.isArray(value[key]) ? value[key] : []
  return raw
}

/* ---------------------------- 编辑会话 ---------------------------- */

export async function listSessions(dataDir, scopeKey) {
  const doc = await readJsonWithBak(sessFile(dataDir, scopeKey), { version: 1, items: [] })
  return readList(doc, 'items')
}

export async function getSession(dataDir, scopeKey, id) {
  const items = await listSessions(dataDir, scopeKey)
  return items.find((s) => s.id === id) ?? null
}

/** 新建或覆盖一个会话(带 id 则覆盖)。返回落库后的条目。 */
export async function upsertSession(dataDir, scopeKey, input) {
  const doc = await readJsonWithBak(sessFile(dataDir, scopeKey), { version: 1, items: [] })
  const items = readList(doc, 'items')
  const id = asString(input?.id, 40) || newId('s')
  const thumb = asString(input?.thumb, MAX_THUMB_BYTES)
  if (thumb && !/^data:image\/(jpeg|png|webp);base64,/.test(thumb)) {
    const err = new Error('缩略图格式不支持')
    err.status = 400
    throw err
  }
  const item = {
    id,
    name: asString(input?.name, 60) || '未命名',
    thumb,
    params: input?.params && typeof input.params === 'object' ? input.params : null,
    analysis: input?.analysis && typeof input.analysis === 'object' ? input.analysis : null,
    createdAt: now(),
    updatedAt: now(),
  }
  const idx = items.findIndex((s) => s.id === id)
  if (idx >= 0) {
    item.createdAt = items[idx].createdAt || item.createdAt
    items[idx] = item
  } else {
    items.unshift(item)
  }
  // 超出上限:丢最旧的(尾部)
  const trimmed = items.slice(0, MAX_SESSIONS)
  await writeJson(sessFile(dataDir, scopeKey), { version: 1, items: trimmed })
  return item
}

export async function removeSession(dataDir, scopeKey, id) {
  const doc = await readJsonWithBak(sessFile(dataDir, scopeKey), { version: 1, items: [] })
  const items = readList(doc, 'items')
  const next = items.filter((s) => s.id !== id)
  if (next.length === items.length) return false
  await writeJson(sessFile(dataDir, scopeKey), { version: 1, items: next })
  return true
}

/* ---------------------------- 预设 ---------------------------- */

export async function listPresets(dataDir, scopeKey) {
  const doc = await readJsonWithBak(presetFile(dataDir, scopeKey), { version: 1, items: [] })
  return readList(doc, 'items')
}

export async function upsertPreset(dataDir, scopeKey, input) {
  const doc = await readJsonWithBak(presetFile(dataDir, scopeKey), { version: 1, items: [] })
  const items = readList(doc, 'items')
  const id = asString(input?.id, 40) || newId('p')
  const item = {
    id,
    name: asString(input?.name, 40) || '预设',
    tone: input?.tone && typeof input.tone === 'object' ? input.tone : {},
    style: asString(input?.style, 20) || 'none',
    createdAt: now(),
  }
  const idx = items.findIndex((p) => p.id === id)
  if (idx >= 0) items[idx] = item
  else items.unshift(item)
  await writeJson(presetFile(dataDir, scopeKey), { version: 1, items: items.slice(0, MAX_PRESETS) })
  return item
}

export async function removePreset(dataDir, scopeKey, id) {
  const doc = await readJsonWithBak(presetFile(dataDir, scopeKey), { version: 1, items: [] })
  const items = readList(doc, 'items')
  const next = items.filter((p) => p.id !== id)
  if (next.length === items.length) return false
  await writeJson(presetFile(dataDir, scopeKey), { version: 1, items: next })
  return true
}
