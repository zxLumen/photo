import { useState } from 'react'
import { SAMPLE_PHOTOS, type SamplePhoto } from '../lib/samples.js'

interface Props {
  /** 选好示例后回调(已转成 File,与本地选图同一条链路) */
  onPick: (file: File) => void
}

/** 内置示例画廊:上传页与「示例」弹窗共用 */
export function SampleGallery({ onPick }: Props) {
  const [loading, setLoading] = useState('')
  const [err, setErr] = useState('')

  const pick = async (s: SamplePhoto) => {
    setLoading(s.id)
    setErr('')
    try {
      const res = await fetch(s.file)
      if (!res.ok) throw new Error('加载失败')
      const blob = await res.blob()
      onPick(new File([blob], `${s.name}.jpg`, { type: blob.type || 'image/jpeg' }))
    } catch {
      setErr('示例图加载失败,请稍后再试')
    } finally {
      setLoading('')
    }
  }

  return (
    <div className="samples">
      <div className="samples-title">
        试试这些<b>待修图</b>的示例
      </div>
      <div className="samples-grid">
        {SAMPLE_PHOTOS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`sample ${loading === s.id ? 'loading' : ''}`}
            disabled={!!loading}
            onClick={() => void pick(s)}
            title={`${s.name} · ${s.issue}`}
          >
            <img src={s.thumb} alt={s.name} loading="lazy" decoding="async" />
            <span className="sample-name">{s.name}</span>
            <span className="sample-issue">{s.issue}</span>
            {loading === s.id && <span className="sample-mask">载入中…</span>}
          </button>
        ))}
      </div>
      {err && <div className="samples-err">{err}</div>}
      <div className="samples-credit">示例图来自 Unsplash(免费授权),仅用于体验效果</div>
    </div>
  )
}
