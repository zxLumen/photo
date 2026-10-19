import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnalysis, extractJson, INTENT_ENUMS, DEFAULT_INTENT } from '../lib/analysis.js'

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
