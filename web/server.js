import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 必须先于读 env 的模块(scope.js 的 DATA_DIR 是模块级常量)。见 lib/env.js。
import './lib/env.js'

import { DATA_DIR, resolveScope, cookieHeader, ownerToken, cidCookieHeader } from './lib/scope.js'
import { loadSettings, saveSettings, saveKey, publicSettings, aiConfig } from './lib/settings.js'
import { PROVIDERS } from './lib/providers.js'
import { analyzeImage, DEFAULT_TONE } from './lib/analysis.js'
import {
  listSessions,
  getSession,
  upsertSession,
  removeSession,
  listPresets,
  upsertPreset,
  removePreset,
  MAX_SESSIONS,
  MAX_PRESETS,
} from './lib/photo-store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')
const PORT = Number(process.env.PHOTO_PORT || 8791)
const HOST = process.env.PHOTO_HOST || '127.0.0.1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(JSON.stringify(body))
}

async function readBody(req, limit = 14 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, '请求体过大(图片请先压缩)')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

const rateBuckets = new Map()
function rateLimited(key, max, windowMs) {
  const now = Date.now()
  const b = rateBuckets.get(key)
  if (!b || now - b.at > windowMs) {
    rateBuckets.set(key, { at: now, n: 1 })
    return false
  }
  b.n += 1
  return b.n > max
}

const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/

/* ============================ 路由 ============================ */

const routes = []
const route = (method, pattern, handler) => routes.push({ method, pattern, handler })

route('GET', /^\/api\/health$/, async () => ({ ok: true, at: Date.now() }))

route('GET', /^\/api\/status$/, async (ctx) => {
  const s = await loadSettings(DATA_DIR)
  const cfg = await aiConfig(DATA_DIR)
  return {
    isOwner: ctx.scope.isOwner,
    hasToken: !!cfg.apiKey,
    visitorAi: s.visitorAi,
    provider: s.provider,
    model: cfg.model,
    limits: { sessions: MAX_SESSIONS, presets: MAX_PRESETS },
  }
})

route('GET', /^\/api\/settings$/, async (ctx) => ({ ...(await publicSettings(DATA_DIR)), isOwner: ctx.scope.isOwner }))

route('POST', /^\/api\/settings$/, async (ctx) => {
  if (!ctx.scope.isOwner) throw new HttpError(403, '仅站长可改配置')
  const body = await readBody(ctx.req)
  await saveSettings(DATA_DIR, body)
  return publicSettings(DATA_DIR)
})

route('POST', /^\/api\/settings\/key$/, async (ctx) => {
  if (!ctx.scope.isOwner) throw new HttpError(403, '仅站长可改配置')
  const body = await readBody(ctx.req)
  const provider = String(body.provider || '')
  if (!PROVIDERS.some((p) => p.id === provider)) throw new HttpError(400, '未知服务商')
  await saveKey(DATA_DIR, provider, String(body.key || ''))
  return publicSettings(DATA_DIR)
})

/* ---- 视觉分析 ---- */

route('POST', /^\/api\/analyze$/, async (ctx) => {
  const body = await readBody(ctx.req)
  const image = typeof body.image === 'string' ? body.image : ''
  if (!DATA_URL_RE.test(image)) throw new HttpError(400, '需要 data:image base64 图片')
  const width = Math.max(1, Math.round(Number(body.width) || 1))
  const height = Math.max(1, Math.round(Number(body.height) || 1))

  const s = await loadSettings(DATA_DIR)
  if (!ctx.scope.isOwner && !s.visitorAi) throw new HttpError(403, '站长未开放访客使用 AI')

  if (!ctx.scope.isOwner && rateLimited(`an:${ctx.scope.cid}`, 30, 10 * 60_000)) {
    throw new HttpError(429, '分析太频繁了,歇一会儿再试')
  }

  const cfg = await aiConfig(DATA_DIR)
  if (!cfg.apiKey) {
    const err = new HttpError(503, '未配置视觉模型令牌(站长在设置里配)')
    err.status = 503
    throw err
  }
  const { analysis, usage } = await analyzeImage(cfg, { dataUrl: image, width, height })
  return { analysis, usage }
})

/* ---- 编辑会话(按访客隔离) ---- */

route('GET', /^\/api\/sessions$/, async (ctx) => {
  const rows = await listSessions(DATA_DIR, ctx.scope.scopeKey)
  return { items: rows, total: rows.length }
})

route('GET', /^\/api\/sessions\/([^/]+)$/, async (ctx) => {
  const item = await getSession(DATA_DIR, ctx.scope.scopeKey, ctx.params[0])
  if (!item) throw new HttpError(404, '会话不存在')
  return { item }
})

route('POST', /^\/api\/sessions$/, async (ctx) => {
  const body = await readBody(ctx.req)
  const item = await upsertSession(DATA_DIR, ctx.scope.scopeKey, body)
  return { item }
})

route('DELETE', /^\/api\/sessions\/([^/]+)$/, async (ctx) => {
  const ok = await removeSession(DATA_DIR, ctx.scope.scopeKey, ctx.params[0])
  if (!ok) throw new HttpError(404, '会话不存在')
  return { ok: true }
})

/* ---- 预设 ---- */

route('GET', /^\/api\/presets$/, async (ctx) => ({ items: await listPresets(DATA_DIR, ctx.scope.scopeKey) }))

route('POST', /^\/api\/presets$/, async (ctx) => {
  const body = await readBody(ctx.req)
  return { item: await upsertPreset(DATA_DIR, ctx.scope.scopeKey, body) }
})

route('DELETE', /^\/api\/presets\/([^/]+)$/, async (ctx) => {
  const ok = await removePreset(DATA_DIR, ctx.scope.scopeKey, ctx.params[0])
  if (!ok) throw new HttpError(404, '预设不存在')
  return { ok: true }
})

/* ============================ 静态资源 ============================ */

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const target = path.join(DIST, rel)
  if (!target.startsWith(DIST)) {
    sendJson(res, 403, { error: 'forbidden' })
    return
  }
  let stat = null
  try {
    stat = await fsp.stat(target)
  } catch {
    stat = null
  }
  if (!stat || stat.isDirectory()) {
    const html = await fsp.readFile(path.join(DIST, 'index.html')).catch(() => null)
    if (!html) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('未构建前端:先执行 npm run build')
      return
    }
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' })
    res.end(html)
    return
  }
  const ext = path.extname(target).toLowerCase()
  const immutable = rel.startsWith('assets/')
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  fs.createReadStream(target).pipe(res)
}

/* ============================ 主循环 ============================ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  const pathname = url.pathname

  // 站长兜底:/?owner=<token> 换 photo_owner cookie
  const ownerParam = url.searchParams.get('owner')
  if (ownerParam && ownerParam !== ownerToken()) {
    sendJson(res, 403, { error: '站长 token 不对' })
    return
  }
  if (ownerParam && !pathname.startsWith('/api/')) {
    url.searchParams.delete('owner')
    res.writeHead(302, {
      Location: `${url.pathname}${url.search}`,
      'Set-Cookie': cookieHeader('photo_owner', ownerToken()),
    })
    res.end()
    return
  }

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method not allowed' })
      return
    }
    await serveStatic(req, res, pathname)
    return
  }

  const scope = resolveScope(req)
  const headers = {}
  if (scope.needsCidCookie) headers['Set-Cookie'] = cidCookieHeader(scope.rawCid)

  try {
    const hit = routes.find((r) => r.method === req.method && r.pattern.test(pathname))
    if (!hit) {
      sendJson(res, 404, { error: 'not found' }, headers)
      return
    }
    const m = pathname.match(hit.pattern)
    const body = await hit.handler({ req, res, url, scope, headers, params: m ? m.slice(1) : [] })
    if (body === undefined) return
    sendJson(res, 200, body, headers)
  } catch (err) {
    if (res.headersSent) {
      res.end()
      return
    }
    const status = err instanceof HttpError ? err.status : err?.status || 502
    const message = err instanceof Error ? err.message : '服务端错误'
    sendJson(res, status, { error: message, defaults: status >= 400 ? { tone: DEFAULT_TONE } : undefined }, headers)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`[photo] listening on http://${HOST}:${PORT}`)
  console.log(`[photo] data dir: ${DATA_DIR}`)
})

export { server }
