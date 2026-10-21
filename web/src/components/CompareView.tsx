import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CropRect, FilterPick, ToneParams } from '../types.js'
import { ColorRenderer } from '../lib/colorPipeline.js'
import { fitWithin, renderCrop } from '../lib/imageOps.js'

interface Props {
  image: HTMLImageElement
  rotate: number
  crop: CropRect
  tone: ToneParams
  filter: FilterPick
}

/**
 * 前后对比(左右分屏):
 *  左 = 修前 · 原图(整幅、不旋转、不调色)
 *  右 = 修后 · 裁剪 + 旋转 + 调色(与导出完全一致)
 * 两侧都按各自比例铺满半边,能同时看出「裁掉了什么」与「颜色变了什么」。
 */
export function CompareView({ image, rotate, crop, tone, filter }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const beforeRef = useRef<HTMLCanvasElement | null>(null)
  const afterRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<ColorRenderer | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = afterRef.current
    if (!canvas) return
    const r = new ColorRenderer(canvas)
    rendererRef.current = r
    return () => {
      r.dispose()
      rendererRef.current = null
    }
  }, [])

  const paneW = Math.max(60, Math.floor((box.w - 30) / 2))
  const paneH = Math.max(60, box.h - 20)
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1

  // 修前:整幅原图
  useLayoutEffect(() => {
    const c = beforeRef.current
    if (!c || box.w === 0) return
    const { w, h } = fitWithin(image.naturalWidth, image.naturalHeight, paneW, paneH)
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    c.style.width = `${w}px`
    c.style.height = `${h}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, c.width, c.height)
  }, [image, paneW, paneH, dpr, box.w])

  // 修后:裁剪 + 旋转 + 调色
  useLayoutEffect(() => {
    const c = afterRef.current
    const r = rendererRef.current
    if (!c || !r || box.w === 0) return
    const cropW = Math.max(1, crop.w * image.naturalWidth)
    const cropH = Math.max(1, crop.h * image.naturalHeight)
    const { w, h } = fitWithin(cropW, cropH, paneW, paneH)
    const geom = renderCrop(image, rotate, crop, Math.round(w * dpr), Math.round(h * dpr))
    if (r.supported) {
      r.setSource(geom, geom.width, geom.height)
      r.render(tone, filter)
      c.style.width = `${w}px`
      c.style.height = `${h}px`
    } else {
      c.width = geom.width
      c.height = geom.height
      c.style.width = `${w}px`
      c.style.height = `${h}px`
      const ctx = c.getContext('2d')
      if (ctx) ctx.drawImage(geom, 0, 0)
    }
  }, [image, rotate, crop, tone, filter, paneW, paneH, dpr, box.w])

  return (
    <div className="compare-wrap" ref={wrapRef}>
      <figure className="cmp-pane">
        <canvas ref={beforeRef} />
        <figcaption className="cmp-tag before">修前 · 原图</figcaption>
      </figure>
      <figure className="cmp-pane">
        <canvas ref={afterRef} />
        <figcaption className="cmp-tag after">修后 · 裁剪 + 调色</figcaption>
      </figure>
    </div>
  )
}
