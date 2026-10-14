import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAnalysis, extractJson, TONE_KEYS, DEFAULT_TONE } from '../lib/analysis.js'

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
  assert.equal(a.style, 'none')
  for (const k of TONE_KEYS) assert.equal(typeof a.tone[k], 'number')
  assert.deepEqual(Object.keys(a.tone).sort(), Object.keys(DEFAULT_TONE).sort())
})

test('normalizeAnalysis 夹紧越界值与非法枚举', () => {
  const a = normalizeAnalysis({
    composition: 'nope',
    crop: { x: 0.9, y: -1, w: 0.5, h: 2 },
    rotate: 99,
    style: 'xxx',
    tone: { exposure: 9999, sharpen: -50, vibrance: -300 },
  })
  assert.equal(a.composition, 'thirds')
  assert.equal(a.style, 'none')
  // x + w 不得越界
  assert.ok(a.crop.x + a.crop.w <= 1.0000001)
  assert.ok(a.crop.y >= 0 && a.crop.h <= 1)
  assert.equal(a.crop.h, 1)
  assert.equal(a.rotate, 15)
  assert.equal(a.tone.exposure, 100)
  assert.equal(a.tone.sharpen, 0) // sharpen 下限 0
  assert.equal(a.tone.vibrance, -100)
})

test('normalizeAnalysis 接受合法值', () => {
  const a = normalizeAnalysis({
    composition: 'golden',
    crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    rotate: -3,
    subjects: [{ x: 0.3, y: 0.4, label: '人眼' }],
    horizon: { angle: -3, y: 0.6 },
    tone: { exposure: 10 },
    style: 'portrait',
    reason: '理由',
  })
  assert.equal(a.composition, 'golden')
  assert.equal(a.crop.w, 0.8)
  assert.equal(a.rotate, -3)
  assert.equal(a.subjects[0].label, '人眼')
  assert.equal(a.horizon.angle, -3)
  assert.equal(a.tone.exposure, 10)
  assert.equal(a.style, 'portrait')
  assert.equal(a.reason, '理由')
})
