import type { ToneParams } from '../types.js'

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

/**
 * 客户端直方图自动调色(与 AI 建议互补,防止模型幻觉)。
 * 输入是降采样后的 RGBA 像素(几百像素级即可)。
 */
export function computeAutoTone(data: Uint8ClampedArray, width: number, height: number): ToneParams {
  const n = width * height
  if (!n) return emptyTone()

  const hist = new Float32Array(256)
  let rs = 0
  let gs = 0
  let bs = 0
  let lSum = 0
  let l2Sum = 0
  for (let i = 0; i < n; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    rs += r
    gs += g
    bs += b
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    hist[Math.min(255, Math.round(l * 255))] += 1
    lSum += l
    l2Sum += l * l
  }
  const meanL = lSum / n
  const stdL = Math.sqrt(Math.max(0, l2Sum / n - meanL * meanL))

  const percentile = (p: number) => {
    const target = n * p
    let acc = 0
    for (let i = 0; i < 256; i++) {
      acc += hist[i]
      if (acc >= target) return i / 255
    }
    return 1
  }
  const black = percentile(0.005)
  const white = percentile(0.995)

  const rAvg = rs / n
  const gAvg = gs / n
  const bAvg = bs / n

  // 曝光:把平均亮度推向 0.5(限制在 ±1 EV)
  const ev = clamp(Math.log2((0.5 + 0.02) / (meanL + 0.02)), -1, 1)
  const exposure = clamp(ev * 100, -100, 100)

  // 黑白场:压严黑场 / 提纯白场(画面发灰时最有效)
  const blacks = clamp((0.08 - black) * 400, -60, 60)
  const whites = clamp((0.92 - white) * 400, -60, 60)

  // 对比:整体偏平(标准差小)时补一点
  const contrast = clamp((0.22 - stdL) * 300, -30, 50)

  // 灰世界白平衡
  const temperature = clamp((bAvg - rAvg) * 2.0, -70, 70)
  const tint = clamp((gAvg - (rAvg + bAvg) / 2) * 2.0, -60, 60)

  // 色彩:偏灰时补一点自然饱和度
  const vib = clamp((0.22 - stdL) * 120, 0, 20)

  return {
    ...emptyTone(),
    exposure: Math.round(exposure),
    contrast: Math.round(contrast),
    whites: Math.round(whites),
    blacks: Math.round(blacks),
    temperature: Math.round(temperature),
    tint: Math.round(tint),
    vibrance: Math.round(vib),
  }
}

/** 把任意来源的参数补全成完整 ToneParams(用于 AI 建议/预设) */
export function mergeTone(partial: Partial<ToneParams> | null | undefined, base?: ToneParams): ToneParams {
  const out = { ...(base ?? emptyTone()) }
  if (partial) {
    for (const k of Object.keys(TONE_LIMITS) as (keyof ToneParams)[]) {
      const v = partial[k]
      if (typeof v === 'number' && Number.isFinite(v)) {
        const lim = TONE_LIMITS[k]
        out[k] = clamp(v, lim.min, lim.max)
      }
    }
  }
  return out
}

/** 风格预设(= 一组 tone 增量)。 */
export const STYLE_PRESETS: Record<string, { label: string; tone: Partial<ToneParams> }> = {
  none: { label: '原图', tone: {} },
  portrait: { label: '人像', tone: { exposure: 6, contrast: 8, shadows: 12, highlights: -8, temperature: 8, vibrance: 10, clarity: -6, sharpen: 8 } },
  landscape: { label: '风景', tone: { contrast: 12, whites: 6, blacks: -6, vibrance: 20, saturation: 6, clarity: 14, sharpen: 12 } },
  night: { label: '夜景', tone: { exposure: 8, contrast: 10, shadows: 20, blacks: -10, temperature: -6, vibrance: 8, denoise: 10 } },
  mono: { label: '黑白', tone: { saturation: -100, contrast: 14, clarity: 12, blacks: -6 } },
  film: { label: '胶片', tone: { exposure: 4, contrast: -6, highlights: -10, shadows: 14, temperature: 6, tint: -4, vibrance: 6, blacks: 8 } },
  vivid: { label: '浓郁', tone: { contrast: 14, vibrance: 24, saturation: 10, clarity: 10, sharpen: 10 } },
}
