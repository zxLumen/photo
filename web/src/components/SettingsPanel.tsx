import { useEffect, useState } from 'react'

export interface ProviderSlot {
  id: string
  label: string
  defaultModel: string
  defaultBaseURL: string
  model: string
  baseURL: string
  hasKey: boolean
  keyMask: string | null
}

export interface SettingsData {
  provider: string
  model: string
  baseURL: string
  hasKey: boolean
  keyMask: string | null
  visitorAi: boolean
  providers: ProviderSlot[]
}

interface Props {
  data: SettingsData | null
  onSaveProvider: (provider: string) => void
  onSaveSlot: (provider: string, patch: { model?: string; baseURL?: string }) => void
  onSaveKey: (provider: string, key: string) => void
  onToggleVisitorAi: (on: boolean) => void
}

export function SettingsPanel({ data, onSaveProvider, onSaveSlot, onSaveKey, onToggleVisitorAi }: Props) {
  const [key, setKey] = useState('')
  const [model, setModel] = useState('')
  const [baseURL, setBaseURL] = useState('')

  const slot = data?.providers.find((p) => p.id === data.provider)
  useEffect(() => {
    setModel(slot?.model ?? '')
    setBaseURL(slot?.baseURL ?? '')
    setKey('')
  }, [slot?.id, slot?.model, slot?.baseURL])

  if (!data) return <div className="muted small">加载中…</div>

  return (
    <div className="settings">
      <div className="group">
        <div className="group-title">视觉模型(仅站长可改)</div>
        <label className="field">
          <span>服务商</span>
          <select className="in" value={data.provider} onChange={(e) => onSaveProvider(e.target.value)}>
            {data.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.hasKey ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>模型</span>
          <input className="in" value={model} placeholder={slot?.defaultModel || '(由网关令牌决定)'} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label className="field">
          <span>接口地址</span>
          <input className="in" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
        </label>
        <div className="row2">
          <button type="button" className="btn small" onClick={() => onSaveSlot(data.provider, { model, baseURL })}>
            保存模型/地址
          </button>
          <span className="muted small">当前:{data.keyMask ? `令牌 ${data.keyMask}` : '未配令牌'}</span>
        </div>
        <div className="row2">
          <input className="in" type="password" placeholder="粘贴 API Key / 网关应用令牌" value={key} onChange={(e) => setKey(e.target.value)} />
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              onSaveKey(data.provider, key)
              setKey('')
            }}
          >
            保存令牌
          </button>
        </div>
      </div>

      <div className="group">
        <label className="toggle">
          <input type="checkbox" checked={data.visitorAi} onChange={(e) => onToggleVisitorAi(e.target.checked)} />
          <span>允许访客使用 AI 分析</span>
        </label>
        <div className="muted small">
          默认走博客 AI 网关(真实 Key 只在主站)。局域网/本地调试可临时直连某个视觉模型。
        </div>
      </div>
    </div>
  )
}
