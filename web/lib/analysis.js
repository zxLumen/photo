import { completeChat } from './llm.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 支持的构图法 id(前端展示名称与参考线在 `web/src/lib/compose.ts`) */
export const COMPOSITIONS = ['thirds', 'golden', 'center', 'diagonal', 'triangle', 'symmetry', 'leading', 'negative']

/**
 * 滤镜目录与前端**共用同一份 JSON**(`src/lib/filters.json`),
 * 提示词、校验、前端配方因此不会各写一套而漂移。
 *
 * 读不到时**不拖垮服务**:退化成一空目录(模型没法挑滤镜),
 * 客户端仍会按题材兜底选一个,功能只是少一点「AI 定制」。
 */
let FILTER_CATALOG = { groups: [], items: [] }
try {
  FILTER_CATALOG = JSON.parse(readFileSync(fileURLToPath(new URL('../src/lib/filters.json', import.meta.url)), 'utf8'))
} catch (e) {
  console.error('[photo] 滤镜目录读取失败,自动修图将退回「按题材兜底」:', e.message)
}
export const FILTER_IDS = FILTER_CATALOG.items.map((i) => i.id)
const FILTER_LINES = FILTER_CATALOG.groups
  .map((g) => {
    const items = FILTER_CATALOG.items.filter((i) => i.group === g.id)
    return `  - ${g.label}: ` + items.map((i) => `${i.id}(${i.name})`).join('、')
  })
  .join('\n')

/**
 * 语义意图枚举(服务端只做轻量清洗,严格归一化在客户端 `src/lib/intent.ts`)。
 * 注意:模型**不再**输出修图数值 —— 数值由客户端按像素实测推导。
 */
export const INTENT_ENUMS = {
  scene: ['portrait', 'landscape', 'night', 'street', 'food', 'architecture', 'macro', 'document', 'other'],
  key: ['low', 'normal', 'high'],
  mood: ['vivid', 'natural', 'muted', 'filmic', 'clean', 'dramatic'],
  noise: ['none', 'light', 'heavy'],
  protect: ['dark-mood', 'warm-sunset', 'silhouette', 'high-key-bright', 'vintage'],
}

export const DEFAULT_INTENT = {
  scene: 'other',
  key: 'normal',
  mood: 'natural',
  skin: false,
  noise: 'none',
  protect: [],
  brightness: 0,
  punch: 0,
  warmth: 0,
  filter: 'none',
  filterAmount: 100,
  filterWhy: '',
  styleHint: '',
}

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
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

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
        '请严格按下面 JSON 结构输出(键名固定):',
        '{',
        '  "composition": "thirds | golden | center | diagonal | triangle | symmetry | leading | negative",',
        '  "crop": { "x": 0~1, "y": 0~1, "w": 0~1, "h": 0~1 },',
        '  "subjects": [ { "x": 0~1, "y": 0~1, "label": "人眼/主体/地平线" } ],',
        '  "intent": {',
        '    "scene": "portrait | landscape | night | street | food | architecture | macro | document | other",',
        '    "key": "low | normal | high",          // 明暗基调:低调(整体偏暗、氛围为主)/ 中性 / 高调(整体明亮)',
        '    "mood": "vivid | natural | muted | filmic | clean | dramatic",  // 想要的后期气质',
        '    "skin": true/false,                    // 画面里有没有需要保护的肤色(人像/手持人物)',
        '    "noise": "none | light | heavy",       // 高感噪点程度',
        '    "protect": ["dark-mood","warm-sunset","silhouette","high-key-bright","vintage"],  // 必须保留的作者意图,可空',
        '    "brightness": -1 | 0 | 1,              // 你的观感:整幅应更暗 / 不用动 / 更亮',
        '    "punch": -1 | 0 | 1,                   // 应更平(柔)/ 不用动 / 更通透',
        '    "warmth": -1 | 0 | 1,                  // 应更冷 / 不用动 / 更暖',
        '    "filter": { "id": "<下方清单里的 id>", "amount": 40~100, "why": "一句话说明为什么选它" },',
        '    "styleHint": "可选,一句话的风格建议(如 风景 / 黑白 / 胶片)"',
        '  },',
        '  "reason": "一句话说明为什么这样裁、这样定调(中文)"',
        '}',
        '要点:',
        '1) crop 要让主体落在所选构图法的关键点/线上(三分交点、黄金交点、中心、对角线等);',
        '2) 裁剪后不要把主体切掉,保留自然的留白与视线空间;',
        '3) **不要输出任何修图数值**(曝光/对比/饱和度等一律不要),**也不要估角度/旋转**;',
        '   数值与摆正角都由客户端按像素实测计算,你只负责判断「这是什么画面、该往哪个方向走、哪些意图不能破坏」。',
        '   所以请把注意力放在 scene / key / mood / skin / noise / protect 与三个方向判断上,判断要具体、不要套话。',
        '4) 只输出 JSON。',
        '',
        '滤镜清单(id 必须严格照抄,不要自创;按组列出):',
        FILTER_LINES,
        '选滤镜的要点:',
        '1) 先看「这是什么画面、什么情绪、什么明暗」,选气质最贴的一个;不要默认选 clean,也不要每张都选胶片;',
        '2) 画面里有明显人物肤色时,避开青橙(tealorange)、赛博(cyber)、黑金(blackgold)这类强偏色;',
        '3) 低调/夜景不要选空气感(airy)、白墙(whitewall)这类高调滤镜;',
        '4) 纪实、文档、证件、图表类照片用 none;拿不准也用 none;',
        '5) amount 表示强度:强风格 70~90,克制的 40~60;不确定就 70;',
        '6) clean(通透)只留给「本身已经干净、没有明显气质」的画面;照片有明确气质(夜市/街头/胶片感/秋景/人像/食物)时,优先选更有性格的,别一瓶 clean 走天下;',
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

  // 模型只给语义意图;这里做轻量清洗(枚举值的严格归一化在客户端 intent.ts)
  const ri = r.intent && typeof r.intent === 'object' ? r.intent : {}
  const pickEnum = (v, list, def) => (typeof v === 'string' && list.includes(v) ? v : def)
  // 滤镜:只接受目录里的 id(模型自创的一律作废,由客户端按题材兜底)
  const rf = ri.filter && typeof ri.filter === 'object' ? ri.filter : {}
  const intent = {
    scene: pickEnum(ri.scene, INTENT_ENUMS.scene, DEFAULT_INTENT.scene),
    key: pickEnum(ri.key, INTENT_ENUMS.key, DEFAULT_INTENT.key),
    mood: pickEnum(ri.mood, INTENT_ENUMS.mood, DEFAULT_INTENT.mood),
    skin: ri.skin === true,
    noise: pickEnum(ri.noise, INTENT_ENUMS.noise, DEFAULT_INTENT.noise),
    protect: Array.isArray(ri.protect)
      ? Array.from(new Set(ri.protect.filter((p) => typeof p === 'string' && INTENT_ENUMS.protect.includes(p)))).slice(0, 5)
      : [],
    brightness: clamp(Math.round(num(ri.brightness, 0)), -1, 1),
    punch: clamp(Math.round(num(ri.punch, 0)), -1, 1),
    warmth: clamp(Math.round(num(ri.warmth, 0)), -1, 1),
    filter: typeof rf.id === 'string' && FILTER_IDS.includes(rf.id) ? rf.id : 'none',
    filterAmount: Math.round(clamp(num(rf.amount, 100), 0, 100)),
    filterWhy: str(rf.why, 60),
    styleHint: str(ri.styleHint, 20),
  }

  const reason = typeof r.reason === 'string' ? r.reason.slice(0, 300) : ''

  return {
    composition,
    crop: { x, y, w, h },
    rotate: clamp(num(r.rotate, 0), -15, 15),
    subjects,
    horizon,
    intent,
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
