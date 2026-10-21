/**
 * 滤镜引擎(纯前端,零图片素材)。
 *
 * 每个滤镜 = 一段**声明式配方**(曲线 / 通道混合 / 分色 / 分色相 HSL / 褪色),
 * 启动时按需**烘焙成 3D LUT**(默认 33³),渲染时只是一次纹理采样。
 * 好处:
 *  - 想加多少个滤镜都行,每个只多几行数据,渲染开销不变;
 *  - 能做真正的胶片褪色、青橙分色、硒调黑白,而不是「挪几个滑块」;
 *  - 不需要下载/内置任何 LUT 图片,离线可用,包体积几乎不涨。
 *
 * 配方跑在 sRGB 0..1 空间(与调色管线的显示空间一致),因此预览、对比、导出完全一致。
 */
import catalog from './filters.json' with { type: 'json' }

export type RGB = [number, number, number]
export type Xform = (c: RGB) => RGB

export interface FilterGroup {
  id: string
  label: string
}

export const FILTER_GROUPS: FilterGroup[] = catalog.groups

export interface FilterDef {
  id: string
  name: string
  group: string
  /** 一句话:什么时候用(也给视觉模型看) */
  hint: string
  /** 空间效果:颗粒 0..1 */
  grain: number
  /** 空间效果:额外暗角 0..1 */
  vignette: number
  ops: Xform[]
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

/** 褪色:把黑场抬起来(level),整体压向灰,kh 越大越褪 */
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

/** 双色调:按亮度在阴影色与高光色之间取色(用于硒调/蓝调黑白) */
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

/** 整体色相旋转(YIQ 旋转矩阵) */
const hueRotate = (deg: number): Xform => {
  const a = (deg * Math.PI) / 180
  const c0 = Math.cos(a)
  const s0 = Math.sin(a)
  const m = [
    [0.213 + c0 * 0.787 - s0 * 0.213, 0.715 - c0 * 0.715 - s0 * 0.715, 0.072 - c0 * 0.072 + s0 * 0.928],
    [0.213 - c0 * 0.213 + s0 * 0.143, 0.715 + c0 * 0.285 + s0 * 0.14, 0.072 - c0 * 0.072 - s0 * 0.283],
    [0.213 - c0 * 0.213 - s0 * 0.787, 0.715 - c0 * 0.715 + s0 * 0.715, 0.072 + c0 * 0.928 + s0 * 0.072],
  ]
  return channelMix(m)
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
}

const RECIPES: Record<string, Recipe> = {
  none: { ops: [] },

  /* ---------------- 基础 ---------------- */
  clean: {
    ops: [curve([[0, 0], [0.22, 0.235], [0.78, 0.79], [1, 1]]), contrast(0.12), vib(0.22), hsl({ b: { sat: 0.06 } })],
  },
  soft: { ops: [curve([[0, 0.02], [0.5, 0.515], [1, 0.99]]), contrast(-0.2), sat(0.95)] },
  punch: { ops: [contrast(0.3), sat(1.12), vib(0.18)] },
  crisp: { ops: [curve([[0, 0], [0.18, 0.13], [0.82, 0.88], [1, 1]]), contrast(0.45), sat(1.05)] },

  /* ---------------- 胶片 ---------------- */
  portra400: {
    ops: [
      curve([[0, 0.03], [0.25, 0.255], [0.5, 0.52], [0.78, 0.79], [1, 0.97]]),
      contrast(-0.06),
      temp(0.1),
      hsl({ r: { sat: 0.06 }, y: { sat: -0.16 }, g: { sat: -0.1, hue: 5 }, b: { sat: 0.06 } }),
      split([0.44, 0.41, 0.4], [0.54, 0.5, 0.44], 0.35),
      fade(0.16, 0.04),
    ],
    grain: 0.16,
  },
  gold200: {
    ops: [
      curve([[0, 0.025], [0.3, 0.3], [0.7, 0.73], [1, 0.98]]),
      contrast(0.1),
      temp(0.18),
      hsl({ y: { sat: 0.12 }, g: { sat: -0.08 }, b: { sat: -0.12 } }),
      split([0.45, 0.41, 0.31], [0.55, 0.5, 0.38], 0.3),
      fade(0.1, 0.035),
    ],
    grain: 0.18,
  },
  ektar100: {
    ops: [contrast(0.22), sat(1.18), hsl({ r: { sat: 0.12 }, b: { sat: 0.08 }, g: { sat: 0.05 } }), split([0.4, 0.44, 0.48], [0.53, 0.51, 0.48], 0.18)],
    grain: 0.04,
  },
  pro400h: {
    ops: [
      curve([[0, 0.05], [0.3, 0.31], [0.7, 0.72], [1, 0.98]]),
      contrast(-0.14),
      sat(0.9),
      temp(-0.03),
      hsl({ g: { sat: -0.06, hue: -4 }, c: { sat: 0.05 } }),
      split([0.41, 0.47, 0.47], [0.53, 0.52, 0.5], 0.22),
    ],
    grain: 0.1,
  },
  c200: {
    ops: [
      contrast(0.08),
      temp(0.05),
      hsl({ y: { sat: 0.08 }, g: { sat: 0.06, hue: 3 }, b: { sat: -0.06 } }),
      split([0.42, 0.45, 0.4], [0.54, 0.5, 0.43], 0.22),
      fade(0.08, 0.03),
    ],
    grain: 0.2,
  },
  classicchrome: {
    ops: [contrast(0.18), sat(0.72), hsl({ b: { sat: 0.05 }, y: { sat: -0.1 } }), split([0.4, 0.43, 0.46], [0.51, 0.51, 0.5], 0.25), fade(0.1, 0.04)],
    grain: 0.05,
  },
  velvia: {
    ops: [curve([[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]]), contrast(0.3), sat(1.4), hsl({ r: { sat: 0.12 }, g: { sat: 0.1 }, b: { sat: 0.14 } })],
    grain: 0.03,
  },
  cinestill800t: {
    ops: [
      temp(-0.16),
      contrast(0.12),
      sat(1.02),
      hsl({ b: { sat: 0.1 }, c: { sat: 0.05 } }),
      split([0.37, 0.44, 0.5], [0.54, 0.47, 0.44], 0.4),
      fade(0.14, 0.05),
    ],
    grain: 0.3,
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
  oldfilm: {
    ops: [sat(0.7), temp(0.16), contrast(-0.02), split([0.43, 0.38, 0.31], [0.53, 0.48, 0.37], 0.35), fade(0.26, 0.09)],
    grain: 0.35,
    vignette: 0.2,
  },
  trix: {
    ops: [mono([0.28, 0.62, 0.1]), curve([[0, 0.01], [0.2, 0.15], [0.8, 0.88], [1, 1]]), contrast(0.28)],
    grain: 0.45,
  },
  hp5: { ops: [mono([0.3, 0.58, 0.12]), contrast(0.12), fade(0.08, 0.04)], grain: 0.4 },

  /* ---------------- 日系 ---------------- */
  japanese: {
    ops: [
      curve([[0, 0.05], [0.5, 0.56], [1, 0.99]]),
      contrast(-0.12),
      sat(0.92),
      hsl({ g: { hue: 6, sat: 0.05 }, c: { sat: 0.06 } }),
      split([0.43, 0.48, 0.47], [0.54, 0.53, 0.51], 0.2),
      fade(0.1, 0.05),
    ],
  },
  airy: {
    ops: [curve([[0, 0.1], [0.5, 0.62], [1, 1]]), contrast(-0.2), sat(0.9), temp(-0.04), fade(0.16, 0.07)],
  },
  cream: {
    ops: [
      curve([[0, 0.06], [0.5, 0.56], [1, 0.99]]),
      contrast(-0.14),
      temp(0.1),
      split([0.46, 0.43, 0.42], [0.56, 0.52, 0.45], 0.3),
      fade(0.14, 0.06),
    ],
  },
  sakura: {
    ops: [
      curve([[0, 0.05], [0.5, 0.55], [1, 0.99]]),
      contrast(-0.1),
      temp(0.05),
      split([0.46, 0.43, 0.46], [0.57, 0.49, 0.51], 0.35),
      fade(0.1, 0.05),
    ],
  },
  mint: {
    ops: [contrast(-0.06), hsl({ g: { hue: 10, sat: 0.1 }, c: { sat: 0.1 } }), temp(-0.06), split([0.41, 0.48, 0.46], [0.51, 0.54, 0.52], 0.25)],
  },
  whitewall: {
    ops: [curve([[0, 0.08], [0.5, 0.6], [1, 1]]), contrast(-0.12), sat(0.86), temp(-0.03), split([0.48, 0.48, 0.49], [0.53, 0.53, 0.54], 0.15)],
  },

  /* ---------------- 电影 ---------------- */
  tealorange: {
    ops: [contrast(0.2), sat(1.05), hsl({ o: { sat: 0.14 }, b: { sat: 0.12, hue: -6 } }), split([0.35, 0.47, 0.52], [0.57, 0.47, 0.35], 0.55)],
  },
  darkcinema: {
    ops: [curve([[0, 0], [0.3, 0.2], [1, 0.96]]), contrast(0.18), sat(0.85), split([0.35, 0.43, 0.48], [0.53, 0.5, 0.46], 0.4)],
    vignette: 0.25,
  },
  silver: { ops: [sat(0.35), contrast(0.3), hsl({ b: { sat: 0.05 } }), split([0.42, 0.44, 0.47], [0.53, 0.54, 0.55], 0.3)] },
  twilight: { ops: [contrast(0.1), sat(1.05), temp(0.05), split([0.44, 0.4, 0.53], [0.56, 0.49, 0.42], 0.4)] },
  cyber: {
    ops: [
      curve([[0, 0], [0.28, 0.18], [1, 1]]),
      contrast(0.26),
      sat(1.2),
      hsl({ m: { sat: 0.18, hue: 4 }, c: { sat: 0.22 }, b: { sat: 0.12 } }),
      split([0.36, 0.4, 0.55], [0.56, 0.42, 0.53], 0.5),
    ],
  },
  blackgold: {
    ops: [sat(0.5), curve([[0, 0], [0.35, 0.24], [1, 1]]), contrast(0.28), split([0.4, 0.4, 0.39], [0.6, 0.51, 0.3], 0.42)],
    grain: 0.1,
  },
  cold: { ops: [temp(-0.2), sat(0.85), contrast(0.22), split([0.38, 0.43, 0.5], [0.51, 0.53, 0.56], 0.35)] },
  hongkong: {
    ops: [
      temp(0.04),
      contrast(0.16),
      sat(1.02),
      hsl({ g: { sat: 0.08, hue: 4 }, y: { sat: -0.06 } }),
      split([0.38, 0.45, 0.43], [0.56, 0.5, 0.41], 0.4),
      fade(0.1, 0.04),
    ],
    grain: 0.2,
  },

  /* ---------------- 复古 ---------------- */
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
  faded: { ops: [fade(0.38, 0.12), contrast(-0.2), sat(0.9), split([0.47, 0.44, 0.46], [0.52, 0.51, 0.5], 0.2)], grain: 0.08 },
  sepia: {
    ops: [
      channelMix([
        [0.393, 0.769, 0.189],
        [0.349, 0.686, 0.168],
        [0.272, 0.534, 0.131],
      ]),
      contrast(0.1),
      temp(0.04),
    ],
  },
  nineties: {
    ops: [
      temp(0.12),
      contrast(-0.04),
      sat(0.98),
      hsl({ g: { sat: 0.05, hue: 3 } }),
      split([0.44, 0.43, 0.36], [0.56, 0.51, 0.4], 0.28),
      fade(0.16, 0.06),
    ],
    grain: 0.25,
  },
  cassette: {
    ops: [hueRotate(6), sat(0.95), contrast(-0.08), split([0.45, 0.4, 0.49], [0.54, 0.5, 0.5], 0.35), fade(0.28, 0.1)],
    grain: 0.18,
  },
  newsprint: { ops: [sat(0.18), contrast(0.26), split([0.4, 0.4, 0.38], [0.57, 0.56, 0.49], 0.3)], grain: 0.12 },

  /* ---------------- 黑白 ---------------- */
  bw: { ops: [mono([0.299, 0.587, 0.114]), contrast(0.08)] },
  bwcontrast: {
    ops: [mono([0.28, 0.6, 0.12]), curve([[0, 0], [0.22, 0.12], [0.78, 0.9], [1, 1]]), contrast(0.4)],
    grain: 0.18,
  },
  bwsoft: { ops: [mono([0.32, 0.55, 0.13]), contrast(-0.16), fade(0.12, 0.06)] },
  bwselenium: { ops: [mono([0.3, 0.59, 0.11]), contrast(0.14), duotone([0.16, 0.14, 0.2], [0.92, 0.9, 0.88], 0.55)] },
  bwblue: { ops: [mono([0.3, 0.59, 0.11]), contrast(0.12), duotone([0.06, 0.1, 0.2], [0.88, 0.92, 1], 0.7)] },

  /* ---------------- 题材 ---------------- */
  mountain: {
    ops: [contrast(0.18), sat(1.08), hsl({ g: { sat: 0.08, hue: 4 }, b: { sat: 0.12 }, c: { sat: 0.08 } }), split([0.38, 0.44, 0.47], [0.53, 0.53, 0.5], 0.3)],
  },
  coast: {
    ops: [contrast(0.08), sat(1.1), hsl({ c: { sat: 0.12 }, b: { sat: 0.1 } }), split([0.39, 0.47, 0.5], [0.54, 0.54, 0.51], 0.28)],
  },
  autumn: {
    ops: [
      contrast(0.12),
      sat(1.12),
      hsl({ o: { sat: 0.16 }, y: { sat: 0.14, hue: -4 }, r: { sat: 0.06 }, g: { sat: -0.08 } }),
      split([0.44, 0.42, 0.34], [0.56, 0.5, 0.39], 0.25),
    ],
  },
  snow: {
    ops: [curve([[0, 0.04], [0.5, 0.55], [1, 1]]), contrast(-0.04), sat(0.85), temp(-0.1), split([0.45, 0.49, 0.53], [0.53, 0.54, 0.56], 0.25)],
  },
  forest: {
    ops: [contrast(0.12), sat(1.05), hsl({ g: { sat: 0.12, hue: -4 }, c: { sat: 0.06 } }), split([0.36, 0.43, 0.4], [0.52, 0.52, 0.48], 0.3)],
    vignette: 0.12,
  },
  citynight: {
    ops: [
      contrast(0.16),
      sat(1.05),
      temp(-0.05),
      hsl({ b: { sat: 0.1 }, o: { sat: 0.1 } }),
      split([0.37, 0.43, 0.55], [0.56, 0.49, 0.38], 0.4),
    ],
    grain: 0.12,
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
  },
  brightskin: {
    ops: [
      curve([[0, 0.05], [0.4, 0.46], [1, 1]]),
      contrast(-0.04),
      sat(0.98),
      temp(0.04),
      hsl({ y: { sat: -0.06 }, r: { sat: -0.04 } }),
      split([0.47, 0.48, 0.48], [0.54, 0.53, 0.5], 0.2),
    ],
  },
  warmfood: {
    ops: [
      contrast(0.14),
      sat(1.1),
      temp(0.12),
      hsl({ o: { sat: 0.16, hue: -3 }, r: { sat: 0.1 }, y: { sat: 0.08 }, g: { sat: -0.1 } }),
      split([0.43, 0.4, 0.34], [0.56, 0.5, 0.39], 0.22),
    ],
  },
  freshfood: {
    ops: [
      contrast(0.1),
      sat(1.18),
      vib(0.2),
      hsl({ g: { sat: 0.14 }, r: { sat: 0.08 }, c: { sat: 0.08 } }),
      split([0.44, 0.48, 0.47], [0.53, 0.53, 0.51], 0.18),
    ],
  },
}

/* ------------------------------------------------------------------ */
/* 注册表                                                              */
/* ------------------------------------------------------------------ */

export const FILTER_LIST: FilterDef[] = catalog.items.map((it) => {
  const r = RECIPES[it.id] ?? { ops: [] }
  return { ...it, grain: r.grain ?? 0, vignette: r.vignette ?? 0, ops: r.ops }
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
