import { useRef, useState, type DragEvent } from 'react'
import { SAMPLE_PHOTOS, type SamplePhoto } from '../lib/samples.js'

interface Props {
  onFile: (file: File) => void
  busy?: string
}

export function Uploader({ onFile, busy }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [over, setOver] = useState(false)
  const [loadingSample, setLoadingSample] = useState('')

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) onFile(f)
  }

  const pickSample = async (s: SamplePhoto) => {
    setLoadingSample(s.id)
    try {
      const res = await fetch(s.file)
      if (!res.ok) throw new Error('示例图加载失败')
      const blob = await res.blob()
      onFile(new File([blob], `${s.name}.jpg`, { type: blob.type || 'image/jpeg' }))
    } catch {
      setLoadingSample('')
    }
  }

  return (
    <div
      className={`uploader ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <div className="up-icon">◉</div>
      <div className="up-title">拖入一张照片,或点击选择</div>
      <div className="up-sub">支持 JPG / PNG / WebP · 也可以直接 Ctrl/⌘+V 粘贴 · 处理全程在浏览器内</div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />

      <div className="samples" onClick={(e) => e.stopPropagation()}>
        <div className="samples-title">
          没有素材?试试这些<b>待修图</b>的示例
        </div>
        <div className="samples-grid">
          {SAMPLE_PHOTOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`sample ${loadingSample === s.id ? 'loading' : ''}`}
              disabled={!!loadingSample}
              onClick={() => void pickSample(s)}
              title={`${s.name} · ${s.issue}`}
            >
              <img src={s.thumb} alt={s.name} loading="lazy" decoding="async" />
              <span className="sample-name">{s.name}</span>
              <span className="sample-issue">{s.issue}</span>
              {loadingSample === s.id && <span className="sample-mask">载入中…</span>}
            </button>
          ))}
        </div>
        <div className="samples-credit">示例图来自 Unsplash(免费授权),仅用于体验效果</div>
      </div>

      {busy && <div className="up-busy">{busy}</div>}
    </div>
  )
}
