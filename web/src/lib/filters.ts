/**
 * 滤镜引擎(纯前端,零图片素材)。
 *
 * 每个滤镜 = 一段**声明式配方**(曲线 / 通道混合 / 分色 / 分色相 HSL / 褪色)
 * + 一组**空间效果**(柔光 / 光晕 / 漏光 / 色散 / HDR 局部对比 / 颗粒 / 暗角)。
 * 颜色部分按需烘焙成 3D LUT(默认 33³),渲染时只多一次纹理采样;
 * 空间效果由 shader 直接做,关闭时零开销。
 *
 * 配色方向:参考剪映 / 抖音那套「网感」——干净透亮、肤色不脏、氛围靠光而不是靠灰,
 * 而不是柯达/富士的胶片型号模拟(那类只保留在「复古」组里)。
 */
import catalog from './filters.json' with { type: 'json' }

export type RGB = [number, number, number]
export type Xform = (c: RGB) => RGB

export interface FilterGroup {
  id: string
  label: string
}

export const FILTER_GROUPS: FilterGroup[] = catalog.groups

/** 空间效果(不在 LUT 里,由 shader 逐像素计算) */
export interface FilterFx {
  /** 胶片颗粒 0..1 */
  grain: number
  /** 额外暗角 0..1 */
  vignette: number
  /** 高光光晕 0..1 */
  bloom: number
  /** 光晕偏暖(0 = 白光,1 = 暖橙,接近 halation) */
  warmBloom: number
  /** 柔焦 0..1 */
  soft: number
  /** HDR 局部对比 0..1 */
  local: number
  /** 漏光 0..1 */
  leak: number
  /** 边缘色散 0..1 */
  ca: number
}

export interface FilterDef {
  id: string
  name: string
  group: string
  /** 一句话:什么时候用(也给视觉模型看) */
  hint: string
  ops: Xform[]
  fx: FilterFx
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const luma = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const smoothstep01 = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6))
  return t * t * (3 - 2 * t)
}
const mixc = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

/** 单调三次插值(Fritsch–Carlson):过控制点、不会过冲、不会出现反转过暗过亮的段落 */
function mkCurve(points: [number, number][]): (x: number) => number {
  const p = [...points].sort((a, b) => a[0] - b[0])
  const n = p.length
  if (n < 2) return (x) => x
  const xs = p.map((q) => q[0])
  const ys = p.map((q) => q[1])
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]))
  const m: number[] = new Array(n)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0]
    if (x >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (i < n - 2 && x > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i]
    const t = (x - xs[i]) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    )
  }
}

/** 单条曲线,三通道共用 */
const curve = (points: [number, number][]): Xform => {
  const f = mkCurve(points)
  return (c) => [clamp01(f(c[0])), clamp01(f(c[1])), clamp01(f(c[2]))]
}

/** 对比:k>0 拉 S 曲线(更硬),k<0 压平(更柔);始终单调 */
const contrast = (k: number): Xform => {
  if (k === 0) return (c) => c
  const f = (v: number) => {
    const s = v * v * (3 - 2 * v)
    return clamp01(v + (s - v) * k)
  }
  return (c) => [f(c[0]), f(c[1]), f(c[2])]
}

/** 饱和度(围绕亮度缩放,不动色相) */
const sat = (k: number): Xform => (c) => {
  const l = luma(c)
  return [clamp01(l + (c[0] - l) * k), clamp01(l + (c[1] - l) * k), clamp01(l + (c[2] - l) * k)]
}

/** 自然饱和度:只补低饱和的颜色,已经很艳的不再加 */
const vib = (k: number): Xform => (c) => {
  const mx = Math.max(c[0], c[1], c[2])
  const mn = Math.min(c[0], c[1], c[2])
  const kk = 1 + k * (1 - Math.min(1, (mx - mn) * 1.6))
  const l = luma(c)
  return [clamp01(l + (c[0] - l) * kk), clamp01(l + (c[1] - l) * kk), clamp01(l + (c[2] - l) * kk)]
}

/** 色温:t>0 偏暖,t<0 偏冷 */
const temp = (t: number): Xform => (c) => [
  clamp01(c[0] * (1 + t * 0.22)),
  clamp01(c[1] * (1 + t * 0.03)),
  clamp01(c[2] * (1 - t * 0.22)),
]

/** 褪色:把黑场抬起来(level),k 越大越褪 */
const fade = (k: number, level = 0.06): Xform => (c) => [
  clamp01(c[0] * (1 - k) + level * k),
  clamp01(c[1] * (1 - k) + level * k),
  clamp01(c[2] * (1 - k) + level * k),
]

/** 通道混合(3×3) */
const channelMix = (m: number[][]): Xform => (c) => [
  clamp01(m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2]),
  clamp01(m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2]),
  clamp01(m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2]),
]

/** 转黑白(权重可调) */
const mono = (weights: RGB): Xform => {
  const s = weights[0] + weights[1] + weights[2] || 1
  const w: RGB = [weights[0] / s, weights[1] / s, weights[2] / s]
  return (c) => {
    const l = clamp01(w[0] * c[0] + w[1] * c[1] + w[2] * c[2])
    return [l, l, l]
  }
}

/** 双色调:按亮度在阴影色与高光色之间取色 */
const duotone = (shadow: RGB, highlight: RGB, k = 1): Xform => (c) => {
  const t = clamp01(luma(c))
  const col = mixc(shadow, highlight, t)
  return mixc(c, col, k)
}

/** 分色:阴影染 s、高光染 h,k 为强度(按亮度平滑过渡) */
const split = (s: RGB, h: RGB, k: number): Xform => (c) => {
  const l = luma(c)
  const w = smoothstep01(0.06, 0.94, l)
  const sw = (1 - w) * k
  const hw = w * k
  return [
    clamp01(c[0] + (s[0] - l) * sw + (h[0] - l) * hw),
    clamp01(c[1] + (s[1] - l) * sw + (h[1] - l) * hw),
    clamp01(c[2] + (s[2] - l) * sw + (h[2] - l) * hw),
  ]
}

/* ---- HSL 分色相 ---- */

type Band = { hue?: number; sat?: number }
type Bands = Partial<Record<'r' | 'o' | 'y' | 'g' | 'c' | 'b' | 'm', Band>>
const BAND_CENTER: Record<string, number> = { r: 0, o: 0.083, y: 0.155, g: 0.33, c: 0.5, b: 0.66, m: 0.83 }
const BAND_WIDTH = 0.1

function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d > 1e-9) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (mx === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return [h, mx <= 1e-9 ? 0 : d / mx, mx]
}

function hsv2rgb(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0:
      return [v, t, p]
    case 1:
      return [q, v, p]
    case 2:
      return [p, v, t]
    case 3:
      return [p, q, v]
    case 4:
      return [t, p, v]
    default:
      return [v, p, q]
  }
}

/** 按色相区间调色:hue 为旋转角度(度),sat 为饱和度增减 */
const hsl = (bands: Bands): Xform => {
  const list = (Object.keys(bands) as (keyof Bands)[]).map((k) => ({ center: BAND_CENTER[k], ...(bands[k] as Band) }))
  return (c) => {
    const [h, s, v] = rgb2hsv(c[0], c[1], c[2])
    if (s < 1e-4) return c
    let dh = 0
    let ds = 1
    for (const b of list) {
      const d = Math.abs(((h - b.center + 1.5) % 1) - 0.5)
      const w = 1 - smoothstep01(0.02, BAND_WIDTH, d)
      if (w <= 0) continue
      if (b.hue) dh += (b.hue / 360) * w
      if (b.sat) ds *= 1 + b.sat * w
    }
    if (dh === 0 && ds === 1) return c
    const out = hsv2rgb((h + dh + 1) % 1, clamp01(s * ds), v)
    return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])]
  }
}

/* ------------------------------------------------------------------ */
/* 配方                                                                */
/* ------------------------------------------------------------------ */

interface Recipe {
  ops: Xform[]
  grain?: number
  vignette?: number
  bloom?: number
  warmBloom?: number
  soft?: number
  local?: number
  leak?: number
  ca?: number
}

const RECIPES: Record<string, Recipe> = {
  none: { ops: [] },

  /* ---------------- 精选 ---------------- */
  clear: {
    ops: [curve([[0, 0], [0.22, 0.235], [0.78, 0.8], [1, 1]]), contrast(0.14), vib(0.2), hsl({ b: { sat: 0.06 } })],
    local: 0.25,
  },
  nature: { ops: [contrast(0.04), sat(1.03), vib(0.08)] },
  fresh: {
    ops: [
      curve([[0, 0.04], [0.5, 0.55], [1, 0.99]]),
      contrast(-0.06),
      sat(1.02),
      hsl({ g: { hue: 5, sat: 0.05 }, c: { sat: 0.06 } }),
      split([0.44, 0.49, 0.48], [0.54, 0.54, 0.51], 0.16),
    ],
    bloom: 0.08,
  },
  clean: { ops: [curve([[0, 0], [0.22, 0.235], [0.78, 0.79], [1, 1]]), contrast(0.12), vib(0.22), hsl({ b: { sat: 0.06 } })] },
  vivid: { ops: [contrast(0.3), sat(1.12), vib(0.18)], local: 0.15 },
  soft: { ops: [curve([[0, 0.02], [0.5, 0.515], [1, 0.99]]), contrast(-0.2), sat(0.95)], soft: 0.15 },
  japanese: {
    ops: [
      curve([[0, 0.05], [0.5, 0.56], [1, 0.99]]),
      contrast(-0.12),
      sat(0.92),
      hsl({ g: { hue: 6, sat: 0.05 }, c: { sat: 0.06 } }),
      split([0.43, 0.48, 0.47], [0.54, 0.53, 0.51], 0.2),
      fade(0.1, 0.05),
    ],
    bloom: 0.06,
  },

  /* ---------------- 人像 ---------------- */
  coldwhite: {
    ops: [
      curve([[0, 0.05], [0.45, 0.52], [1, 1]]),
      contrast(-0.02),
      temp(-0.09),
      hsl({ y: { sat: -0.12 }, r: { sat: -0.05 }, b: { sat: 0.05 } }),
      split([0.47, 0.49, 0.51], [0.53, 0.53, 0.54], 0.2),
    ],
    bloom: 0.1,
  },
  warmwhite: {
    ops: [
      curve([[0, 0.05], [0.45, 0.52], [1, 1]]),
      contrast(-0.03),
      temp(0.08),
      hsl({ y: { sat: -0.06 } }),
      split([0.48, 0.46, 0.44], [0.55, 0.52, 0.48], 0.22),
    ],
    bloom: 0.1,
  },
  cream: {
    ops: [
      curve([[0, 0.06], [0.5, 0.56], [1, 0.99]]),
      contrast(-0.14),
      temp(0.1),
      split([0.46, 0.43, 0.42], [0.56, 0.52, 0.45], 0.3),
      fade(0.14, 0.06),
    ],
    bloom: 0.12,
  },
  creamskin: {
    ops: [
      curve([[0, 0.04], [0.5, 0.55], [1, 0.99]]),
      contrast(-0.1),
      temp(0.08),
      hsl({ r: { sat: -0.06 }, o: { sat: -0.04 } }),
      split([0.47, 0.44, 0.43], [0.56, 0.52, 0.46], 0.3),
      fade(0.08, 0.04),
    ],
    bloom: 0.12,
  },
  peach: {
    ops: [
      curve([[0, 0.05], [0.5, 0.55], [1, 1]]),
      contrast(-0.04),
      temp(0.06),
      hsl({ o: { sat: 0.1, hue: -4 }, r: { sat: 0.02 }, y: { sat: -0.04 } }),
      split([0.47, 0.44, 0.45], [0.58, 0.5, 0.47], 0.3),
    ],
    bloom: 0.18,
  },
  sakura: {
    ops: [
      curve([[0, 0.05], [0.5, 0.55], [1, 0.99]]),
      contrast(-0.1),
      temp(0.05),
      split([0.46, 0.43, 0.46], [0.57, 0.49, 0.51], 0.35),
      fade(0.1, 0.05),
    ],
    bloom: 0.12,
  },
  oxygen: {
    ops: [curve([[0, 0.09], [0.5, 0.6], [1, 1]]), contrast(-0.16), sat(0.95), temp(-0.03), fade(0.1, 0.05)],
    bloom: 0.12,
  },
  water: {
    ops: [
      curve([[0, 0.04], [0.5, 0.53], [1, 1]]),
      contrast(0.05),
      sat(1.02),
      split([0.45, 0.48, 0.51], [0.56, 0.55, 0.53], 0.2),
    ],
    bloom: 0.3,
    warmBloom: 0.35,
    local: 0.15,
  },

  /* ---------------- 风景 ---------------- */
  sky: {
    ops: [contrast(0.22), sat(1.18), hsl({ b: { sat: 0.2, hue: -4 }, c: { sat: 0.1 } }), split([0.4, 0.46, 0.5], [0.53, 0.53, 0.5], 0.2)],
    local: 0.3,
  },
  coast: {
    ops: [contrast(0.08), sat(1.1), hsl({ c: { sat: 0.12 }, b: { sat: 0.1 } }), split([0.39, 0.47, 0.5], [0.54, 0.54, 0.51], 0.28)],
    local: 0.15,
  },
  mountain: {
    ops: [contrast(0.18), sat(1.08), hsl({ g: { sat: 0.08, hue: 4 }, b: { sat: 0.12 }, c: { sat: 0.08 } }), split([0.38, 0.44, 0.47], [0.53, 0.53, 0.5], 0.3)],
    local: 0.2,
  },
  forest: {
    ops: [contrast(0.12), sat(1.05), hsl({ g: { sat: 0.12, hue: -4 }, c: { sat: 0.06 } }), split([0.36, 0.43, 0.4], [0.52, 0.52, 0.48], 0.3)],
    local: 0.15,
    vignette: 0.12,
  },
  snow: {
    ops: [curve([[0, 0.04], [0.5, 0.55], [1, 1]]), contrast(-0.04), sat(0.85), temp(-0.1), split([0.45, 0.49, 0.53], [0.53, 0.54, 0.56], 0.25)],
    local: 0.1,
  },
  sunset: {
    ops: [
      contrast(0.15),
      sat(1.14),
      temp(0.12),
      hsl({ o: { sat: 0.18 }, y: { sat: 0.12 }, b: { sat: -0.06 } }),
      split([0.42, 0.38, 0.42], [0.6, 0.48, 0.36], 0.35),
    ],
    bloom: 0.2,
    warmBloom: 0.7,
  },
  autumn: {
    ops: [
      contrast(0.12),
      sat(1.12),
      hsl({ o: { sat: 0.16 }, y: { sat: 0.14, hue: -4 }, r: { sat: 0.06 }, g: { sat: -0.08 } }),
      split([0.44, 0.42, 0.34], [0.56, 0.5, 0.39], 0.25),
    ],
    local: 0.1,
  },

  /* ---------------- 美食 ---------------- */
  savory: {
    ops: [
      contrast(0.16),
      sat(1.14),
      temp(0.12),
      hsl({ o: { sat: 0.18, hue: -3 }, r: { sat: 0.12 }, y: { sat: 0.08 }, g: { sat: -0.1 } }),
      split([0.43, 0.4, 0.34], [0.56, 0.5, 0.39], 0.2),
    ],
    local: 0.2,
  },
  warmfood: {
    ops: [
      contrast(0.14),
      sat(1.1),
      temp(0.12),
      hsl({ o: { sat: 0.16, hue: -3 }, r: { sat: 0.1 }, y: { sat: 0.08 }, g: { sat: -0.1 } }),
      split([0.43, 0.4, 0.34], [0.56, 0.5, 0.39], 0.22),
    ],
    local: 0.15,
  },
  souffle: {
    ops: [
      curve([[0, 0.05], [0.5, 0.56], [1, 1]]),
      contrast(-0.1),
      temp(0.1),
      sat(1.04),
      split([0.48, 0.45, 0.43], [0.57, 0.53, 0.47], 0.28),
    ],
    bloom: 0.16,
  },
  smoke: {
    ops: [
      curve([[0, 0], [0.3, 0.22], [1, 0.98]]),
      contrast(0.2),
      temp(0.1),
      sat(1.08),
      split([0.4, 0.38, 0.33], [0.55, 0.49, 0.39], 0.3),
    ],
    vignette: 0.18,
    grain: 0.12,
  },
  crispfood: {
    ops: [
      contrast(0.1),
      sat(1.18),
      vib(0.2),
      hsl({ g: { sat: 0.14 }, r: { sat: 0.08 }, c: { sat: 0.08 } }),
      split([0.44, 0.48, 0.47], [0.53, 0.53, 0.51], 0.18),
    ],
    local: 0.1,
  },

  /* ---------------- 氛围 ---------------- */
  moody: {
    ops: [curve([[0, 0], [0.3, 0.2], [1, 0.96]]), contrast(0.18), sat(0.85), split([0.35, 0.43, 0.48], [0.53, 0.5, 0.46], 0.4)],
    bloom: 0.08,
    vignette: 0.25,
  },
  neon: {
    ops: [
      curve([[0, 0], [0.28, 0.2], [1, 1]]),
      contrast(0.24),
      sat(1.22),
      hsl({ m: { sat: 0.2, hue: 4 }, c: { sat: 0.24 }, b: { sat: 0.14 } }),
      split([0.34, 0.4, 0.56], [0.56, 0.42, 0.54], 0.55),
    ],
    bloom: 0.35,
    warmBloom: 0.15,
    vignette: 0.15,
  },
  dusk: {
    ops: [contrast(0.1), sat(1.05), temp(0.05), split([0.44, 0.4, 0.53], [0.56, 0.49, 0.42], 0.4)],
    bloom: 0.1,
  },
  blue: { ops: [temp(-0.2), sat(0.85), contrast(0.22), split([0.38, 0.43, 0.5], [0.51, 0.53, 0.56], 0.35)] },
  haze: {
    ops: [
      curve([[0, 0.08], [0.5, 0.55], [1, 0.98]]),
      contrast(-0.1),
      sat(0.72),
      temp(-0.1),
      split([0.45, 0.48, 0.52], [0.53, 0.53, 0.55], 0.25),
    ],
    soft: 0.1,
  },
  cyber: {
    ops: [
      curve([[0, 0], [0.28, 0.18], [1, 1]]),
      contrast(0.26),
      sat(1.2),
      hsl({ m: { sat: 0.18, hue: 4 }, c: { sat: 0.22 }, b: { sat: 0.12 } }),
      split([0.36, 0.4, 0.55], [0.56, 0.42, 0.53], 0.5),
    ],
    bloom: 0.3,
    ca: 0.2,
  },
  tealorange: {
    ops: [contrast(0.2), sat(1.05), hsl({ o: { sat: 0.14 }, b: { sat: 0.12, hue: -6 } }), split([0.35, 0.47, 0.52], [0.57, 0.47, 0.35], 0.55)],
    local: 0.15,
  },
  blackgold: {
    ops: [sat(0.5), curve([[0, 0], [0.35, 0.24], [1, 1]]), contrast(0.28), split([0.4, 0.4, 0.39], [0.6, 0.51, 0.3], 0.42)],
    grain: 0.1,
  },

  /* ---------------- 潮流 ---------------- */
  dopamine: {
    ops: [contrast(0.2), sat(1.45), hsl({ r: { sat: 0.15 }, c: { sat: 0.2 }, m: { sat: 0.15 }, y: { sat: 0.15 } })],
    bloom: 0.18,
  },
  maillard: {
    ops: [
      contrast(0.18),
      sat(1.08),
      temp(0.16),
      hsl({ o: { sat: 0.16, hue: -6 }, y: { sat: 0.1 }, b: { sat: -0.1 } }),
      split([0.42, 0.36, 0.28], [0.58, 0.49, 0.34], 0.35),
    ],
    grain: 0.12,
  },
  morandi: { ops: [contrast(-0.08), sat(0.62), split([0.46, 0.45, 0.45], [0.54, 0.52, 0.49], 0.2)], soft: 0.12 },
  y2k: {
    ops: [
      curve([[0, 0.03], [0.5, 0.54], [1, 1]]),
      contrast(0.2),
      sat(1.25),
      temp(-0.05),
      hsl({ m: { sat: 0.2 }, c: { sat: 0.2 }, b: { sat: 0.1 } }),
      split([0.38, 0.42, 0.55], [0.58, 0.46, 0.55], 0.45),
    ],
    bloom: 0.3,
    leak: 0.35,
    ca: 0.45,
  },

  /* ---------------- 复古 ---------------- */
  film: {
    ops: [
      curve([[0, 0.03], [0.25, 0.255], [0.5, 0.52], [0.78, 0.79], [1, 0.97]]),
      contrast(-0.06),
      temp(0.1),
      hsl({ r: { sat: 0.05 }, y: { sat: -0.14 }, g: { sat: -0.1, hue: 5 }, b: { sat: 0.05 } }),
      split([0.44, 0.41, 0.4], [0.54, 0.5, 0.44], 0.3),
      fade(0.14, 0.04),
    ],
    grain: 0.15,
  },
  hongkong: {
    ops: [
      temp(0.04),
      contrast(0.16),
      sat(1.02),
      hsl({ g: { sat: 0.08, hue: 4 }, y: { sat: -0.06 } }),
      split([0.38, 0.45, 0.43], [0.56, 0.5, 0.41], 0.4),
      fade(0.1, 0.04),
    ],
    grain: 0.15,
  },
  ccd: {
    ops: [
      curve([[0, 0], [0.3, 0.27], [1, 0.98]]),
      contrast(0.24),
      temp(-0.1),
      sat(1.06),
      hsl({ b: { sat: 0.08 } }),
      split([0.4, 0.45, 0.5], [0.54, 0.5, 0.46], 0.3),
    ],
    bloom: 0.22,
    warmBloom: 0.5,
    ca: 0.25,
    grain: 0.22,
  },
  faded: { ops: [fade(0.38, 0.12), contrast(-0.2), sat(0.9), split([0.47, 0.44, 0.46], [0.52, 0.51, 0.5], 0.2)], grain: 0.08 },
  oldphoto: {
    ops: [
      channelMix([
        [0.5, 0.4, 0.1],
        [0.42, 0.42, 0.16],
        [0.3, 0.32, 0.18],
      ]),
      contrast(-0.06),
      split([0.45, 0.4, 0.33], [0.55, 0.5, 0.4], 0.2),
      fade(0.28, 0.1),
    ],
    grain: 0.25,
    vignette: 0.28,
  },
  polaroid: {
    ops: [
      curve([[0, 0.06], [0.3, 0.34], [0.7, 0.74], [1, 0.97]]),
      contrast(-0.18),
      sat(0.9),
      temp(0.12),
      split([0.45, 0.48, 0.45], [0.56, 0.53, 0.44], 0.3),
      fade(0.3, 0.1),
    ],
    grain: 0.12,
  },

  /* ---------------- 黑白 ---------------- */
  bw: { ops: [mono([0.299, 0.587, 0.114]), contrast(0.08)] },
  bwcontrast: {
    ops: [mono([0.28, 0.6, 0.12]), curve([[0, 0], [0.22, 0.12], [0.78, 0.9], [1, 1]]), contrast(0.4)],
    grain: 0.18,
  },
  bwsoft: { ops: [mono([0.32, 0.55, 0.13]), contrast(-0.16), fade(0.12, 0.06)] },
  silver: {
    ops: [mono([0.3, 0.59, 0.11]), contrast(0.16), duotone([0.1, 0.11, 0.13], [0.9, 0.91, 0.93], 0.6)],
    grain: 0.18,
  },
}

const ZERO_FX: FilterFx = { grain: 0, vignette: 0, bloom: 0, warmBloom: 0, soft: 0, local: 0, leak: 0, ca: 0 }

export const FILTER_LIST: FilterDef[] = catalog.items.map((it) => {
  const r = RECIPES[it.id] ?? { ops: [] }
  return {
    ...it,
    ops: r.ops,
    fx: {
      ...ZERO_FX,
      grain: r.grain ?? 0,
      vignette: r.vignette ?? 0,
      bloom: r.bloom ?? 0,
      warmBloom: r.warmBloom ?? 0,
      soft: r.soft ?? 0,
      local: r.local ?? 0,
      leak: r.leak ?? 0,
      ca: r.ca ?? 0,
    },
  }
})

export const FILTERS: Record<string, FilterDef> = Object.fromEntries(FILTER_LIST.map((f) => [f.id, f]))
export const FILTER_IDS: string[] = FILTER_LIST.map((f) => f.id)

export function getFilter(id: string): FilterDef {
  return FILTERS[id] ?? FILTERS.none
}

export function filterName(id: string): string {
  return getFilter(id).name
}

/* ------------------------------------------------------------------ */
/* LUT 烘焙与采样                                                       */
/* ------------------------------------------------------------------ */

/** 正式渲染用的 LUT 网格点数(33³ ≈ 3.6 万采样) */
export const LUT_N = 33
/** 缩略图预览用(17³,够小图看,烘焙快 7 倍) */
export const PREVIEW_LUT_N = 17

export interface Lut {
  data: Uint8Array
  n: number
  cols: number
  width: number
  height: number
}

/**
 * 把配方烘焙成 3D LUT:按 b 切片、每片 n×n,横向排 8 片(2D 图集)。
 * 采样端做「片内双线性 + 片间线性」,就是完整三线性插值。
 */
export function bakeLut(def: FilterDef, n = LUT_N): Lut {
  const cols = Math.min(8, n)
  const rows = Math.ceil(n / cols)
  const width = cols * n
  const height = rows * n
  const data = new Uint8Array(width * height * 4)
  const inv = 1 / (n - 1)
  const ops = def.ops
  for (let bi = 0; bi < n; bi++) {
    const tx = (bi % cols) * n
    const ty = Math.floor(bi / cols) * n
    for (let gi = 0; gi < n; gi++) {
      for (let ri = 0; ri < n; ri++) {
        let c: RGB = [ri * inv, gi * inv, bi * inv]
        for (let k = 0; k < ops.length; k++) c = ops[k](c)
        const o = ((ty + gi) * width + tx + ri) * 4
        data[o] = (clamp01(c[0]) * 255 + 0.5) | 0
        data[o + 1] = (clamp01(c[1]) * 255 + 0.5) | 0
        data[o + 2] = (clamp01(c[2]) * 255 + 0.5) | 0
        data[o + 3] = 255
      }
    }
  }
  return { data, n, cols, width, height }
}

const lutCache = new Map<string, Lut>()

/** 取(并缓存)LUT;n 不同则是不同精度的烘焙结果 */
export function getLut(id: string, n = LUT_N): Lut {
  const key = `${id}@${n}`
  let lut = lutCache.get(key)
  if (!lut) {
    lut = bakeLut(getFilter(id), n)
    lutCache.set(key, lut)
  }
  return lut
}

function sliceSample(lut: Lut, r: number, g: number, slice: number): RGB {
  const n = lut.n
  const tx = (slice % lut.cols) * n
  const ty = Math.floor(slice / lut.cols) * n
  const x = tx + clamp01(r) * (n - 1)
  const y = ty + clamp01(g) * (n - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, tx + n - 1)
  const y1 = Math.min(y0 + 1, ty + n - 1)
  const fx = x - x0
  const fy = y - y0
  const px = (xx: number, yy: number) => {
    const o = (yy * lut.width + xx) * 4
    return [lut.data[o] / 255, lut.data[o + 1] / 255, lut.data[o + 2] / 255] as RGB
  }
  const a = px(x0, y0)
  const b = px(x1, y0)
  const c = px(x0, y1)
  const d = px(x1, y1)
  const top: RGB = [a[0] + (b[0] - a[0]) * fx, a[1] + (b[1] - a[1]) * fx, a[2] + (b[2] - a[2]) * fx]
  const bot: RGB = [c[0] + (d[0] - c[0]) * fx, c[1] + (d[1] - c[1]) * fx, c[2] + (d[2] - c[2]) * fx]
  return [top[0] + (bot[0] - top[0]) * fy, top[1] + (bot[1] - top[1]) * fy, top[2] + (bot[2] - top[2]) * fy]
}

/** 与 GPU 端一致的采样(给测试和 JS 端预览使用) */
export function sampleLut(lut: Lut, c: RGB): RGB {
  const n = lut.n
  const bv = clamp01(c[2]) * (n - 1)
  const b0 = Math.floor(bv)
  const b1 = Math.min(b0 + 1, n - 1)
  const f = bv - b0
  const s0 = sliceSample(lut, c[0], c[1], b0)
  const s1 = sliceSample(lut, c[0], c[1], b1)
  return [s0[0] + (s1[0] - s0[0]) * f, s0[1] + (s1[1] - s0[1]) * f, s0[2] + (s1[2] - s0[2]) * f]
}
