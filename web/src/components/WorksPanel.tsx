import { useState } from 'react'
import type { PresetItem, SessionItem } from '../types.js'

interface Props {
  sessions: SessionItem[]
  presets: PresetItem[]
  canSave: boolean
  onOpenSession: (s: SessionItem) => void
  onDeleteSession: (id: string) => void
  onSaveSession: (name: string) => void
  onApplyPreset: (p: PresetItem) => void
  onSavePreset: (name: string) => void
  onDeletePreset: (id: string) => void
}

const fmt = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function WorksPanel({ sessions, presets, canSave, onOpenSession, onDeleteSession, onSaveSession, onApplyPreset, onSavePreset, onDeletePreset }: Props) {
  const [name, setName] = useState('')
  const [pname, setPname] = useState('')

  return (
    <div className="works">
      <div className="group">
        <div className="group-title">我的作品</div>
        {canSave ? (
          <div className="row2">
            <input className="in" placeholder="作品名" value={name} onChange={(e) => setName(e.target.value)} />
            <button
              type="button"
              className="btn small"
              onClick={() => {
                onSaveSession(name.trim() || `作品 ${sessions.length + 1}`)
                setName('')
              }}
            >
              保存
            </button>
          </div>
        ) : (
          <div className="muted small">上传照片后可保存作品(只存缩略图与参数,不存原图)</div>
        )}

        <div className="cards">
          {sessions.map((s) => (
            <div className="card" key={s.id}>
              <button type="button" className="card-thumb" onClick={() => onOpenSession(s)} title="打开">
                {s.thumb ? <img src={s.thumb} alt={s.name} /> : <span className="ph">图</span>}
              </button>
              <div className="card-meta">
                <span className="card-name" title={s.name}>
                  {s.name}
                </span>
                <span className="muted small">{fmt(s.updatedAt)}</span>
              </div>
              <button type="button" className="icon-btn" title="删除" onClick={() => onDeleteSession(s.id)}>
                ✕
              </button>
            </div>
          ))}
          {!sessions.length && <div className="muted small">还没有作品</div>}
        </div>
      </div>

      <div className="group">
        <div className="group-title">我的预设</div>
        <div className="row2">
          <input className="in" placeholder="预设名" value={pname} onChange={(e) => setPname(e.target.value)} />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              onSavePreset(pname.trim() || `预设 ${presets.length + 1}`)
              setPname('')
            }}
          >
            存为预设
          </button>
        </div>
        <div className="chips">
          {presets.map((p) => (
            <span className="chip preset" key={p.id}>
              <button type="button" className="chip-apply" onClick={() => onApplyPreset(p)}>
                {p.name}
              </button>
              <button type="button" className="chip-x" title="删除" onClick={() => onDeletePreset(p.id)}>
                ✕
              </button>
            </span>
          ))}
          {!presets.length && <div className="muted small">保存调色参数,一键套用到别的照片</div>}
        </div>
      </div>
    </div>
  )
}
