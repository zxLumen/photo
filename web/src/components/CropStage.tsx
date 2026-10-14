import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ComposeId, CropRect, Subject, ToneParams } from '../types.js'
import { guideLines, guidePoints } from '../lib/compose.js'
import { containsPoint, handleAt, moveCrop, resizeCrop, snapMoveToGuides, type HandleId } from '../lib/crop.js'
import { ColorRenderer } from '../lib/colorPipeline.js'
import { renderStraightened } from '../lib/imageOps.js'

interface Props {
  image: HTMLImageElement
  rotate: number
  crop: CropRect
  composition: ComposeId
  subjects: Subject[]
  tone: ToneParams
  onCrop: (c: CropRect) => void
}

const SNAP_TOL_PX = 12
const HANDLE_TOL_PX = 13

export function CropStage({ image, rotate, crop, composition, subjects, tone, onCrop }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<ColorRenderer | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [snapped, setSnapped] = useState(false)
  const dragRef = useRef<{ mode: 'move' | 'resize'; handle: HandleId | null; start: CropRect; sx: number; sy: number } | null>(null)

  // 容器尺寸
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const W = image.naturalWidth
  const H = image.naturalHeight
  const maxW = Math.max(80, box.w - 8)
  const maxH = Math.max(80, box.h - 8)
  const scale = Math.min(maxW / W, maxH / H)
  const dispW = Math.max(40, Math.round(W * scale))
  const dispH = Math.max(40, Math.round(H * scale))
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1

  // WebGL 渲染器(几何 + 调色)
  useEffect(() => {
    const canvas = baseRef.current
    if (!canvas) return
    const r = new ColorRenderer(canvas)
    rendererRef.current = r
    return () => {
      r.dispose()
      rendererRef.current = null
    }
  }, [])

  // 几何变化(图片/旋转/显示尺寸)→ 重画整幅画面
  useLayoutEffect(() => {
    const r = rendererRef.current
    const canvas = baseRef.current
    if (!r || !canvas || !dispW || !dispH) return
    const pw = Math.round(dispW * dpr)
    const ph = Math.round(dispH * dpr)
    const geom = renderStraightened(image, rotate, pw, ph)
    if (r.supported) {
      r.setSource(geom, pw, ph)
      r.render(tone)
    } else {
      // 无 WebGL:退化为纯几何(不调色)
      canvas.width = pw
      canvas.height = ph
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, pw, ph)
        ctx.drawImage(geom, 0, 0)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, rotate, dispW, dispH, dpr])

  // 仅调色变化 → 复用已上传纹理
  useEffect(() => {
    const r = rendererRef.current
    if (r?.supported) r.render(tone)
  }, [tone])

  // 叠加层(裁剪框 / 参考线 / 手柄 / 主体)
  useLayoutEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    canvas.width = Math.round(dispW * dpr)
    canvas.height = Math.round(dispH * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, dispW, dispH)
    drawOverlay(ctx, dispW, dispH, crop, composition as ComposeId, subjects)
  }, [crop, composition, subjects, dispW, dispH, dpr])

  const toNorm = (e: ReactPointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toNorm(e)
    const tol = HANDLE_TOL_PX / Math.min(dispW, dispH)
    const handle = handleAt(crop, x, y, tol)
    if (handle) {
      dragRef.current = { mode: 'resize', handle, start: crop, sx: e.clientX, sy: e.clientY }
    } else if (containsPoint(crop, x, y)) {
      dragRef.current = { mode: 'move', handle: null, start: crop, sx: e.clientX, sy: e.clientY }
    } else {
      return
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.sx) / dispW
    const dy = (e.clientY - d.sy) / dispH
    if (d.mode === 'move') {
      const moved = moveCrop(d.start, dx, dy)
      const tol = SNAP_TOL_PX / Math.min(dispW, dispH)
      const snap = snapMoveToGuides(moved, subjects, composition, tol)
      setSnapped(snap.snapped)
      onCrop(snap.crop)
    } else if (d.handle) {
      setSnapped(false)
      onCrop(resizeCrop(d.start, d.handle, dx, dy))
    }
  }

  const endDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    setSnapped(false)
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="stage-wrap" ref={wrapRef}>
      <div className="stage" style={{ width: dispW, height: dispH }}>
        <canvas ref={baseRef} className="stage-base" style={{ width: dispW, height: dispH }} />
        <canvas
          ref={overlayRef}
          className="stage-overlay"
          style={{ width: dispW, height: dispH, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
        {snapped && <div className="snap-badge">已吸附构图点</div>}
      </div>
    </div>
  )
}

function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, crop: CropRect, composition: ComposeId, subjects: Subject[]) {
  const cx = crop.x * w
  const cy = crop.y * h
  const cw = crop.w * w
  const ch = crop.h * h
  const bottom = cy + ch
  const right = cx + cw

  // 裁剪区外压暗
  ctx.fillStyle = 'rgba(8, 10, 14, 0.55)'
  ctx.fillRect(0, 0, w, cy)
  ctx.fillRect(0, bottom, w, h - bottom)
  ctx.fillRect(0, cy, cx, ch)
  ctx.fillRect(right, cy, w - right, ch)

  // 裁剪框内三分网格
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 1
  for (let i = 1; i <= 2; i++) {
    const gx = cx + (cw * i) / 3
    const gy = cy + (ch * i) / 3
    line(ctx, gx, cy, gx, bottom)
    line(ctx, cx, gy, right, gy)
  }

  // 构图参考线
  ctx.strokeStyle = 'rgba(255, 200, 90, 0.85)'
  ctx.lineWidth = 1
  for (const l of guideLines(composition)) {
    line(ctx, cx + l.x1 * cw, cy + l.y1 * ch, cx + l.x2 * cw, cy + l.y2 * ch)
  }
  // 构图关键点
  ctx.fillStyle = 'rgba(255, 200, 90, 0.95)'
  for (const p of guidePoints(composition)) {
    dot(ctx, cx + p.x * cw, cy + p.y * ch, 3.5)
  }

  // 主体
  ctx.strokeStyle = 'rgba(120, 220, 255, 0.95)'
  ctx.lineWidth = 1.5
  for (const s of subjects) {
    cross(ctx, s.x * w, s.y * h, 9)
  }

  // 边框
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1)

  // 手柄
  ctx.fillStyle = '#fff'
  for (const [hx, hy] of handles(cx, cy, right, bottom)) {
    ctx.fillRect(hx - 4, hy - 4, 8, 8)
  }
}

function handles(l: number, t: number, r: number, b: number): [number, number][] {
  const mx = (l + r) / 2
  const my = (t + b) / 2
  return [
    [l, t],
    [mx, t],
    [r, t],
    [r, my],
    [r, b],
    [mx, b],
    [l, b],
    [l, my],
  ]
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function cross(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  line(ctx, x - s, y, x + s, y)
  line(ctx, x, y - s, x, y + s)
}
