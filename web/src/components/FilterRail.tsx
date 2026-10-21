import { useEffect, useRef, useState } from 'react'
import type { CropRect, FilterPick, ToneParams } from '../types.js'
import { ColorRenderer } from '../lib/colorPipeline.js'
import { FILTER_GROUPS, FILTER_LIST, PREVIEW_LUT_N } from '../lib/filters.js'
import { renderCrop } from '../lib/imageOps.js'

/** 缩略图边长(渲染分辨率;CSS 显示约 90px,2x 足够清晰) */
const SIDE = 144

interface Props {
  image: HTMLImageElement
  rotate: number
  crop: CropRect
  /** 当前调色(滤镜叠在调色之上,所以预览要带上它) */
  tone: ToneParams
  value: FilterPick
  onPick: (id: string) => void
}

/**
 * 滤镜画廊:52 个滤镜在**当前这张照片**上的实时预览。
 *
 * 做法:一个隐藏的 WebGL 画布 + 16³ LUT(缩略图够用),逐个渲染后拷到各自的小 canvas。
 * LUT 有全局缓存,拖动调色滑块时只重画、不重烘焙;渲染分帧进行,不卡面板。
 */
export function FilterRail({ image, rotate, crop, tone, value, onPick }: Props) {
  const [cat, setCat] = useState('all')
  const [noGl, setNoGl] = useState(false)
  const refs = useRef(new Map<string, HTMLCanvasElement>())

  useEffect(() => {
    let cancelled = false
    let timer = 0
    let raf = 0
    let renderer: ColorRenderer | null = null
    const glCanvas = document.createElement('canvas')

    timer = window.setTimeout(() => {
      if (cancelled) return
      const gl = glCanvas
      const r = new ColorRenderer(gl, PREVIEW_LUT_N)
      if (!r.supported || !r.graded) {
        r.dispose()
        setNoGl(true)
        return
      }
      renderer = r
      setNoGl(false)

      // 取当前裁剪区的中心正方形,保证缩略图就是「这张照片」的样子
      const side = Math.min(crop.w, crop.h)
      const rect: CropRect = {
        x: crop.x + crop.w / 2 - side / 2,
        y: crop.y + crop.h / 2 - side / 2,
        w: side,
        h: side,
      }
      const src = renderCrop(image, rotate, rect, SIDE, SIDE)
      r.setSource(src, SIDE, SIDE)

      let i = 0
      const step = () => {
        if (cancelled) return
        const end = Math.min(i + 5, FILTER_LIST.length)
        for (; i < end; i++) {
          const def = FILTER_LIST[i]
          const cv = refs.current.get(def.id)
          if (!cv) continue
          r.render(tone, { id: def.id, amount: 100 })
          const ctx = cv.getContext('2d')
          if (ctx) ctx.drawImage(gl, 0, 0, SIDE, SIDE)
        }
        if (i < FILTER_LIST.length) raf = requestAnimationFrame(step)
      }
      step()
    }, 120)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      cancelAnimationFrame(raf)
      renderer?.dispose()
      renderer = null
      // 显式释放 WebGL 上下文:反复切标签页不会把浏览器的上下文配额耗光
      glCanvas.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [image, rotate, crop, tone])

  return (
    <div className="filter-rail">
      <div className="filter-cats">
        <button type="button" className={`chip tiny ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>
          全部
        </button>
        {FILTER_GROUPS.map((g) => (
          <button key={g.id} type="button" className={`chip tiny ${cat === g.id ? 'on' : ''}`} onClick={() => setCat(g.id)}>
            {g.label}
          </button>
        ))}
      </div>

      {noGl && <div className="muted small">当前浏览器不支持 WebGL 滤镜预览(仍可导出,但看不到效果)。</div>}

      <div className="filter-grid">
        {/* 全部挂载、按分组隐藏:切分组时缩略图不用重画 */}
        {FILTER_LIST.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`filter-item ${value.id === f.id ? 'on' : ''} ${cat !== 'all' && f.group !== cat ? 'off-cat' : ''}`}
            title={`${f.name} · ${f.hint}`}
            onClick={() => onPick(f.id)}
          >
            <span className="filter-thumb">
              <canvas
                width={SIDE}
                height={SIDE}
                ref={(el) => {
                  if (el) refs.current.set(f.id, el)
                  else refs.current.delete(f.id)
                }}
              />
            </span>
            <span className="filter-name">{f.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
