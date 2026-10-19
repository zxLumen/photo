import { fitWithin, renderStraightened } from './imageOps.js'

/**
 * 自动摆正:在浏览器里估「画面整体倾斜角」。
 *
 * 为什么不用视觉模型:大模型对**角度**估计很不准(实测把 4.5° 的倾斜只判成 0.3°)。
 * 角度是纯几何问题,交给算法更靠谱 —— 这里用**受限 Radon/Hough**:
 *  1. 缩小到 ~360px,转灰度,求 Sobel 梯度;
 *  2. 只保留「方向接近水平」的强边缘(梯度竖直 ⇒ 地平线 / 桌沿 / 建筑腰线),
 *     并按 `horiz²` 加权,压制柱子、楼角这类竖直边缘;
 *  3. 对 ±MAX_ANGLE 内每 0.2° 的候选角 δ,把边缘点按法线方向
 *     ρ = Y·cosδ − X·sinδ 投影成一维直方图;线越「聚成一条细线」,峰值越高;
 *  4. 峰值最高的 δ 就是画面主导倾斜角,回正角 = −δ。
 */
export interface TiltResult {
  /** 建议施加的旋转角(度);直接可给 `rotate` 用 */
  angle: number
  /** 0~1,峰值显著性;太低说明没有可靠主导线,别信这个角 */
  confidence: number
}

const MAX_ANGLE = 10
const STEP = 0.2
const BIN_PX = 2
/** 峰值能量至少要比中位角高这么多倍,才认为「存在主导水平线」 */
const MIN_RATIO = 1.25
/**
 * 置信度下限。
 * 实测:真正倾斜的图(湖面) conf≈0.60;而「山脊/海岸线本身就是斜的」这类图
 * 会给出 10° 这种离谱角度,但 conf 只有 ≈0.36 —— 加这道闸避免把好图拧歪。
 */
const MIN_CONFIDENCE = 0.45
/** 小于这个角度就当作已经水平(避免抖动) */
const MIN_ANGLE = 0.25

export function detectTilt(img: HTMLImageElement, maxSide = 360): TiltResult {
  const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, maxSide, maxSide)
  if (w < 24 || h < 24) return { angle: 0, confidence: 0 }

  const geom = renderStraightened(img, 0, w, h)
  const ctx = geom.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { angle: 0, confidence: 0 }
  const data = ctx.getImageData(0, 0, w, h).data

  const gray = new Float32Array(w * h)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255
  }

  const px: number[] = []
  const py: number[] = []
  const pw: number[] = []
  const cx = w / 2
  const cy = h / 2
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = gray[i - 1] - gray[i + 1]
      const gy = gray[i - w] - gray[i + w]
      const m = Math.sqrt(gx * gx + gy * gy)
      if (m < 0.05) continue
      const horiz = Math.abs(gy) / (Math.abs(gx) + Math.abs(gy) + 1e-6)
      const wgt = m * horiz * horiz
      if (wgt < 0.02) continue
      px.push(x - cx)
      py.push(y - cy)
      pw.push(wgt)
    }
  }
  if (px.length < 60) return { angle: 0, confidence: 0 }

  const diag = Math.ceil(Math.sqrt(w * w + h * h) / 2) + BIN_PX
  const bins = Math.ceil((diag * 2) / BIN_PX) + 1
  let total = 0
  for (const v of pw) total += v

  const hist = new Float32Array(bins)
  const energies: number[] = []
  const angles: number[] = []
  const norm = total * total
  for (let a = -MAX_ANGLE; a <= MAX_ANGLE + 1e-9; a += STEP) {
    hist.fill(0)
    const rad = (a * Math.PI) / 180
    const cd = Math.cos(rad)
    const sd = Math.sin(rad)
    for (let k = 0; k < px.length; k++) {
      const rho = py[k] * cd - px[k] * sd
      const b = Math.round((rho + diag) / BIN_PX)
      if (b >= 0 && b < bins) hist[b] += pw[k]
    }
    let energy = 0
    for (let i = 0; i < bins; i++) energy += hist[i] * hist[i]
    energies.push(energy / norm)
    angles.push(a)
  }

  let bi = 0
  for (let i = 1; i < energies.length; i++) if (energies[i] > energies[bi]) bi = i
  const sorted = [...energies].sort((x, y) => x - y)
  const med = sorted[Math.floor(sorted.length / 2)] || 1e-9
  const ratio = energies[bi] / med
  const confidence = Math.min(1, Math.max(0, (ratio - 1) / 0.8))

  if (ratio < MIN_RATIO || confidence < MIN_CONFIDENCE) return { angle: 0, confidence }
  const angle = -angles[bi]
  if (Math.abs(angle) < MIN_ANGLE) return { angle: 0, confidence }
  return { angle: Math.max(-15, Math.min(15, Math.round(angle * 10) / 10)), confidence }
}
