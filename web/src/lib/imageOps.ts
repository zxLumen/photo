import type { CropRect, ToneParams } from '../types.js'
import { computeAutoTone } from './autoTone.js'

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

/** 摆正后的整幅画面(未裁剪),映射到 outW×outH(保持原图宽高比) */
export function renderStraightened(img: HTMLImageElement, rotateDeg: number, outW: number, outH: number): HTMLCanvasElement {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const c = makeCanvas(outW, outH)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.imageSmoothingQuality = 'high'
  const scale = outW / W
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(W / 2, H / 2)
  ctx.rotate(rad(rotateDeg))
  ctx.translate(-W / 2, -H / 2)
  ctx.drawImage(img, 0, 0, W, H)
  ctx.restore()
  return c
}

/** 摆正 + 裁剪(用于导出);crop 为摆正后画面的归一化坐标 */
export function renderCrop(img: HTMLImageElement, rotateDeg: number, crop: CropRect, outW: number, outH: number): HTMLCanvasElement {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const sw = Math.max(1, crop.w * W)
  const sx = crop.x * W
  const sy = crop.y * H
  const c = makeCanvas(outW, outH)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.imageSmoothingQuality = 'high'
  const scale = outW / sw
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(-sx, -sy)
  ctx.translate(W / 2, H / 2)
  ctx.rotate(rad(rotateDeg))
  ctx.translate(-W / 2, -H / 2)
  ctx.drawImage(img, 0, 0, W, H)
  ctx.restore()
  return c
}

/** 在裁剪区域内取样,算出直方图自动调色建议 */
export function sampleAutoTone(img: HTMLImageElement, rotateDeg: number, crop: CropRect): ToneParams {
  const geom = renderCrop(img, rotateDeg, crop, 160, Math.max(1, Math.round((160 * crop.h * img.naturalHeight) / (crop.w * img.naturalWidth))))
  const ctx = geom.getContext('2d', { willReadFrequently: true })
  if (!ctx) return computeAutoTone(new Uint8ClampedArray(0), 0, 0)
  const data = ctx.getImageData(0, 0, geom.width, geom.height).data
  return computeAutoTone(data, geom.width, geom.height)
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
