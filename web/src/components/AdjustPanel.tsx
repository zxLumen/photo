import type { CropRect, FilterPick, ToneParams } from '../types.js'
import { TONE_LIMITS } from '../lib/autoTone.js'
import { filterName, getFilter } from '../lib/filters.js'
import { FilterRail } from './FilterRail.js'

interface Props {
  tone: ToneParams
  /** 选中的滤镜 */
  filter: FilterPick
  /** 滤镜来源:ai = 模型选的;auto = 按题材兜底;manual = 手动换的 */
  filterSource: 'ai' | 'auto' | 'manual' | 'none'
  /** 为什么选它(模型给的理由 / 兜底说明) */
  filterWhy: string
  /** 参数来源:auto = 按本图测算 */
  source: 'none' | 'auto' | 'manual'
  /** 本图实测诊断(百分位/溢出/色偏/噪点…) */
  diagnosis?: string
  /** 模型对本图的语义判断 */
  intentText?: string
  /** 滤镜预览要用当前照片 */
  image: HTMLImageElement | null
  rotate: number
  crop: CropRect
  onChange: (patch: Partial<ToneParams>) => void
  onFilter: (id: string) => void
  onFilterAmount: (n: number) => void
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

const FILTER_SOURCE_LABEL: Record<Props['filterSource'], string> = {
  ai: 'AI 选',
  auto: '按题材',
  manual: '手动',
  none: '',
}

export function AdjustPanel({
  tone,
  filter,
  filterSource,
  filterWhy,
  source,
  diagnosis,
  intentText,
  image,
  rotate,
  crop,
  onChange,
  onFilter,
  onFilterAmount,
  onAuto,
  onReset,
}: Props) {
  const active = filter.id !== 'none'
  return (
    <div className="adjust">
      <div className="tone-head">
        <span className={`badge tone-${source}`}>{SOURCE_LABEL[source]}</span>
        {active && (
          <span className="badge look">
            {FILTER_SOURCE_LABEL[filterSource]} · {filterName(filter.id)}
          </span>
        )}
      </div>

      {intentText && <div className="muted small tone-note">模型判断:{intentText}</div>}
      {diagnosis && <div className="tone-note diag small">本图实测:{diagnosis}</div>}

      <div className="group">
        <div className="group-title">滤镜 · 叠在调色结果上</div>
        {image ? (
          <FilterRail image={image} rotate={rotate} crop={crop} tone={tone} value={filter} onPick={onFilter} />
        ) : (
          <div className="muted small">载入照片后可在本图上实时预览</div>
        )}

        {active ? (
          <>
            <label className="slider filter-amount">
              <span className="slider-label">强度</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={filter.amount}
                onChange={(e) => onFilterAmount(Number(e.target.value))}
              />
              <span className="slider-val">{filter.amount}</span>
            </label>
            <div className="muted small filter-why">
              {filterWhy || getFilter(filter.id).hint}
              <button type="button" className="link-btn" onClick={() => onFilter('none')}>
                取消滤镜
              </button>
            </div>
          </>
        ) : (
          <div className="muted small">自动修图会按题材挑一个;也可以点上面的缩略图自己换。</div>
        )}
      </div>

      <div className="group">
        <div className="group-title">精细调色 · 按本图实测</div>
        <div className="row2">
          <button type="button" className="btn small" onClick={onAuto}>
            自动修图
          </button>
          <button type="button" className="btn small ghost" onClick={onReset}>
            重置
          </button>
        </div>
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
