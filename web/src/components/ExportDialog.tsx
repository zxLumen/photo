import { useState } from 'react'
import type { CropRect, FilterPick, ToneParams } from '../types.js'
import { ColorRenderer } from '../lib/colorPipeline.js'
import { canvasToBlob, downloadBlob, makeCanvas, renderCrop } from '../lib/imageOps.js'

interface Props {
  image: HTMLImageElement
  rotate: number
  crop: CropRect
  tone: ToneParams
  filter: FilterPick
  fileBase: string
  onClose: () => void
}

const LONG_OPTIONS = [
  { v: 0, label: '原始尺寸' },
  { v: 2560, label: '2560px' },
  { v: 1920, label: '1920px' },
  { v: 1280, label: '1280px' },
]

export function ExportDialog({ image, rotate, crop, tone, filter, fileBase, onClose }: Props) {
  const [format, setFormat] = useState<'image/jpeg' | 'image/png'>('image/jpeg')
  const [quality, setQuality] = useState(92)
  const [maxLong, setMaxLong] = useState(0)
  const [busy, setBusy] = useState(false)

  const W = image.naturalWidth
  const H = image.naturalHeight
  const cropW = Math.max(1, crop.w * W)
  const cropH = Math.max(1, crop.h * H)
  const scale = maxLong > 0 ? Math.min(1, maxLong / Math.max(cropW, cropH)) : 1
  const outW = Math.round(cropW * scale)
  const outH = Math.round(cropH * scale)

  const doExport = async () => {
    setBusy(true)
    try {
      const geom = renderCrop(image, rotate, crop, outW, outH)
      let out: HTMLCanvasElement = geom
      const probe = makeCanvas(1, 1)
      const r = new ColorRenderer(probe)
      if (r.supported) {
        r.setSource(geom, outW, outH)
        r.render(tone, filter)
        out = probe
        r.dispose()
      }
      const blob = await canvasToBlob(out, format, quality / 100)
      if (blob) downloadBlob(blob, `${fileBase}.${format === 'image/png' ? 'png' : 'jpg'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">导出照片</div>
        <label className="field">
          <span>格式</span>
          <select className="in" value={format} onChange={(e) => setFormat(e.target.value as 'image/jpeg' | 'image/png')}>
            <option value="image/jpeg">JPEG</option>
            <option value="image/png">PNG</option>
          </select>
        </label>
        <label className="field">
          <span>长边</span>
          <select className="in" value={maxLong} onChange={(e) => setMaxLong(Number(e.target.value))}>
            {LONG_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {format === 'image/jpeg' && (
          <label className="slider">
            <span className="slider-label">质量</span>
            <input type="range" min={50} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
            <span className="slider-val">{quality}</span>
          </label>
        )}
        <div className="muted small">
          输出尺寸:{outW} × {outH}
        </div>
        <div className="row2 end">
          <button type="button" className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn" disabled={busy} onClick={doExport}>
            {busy ? '导出中…' : '导出下载'}
          </button>
        </div>
      </div>
    </div>
  )
}
