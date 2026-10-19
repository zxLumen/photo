export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export type ComposeId = 'thirds' | 'golden' | 'center' | 'diagonal' | 'triangle' | 'symmetry' | 'leading' | 'negative'

export interface Subject {
  x: number
  y: number
  label: string
}

export interface ToneParams {
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temperature: number
  tint: number
  vibrance: number
  saturation: number
  clarity: number
  sharpen: number
  denoise: number
  vignette: number
}

export const SCENES = ['portrait', 'landscape', 'night', 'street', 'food', 'architecture', 'macro', 'document', 'other'] as const
export type Scene = (typeof SCENES)[number]

export const KEYS = ['low', 'normal', 'high'] as const
/** 基调:低调 / 正常 / 高调 */
export type ToneKey = (typeof KEYS)[number]

export const MOODS = ['vivid', 'natural', 'muted', 'filmic', 'clean', 'dramatic'] as const
export type Mood = (typeof MOODS)[number]

export const NOISE_LEVELS = ['none', 'light', 'heavy'] as const
export type NoiseLevel = (typeof NOISE_LEVELS)[number]

export const PROTECT_TAGS = ['dark-mood', 'warm-sunset', 'silhouette', 'high-key-bright', 'vintage'] as const
export type ProtectTag = (typeof PROTECT_TAGS)[number]

/**
 * 视觉模型只回答它擅长的**语义意图**,不回答具体修图数值。
 * 数值一律由客户端按本图实测(ImageStats)推导,模型只用来定目标、设护栏。
 */
export interface AiIntent {
  scene: Scene
  key: ToneKey
  mood: Mood
  /** 画面里有需要保护的人物肤色 */
  skin: boolean
  noise: NoiseLevel
  protect: ProtectTag[]
  /** 粗方向:更暗 / 不变 / 更亮 */
  brightness: -1 | 0 | 1
  /** 粗方向:更平 / 不变 / 更透 */
  punch: -1 | 0 | 1
  /** 粗方向:更冷 / 不变 / 更暖 */
  warmth: -1 | 0 | 1
  /** 建议的风格(仅提示,不自动套用) */
  styleHint: string
}

export interface AnalysisResult {
  composition: ComposeId
  crop: CropRect
  rotate: number
  subjects: Subject[]
  horizon: { angle: number; y: number } | null
  intent: AiIntent
  reason: string
  /** 兼容旧数据(旧版模型直接给参数) */
  tone?: Partial<ToneParams>
  style?: string
}

/** 完整的可编辑状态(会随会话落库) */
export interface EditParams {
  crop: CropRect
  rotate: number
  composition: ComposeId
  subjects: Subject[]
  /** 生效中的完整参数(= 实测基座 + 风格层) */
  tone: ToneParams
  /** 叠加中的风格 id(none = 不叠加)。字段名沿用旧版的 style 以兼容存档 */
  style: string
  /** 实测基座(未叠加风格);用于切换风格层时重新叠加 */
  baseTone?: ToneParams
  /** 参数来源:auto = 按本图测算;manual = 手动调整过;none = 未调色 */
  source?: 'auto' | 'manual' | 'none'
  /** 参数结构版本:2 = 实测基座 + 叠加风格(1/undefined = 旧版,style 已烘进 tone) */
  v?: number
}

export interface SessionItem {
  id: string
  name: string
  params: EditParams | null
  analysis: AnalysisResult | null
  createdAt: number
  updatedAt: number
  /** 仅在单条详情接口里返回 */
  thumb?: string
}

export interface PresetItem {
  id: string
  name: string
  tone: Partial<ToneParams>
  style: string
  createdAt: number
}

export interface StatusInfo {
  isOwner: boolean
  hasToken: boolean
  visitorAi: boolean
  provider: string
  model: string
  limits: { sessions: number; presets: number }
}
