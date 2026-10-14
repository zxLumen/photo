import type { ComposeId } from '../types.js'

export interface Pt {
  x: number
  y: number
}

export interface GuideLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface CompositionDef {
  id: ComposeId
  label: string
  hint: string
}

/** 构图法注册表(展示名 + 一句话说明) */
export const COMPOSITIONS: readonly CompositionDef[] = [
  { id: 'thirds', label: '三分法', hint: '主体放在四条三分线的交点' },
  { id: 'golden', label: '黄金分割', hint: '主体放在 0.618 黄金点' },
  { id: 'center', label: '中心构图', hint: '主体居中,稳定直接' },
  { id: 'diagonal', label: '对角线', hint: '沿对角线排布,增强动感' },
  { id: 'triangle', label: '三角构图', hint: '三点成三角,稳定又有变化' },
  { id: 'symmetry', label: '对称构图', hint: '左右/上下对称,庄重平衡' },
  { id: 'leading', label: '引导线', hint: '用线条把视线引向主体' },
  { id: 'negative', label: '留白', hint: '给主体留出呼吸的空间' },
]

export const compositionLabel = (id: ComposeId): string => COMPOSITIONS.find((c) => c.id === id)?.label ?? '构图'

/** 参考线(裁剪框内归一化 0..1) */
export function guideLines(id: ComposeId): GuideLine[] {
  const T = 1 / 3
  const G1 = 0.382
  const G2 = 0.618
  switch (id) {
    case 'thirds':
      return [
        { x1: T, y1: 0, x2: T, y2: 1 },
        { x1: 2 * T, y1: 0, x2: 2 * T, y2: 1 },
        { x1: 0, y1: T, x2: 1, y2: T },
        { x1: 0, y1: 2 * T, x2: 1, y2: 2 * T },
      ]
    case 'golden':
      return [
        { x1: G1, y1: 0, x2: G1, y2: 1 },
        { x1: G2, y1: 0, x2: G2, y2: 1 },
        { x1: 0, y1: G1, x2: 1, y2: G1 },
        { x1: 0, y1: G2, x2: 1, y2: G2 },
      ]
    case 'center':
      return [
        { x1: 0.5, y1: 0, x2: 0.5, y2: 1 },
        { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      ]
    case 'diagonal':
      return [
        { x1: 0, y1: 0, x2: 1, y2: 1 },
        { x1: 1, y1: 0, x2: 0, y2: 1 },
      ]
    case 'triangle':
      return [
        { x1: 0, y1: 1, x2: 1, y2: 0 },
        { x1: 0, y1: 0, x2: 1, y2: 1 },
        { x1: 0.5, y1: 0, x2: 0.5, y2: 1 },
      ]
    case 'symmetry':
      return [
        { x1: 0.5, y1: 0, x2: 0.5, y2: 1 },
        { x1: 0, y1: 0.5, x2: 1, y2: 0.5 },
      ]
    case 'leading':
      return [
        { x1: 0, y1: 1, x2: 0.5, y2: 0.38 },
        { x1: 1, y1: 1, x2: 0.5, y2: 0.38 },
        { x1: 0.5, y1: 0.38, x2: 0.5, y2: 1 },
      ]
    case 'negative':
    default:
      return []
  }
}

/** 构图关键点(裁剪框内归一化 0..1);用于吸附主体 */
export function guidePoints(id: ComposeId): Pt[] {
  const T = 1 / 3
  const G1 = 0.382
  const G2 = 0.618
  switch (id) {
    case 'thirds':
      return [
        { x: T, y: T },
        { x: 2 * T, y: T },
        { x: T, y: 2 * T },
        { x: 2 * T, y: 2 * T },
      ]
    case 'golden':
      return [
        { x: G1, y: G1 },
        { x: G2, y: G1 },
        { x: G1, y: G2 },
        { x: G2, y: G2 },
      ]
    case 'center':
      return [{ x: 0.5, y: 0.5 }]
    case 'diagonal':
      return [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.75 },
      ]
    case 'triangle':
      return [
        { x: 0.5, y: 0.2 },
        { x: 0.2, y: 0.8 },
        { x: 0.8, y: 0.8 },
      ]
    case 'symmetry':
      return [{ x: 0.5, y: 0.5 }]
    case 'leading':
      return [{ x: 0.5, y: 0.38 }]
    case 'negative':
      return [{ x: 0.35, y: 0.5 }]
    default:
      return [{ x: 0.5, y: 0.5 }]
  }
}
