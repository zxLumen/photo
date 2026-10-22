import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILTER_GROUPS, FILTER_IDS, FILTER_LIST, FILTERS, bakeLut, getFilter, sampleLut } from '../src/lib/filters.js'
import { normalizeIntent, pickFilter } from '../src/lib/intent.js'
import { KEYS, MOODS, SCENES } from '../src/types.js'
import type { ImageStats } from '../src/lib/imageStats.js'

const N = 17
const lutOf = (id: string) => bakeLut(getFilter(id), N)

/** 用来抽查的一组代表色:灰阶 + 三原色 + 肤色 + 天空 */
const COLORS: [number, number, number][] = [
  [0, 0, 0],
  [0.05, 0.05, 0.05],
  [0.18, 0.18, 0.18],
  [0.5, 0.5, 0.5],
  [0.82, 0.82, 0.82],
  [1, 1, 1],
  [0.85, 0.12, 0.1],
  [0.1, 0.7, 0.15],
  [0.1, 0.2, 0.85],
  [0.85, 0.65, 0.5],
  [0.45, 0.6, 0.75],
  [0.55, 0.35, 0.65],
]

test('滤镜目录:52 个、id 唯一、分组都存在', () => {
  assert.ok(FILTER_LIST.length >= 50, `滤镜数量应 >= 50,实际 ${FILTER_LIST.length}`)
  assert.equal(new Set(FILTER_IDS).size, FILTER_IDS.length, 'id 必须唯一')
  const groups = new Set(FILTER_GROUPS.map((g) => g.id))
  for (const f of FILTER_LIST) {
    assert.ok(groups.has(f.group), `${f.id} 的分组 ${f.group} 不在分组表里`)
    assert.ok(f.name.length > 0, `${f.id} 缺名字`)
  }
  // 除「原片」外,每个滤镜都必须有实际配方
  for (const f of FILTER_LIST) {
    if (f.id === 'none') continue
    assert.ok(f.ops.length > 0, `${f.id} 没有配方`)
  }
})

test('原片滤镜 = 严格恒等(误差 < 1/255)', () => {
  const lut = lutOf('none')
  for (const c of COLORS) {
    const out = sampleLut(lut, c)
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(out[i] - c[i]) <= 1 / 255, `原片把 ${c.join(',')} 改成了 ${out.map((v) => v.toFixed(3)).join(',')}`)
    }
  }
})

test('每个滤镜都真的改变画面(没有空配方)', () => {
  for (const f of FILTER_LIST) {
    if (f.id === 'none') continue
    const lut = lutOf(f.id)
    let max = 0
    for (const c of COLORS) {
      const out = sampleLut(lut, c)
      for (let i = 0; i < 3; i++) max = Math.max(max, Math.abs(out[i] - c[i]))
    }
    assert.ok(max > 3 / 255, `${f.id} 几乎没改颜色(最大差 ${(max * 255).toFixed(1)}/255)`)
  }
})

test('灰阶必须单调:滤镜不能把亮部压得比暗部还暗', () => {
  for (const f of FILTER_LIST) {
    const lut = lutOf(f.id)
    let prev = -1
    for (let i = 0; i <= 32; i++) {
      const v = i / 32
      const out = sampleLut(lut, [v, v, v])
      const l = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]
      assert.ok(l >= prev - 2 / 255, `${f.id} 在灰阶 ${v.toFixed(2)} 处反转过(前 ${prev.toFixed(3)} → 后 ${l.toFixed(3)})`)
      prev = l
    }
  }
})

test('LUT 采样是确定的,且与配方方向一致', () => {
  const sky: [number, number, number] = [0.45, 0.6, 0.75]
  const a = sampleLut(lutOf('sky'), sky)
  const b = sampleLut(lutOf('sky'), sky)
  assert.deepEqual(a, b)
  // 晴空:蓝天要更蓝(蓝-绿的差被拉开)
  assert.ok(a[2] - a[1] > sky[2] - sky[1], '晴空应让蓝色相对绿色更突出')
})

test('原片没有任何空间效果(恒等的另一半保证)', () => {
  const fx = getFilter('none').fx
  for (const [k, v] of Object.entries(fx)) assert.equal(v, 0, `原片的 ${k} 应为 0`)
})

test('空间效果都在 0..1,不会把画面炸掉', () => {
  for (const f of FILTER_LIST) {
    for (const [k, v] of Object.entries(f.fx)) {
      assert.ok(v >= 0 && v <= 1, `${f.id}.${k} = ${v} 越界`)
    }
  }
  // 潮流/复古那几个「有光」的滤镜必须真的带效果
  assert.ok(getFilter('ccd').fx.bloom > 0 && getFilter('ccd').fx.ca > 0, 'CCD 应有光晕与色散')
  assert.ok(getFilter('y2k').fx.leak > 0, '千禧应有漏光')
  assert.ok(getFilter('water').fx.bloom > 0, '水光应有光晕')
  assert.ok(getFilter('sky').fx.local > 0, '晴空应有 HDR 局部对比')
})

test('AI 选的滤镜 id 必须真实存在,不存在就作废', () => {
  const ok = normalizeIntent({ filter: 'film', filterAmount: 80 })
  assert.equal(ok.filter, 'film')
  assert.equal(ok.filterAmount, 80)

  const bad = normalizeIntent({ filter: 'super-cool-filter', filterAmount: 80 })
  assert.equal(bad.filter, 'none', '编造的 id 应被丢弃')
})

test('滤镜强度会被夹到合法区间', () => {
  assert.equal(normalizeIntent({ filter: 'bw', filterAmount: 999 }).filterAmount, 100)
  assert.equal(normalizeIntent({ filter: 'bw', filterAmount: -20 }).filterAmount, 0)
  assert.equal(normalizeIntent({ filter: 'bw' }).filterAmount, 100)
})

test('文档类照片不加滤镜', () => {
  const p = pickFilter(normalizeIntent({ scene: 'document', filter: 'velvia' }))
  assert.equal(p.id, 'none')
  assert.equal(p.source, 'none')
})

test('模型的选择被采纳(并带上理由)', () => {
  const p = pickFilter(normalizeIntent({ scene: 'landscape', filter: 'sky', filterAmount: 85, filterWhy: '天空很蓝' }))
  assert.equal(p.id, 'sky')
  assert.equal(p.source, 'ai')
  assert.equal(p.amount, 85)
  assert.equal(p.why, '天空很蓝')
})

test('护栏:低调照片不套高调滤镜', () => {
  const p = pickFilter(normalizeIntent({ scene: 'city', key: 'low', filter: 'oxygen', filterAmount: 90 }))
  assert.notEqual(p.id, 'oxygen')
  assert.equal(p.source, 'auto', '被护栏拦下后应转为按题材兜底')
})

test('护栏:有肤色时不套强偏色滤镜', () => {
  const p = pickFilter(normalizeIntent({ scene: 'portrait', skin: true, filter: 'cyber', filterAmount: 90 }))
  assert.notEqual(p.id, 'cyber')
  assert.ok(['creamskin', 'peach', 'coldwhite', 'oxygen', 'film', 'bwcontrast'].includes(p.id), `应回落到人像类滤镜,实际 ${p.id}`)
})

test('护栏:噪点重时颗粒类滤镜自动降强度', () => {
  const stats = { noise: 0.6 } as unknown as ImageStats
  const p = pickFilter(normalizeIntent({ scene: 'street', filter: 'ccd', filterAmount: 100 }), stats)
  assert.ok(p.amount <= 60, `颗粒滤镜在噪点图上应压到 60 以内,实际 ${p.amount}`)
})

test('兜底:任何题材×情绪×基调组合都能选出合法滤镜', () => {
  let n = 0
  for (const scene of SCENES) {
    for (const mood of MOODS) {
      for (const key of KEYS) {
        const p = pickFilter(normalizeIntent({ scene, mood, key }))
        assert.ok(FILTER_IDS.includes(p.id), `${scene}/${mood}/${key} 选出了不存在的滤镜 ${p.id}`)
        if (p.id === 'none') assert.equal(p.amount, 0)
        else assert.ok(p.amount >= 40 && p.amount <= 100, `${scene}/${mood}/${key} 强度越界:${p.amount}`)
        assert.ok(p.why.length > 0, `${scene}/${mood}/${key} 缺少理由文案`)
        n++
      }
    }
  }
  assert.equal(n, SCENES.length * MOODS.length * KEYS.length)
})

test('兜底会区分题材:人像与美食不会选到同一个滤镜', () => {
  const portrait = pickFilter(normalizeIntent({ scene: 'portrait', mood: 'natural' }))
  const food = pickFilter(normalizeIntent({ scene: 'food', mood: 'natural' }))
  const night = pickFilter(normalizeIntent({ scene: 'night', mood: 'natural' }))
  assert.notEqual(portrait.id, food.id)
  assert.notEqual(food.id, night.id)
})

test('注册表里没有的 id 会安全回落到原片', () => {
  assert.equal(getFilter('nope').id, 'none')
  assert.equal(FILTERS.none.id, 'none')
})

test('护栏:明明选了「通透」但情绪是胶片/浓郁,就按情绪换个更有性格的', () => {
  const filmic = pickFilter(normalizeIntent({ scene: 'street', mood: 'filmic', filter: 'clear' }))
  assert.notEqual(filmic.id, 'clear', '胶片情绪的街拍不该只剩清晰')
  const vivid = pickFilter(normalizeIntent({ scene: 'landscape', mood: 'vivid', filter: 'clear' }))
  assert.notEqual(vivid.id, 'clear')
  // 中性画面仍然可以用通透
  const neutral = pickFilter(normalizeIntent({ scene: 'other', mood: 'natural', filter: 'clear' }))
  assert.equal(neutral.id, 'clear')
})
