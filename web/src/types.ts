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

export interface AnalysisResult {
  composition: ComposeId
  crop: CropRect
  rotate: number
  subjects: Subject[]
  horizon: { angle: number; y: number } | null
  tone: ToneParams
  style: string
  reason: string
}

/** 完整的可编辑状态(会随会话落库) */
export interface EditParams {
  crop: CropRect
  rotate: number
  composition: ComposeId
  subjects: Subject[]
  tone: ToneParams
  style: string
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
