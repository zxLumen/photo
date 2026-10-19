import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyIntent, normalizeIntent } from '../src/lib/intent.js'
import { applyLook, deriveAutoTone, emptyTone, TONE_KEYS } from '../src/lib/autoTone.js'
import { computeImageStats, estimateNoise } from '../src/lib/imageStats.js'
import type { ToneParams } from '../src/types.js'

const W = 64
const H = 64

type Pixel = [number, number, number]

function makeImage(fn: (x: number, y: number) => Pixel): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * W + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return data
}

/** 确定性伪随机(避免测试不稳定) */
function rnd(seed: number): number {
  const v = Math.sin(seed * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

const stats = (data: Uint8ClampedArray) => computeImageStats(data, W, H)
const dist = (a: ToneParams, b: ToneParams) =>
  TONE_KEYS.reduce((s, k) => s + Math.abs(a[k] - b[k]), 0)

// 暗而平:整体 0.23 左右,几乎没有纹理
const darkFlat = makeImage(() => [58, 60, 62])
// 明亮且大量溢出
const brightClip: Uint8ClampedArray = makeImage((x, y) => (x + y) % 3 === 0 ? [255, 255, 255] : [210, 214, 218])
// 高饱和:已经「很艳」,不该再加自然饱和度
const colorful = makeImage((x, y) => (x % 2 ? [230, 30, 30] : [20, 40, 220]))
// 灰雾:中间调窄幅、无纯黑
const hazy = makeImage((x, y) => {
  const v = 140 + ((x + y) % 8) * 2
  return [v, v, v]
})
// 干净平滑渐变
const smooth = makeImage((x, y) => {
  const v = Math.round(20 + (x / W) * 210)
  return [v, v, v]
})
// 暗部高感噪点
const noisy = makeImage((x, y) => {
  const base = 46
  const n = Math.round((rnd(x * 7 + y * 13) - 0.5) * 90)
  const v = Math.max(0, Math.min(255, base + n))
  return [v, v, v]
})

test('暗而平的图:提曝光、补对比、提阴影', () => {
  const t = deriveAutoTone(stats(darkFlat))
  assert.ok(t.exposure > 0, `exposure 应 > 0,实际 ${t.exposure}`)
  assert.ok(t.contrast > 0, `contrast 应 > 0,实际 ${t.contrast}`)
  assert.ok(t.shadows >= 0, `shadows 应 >= 0,实际 ${t.shadows}`)
})

test('高光溢出:高光回收为负、白场不再硬提', () => {
  const s = stats(brightClip)
  assert.ok(s.clipHigh > 0.1, `clipHigh 应明显,实际 ${s.clipHigh}`)
  const t = deriveAutoTone(s)
  assert.ok(t.highlights < 0, `highlights 应 < 0,实际 ${t.highlights}`)
  assert.equal(t.whites, 0, '已大面积溢出时不应再提白场')
})

test('已经很艳的图:不加自然饱和度', () => {
  const t = deriveAutoTone(stats(colorful))
  assert.equal(t.vibrance, 0, `vibrance 应为 0,实际 ${t.vibrance}`)
})

test('灰雾图:补对比与清晰度', () => {
  const t = deriveAutoTone(stats(hazy))
  assert.ok(t.contrast > 10, `contrast 应明显 > 10,实际 ${t.contrast}`)
  assert.ok(t.clarity > 0, `clarity 应 > 0,实际 ${t.clarity}`)
})

test('噪点图:锐化明显低于干净图,并强制降噪', () => {
  const cleanNoise = estimateNoise(smooth, W, H)
  const dirtyNoise = estimateNoise(noisy, W, H)
  assert.ok(dirtyNoise > cleanNoise, `噪点估计应更高:clean=${cleanNoise} noisy=${dirtyNoise}`)

  const sc = stats(smooth)
  const sn = stats(noisy)
  sc.noise = cleanNoise
  sn.noise = dirtyNoise
  const tc = deriveAutoTone(sc)
  const tn = deriveAutoTone(sn)
  assert.ok(tn.sharpen < tc.sharpen, `噪点图锐化应更低:${tn.sharpen} vs ${tc.sharpen}`)
  assert.ok(tn.denoise > 0, `噪点图应有降噪,实际 ${tn.denoise}`)
})

test('核心回归:不同照片必须算出明显不同的参数', () => {
  const a = deriveAutoTone(stats(darkFlat))
  const b = deriveAutoTone(stats(brightClip))
  const c = deriveAutoTone(stats(colorful))
  const d = deriveAutoTone(stats(hazy))
  for (const [name, x, y] of [
    ['dark vs bright', a, b],
    ['dark vs colorful', a, c],
    ['bright vs hazy', b, d],
    ['colorful vs hazy', c, d],
  ] as const) {
    assert.ok(dist(x, y) > 25, `${name} 的参数距离应 > 25,实际 ${dist(x, y)}`)
  }
})

test('同一张图重复计算完全一致(确定性)', () => {
  const s = stats(colorful)
  assert.deepEqual(deriveAutoTone(s), deriveAutoTone(s))
})

test('意图护栏:护肤色时压清晰度/锐化,噪点重时强降噪', () => {
  const base = deriveAutoTone(stats(darkFlat))
  const skin = applyIntent(base, normalizeIntent({ scene: 'portrait', skin: true, mood: 'natural' }))
  assert.ok(skin.clarity <= 6, `clarity 应 <= 6,实际 ${skin.clarity}`)
  assert.ok(skin.sharpen <= 12, `sharpen 应 <= 12,实际 ${skin.sharpen}`)

  const heavy = applyIntent(base, normalizeIntent({ noise: 'heavy' }))
  assert.ok(heavy.denoise >= 20, `denoise 应 >= 20,实际 ${heavy.denoise}`)
  assert.ok(heavy.sharpen <= base.sharpen, '噪点重时锐化不应增加')
})

test('意图护栏:保留暗调氛围时不强提曝光', () => {
  const base = deriveAutoTone(stats(darkFlat))
  const t = applyIntent(base, normalizeIntent({ key: 'low', protect: ['dark-mood'], brightness: 1 }))
  assert.ok(t.exposure <= 24, `exposure 应 <= 24,实际 ${t.exposure}`)
  // 但也不能把「欠曝」完全按住不动
  assert.ok(t.exposure > 0, `仍应保留一定提亮,实际 ${t.exposure}`)
})

test('意图是定向微调,不是覆盖实测(同一意图用在两张图上结果不同)', () => {
  const intent = normalizeIntent({ mood: 'vivid', punch: 1 })
  const a = applyIntent(deriveAutoTone(stats(darkFlat)), intent)
  const b = applyIntent(deriveAutoTone(stats(brightClip)), intent)
  assert.ok(dist(a, b) > 25, `同一意图下仍应明显不同,实际距离 ${dist(a, b)}`)
})

test('风格层是叠加,不改动基座', () => {
  const base = deriveAutoTone(stats(darkFlat))
  const snapshot = { ...base }
  const looked = applyLook(base, 'landscape')
  assert.deepEqual(base, snapshot, '基座不应被修改')
  assert.ok(looked.contrast > base.contrast, '风景 look 应提高对比')
  assert.ok(looked.clarity > base.clarity, '风景 look 应提高清晰度')
  // 取消 look 就是回到基座
  assert.deepEqual(applyLook(base, 'none'), base)
})

test('风格层受滑块上下限约束', () => {
  const base = { ...emptyTone(), saturation: -95 }
  const mono = applyLook(base, 'mono')
  assert.equal(mono.saturation, -100, '黑白 look 应把饱和度压到 -100 且不越界')
})
