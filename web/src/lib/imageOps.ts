import type { CropRect, ToneParams } from '../types.js'
import { deriveAutoTone } from './autoTone.js'
import { computeImageStats, estimateNoise, type ImageStats } from './imageStats.js'

/** 自动修图的取样结果:参数 + 本图体检数据 */
export interface AutoToneSample {
  tone: ToneParams
  stats: ImageStats
}

/** 统计取样长边(384 足够稳,又不会拖慢上传) */
const SAMPLE_SIDE = 384

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    loadImage(url)
      .then((img) => {
        URL.revokeObjectURL(url)
        resolve(img)
      })
      .catch((e) => {
        URL.revokeObjectURL(url)
        reject(e)
      })
  })
}

/** 把 w×h 按比例缩到不超过 maxW×maxH */
export function fitWithin(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(maxW / w, maxH / h, 1)
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

/** 生成分析/缩略图用的 JPEG data URL(长边不超过 maxSide) */
export function downscaleDataURL(img: HTMLImageElement, maxSide: number, quality = 0.72): { dataUrl: string; width: number; height: number } {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const { w, h } = fitWithin(W, H, maxSide, maxSide)
  const c = makeCanvas(w, h)
  const ctx = c.getContext('2d')
  if (!ctx) return { dataUrl: '', width: 0, height: 0 }
  ctx.drawImage(img, 0, 0, w, h)
  return { dataUrl: c.toDataURL('image/jpeg', quality), width: w, height: h }
}

const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * 旋转后为不出「空角」需要的放大倍数(绕中心旋转,再把画面撑满原框)。
 * 例:16:9 画面转 5°,约为 1.12。手机修图 App 的「自动裁切」就是这个。
 */
export function straightenZoom(w: number, h: number, deg: number): number {
  const t = Math.abs(rad(deg))
  if (t < 1e-4) return 1
  const c = Math.cos(t)
  const s = Math.sin(t)
  return Math.max(c + (h / w) * s, c + (w / h) * s)
}

/** 摆正后的整幅画面(未裁剪),映射到 outW×outH(保持原图宽高比) */
export function renderStraightened(img: HTMLImageElement, rotateDeg: number, outW: number, outH: number): HTMLCanvasElement {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const c = makeCanvas(outW, outH)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.imageSmoothingQuality = 'high'
  const scale = outW / W
  const z = straightenZoom(W, H, rotateDeg)
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(W / 2, H / 2)
  ctx.rotate(rad(rotateDeg))
  ctx.scale(z, z)
  ctx.translate(-W / 2, -H / 2)
  ctx.drawImage(img, 0, 0, W, H)
  ctx.restore()
  return c
}

/** 把「摆正后的归一化矩形」画到 outW×outH(内部统一走这里) */
function drawRegion(img: HTMLImageElement, rotateDeg: number, rect: CropRect, outW: number, outH: number): HTMLCanvasElement {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const sw = Math.max(1, rect.w * W)
  const sx = rect.x * W
  const sy = rect.y * H
  const c = makeCanvas(outW, outH)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.imageSmoothingQuality = 'high'
  const scale = outW / sw
  const z = straightenZoom(W, H, rotateDeg)
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-sx, -sy)
  ctx.translate(W / 2, H / 2)
  ctx.rotate(rad(rotateDeg))
  ctx.scale(z, z)
  ctx.translate(-W / 2, -H / 2)
  ctx.drawImage(img, 0, 0, W, H)
  ctx.restore()
  return c
}

/** 摆正 + 裁剪(用于导出);crop 为摆正后画面的归一化坐标 */
export function renderCrop(img: HTMLImageElement, rotateDeg: number, crop: CropRect, outW: number, outH: number): HTMLCanvasElement {
  return drawRegion(img, rotateDeg, crop, outW, outH)
}

/** 在裁剪区域内取样:整幅统计(384px)+ 原生分辨率小块估噪点 */
export function sampleAutoTone(img: HTMLImageElement, rotateDeg: number, crop: CropRect): AutoToneSample {
  const cropW = Math.max(1, crop.w * img.naturalWidth)
  const cropH = Math.max(1, crop.h * img.naturalHeight)
  const aspect = cropW / cropH
  const w = aspect >= 1 ? SAMPLE_SIDE : Math.max(8, Math.round(SAMPLE_SIDE * aspect))
  const h = aspect >= 1 ? Math.max(8, Math.round(SAMPLE_SIDE / aspect)) : SAMPLE_SIDE

  const geom = drawRegion(img, rotateDeg, crop, w, h)
  const ctx = geom.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    const stats = computeImageStats(new Uint8ClampedArray(0), 0, 0)
    return { tone: deriveAutoTone(stats), stats }
  }
  const stats = computeImageStats(ctx.getImageData(0, 0, w, h).data, w, h)

  // 噪点必须在**原生分辨率**上量:降采样会把噪点平均掉,384px 样本上测不出来
  const inner: CropRect = { x: crop.x + crop.w * 0.275, y: crop.y + crop.h * 0.275, w: crop.w * 0.45, h: crop.h * 0.45 }
  const pw = Math.max(16, Math.min(256, Math.round(inner.w * img.naturalWidth)))
  const ph = Math.max(16, Math.min(256, Math.round(inner.h * img.naturalHeight)))
  const patch = drawRegion(img, rotateDeg, inner, pw, ph)
  const pctx = patch.getContext('2d', { willReadFrequently: true })
  if (pctx) {
    stats.noise = estimateNoise(pctx.getImageData(0, 0, pw, ph).data, pw, ph)
  }

  return { tone: deriveAutoTone(stats), stats }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
