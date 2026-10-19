import type { ToneParams } from '../types.js'
import { STYLE_PRESETS, TONE_LIMITS } from '../lib/autoTone.js'

interface Props {
  tone: ToneParams
  /** 叠加中的风格(id,none = 不叠加) */
  look: string
  /** 参数来源:auto = 按本图测算 */
  source: 'none' | 'auto' | 'manual'
  /** 本图实测诊断(百分位/溢出/色偏/噪点…) */
  diagnosis?: string
  /** 模型对本图的语义判断 */
  intentText?: string
  onChange: (patch: Partial<ToneParams>) => void
  onLook: (id: string) => void
  onAuto: () => void
  onReset: () => void
}

const GROUPS: { title: string; keys: (keyof ToneParams)[] }[] = [
  { title: '光线', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { title: '色彩', keys: ['temperature', 'tint', 'vibrance', 'saturation'] },
  { title: '细节', keys: ['clarity', 'sharpen', 'denoise', 'vignette'] },
]

const SOURCE_LABEL: Record<Props['source'], string> = {
  auto: '自动 · 按本图测算',
  manual: '手动调整',
  none: '未调色',
}

export function AdjustPanel({ tone, look, source, diagnosis, intentText, onChange, onLook, onAuto, onReset }: Props) {
  return (
    <div className="adjust">
      <div className="tone-head">
        <span className={`badge tone-${source}`}>{SOURCE_LABEL[source]}</span>
        {look !== 'none' && <span className="badge look">叠加 {STYLE_PRESETS[look]?.label ?? look}</span>}
      </div>

      {intentText && <div className="muted small tone-note">模型判断:{intentText}</div>}
      {diagnosis && <div className="tone-note diag small">本图实测:{diagnosis}</div>}

      <div className="group style-block">
        <div className="group-title">风格叠加 · 在实测结果上加一层</div>
        <div className="style-row">
          {Object.entries(STYLE_PRESETS).map(([id, p]) => (
            <button key={id} type="button" className={`chip ${look === id ? 'on' : ''}`} onClick={() => onLook(id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="muted small">点同一项可取消;拖动任一滑块会把风格「拍平」成具体数值。</div>
      </div>

      <div className="row2">
        <button type="button" className="btn small" onClick={onAuto}>
          自动修图
        </button>
        <button type="button" className="btn small ghost" onClick={onReset}>
          重置
        </button>
      </div>

      {GROUPS.map((g) => (
        <div className="group" key={g.title}>
          <div className="group-title">{g.title}</div>
          {g.keys.map((k) => {
            const lim = TONE_LIMITS[k]
            const v = tone[k]
            return (
              <label className="slider" key={k}>
                <span className="slider-label">{lim.label}</span>
                <input
                  type="range"
                  min={lim.min}
                  max={lim.max}
                  step={lim.step}
                  value={v}
                  onChange={(e) => onChange({ [k]: Number(e.target.value) } as Partial<ToneParams>)}
                />
                <span className="slider-val">{v > 0 ? `+${v}` : v}</span>
              </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}
