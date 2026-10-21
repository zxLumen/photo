import type { AiIntent, ToneParams } from '../types.js'
import { KEYS, MOODS, NOISE_LEVELS, PROTECT_TAGS, SCENES } from '../types.js'
import { mergeTone } from './autoTone.js'
import { FILTER_IDS, filterName, getFilter } from './filters.js'
import type { ImageStats } from './imageStats.js'

const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : def

const tri = (v: unknown): -1 | 0 | 1 => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return n >= 1 ? 1 : n <= -1 ? -1 : 0
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** 校验并收敛模型返回的语义意图(非法枚举一律回落默认) */
export function normalizeIntent(raw: unknown): AiIntent {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const protect = Array.isArray(r.protect)
    ? Array.from(new Set(r.protect.filter((p): p is string => typeof p === 'string').filter((p) => (PROTECT_TAGS as readonly string[]).includes(p)))).slice(0, 5)
    : []
  const amount = Number(r.filterAmount)
  return {
    scene: pick(r.scene, SCENES, 'other'),
    key: pick(r.key, KEYS, 'normal'),
    mood: pick(r.mood, MOODS, 'natural'),
    skin: r.skin === true,
    noise: pick(r.noise, NOISE_LEVELS, 'none'),
    protect: protect as AiIntent['protect'],
    brightness: tri(r.brightness),
    punch: tri(r.punch),
    warmth: tri(r.warmth),
    // 只认目录里的 id:模型编一个不存在的名字一律作废,交给 fallbackFilter 兜底
    filter: pick(r.filter, FILTER_IDS, 'none'),
    filterAmount: Number.isFinite(amount) ? Math.round(clamp(amount, 0, 100)) : 100,
    filterWhy: typeof r.filterWhy === 'string' ? r.filterWhy.slice(0, 60) : '',
    styleHint: typeof r.styleHint === 'string' ? r.styleHint.slice(0, 20) : '',
  }
}

const SCENE_LABEL: Record<string, string> = {
  portrait: '人像',
  landscape: '风景',
  night: '夜景',
  street: '街拍',
  food: '美食',
  architecture: '建筑',
  macro: '微距',
  document: '文档',
  other: '其他',
}
const KEY_LABEL: Record<string, string> = { low: '低调', normal: '中性', high: '高调' }
const MOOD_LABEL: Record<string, string> = {
  vivid: '浓郁',
  natural: '自然',
  muted: '淡雅',
  filmic: '胶片',
  clean: '干净',
  dramatic: '戏剧',
}
const NOISE_LABEL: Record<string, string> = { none: '干净', light: '轻噪点', heavy: '噪点重' }

/** 把意图翻成人话(面板展示,让「针对性」看得见) */
export function describeIntent(i: AiIntent): string {
  const parts = [SCENE_LABEL[i.scene] ?? '其他', KEY_LABEL[i.key] ?? '中性', MOOD_LABEL[i.mood] ?? '自然']
  if (i.skin) parts.push('护肤色')
  if (i.noise !== 'none') parts.push(NOISE_LABEL[i.noise] ?? '')
  if (i.filter && i.filter !== 'none') parts.push(`滤镜 ${filterName(i.filter)}`)
  return parts.filter(Boolean).join(' · ')
}

/* ------------------------------------------------------------------ */
/* 滤镜选择:模型给语义,客户端做护栏与兜底                              */
/* ------------------------------------------------------------------ */

/** 高调滤镜:套在低调(欠曝/夜景)照片上会把氛围洗掉 */
const HIGH_KEY_ONLY = new Set(['airy', 'whitewall', 'japanese', 'brightskin', 'snow', 'mint'])
/** 强偏色滤镜:画面里有肤色时容易把脸染花 */
const SKIN_UNSAFE = new Set(['cyber', 'tealorange', 'blackgold', 'cassette', 'oldfilm', 'twilight'])

export interface FilterChoice {
  id: string
  amount: number
  why: string
  source: 'ai' | 'auto' | 'none'
}

/**
 * 模型没给、或给了不存在的 id 时的兜底:
 * 按题材 + 情绪选一个语义最贴的,保证「任何照片都有个合理落点」。
 */
export function fallbackFilter(i: AiIntent): string {
  if (i.protect.includes('vintage')) return 'faded'
  switch (i.scene) {
    case 'portrait':
      return i.mood === 'dramatic' ? 'bwcontrast' : i.mood === 'filmic' ? 'portra400' : i.mood === 'vivid' ? 'brightskin' : 'creamskin'
    case 'food':
      return i.key === 'low' || i.mood === 'dramatic' ? 'warmfood' : 'freshfood'
    case 'night':
      return i.mood === 'dramatic' ? 'cyber' : i.mood === 'filmic' ? 'cinestill800t' : 'citynight'
    case 'street':
      return i.mood === 'filmic' ? 'hongkong' : i.mood === 'dramatic' ? 'bwcontrast' : 'cinestill800t'
    case 'architecture':
      return i.mood === 'clean' ? 'crisp' : i.mood === 'filmic' ? 'classicchrome' : 'cold'
    case 'macro':
      return i.mood === 'muted' ? 'soft' : 'clean'
    case 'landscape':
      if (i.key === 'high') return 'airy'
      if (i.protect.includes('warm-sunset')) return 'twilight'
      if (i.mood === 'vivid') return 'velvia'
      if (i.mood === 'filmic') return 'ektar100'
      if (i.mood === 'muted') return 'pro400h'
      if (i.mood === 'dramatic') return 'bwcontrast'
      return 'mountain'
    default:
      break
  }
  switch (i.mood) {
    case 'filmic':
      return 'portra400'
    case 'muted':
      return 'faded'
    case 'vivid':
      return 'punch'
    case 'dramatic':
      return 'bwcontrast'
    case 'clean':
      return 'clean'
    default:
      return 'clean'
  }
}

/**
 * 定稿滤镜:优先用模型选的(必须是目录里的 id),再过三道护栏:
 *  - 文档不加滤镜;
 *  - 低调系照片不套高调滤镜;
 *  - 有肤色不套强偏色滤镜;
 *  - 噪点重 → 颗粒类滤镜压强度。
 */
export function pickFilter(intent: AiIntent | null | undefined, stats?: ImageStats | null): FilterChoice {
  if (!intent) return { id: 'none', amount: 0, why: '', source: 'none' }
  if (intent.scene === 'document') return { id: 'none', amount: 0, why: '文档类照片不加滤镜,避免影响可读性', source: 'none' }

  const def = getFilter(intent.filter)
  const fromAi = intent.filter !== 'none' && def.id === intent.filter
  let id = fromAi ? def.id : fallbackFilter(intent)
  let why = fromAi ? intent.filterWhy : ''
  let source: FilterChoice['source'] = fromAi ? 'ai' : 'auto'

  if (intent.key === 'low' && HIGH_KEY_ONLY.has(id)) {
    id = fallbackFilter({ ...intent, key: 'normal' })
    why = ''
    source = 'auto'
  }
  if (intent.skin && SKIN_UNSAFE.has(id)) {
    id = fallbackFilter({ ...intent, scene: 'portrait' })
    why = ''
    source = 'auto'
  }
  // 模型嘴上说「胶片/淡雅/浓郁/戏剧」,却选了最中性的「通透」——
  // 说明画面有明显气质,按它自己判的情绪挑个更有性格的,别浪费 52 个滤镜。
  if (id === 'clean' && intent.mood !== 'natural' && intent.mood !== 'clean') {
    const alt = fallbackFilter(intent)
    if (alt !== 'none') {
      id = alt
      why = ''
      source = 'auto'
    }
  }
  if (id === 'none') return { id: 'none', amount: 0, why: '', source: 'none' }

  const noise = stats ? stats.noise : intent.noise === 'heavy' ? 0.5 : intent.noise === 'light' ? 0.2 : 0
  let amount = source === 'ai' ? clamp(intent.filterAmount, 40, 100) : 100
  if (getFilter(id).grain > 0.15 && noise > 0.3) amount = Math.min(amount, 60)
  if (!why) why = getFilter(id).hint
  return { id, amount: Math.round(amount), why, source }
}

/**
 * 在**实测基座**上应用语义意图。
 *
 * 关键:**绝不覆盖实测值**,只做定向微调 + 设护栏(上限/下限)。
 * 因此同一套意图用在不同的图上,得到的参数依然不同。
 */
export function applyIntent(measured: ToneParams, intent: AiIntent | null | undefined, stats?: ImageStats | null): ToneParams {
  const out = { ...measured }
  if (!intent) return mergeTone(out)

  const add = (k: keyof ToneParams, d: number) => {
    out[k] += d
  }

  // ---- 三个粗方向(模型最可靠的判断) ----
  if (intent.brightness > 0) add('exposure', 9)
  else if (intent.brightness < 0) add('exposure', -9)

  if (intent.punch > 0) {
    add('contrast', 7)
    add('clarity', 5)
  } else if (intent.punch < 0) {
    add('contrast', -6)
    add('clarity', -4)
  }

  if (intent.warmth > 0) add('temperature', 8)
  else if (intent.warmth < 0) add('temperature', -8)

  // ---- 情绪 ----
  switch (intent.mood) {
    case 'vivid':
      add('vibrance', 10)
      add('saturation', 4)
      add('contrast', 5)
      break
    case 'muted':
      add('vibrance', -10)
      add('saturation', -8)
      break
    case 'filmic':
      add('contrast', -5)
      add('blacks', 6)
      add('highlights', -5)
      break
    case 'clean':
      add('clarity', 4)
      add('saturation', -2)
      break
    case 'dramatic':
      add('contrast', 10)
      add('blacks', -6)
      add('vignette', -8)
      break
    default:
      break
  }

  // ---- 场景 ----
  switch (intent.scene) {
    case 'portrait':
      add('vibrance', 4)
      break
    case 'night':
      // 噪点/锐化属于「可测量」的问题:有实测就听实测,别被模型的「夜景=噪点多」带偏
      if (!stats || stats.noise > 0.1) {
        add('denoise', 8)
        add('sharpen', -3)
      }
      break
    case 'architecture':
      add('clarity', 5)
      break
    case 'landscape':
      add('clarity', 3)
      add('vibrance', 3)
      break
    case 'food':
      add('vibrance', 6)
      add('temperature', 4)
      break
    case 'document':
      add('contrast', 6)
      add('clarity', 6)
      add('saturation', -12)
      break
    default:
      break
  }

  // ---- 护栏:人像护肤色,别把质感磨成塑料,也别锐出毛孔 ----
  if (intent.skin || intent.scene === 'portrait') {
    out.clarity = Math.min(out.clarity, 6)
    out.sharpen = Math.min(out.sharpen, 12)
    out.saturation = Math.min(out.saturation, 8)
  }

  // ---- 护栏:噪点。「噪点多少」是可测量的 → 有实测就以实测为准,模型判断只作兜底 ----
  const nz = stats ? stats.noise : intent.noise === 'heavy' ? 0.6 : intent.noise === 'light' ? 0.25 : 0
  if (nz > 0.12) {
    out.sharpen *= nz > 0.35 ? 0.3 : 0.6
    out.denoise = Math.max(out.denoise, nz > 0.35 ? 20 : 8)
  }

  // ---- 保护:不要「纠正」掉作者的意图 ----
  for (const p of intent.protect) {
    if (p === 'dark-mood') {
      // 「保留暗调氛围」是让它别被提成白天,不是一点都不许提:
      // 实测 p50=0.14 的烛光照片需要约 +0.9EV,这里给到 +0.34EV 的中庸上限
      out.exposure = Math.min(out.exposure, 24)
      out.shadows = Math.min(out.shadows, 20)
    } else if (p === 'silhouette') {
      out.shadows = Math.min(out.shadows, 8)
    } else if (p === 'warm-sunset') {
      out.temperature = Math.min(out.temperature, 14)
    } else if (p === 'high-key-bright') {
      out.contrast = Math.min(out.contrast, 12)
    } else if (p === 'vintage') {
      out.vibrance = Math.min(out.vibrance, 8)
    }
  }

  // ---- 基调:低调图不许被提成白天;高调图不许压暗 ----
  if (intent.key === 'low') out.exposure = Math.min(out.exposure, 28)
  else if (intent.key === 'high') out.exposure = Math.max(out.exposure, 0)

  return mergeTone(out)
}
