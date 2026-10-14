import path from 'node:path'
import { readJsonWithBak, writeJson } from './store.js'
import { PROVIDERS, detectProvider } from './providers.js'

/**
 * AI 配置。**每个服务商一个独立槽位**(各自的 model + baseURL),与 luminari / yijing64 同构。
 * 主要走博客 AI 网关(令牌经 env `ZX_AI_APP_TOKEN` 注入);直连槽位仅供本地调试。
 */

const settingsFile = (dataDir) => path.join(dataDir, 'settings.json')
const keysFile = (dataDir) => path.join(dataDir, 'keys.json')

export const DEFAULT_SETTINGS = {
  provider: 'zxGateway',
  maxTokens: 4096,
  temperature: 0.4,
  visitorAi: process.env.PHOTO_VISITOR_AI !== '0',
}

const str = (value, fallback) => (typeof value === 'string' && value.trim() ? value.trim() : fallback)

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const clampNum = (value, min, max, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const normalize = (stored) => {
  const raw = stored && typeof stored === 'object' ? stored : {}
  const provider = PROVIDERS.some((p) => p.id === raw.provider) ? raw.provider : DEFAULT_SETTINGS.provider
  const legacy = raw.providers && typeof raw.providers === 'object' ? null : provider

  /** @type {Record<string, {model: string, baseURL: string}>} */
  const providers = {}
  for (const preset of PROVIDERS) {
    const slot = legacy ? {} : (raw.providers?.[preset.id] ?? {})
    providers[preset.id] = {
      model: str(legacy === preset.id ? raw.model : slot.model, preset.defaultModel),
      baseURL:
        preset.id === 'zxGateway'
          ? process.env.ZX_AI_GATEWAY_URL || preset.defaultBaseURL
          : str(legacy === preset.id ? raw.baseURL : slot.baseURL, preset.defaultBaseURL),
    }
  }

  return {
    provider,
    providers,
    maxTokens: clampInt(raw.maxTokens, 256, 8192, DEFAULT_SETTINGS.maxTokens),
    temperature: clampNum(raw.temperature, 0, 2, DEFAULT_SETTINGS.temperature),
    visitorAi: typeof raw.visitorAi === 'boolean' ? raw.visitorAi : DEFAULT_SETTINGS.visitorAi,
  }
}

export const loadSettings = async (dataDir) => normalize(await readJsonWithBak(settingsFile(dataDir), null))

export async function saveSettings(dataDir, patch) {
  const current = await loadSettings(dataDir)
  const next = { ...current, providers: { ...current.providers } }

  if (PROVIDERS.some((p) => p.id === patch?.provider)) next.provider = patch.provider
  if (patch?.providers && typeof patch.providers === 'object') {
    for (const preset of PROVIDERS) {
      const slot = patch.providers[preset.id]
      if (!slot || typeof slot !== 'object') continue
      const prev = current.providers[preset.id]
      next.providers[preset.id] = {
        model: 'model' in slot ? str(slot.model, preset.defaultModel) : prev.model,
        baseURL: 'baseURL' in slot ? str(slot.baseURL, preset.defaultBaseURL) : prev.baseURL,
      }
    }
  }
  if (patch?.maxTokens !== undefined) next.maxTokens = clampInt(patch.maxTokens, 256, 8192, current.maxTokens)
  if (patch?.temperature !== undefined) next.temperature = clampNum(patch.temperature, 0, 2, current.temperature)
  if (typeof patch?.visitorAi === 'boolean') next.visitorAi = patch.visitorAi

  await writeJson(settingsFile(dataDir), next)
  return next
}

export async function loadKeys(dataDir) {
  const keys = await readJsonWithBak(keysFile(dataDir), {})
  return keys && typeof keys === 'object' ? keys : {}
}

export async function saveKey(dataDir, provider, key) {
  const keys = await loadKeys(dataDir)
  if (key) keys[provider] = String(key).trim()
  else delete keys[provider]
  await writeJson(keysFile(dataDir), keys, { mode: 0o600 })
  return keys
}

const maskKey = (key) => {
  const k = String(key || '')
  if (!k) return null
  if (k.length <= 10) return `${k.slice(0, 2)}…`
  return `${k.slice(0, 6)}…${k.slice(-4)}`
}

export async function aiConfigFor(dataDir, provider) {
  const s = await loadSettings(dataDir)
  const id = PROVIDERS.some((p) => p.id === provider) ? provider : s.provider
  const keys = await loadKeys(dataDir)
  const slot = s.providers[id]
  const keyId = keys[id] ? id : detectProvider(slot.baseURL)
  let apiKey = keys[keyId] || ''
  if (!apiKey && (id === 'zxGateway' || keyId === 'zxGateway')) {
    apiKey = (process.env.ZX_AI_APP_TOKEN || '').trim()
  }
  const isGw = id === 'zxGateway' || keyId === 'zxGateway'
  const baseURL = isGw
    ? process.env.ZX_AI_GATEWAY_URL ||
      PROVIDERS.find((p) => p.id === 'zxGateway')?.defaultBaseURL ||
      slot.baseURL
    : slot.baseURL
  return {
    apiKey,
    baseURL,
    model: slot.model,
    maxTokens: s.maxTokens,
    temperature: s.temperature,
    visitorAi: s.visitorAi,
  }
}

export const aiConfig = (dataDir) => aiConfigFor(dataDir, null)

export async function publicSettings(dataDir) {
  const s = await loadSettings(dataDir)
  const keys = await loadKeys(dataDir)
  const cfg = await aiConfigFor(dataDir, s.provider)
  return {
    provider: s.provider,
    model: cfg.model,
    baseURL: cfg.baseURL,
    maxTokens: s.maxTokens,
    temperature: s.temperature,
    visitorAi: s.visitorAi,
    hasKey: !!cfg.apiKey,
    keyMask: maskKey(cfg.apiKey),
    providers: PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      defaultModel: p.defaultModel,
      defaultBaseURL: p.defaultBaseURL,
      model: s.providers[p.id].model,
      baseURL: s.providers[p.id].baseURL,
      hasKey: !!keys[p.id],
      keyMask: maskKey(keys[p.id]),
    })),
  }
}
