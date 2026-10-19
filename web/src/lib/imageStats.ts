/**
 * 逐图「体检」:把一张图量成可解释的数值,作为自动调色的**唯一依据**。
 *
 * 设计原则:每个数值都必须能对应到一个具体的修图动作,而不是「差不多给个 18」。
 *   - 分位数 p1/p5/p50/p95/p99 → 曝光、黑白场、对比
 *   - 两端溢出比例 → 高光回收 / 暗部提亮
 *   - 分区(暗/中/亮)中性像素均值 → 白平衡,且能区分「整体色偏」与「刻意氛围」
 *   - 彩度分布 → 自然饱和度
 *   - 高通残差 → 清晰度(灰雾)、锐化(已有细节)、噪点
 */

export interface ZoneCast {
  r: number
  g: number
  b: number
}

export interface ImageStats {
  /** 亮度分位(0..1,sRGB 感知域) */
  p1: number
  p5: number
  p25: number
  p50: number
  p75: number
  p95: number
  p99: number
  mean: number
  std: number
  /** 接近纯黑 / 纯白的像素比例 */
  clipLow: number
  clipHigh: number
  /** 平均彩度与高彩度分位(max-min) */
  chroma: number
  chromaP90: number
  /** 局部对比(高通残差均值):越低越「平 / 有雾」 */
  localContrast: number
  /** 灰雾度(0..1):局部平 **且** 全局动态范围窄才算 */
  haze: number
  /** 噪点强度(0..1) */
  noise: number
  /** 暗区(<0.30)/ 亮区(>0.70)的亮度中位 */
  shadowMed: number
  highMed: number
  /** 三区的中性像素均色(白平衡参考) */
  shadow: ZoneCast
  mid: ZoneCast
  highlight: ZoneCast
  /** 低饱和(中性)像素占比:太低说明画面本来就很艳,白平衡不可信 */
  neutralRatio: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

const lumaOf = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

/** 从 256 桶直方图取分位 */
function pct(hist: Float64Array, total: number, p: number): number {
  if (total <= 0) return 0
  const target = total * p
  let acc = 0
  for (let i = 0; i < 256; i++) {
    acc += hist[i]
    if (acc >= target) return i / 255
  }
  return 1
}

interface ZoneAcc {
  r: number
  g: number
  b: number
  n: number
  nr: number
  ng: number
  nb: number
  nn: number
}

const newZone = (): ZoneAcc => ({ r: 0, g: 0, b: 0, n: 0, nr: 0, ng: 0, nb: 0, nn: 0 })

const zoneOut = (z: ZoneAcc): ZoneCast => {
  const n = z.nn > 0 ? z.nn : z.n
  if (n <= 0) return { r: 0.5, g: 0.5, b: 0.5 }
  const r = (z.nn > 0 ? z.nr : z.r) / n / 255
  const g = (z.nn > 0 ? z.ng : z.g) / n / 255
  const b = (z.nn > 0 ? z.nb : z.b) / n / 255
  return { r, g, b }
}

/**
 * 计算整幅统计。`noise` 在这里只是**粗估**(样本常被降采样,噪点会被平均掉),
 * 调用方应用原生分辨率小块的 `estimateNoise()` 覆盖它。
 */
export function computeImageStats(data: Uint8ClampedArray | Uint8Array, width: number, height: number): ImageStats {
  const n = width * height
  if (n <= 0) {
    return {
      p1: 0,
      p5: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p95: 0,
      p99: 0,
      mean: 0,
      std: 0,
      clipLow: 0,
      clipHigh: 0,
      chroma: 0,
      chromaP90: 0,
      localContrast: 0,
      haze: 0,
      noise: 0,
      shadowMed: 0,
      highMed: 0,
      shadow: { r: 0.5, g: 0.5, b: 0.5 },
      mid: { r: 0.5, g: 0.5, b: 0.5 },
      highlight: { r: 0.5, g: 0.5, b: 0.5 },
      neutralRatio: 0,
    }
  }

  const hist = new Float64Array(256)
  const chromaHist = new Float64Array(256)
  const histSh = new Float64Array(256)
  const histHi = new Float64Array(256)
  const luma = new Float32Array(n)

  let sum = 0
  let sum2 = 0
  let clipLow = 0
  let clipHigh = 0
  let chromaSum = 0
  let neutral = 0
  let shCount = 0
  let hiCount = 0

  const zSh = newZone()
  const zMid = newZone()
  const zHi = newZone()

  for (let i = 0; i < n; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const l = lumaOf(r, g, b)
    luma[i] = l

    const idx = Math.min(255, Math.max(0, Math.round(l * 255)))
    hist[idx] += 1
    sum += l
    sum2 += l * l
    if (l < 0.005) clipLow += 1
    if (l > 0.995) clipHigh += 1

    const mx = r > g ? (r > b ? r : b) : g > b ? g : b
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b
    const chroma = (mx - mn) / 255
    chromaSum += chroma
    chromaHist[Math.min(255, Math.round(chroma * 255))] += 1
    const isNeutral = chroma < 0.12
    if (isNeutral) neutral += 1

    // 分区累计(暗/中/亮);色偏只用低饱和像素,避免把刻意色彩当偏色
    const zone = l < 0.3 ? zSh : l > 0.7 ? zHi : zMid
    if (l < 0.3) {
      histSh[idx] += 1
      shCount += 1
    } else if (l > 0.7) {
      histHi[idx] += 1
      hiCount += 1
    }
    zone.r += r
    zone.g += g
    zone.b += b
    zone.n += 1
    if (isNeutral) {
      zone.nr += r
      zone.ng += g
      zone.nb += b
      zone.nn += 1
    }
  }

  // 高通残差:局部对比 / 噪点 / 已有细节
  let hpSum = 0
  let hpCount = 0
  let darkHp = 0
  let darkCount = 0
  const w = width
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const avg = (luma[i - 1] + luma[i + 1] + luma[i - w] + luma[i + w]) * 0.25
      const hp = Math.abs(luma[i] - avg)
      hpSum += hp
      hpCount += 1
      if (luma[i] < 0.3) {
        darkHp += hp
        darkCount += 1
      }
    }
  }
  const localContrast = hpCount > 0 ? hpSum / hpCount : 0
  const darkNoise = darkCount > n * 0.01 ? darkHp / darkCount : localContrast
  const noise = clamp01((darkNoise - 0.010) / 0.050)

  const mean = sum / n
  // 加权标准差(按直方图算也一样,这里直接用累计和)
  const std = Math.sqrt(Math.max(0, sum2 / n - mean * mean))

  const p5 = pct(hist, n, 0.05)
  const p95 = pct(hist, n, 0.95)

  // 灰雾:局部平(高通残差低)**且** 全局动态范围窄 —— 两个条件同时成立才是「雾」
  const lcLow = clamp01((0.022 - localContrast) / 0.022)
  const spanLow = 1 - clamp01((p95 - p5) / 0.7)

  return {
    p1: pct(hist, n, 0.01),
    p5,
    p25: pct(hist, n, 0.25),
    p50: pct(hist, n, 0.5),
    p75: pct(hist, n, 0.75),
    p95,
    p99: pct(hist, n, 0.99),
    mean,
    std,
    clipLow: clipLow / n,
    clipHigh: clipHigh / n,
    chroma: chromaSum / n,
    chromaP90: pct(chromaHist, n, 0.9),
    localContrast,
    haze: lcLow * spanLow,
    noise,
    shadowMed: pct(histSh, shCount, 0.5),
    highMed: pct(histHi, hiCount, 0.5),
    shadow: zoneOut(zSh),
    mid: zoneOut(zMid),
    highlight: zoneOut(zHi),
    neutralRatio: neutral / n,
  }
}

/**
 * 在**原生分辨率**小块上估噪点(降采样样本会把噪点平均掉,不可用)。
 * 取暗部平坦区的高通残差均值:干净图 ≈0.004~0.010,高感夜景 ≈0.02~0.06。
 */
export function estimateNoise(data: Uint8ClampedArray | Uint8Array, width: number, height: number): number {
  const n = width * height
  if (n <= 0 || width < 3 || height < 3) return 0
  const luma = new Float32Array(n)
  for (let i = 0; i < n; i++) luma[i] = lumaOf(data[i * 4], data[i * 4 + 1], data[i * 4 + 2])

  const BINS = 256
  const MAX = 0.2
  const flat = new Float64Array(BINS)
  const all = new Float64Array(BINS)
  let flatN = 0
  let allN = 0

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const a = luma[i - 1]
      const b = luma[i + 1]
      const c = luma[i - width]
      const d = luma[i + width]
      const l = luma[i]
      const hp = Math.abs(l - (a + b + c + d) * 0.25)
      const bin = Math.min(BINS - 1, Math.max(0, Math.round((hp / MAX) * (BINS - 1))))
      all[bin] += 1
      allN += 1
      // 只统计「局部平坦」的像素:树叶/毛发/砖墙这类纹理不会被误判成噪点
      const mx = Math.max(l, a, b, c, d)
      const mn = Math.min(l, a, b, c, d)
      if (mx - mn < 0.1) {
        flat[bin] += 1
        flatN += 1
      }
    }
  }

  // 平坦像素太少(画面全是纹理)时退回全图
  const useFlat = flatN > n * 0.02
  const hist = useFlat ? flat : all
  const total = useFlat ? flatN : allN
  if (total <= 0) return 0

  // 取中位数:hp 是绝对值,中位数比均值稳,也不容易被零星纹理/边缘拉高
  const target = total * 0.5
  let acc = 0
  let idx = 0
  for (let i = 0; i < BINS; i++) {
    acc += hist[i]
    if (acc >= target) {
      idx = i
      break
    }
  }
  const hp = (idx / (BINS - 1)) * MAX
  return clamp01((hp - 0.004) / 0.045)
}

/** 把统计结果翻译成一句人话(给面板显示,让「按图测算」看得见) */
export function describeStats(s: ImageStats, exposureEv = 0): string {
  const out: string[] = []

  if (s.p50 < 0.34) out.push(`偏暗 p50=${s.p50.toFixed(2)}`)
  else if (s.p50 > 0.74) out.push(`偏亮 p50=${s.p50.toFixed(2)}`)
  else out.push('亮度合适')

  const span = s.p95 - s.p5
  if (span < 0.48) out.push('发灰')
  else if (span > 0.88) out.push('反差足')

  if (s.clipHigh > 0.02) out.push(`高光溢出 ${(s.clipHigh * 100).toFixed(0)}%`)
  if (s.clipLow > 0.02) out.push(`暗部死黑 ${(s.clipLow * 100).toFixed(0)}%`)
  if (s.p5 > 0.08) out.push('黑场浮起')

  const warm = s.mid.r - s.mid.b
  if (warm > 0.055) out.push('整体偏暖')
  else if (warm < -0.055) out.push('整体偏冷')

  if (s.chroma < 0.08) out.push('色彩偏淡')
  else if (s.chroma > 0.2) out.push('色彩浓')

  if (s.haze > 0.15) out.push('有灰雾')
  if (s.noise > 0.35) out.push('噪点明显')

  if (Math.abs(exposureEv) >= 0.15) {
    out.push(`曝光 ${exposureEv > 0 ? '+' : ''}${exposureEv.toFixed(1)}EV`)
  }
  return out.join(' · ')
}
