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
  let nR = 0
  let nG = 0
  let nB = 0
  let nCount = 0
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
    // 只统计「接近中性」的低饱和像素做白平衡参考,避免把夕阳 / 夜景这类
    // 刻意的强色偏当成白平衡错误而强行「纠」掉
    const chroma = (Math.max(r, Math.max(g, b)) - Math.min(r, Math.min(g, b))) / 255
    if (chroma < 0.12) {
      nR += r
      nG += g
      nB += b
      nCount += 1
    }
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

  // 白平衡参考:优先用「中性像素」,中性像素太少(如整体很艳)才退回全图均值
  const useNeutral = nCount > n * 0.04
  const rRef = (useNeutral ? nR / nCount : rs / n) / 255
  const gRef = (useNeutral ? nG / nCount : gs / n) / 255
  const bRef = (useNeutral ? nB / nCount : bs / n) / 255

  // 曝光:只在明显偏暗 / 偏亮时才推中间调(「想要的亮度」不是像素能测出来的)
  let ev = 0
  if (median < 0.34) ev = Math.log2(0.44 / (median + 0.015))
  else if (median > 0.70) ev = Math.log2(0.60 / (median + 0.015))
  const exposure = clamp((ev / 1.5) * 100, -100, 100)

  // 黑/白场:发灰(黑场不在底、白场不到顶)时收紧
  const blacks = clamp((0.028 - black) * 240, -65, 0)
  const whites = clamp((0.965 - white) * 300, 0, 55)

  // 高光回收:大面积接近纯白时压一点
  const highlights = clamp(-clipFrac * 340, -48, 0)

  // 暗部提亮:整体偏暗时补暗部(不硬提曝光)
  const shadows = clamp((0.30 - median) * 130, 0, 46)

  // 对比:只「补」不「削」,免得把本来就有反差的画面压平
  const contrast = clamp((0.19 - stdL) * 220, 0, 40)

  // 白平衡:死区(轻微偏色不动)+ 限幅 —— 只在确实偏色时温和纠偏
  const dead = (v: number, d: number) => (v > 0 ? Math.max(0, v - d) : Math.min(0, v + d))
  const temperature = clamp(dead(bRef - rRef, 0.03) * 260, -22, 22)
  const tint = clamp(dead(gRef - (rRef + bRef) / 2, 0.02) * 300, -18, 18)

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

/**
 * 融合「直方图测量」与「AI 语义建议」—— 让「一键构图」与「自动修图」口径一致。
 *
 * 原则:
 *  - 曝光 / 色温 / 色调是**测量问题**(模型估不准)→ 以直方图为主(w=0.7);
 *  - 对比 / 高光 / 阴影 / 鲜艳度 / 清晰度等是**审美取向** → 以模型为主(w=0.4);
 *  - 两边都没有的值保持不变;越界一律夹紧。
 */
const MEASURE_WEIGHT: Partial<Record<keyof ToneParams, number>> = { exposure: 0.7, temperature: 0.7, tint: 0.7 }

export function blendTone(measured: ToneParams, ai: Partial<ToneParams> | null | undefined): ToneParams {
  const out = { ...measured }
  if (!ai) return out
  for (const k of Object.keys(TONE_LIMITS) as (keyof ToneParams)[]) {
    const a = ai[k]
    if (typeof a !== 'number' || !Number.isFinite(a)) continue
    const w = MEASURE_WEIGHT[k] ?? 0.4
    const v = measured[k] * w + a * (1 - w)
    out[k] = Math.round(clamp(v, TONE_LIMITS[k].min, TONE_LIMITS[k].max))
  }
  return out
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
