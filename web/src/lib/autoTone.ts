import type { ToneParams } from '../types.js'
import type { ImageStats } from './imageStats.js'

export const TONE_LIMITS: Record<keyof ToneParams, { min: number; max: number; step: number; label: string }> = {
  exposure: { min: -100, max: 100, step: 1, label: '曝光' },
  contrast: { min: -100, max: 100, step: 1, label: '对比度' },
  highlights: { min: -100, max: 100, step: 1, label: '高光' },
  shadows: { min: -100, max: 100, step: 1, label: '阴影' },
  whites: { min: -100, max: 100, step: 1, label: '白色' },
  blacks: { min: -100, max: 100, step: 1, label: '黑色' },
  temperature: { min: -100, max: 100, step: 1, label: '色温' },
  tint: { min: -100, max: 100, step: 1, label: '色调' },
  vibrance: { min: -100, max: 100, step: 1, label: '自然饱和度' },
  saturation: { min: -100, max: 100, step: 1, label: '饱和度' },
  clarity: { min: -100, max: 100, step: 1, label: '清晰度' },
  sharpen: { min: 0, max: 100, step: 1, label: '锐化' },
  denoise: { min: 0, max: 100, step: 1, label: '降噪' },
  vignette: { min: -100, max: 100, step: 1, label: '暗角' },
}

export const TONE_KEYS = Object.keys(TONE_LIMITS) as (keyof ToneParams)[]

export const emptyTone = (): ToneParams => ({
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  clarity: 0,
  sharpen: 0,
  denoise: 0,
  vignette: 0,
})

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** 曝光换算:与 colorPipeline 里 `lin *= pow(2.0, u_exposure * 1.4)` 严格对应(u = 参数/100) */
export const EV_SCALE = 1.4

/**
 * **按本图实测数据推导**自动修图参数。
 *
 * 每个参数都能追溯到一项测量:没有「默认就 +18」这种模板值。
 * 这也是「不同照片算出不同参数」的根本保证。
 */
export function deriveAutoTone(s: ImageStats): ToneParams {
  // ---- 曝光:只纠正「明显欠曝 / 明显过曝」,不把每张图都往中灰推 ----
  // (把一张曝光正常的落日强行压暗 0.5EV 是错的 —— 只要没有溢出就说明它本来就该这么亮)
  const lowKey = s.p75 < 0.45
  const highKey = s.p25 > 0.56
  const darkTarget = lowKey ? 0.3 : highKey ? 0.54 : 0.44
  const brightTarget = highKey ? 0.62 : 0.68
  let ev = 0
  if (s.p50 < darkTarget - 0.04) ev = Math.log2(darkTarget / clamp(s.p50, 0.03, 0.95))
  else if (s.p50 > brightTarget + 0.06 || s.clipHigh > 0.03) ev = Math.log2(brightTarget / clamp(s.p50, 0.03, 0.95))
  ev = clamp(ev, -0.7, 0.85)
  const exposure = Math.round(clamp((ev / EV_SCALE) * 100, -100, 100))

  // ---- 黑场:只有黑场明显浮起来(发灰)才收;白场交给对比度曲线,实测不做 ----
  const blacks = Math.round(clamp(-(s.p5 - 0.02) * 400, -55, 0))
  const whites = 0

  // ---- 阴影:死黑比例 + 暗部(下四分位)是否闷;正常光照下不硬提 ----
  const crushed = clamp((s.clipLow - 0.002) * 250, 0, 1)
  const darkQuiet = clamp((0.16 - s.p25) / 0.16, 0, 1)
  const shadows = Math.round(clamp(crushed * 24 + darkQuiet * 20, 0, 46))

  // ---- 高光:只看「溢出比例 + 白点顶到多满」,不靠猜 ----
  const hlNeed = clamp(s.clipHigh * 4 + Math.max(0, s.p99 - 0.96) * 3, 0, 1)
  const highlights = Math.round(-hlNeed * 80)

  // ---- 对比:p5–p95 跨度 vs 0.84,不足则加、过盛则减 ----
  const span = s.p95 - s.p5
  const contrast = Math.round(clamp(((0.84 - span) / 0.5) * 30, -25, 55))

  // ---- 白平衡:三区中性像素;可信度 = 中性像素占比;低调/夜景再打折(夜色的蓝是氛围) ----
  const wbConf = clamp(s.neutralRatio / 0.08, 0, 1) * (lowKey ? 0.35 : 1)
  const dead = (v: number, d: number) => (Math.abs(v) < d ? 0 : v - Math.sign(v) * d)
  const rb = s.mid.b - s.mid.r
  const gm = s.mid.g - (s.mid.r + s.mid.b) / 2
  const temperature = Math.round(clamp(dead(rb, 0.035) * 420 * wbConf, -30, 30))
  const tint = Math.round(clamp(dead(gm, 0.03) * 480 * wbConf, -25, 25))

  // ---- 自然饱和度:彩度低于 0.24 才补(实测照片均值多在 0.13~0.31,所以能拉开差距) ----
  const vibrance = Math.round(clamp((0.24 - s.chroma) * 140, 0, 30))

  // ---- 清晰度:只治「灰雾」(局部平 + 动态范围窄) ----
  const clarity = Math.round(clamp(s.haze * 26, 0, 26))

  // ---- 锐化:已有细节多就少加;噪点多就大幅压低 ----
  const detail = clamp(s.localContrast / 0.06, 0, 1)
  const sharpen = Math.round(clamp(15 * (1 - clamp(s.noise, 0, 1)) * (0.55 + 0.45 * detail), 0, 16))

  // ---- 降噪:只对噪点明显的图 ----
  const denoise = s.noise > 0.18 ? Math.round(clamp(s.noise * 46, 0, 28)) : 0

  return {
    ...emptyTone(),
    exposure,
    contrast,
    highlights,
    shadows,
    whites,
    blacks,
    temperature,
    tint,
    vibrance,
    clarity,
    sharpen,
    denoise,
    // 暗角是「风格」而不是「矫正」,实测默认不添加
    vignette: 0,
  }
}

/** 把任意来源的参数补全并夹紧成完整 ToneParams(全部为整数,与滑块 step=1 一致) */
export function mergeTone(partial: Partial<ToneParams> | null | undefined, base?: ToneParams): ToneParams {
  const out = { ...(base ?? emptyTone()) }
  if (partial) {
    for (const k of TONE_KEYS) {
      const v = partial[k]
      if (typeof v === 'number' && Number.isFinite(v)) {
        const lim = TONE_LIMITS[k]
        out[k] = Math.round(clamp(v, lim.min, lim.max))
      }
    }
  }
  return out
}

/**
 * 「叠加式」风格:在实测基座之上加一层 look 增量(clamped),而不是整组替换。
 * 这样既能玩风格,又不会把「按本图测算」的结果冲掉。
 */
export function applyLook(base: ToneParams, lookId: string): ToneParams {
  const look = STYLE_PRESETS[lookId]
  if (!look || lookId === 'none') return mergeTone(base)
  const out = { ...base }
  for (const k of TONE_KEYS) {
    const d = look.tone[k]
    if (typeof d !== 'number') continue
    const lim = TONE_LIMITS[k]
    out[k] = clamp(base[k] + d, lim.min, lim.max)
  }
  return out
}

/**
 * 风格层(= 在实测基座上的增量)。数值是「相对量」,不是绝对值:
 * 同一套 look 用在暗调图与高调图上,结果依然会不同。
 */
export const STYLE_PRESETS: Record<string, { label: string; tone: Partial<ToneParams> }> = {
  none: { label: '无', tone: {} },
  portrait: {
    label: '人像',
    tone: { temperature: 6, highlights: -4, shadows: 6, vibrance: 8, saturation: 2, clarity: -6, sharpen: 4 },
  },
  landscape: {
    label: '风景',
    tone: { contrast: 10, highlights: -6, blacks: -6, vibrance: 14, clarity: 10, sharpen: 6 },
  },
  night: { label: '夜景', tone: { shadows: 12, blacks: -6, vibrance: 8, clarity: 4, denoise: 6 } },
  mono: { label: '黑白', tone: { saturation: -100, contrast: 10, clarity: 8, sharpen: 4 } },
  film: { label: '胶片', tone: { contrast: -6, highlights: -5, shadows: 8, blacks: 8, temperature: 5, tint: -3, vibrance: 4 } },
  vivid: { label: '浓郁', tone: { contrast: 8, vibrance: 18, saturation: 8, clarity: 6 } },
}
