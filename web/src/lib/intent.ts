import type { AiIntent, ToneParams } from '../types.js'
import { KEYS, MOODS, NOISE_LEVELS, PROTECT_TAGS, SCENES } from '../types.js'
import { mergeTone } from './autoTone.js'
import type { ImageStats } from './imageStats.js'

const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : def

const tri = (v: unknown): -1 | 0 | 1 => {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return n >= 1 ? 1 : n <= -1 ? -1 : 0
}

/** 校验并收敛模型返回的语义意图(非法枚举一律回落默认) */
export function normalizeIntent(raw: unknown): AiIntent {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const protect = Array.isArray(r.protect)
    ? Array.from(new Set(r.protect.filter((p): p is string => typeof p === 'string').filter((p) => (PROTECT_TAGS as readonly string[]).includes(p)))).slice(0, 5)
    : []
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
  return parts.filter(Boolean).join(' · ')
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
