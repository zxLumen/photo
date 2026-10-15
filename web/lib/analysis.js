import { completeChat } from './llm.js'

/** 支持的构图法 id(前端展示名称与参考线在 `web/src/lib/compose.ts`) */
export const COMPOSITIONS = ['thirds', 'golden', 'center', 'diagonal', 'triangle', 'symmetry', 'leading', 'negative']

/** 风格预设 id */
export const STYLES = ['none', 'portrait', 'landscape', 'night', 'mono', 'film', 'vivid']

/** 修图参数键 + 取值范围(前端滑块一致) */
export const TONE_KEYS = [
  'exposure',
  'contrast',
  'highlights',
  'shadows',
  'whites',
  'blacks',
  'temperature',
  'tint',
  'vibrance',
  'saturation',
  'clarity',
  'sharpen',
  'denoise',
  'vignette',
]

export const DEFAULT_TONE = Object.fromEntries(TONE_KEYS.map((k) => [k, 0]))
export const DEFAULT_CROP = { x: 0, y: 0, w: 1, h: 1 }

const clamp = (n, min, max) => Math.min(max, Math.max(min, n))
const num = (v, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** 提示词:要求模型只回一个 JSON 对象,坐标全部归一化到 0..1。 */
export function buildMessages({ width, height }) {
  const sys =
    '你是一位资深摄影构图与后期专家。分析给定照片,给出**最佳构图裁剪**与**自动修图参数**。' +
    '只输出一个 JSON 对象,不要任何解释、不要 markdown 代码块、不要多余文字。'

  const user = [
    {
      type: 'text',
      text: [
        `原图尺寸 ${width}×${height}。坐标一律用归一化 0..1(左上为原点),相对原图。`,
        '请严格按下面 JSON 结构输出(键名固定,数值为数字):',
        '{',
        '  "composition": "thirds | golden | center | diagonal | triangle | symmetry | leading | negative",',
        '  "crop": { "x": 0~1, "y": 0~1, "w": 0~1, "h": 0~1 },',
        '  "rotate": -15~15,            // 拉直角度,地平线倾斜才非 0',
        '  "subjects": [ { "x": 0~1, "y": 0~1, "label": "人眼/主体/地平线" } ],',
        '  "horizon": { "angle": -15~15, "y": 0~1 } 或 null,',
        '  "tone": { "exposure": -100~100, "contrast": -100~100, "highlights": -100~100, "shadows": -100~100,',
        '            "whites": -100~100, "blacks": -100~100, "temperature": -100~100, "tint": -100~100,',
        '            "vibrance": -100~100, "saturation": -100~100, "clarity": -100~100, "sharpen": 0~100,',
        '            "denoise": 0~100, "vignette": -100~100 },',
        '  "style": "none | portrait | landscape | night | mono | film | vivid",',
        '  "reason": "一句话说明为什么这样裁与这样调(中文)"',
        '}',
        '要点:',
        '1) crop 要让主体落在所选构图法的关键点/线上(三分交点、黄金交点、中心、对角线等);',
        '2) 裁剪后不要把主体切掉,保留自然的留白与视线空间;',
        '3) rotate 是「智能摆正」:先判断地平线/海平线、建筑竖直线是否倾斜 —— 只要肉眼看得出歪就给去倾斜角',
        '   (画面逆时针需顺时针回正时为正、反之为负),幅度常见 0.3~8°;横平竖直都正才给 0;',
        '   horizon 用来标注你依据的那条线(angle 同 rotate 的符号约定,y 为它在画面中的归一化高度);',
        '   没有可靠参考线时 horizon 给 null。crop 坐标一律基于**摆正后**的画面;',
        '4) tone 是与界面滑块同刻度的「自动修图参数」(-100~100;sharpen/denoise 为 0~100)。参考量级:',
        '   曝光 ±40 ≈ ±0.6EV;对比度 +15 已有明显反差;阴影 +25 能救回暗部;高光 -20 能压住过曝;',
        '   自然饱和度 +20 明显提色;清晰度 +15 通透感明显。请给**看得出差别**的值,不要过分保守;',
        '   但画面本来就很到位时对应键给 0,不要硬凑;5) 只输出 JSON。',
      ].join('\n'),
    },
    { type: 'image_url', image_url: { url: 'PLACEHOLDER' } },
  ]

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]
}

/** 从某个 `{` 开始做括号配平并尝试解析;失败返回 undefined(忽略字符串内的括号)。 */
function parseBalancedAt(body, start) {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < body.length; i++) {
    const c = body[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

/**
 * 从模型输出里抠出第一个**可解析**的 JSON 对象。
 * 容忍 ```json 包裹、前后杂文本,以及正文里出现更早的无效 `{}` 片段。
 */
export function extractJson(text) {
  const t = String(text ?? '').trim()
  if (!t) return null
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : t
  for (let start = body.indexOf('{'); start >= 0; start = body.indexOf('{', start + 1)) {
    const parsed = parseBalancedAt(body, start)
    if (parsed !== undefined) return parsed
  }
  return null
}

/** 校验并收敛模型输出(缺字段补默认、越界夹紧)。 */
export function normalizeAnalysis(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const composition = COMPOSITIONS.includes(r.composition) ? r.composition : 'thirds'

  const c = r.crop && typeof r.crop === 'object' ? r.crop : {}
  let x = clamp(num(c.x, 0), 0, 1)
  let y = clamp(num(c.y, 0), 0, 1)
  let w = clamp(num(c.w, 1), 0.05, 1)
  let h = clamp(num(c.h, 1), 0.05, 1)
  if (x + w > 1) x = 1 - w
  if (y + h > 1) y = 1 - h
  x = clamp(x, 0, 1 - w)
  y = clamp(y, 0, 1 - h)

  const subjects = Array.isArray(r.subjects)
    ? r.subjects
        .slice(0, 8)
        .map((s) => ({
          x: clamp(num(s?.x, 0.5), 0, 1),
          y: clamp(num(s?.y, 0.5), 0, 1),
          label: typeof s?.label === 'string' ? s.label.slice(0, 24) : '主体',
        }))
        .filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y))
    : []

  const horizon =
    r.horizon && typeof r.horizon === 'object'
      ? { angle: clamp(num(r.horizon.angle, 0), -45, 45), y: clamp(num(r.horizon.y, 0.5), 0, 1) }
      : null

  const toneRaw = r.tone && typeof r.tone === 'object' ? r.tone : {}
  const tone = {}
  for (const k of TONE_KEYS) {
    const isSharpenLike = k === 'sharpen' || k === 'denoise'
    const def = isSharpenLike ? 0 : 0
    tone[k] = clamp(num(toneRaw[k], def), isSharpenLike ? 0 : -100, 100)
  }

  const style = STYLES.includes(r.style) ? r.style : 'none'
  const reason = typeof r.reason === 'string' ? r.reason.slice(0, 300) : ''

  return {
    composition,
    crop: { x, y, w, h },
    rotate: clamp(num(r.rotate, 0), -15, 15),
    subjects,
    horizon,
    tone,
    style,
    reason,
  }
}

/**
 * 调视觉模型分析一张图。dataUrl 需是 `data:image/...;base64,...`。
 * 返回 { analysis, usage }。
 */
export async function analyzeImage(cfg, { dataUrl, width, height, signal }) {
  if (!cfg.apiKey) {
    const err = new Error('未配置视觉模型令牌')
    err.status = 503
    throw err
  }
  const messages = buildMessages({ width, height })
  // 把占位替换成真正的图片(避免模板字符串里塞超长 base64 影响可读性)
  const parts = messages[1].content
  parts[parts.length - 1] = { type: 'image_url', image_url: { url: dataUrl } }

  const res = await completeChat(cfg, { messages, maxTokens: cfg.maxTokens || 4096, temperature: cfg.temperature ?? 0.4, noThinking: true, sessionId: 'photo', signal })
  const json = extractJson(res.text)
  if (!json) {
    const err = new Error('模型未返回可解析的 JSON')
    err.status = 502
    throw err
  }
  return {
    analysis: normalizeAnalysis(json),
    usage: { inTokens: res.inTokens, outTokens: res.outTokens },
  }
}
