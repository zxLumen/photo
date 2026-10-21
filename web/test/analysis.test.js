import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnalysis, extractJson, buildMessages, INTENT_ENUMS, DEFAULT_INTENT } from '../lib/analysis.js'

test('extractJson 解析裸 JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
})

test('extractJson 解析 ```json 包裹', () => {
  const t = '这里是结果:\n```json\n{"composition":"golden","crop":{"x":0,"y":0,"w":1,"h":1}}\n```\n完毕'
  assert.equal(extractJson(t).composition, 'golden')
})

test('extractJson 容忍前后杂文本与字符串内括号', () => {
  const t = '说明 {不是json} 然后 {"reason":"含 } 的说明","rotate":2} 结尾'
  assert.equal(extractJson(t).rotate, 2)
})

test('extractJson 无法解析时返回 null', () => {
  assert.equal(extractJson('没有对象'), null)
  assert.equal(extractJson('{坏'), null)
})

test('normalizeAnalysis 补默认值', () => {
  const a = normalizeAnalysis({})
  assert.equal(a.composition, 'thirds')
  assert.equal(a.crop.w, 1)
  assert.equal(a.rotate, 0)
  assert.deepEqual(a.subjects, [])
  assert.equal(a.horizon, null)
  // 模型只给语义意图,不再给修图数值
  assert.equal(a.tone, undefined)
  assert.deepEqual(a.intent, DEFAULT_INTENT)
})

test('normalizeAnalysis 夹紧越界值与非法枚举', () => {
  const a = normalizeAnalysis({
    composition: 'nope',
    crop: { x: 0.9, y: -1, w: 0.5, h: 2 },
    rotate: 99,
    intent: {
      scene: 'xxx',
      key: 'nope',
      mood: 'nope',
      noise: 'nope',
      brightness: 9,
      punch: -9,
      warmth: 0.2,
      protect: ['dark-mood', 'dark-mood', 'not-a-tag', 123],
      styleHint: 'x'.repeat(100),
    },
  })
  assert.equal(a.composition, 'thirds')
  // x + w 不得越界
  assert.ok(a.crop.x + a.crop.w <= 1.0000001)
  assert.ok(a.crop.y >= 0 && a.crop.h <= 1)
  assert.equal(a.crop.h, 1)
  assert.equal(a.rotate, 15)
  // 非法枚举回落默认
  assert.equal(a.intent.scene, 'other')
  assert.equal(a.intent.key, 'normal')
  assert.equal(a.intent.mood, 'natural')
  assert.equal(a.intent.noise, 'none')
  // 方向值夹到 -1..1
  assert.equal(a.intent.brightness, 1)
  assert.equal(a.intent.punch, -1)
  assert.equal(a.intent.warmth, 0)
  // protect 去重 + 过滤未知标签
  assert.deepEqual(a.intent.protect, ['dark-mood'])
  assert.equal(a.intent.styleHint.length, 20)
})

test('normalizeAnalysis 接受合法值', () => {
  const a = normalizeAnalysis({
    composition: 'golden',
    crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    rotate: -3,
    subjects: [{ x: 0.3, y: 0.4, label: '人眼' }],
    horizon: { angle: -3, y: 0.6 },
    intent: {
      scene: 'portrait',
      key: 'low',
      mood: 'clean',
      skin: true,
      noise: 'light',
      protect: ['warm-sunset'],
      brightness: 1,
      punch: -1,
      warmth: 0,
      filter: { id: 'portra400', amount: 85, why: '肤色柔和' },
      styleHint: '人像',
    },
    reason: '理由',
  })
  assert.equal(a.composition, 'golden')
  assert.equal(a.crop.w, 0.8)
  assert.equal(a.rotate, -3)
  assert.equal(a.subjects[0].label, '人眼')
  assert.equal(a.horizon.angle, -3)
  assert.deepEqual(a.intent, {
    scene: 'portrait',
    key: 'low',
    mood: 'clean',
    skin: true,
    noise: 'light',
    protect: ['warm-sunset'],
    brightness: 1,
    punch: -1,
    warmth: 0,
    filter: 'portra400',
    filterAmount: 85,
    filterWhy: '肤色柔和',
    styleHint: '人像',
  })
  assert.equal(a.reason, '理由')
})

test('意图枚举与前端保持一致的形状(至少非空且唯一)', () => {
  for (const [k, list] of Object.entries(INTENT_ENUMS)) {
    assert.ok(Array.isArray(list) && list.length > 0, `${k} 不能为空`)
    assert.equal(new Set(list).size, list.length, `${k} 不能有重复`)
  }
  assert.ok(INTENT_ENUMS.protect.includes('dark-mood'))
  assert.equal(INTENT_ENUMS.key.includes('normal'), true)
})

test('滤镜:只接受目录里的 id,自创的作废为 none', () => {
  const ok = normalizeAnalysis({ intent: { filter: { id: 'tealorange', amount: 70, why: '夜景' } } })
  assert.equal(ok.intent.filter, 'tealorange')
  assert.equal(ok.intent.filterAmount, 70)
  assert.equal(ok.intent.filterWhy, '夜景')

  const bad = normalizeAnalysis({ intent: { filter: { id: 'not-a-filter', amount: 70 } } })
  assert.equal(bad.intent.filter, 'none', '不存在的 id 不能被透传')
  assert.equal(bad.intent.filterWhy, '')

  // 兼容模型把 filter 直接写成字符串的老格式
  const str = normalizeAnalysis({ intent: { filter: 'bw' } })
  assert.equal(str.intent.filter, 'none', '非对象格式一律作废,交给客户端兜底')
})

test('滤镜:强度夹到 0..100,缺省 100', () => {
  assert.equal(normalizeAnalysis({ intent: { filter: { id: 'bw', amount: 999 } } }).intent.filterAmount, 100)
  assert.equal(normalizeAnalysis({ intent: { filter: { id: 'bw', amount: -5 } } }).intent.filterAmount, 0)
  assert.equal(normalizeAnalysis({ intent: { filter: { id: 'bw' } } }).intent.filterAmount, 100)
})

test('提示词里带上了完整滤镜清单(模型才知道有哪些可选)', () => {
  const msgs = buildMessages({ width: 800, height: 600 })
  const text = msgs[1].content[0].text
  assert.ok(text.includes('滤镜清单'), '提示词应有滤镜清单')
  for (const id of ['portra400', 'tealorange', 'bwselenium', 'creamskin', 'none']) {
    assert.ok(text.includes(`${id}(`), `清单里缺少 ${id}`)
  }
  assert.ok(text.includes('"filter"'), 'JSON 结构里应有 filter 字段')
})
