import type { CropRect, Subject } from '../types.js'
import { guidePoints } from './compose.js'

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const MIN_SIZE = 0.06

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function clampCrop(c: CropRect, min = MIN_SIZE): CropRect {
  let w = clamp(c.w, min, 1)
  let h = clamp(c.h, min, 1)
  let x = clamp(c.x, 0, 1 - w)
  let y = clamp(c.y, 0, 1 - h)
  // 极端情况下(浮点)再兜一次
  if (x + w > 1) x = 1 - w
  if (y + h > 1) y = 1 - h
  return { x, y, w, h }
}

export function moveCrop(c: CropRect, dx: number, dy: number, min = MIN_SIZE): CropRect {
  return clampCrop({ x: c.x + dx, y: c.y + dy, w: c.w, h: c.h }, min)
}

export function resizeCrop(c: CropRect, handle: HandleId, dx: number, dy: number, min = MIN_SIZE): CropRect {
  let left = c.x
  let top = c.y
  let right = c.x + c.w
  let bottom = c.y + c.h

  if (handle.includes('w')) left = clamp(left + dx, 0, right - min)
  if (handle.includes('e')) right = clamp(right + dx, left + min, 1)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, 1)

  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function containsPoint(c: CropRect, x: number, y: number): boolean {
  return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h
}

/** 命中哪个缩放手柄(坐标与 crop 同一归一化空间);无则返回 null */
export function handleAt(c: CropRect, x: number, y: number, tol: number): HandleId | null {
  const nearL = Math.abs(x - c.x) <= tol
  const nearR = Math.abs(x - (c.x + c.w)) <= tol
  const nearT = Math.abs(y - c.y) <= tol
  const nearB = Math.abs(y - (c.y + c.h)) <= tol
  const inX = x >= c.x - tol && x <= c.x + c.w + tol
  const inY = y >= c.y - tol && y <= c.y + c.h + tol
  if (nearL && nearT) return 'nw'
  if (nearR && nearT) return 'ne'
  if (nearL && nearB) return 'sw'
  if (nearR && nearB) return 'se'
  if (nearT && inX) return 'n'
  if (nearB && inX) return 's'
  if (nearL && inY) return 'w'
  if (nearR && inY) return 'e'
  return null
}

export interface SnapResult {
  crop: CropRect
  snapped: boolean
}

/**
 * 移动裁剪框时,把「主体」吸附到当前构图法的关键点。
 * 坐标均为原图归一化 0..1;tol 是容差(同一空间)。
 */
export function snapMoveToGuides(crop: CropRect, subjects: Subject[], composition: string, tol: number): SnapResult {
  const pts = guidePoints(composition as never)
  if (!pts.length || !subjects.length) return { crop, snapped: false }

  let best: { dx: number; dy: number; dist: number } | null = null
  for (const p of pts) {
    // 该构图点在原图中的位置
    const px = crop.x + p.x * crop.w
    const py = crop.y + p.y * crop.h
    for (const s of subjects) {
      const dx = px - s.x
      const dy = py - s.y
      const dist = Math.hypot(dx, dy)
      if (dist <= tol && (!best || dist < best.dist)) best = { dx, dy, dist }
    }
  }
  if (!best) return { crop, snapped: false }
  return { crop: moveCrop(crop, best.dx, best.dy), snapped: true }
}
