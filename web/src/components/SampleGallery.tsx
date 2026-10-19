import { useState } from 'react'
import { SAMPLE_GROUPS, SAMPLE_PHOTOS, type SamplePhoto } from '../lib/samples.js'

interface Props {
  /** 选好示例后回调(已转成 File,与本地选图同一条链路) */
  onPick: (file: File) => void
}

/** 内置示例画廊:上传页与「示例」弹窗共用,按「要修什么」分组 */
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
        按<b>要修什么</b>选一张试试(都是未调色的直出原片)
      </div>

      {SAMPLE_GROUPS.map((g) => {
        const items = SAMPLE_PHOTOS.filter((s) => s.group === g.id)
        if (!items.length) return null
        return (
          <section className="sample-group" key={g.id}>
            <div className="sample-group-title">
              {g.label}
              <span>{g.hint}</span>
            </div>
            <div className="samples-grid">
              {items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`sample ${loading === s.id ? 'loading' : ''}`}
                  disabled={!!loading}
                  onClick={() => void pick(s)}
                  title={`${s.name} · ${s.issue} · ${s.credit}`}
                >
                  <img src={s.thumb} alt={s.name} loading="lazy" decoding="async" />
                  <span className="sample-name">{s.name}</span>
                  <span className="sample-issue">{s.issue}</span>
                  {loading === s.id && <span className="sample-mask">载入中…</span>}
                </button>
              ))}
            </div>
          </section>
        )
      })}

      {err && <div className="samples-err">{err}</div>}
      <details className="samples-credit">
        <summary>图片来源与授权(CC BY / CC BY-SA 需署名)</summary>
        <ul>
          {SAMPLE_PHOTOS.map((s) => (
            <li key={s.id}>
              <a href={s.source} target="_blank" rel="noreferrer noopener">
                {s.name}
              </a>
              <span> — {s.credit}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
