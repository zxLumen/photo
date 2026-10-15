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
 *
 * 做了三件「真正能看出效果、又不过火」的事:
 *  1. 把中位亮度推向 0.46(限制 ±1.2 EV);//曝光
 *  2. 压黑场 / 提白场 + 补对比,治「发灰」;//黑白场 + 对比
 *  3. 只在偏色明显时才做灰世界白平衡(避免毁掉落日这类本就偏暖的氛围)。
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
  let clipped = 0
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
    if (l > 0.985) clipped += 1
  }
  const meanL = lSum / n
  const stdL = Math.sqrt(Math.max(0, l2Sum / n - meanL * meanL))
  const clipFrac = clipped / n

  const percentile = (p: number) => {
    const target = n * p
    let acc = 0
    for (let i = 0; i < 256; i++) {
      acc += hist[i]
      if (acc >= target) return i / 255
    }
    return 1
  }
  const black = percentile(0.004)
  const median = percentile(0.5)
  const white = percentile(0.996)

  const rAvg = rs / n
  const gAvg = gs / n
  const bAvg = bs / n

  // 曝光:把中位亮度推向 0.46(shader 里曝光 100 = 1.5EV)
  const ev = clamp(Math.log2((0.46 + 0.015) / (median + 0.015)), -1.2, 1.2)
  const exposure = clamp((ev / 1.5) * 100, -100, 100)

  // 黑/白场:发灰(黑场不在底、白场不到顶)时收紧
  const blacks = clamp((0.028 - black) * 240, -65, 0)
  const whites = clamp((0.965 - white) * 300, 0, 55)

  // 高光回收:大面积接近纯白时压一点
  const highlights = clamp(-clipFrac * 340, -48, 0)

  // 暗部提亮:整体偏暗时补暗部(不硬提曝光)
  const shadows = clamp((0.30 - median) * 130, 0, 46)

  // 对比:整体偏平时补;标准差已经很大则不动
  const contrast = clamp((0.20 - stdL) * 210, -12, 42)

  // 灰世界白平衡(收敛到 ±32,避免毁掉刻意的暖/冷调)
  const temperature = clamp((bAvg - rAvg) * 1.25, -32, 32)
  const tint = clamp((gAvg - (rAvg + bAvg) / 2) * 1.4, -28, 28)

  // 色彩与通透:发灰时补自然饱和度与清晰度
  const vibrance = clamp((0.26 - stdL) * 90, 0, 26)
  const clarity = clamp((0.20 - stdL) * 120, 0, 22)

  // 极暗夜景通常噪点明显 → 轻量降噪
  const denoise = clamp((0.26 - median) * 80, 0, 16)

  return {
    ...emptyTone(),
    exposure: Math.round(exposure),
    contrast: Math.round(contrast),
    highlights: Math.round(highlights),
    shadows: Math.round(shadows),
    whites: Math.round(whites),
    blacks: Math.round(blacks),
    temperature: Math.round(temperature),
    tint: Math.round(tint),
    vibrance: Math.round(vibrance),
    clarity: Math.round(clarity),
    denoise: Math.round(denoise),
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

/** 风格预设(= 一组 tone 增量)。数值按新管线(线性光 + 乘性分区 + S 曲线)标定。 */
export const STYLE_PRESETS: Record<string, { label: string; tone: Partial<ToneParams> }> = {
  none: { label: '原图', tone: {} },
  portrait: {
    label: '人像',
    tone: { exposure: 5, contrast: 6, highlights: -12, shadows: 16, whites: 4, blacks: -8, temperature: 10, tint: 3, vibrance: 12, clarity: -8, sharpen: 10 },
  },
  landscape: {
    label: '风景',
    tone: { contrast: 14, highlights: -14, shadows: 12, whites: 8, blacks: -14, vibrance: 22, saturation: 4, clarity: 16, sharpen: 14 },
  },
  night: {
    label: '夜景',
    tone: { exposure: 14, contrast: 8, highlights: -6, shadows: 28, blacks: -14, temperature: -8, vibrance: 10, clarity: 8, denoise: 18 },
  },
  mono: { label: '黑白', tone: { saturation: -100, contrast: 18, whites: 8, blacks: -14, clarity: 14, sharpen: 8 } },
  film: {
    label: '胶片',
    tone: { exposure: 4, contrast: -6, highlights: -14, shadows: 18, blacks: 6, temperature: 6, tint: -4, vibrance: 8 },
  },
  vivid: {
    label: '浓郁',
    tone: { contrast: 16, highlights: -8, blacks: -8, vibrance: 26, saturation: 8, clarity: 12, sharpen: 10 },
  },
}
