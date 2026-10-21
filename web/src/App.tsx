import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnalysisResult, ComposeId, CropRect, EditParams, FilterPick, PresetItem, SessionItem, StatusInfo, Subject, ToneParams } from './types.js'
import { api } from './api.js'
import { COMPOSITIONS, compositionLabel } from './lib/compose.js'
import { mergeTone, emptyTone, EV_SCALE } from './lib/autoTone.js'
import { applyIntent, describeIntent, normalizeIntent, pickFilter } from './lib/intent.js'
import { FILTERS } from './lib/filters.js'
import { describeStats, type ImageStats } from './lib/imageStats.js'
import { downscaleDataURL, loadImage, loadImageFile, sampleAutoTone } from './lib/imageOps.js'
import { reportAiStatus, type AiState } from './embed.js'
import { readState, writeState } from './sessionState.js'
import { CropStage } from './components/CropStage.js'
import { CompareView } from './components/CompareView.js'
import { AdjustPanel } from './components/AdjustPanel.js'
import { WorksPanel } from './components/WorksPanel.js'
import { SettingsPanel, type SettingsData as SettingsDataT } from './components/SettingsPanel.js'
import { ExportDialog } from './components/ExportDialog.js'
import { Uploader } from './components/Uploader.js'
import { SampleGallery } from './components/SampleGallery.js'
import { detectColorSupport } from './lib/colorPipeline.js'
import { detectTilt } from './lib/straighten.js'

type Tab = 'compose' | 'adjust' | 'works'

const RESUME_MAX = 1800

export function App() {
  const [status, setStatus] = useState<StatusInfo | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [fileName, setFileName] = useState('')
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 })
  const [rotate, setRotate] = useState(0)
  const [composition, setComposition] = useState<ComposeId>('thirds')
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [tone, setTone] = useState<ToneParams>(emptyTone())
  /** 实测基座(未叠加风格层);切换风格时以它为底重新叠加 */
  const [baseTone, setBaseTone] = useState<ToneParams>(emptyTone())
  /** 叠加中的风格层 id(none = 不叠加)。仅用于读取 v2 旧存档 */
  const [lookId, setLookId] = useState('none')
  /** 选中的滤镜 + 强度 */
  const [filter, setFilter] = useState<FilterPick>({ id: 'none', amount: 100 })
  const [filterSource, setFilterSource] = useState<'ai' | 'auto' | 'manual' | 'none'>('none')
  const [filterWhy, setFilterWhy] = useState('')
  const [toneSource, setToneSource] = useState<'none' | 'auto' | 'manual'>('none')
  const [stats, setStats] = useState<ImageStats | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)

  const [tab, setTab] = useState<Tab>('compose')
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [presets, setPresets] = useState<PresetItem[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [showExport, setShowExport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settings, setSettings] = useState<SettingsDataT | null>(null)
  const [compare, setCompare] = useState(false)
  const [holdOriginal, setHoldOriginal] = useState(false)
  const [showSamples, setShowSamples] = useState(false)
  const [colorWarn, setColorWarn] = useState('')

  const restoredRef = useRef(false)
  const statusRef = useRef<StatusInfo | null>(null)

  const setAi = useCallback((s: AiState, detail?: string) => reportAiStatus(s, detail), [])

  /* ---------------- 初始化:状态 / 会话 / 预设 / 断点恢复 ---------------- */

  useEffect(() => {
    api
      .status()
      .then((s) => {
        setStatus(s)
        statusRef.current = s
      })
      .catch(() => {})
    refreshSessions()
    refreshPresets()
  }, [])

  // 调色支持自检:WebGL 不可用 / 调色 shader 编译失败时明确提示(不再静默失效)
  useEffect(() => {
    const s = detectColorSupport()
    if (!s.webgl) {
      setColorWarn('当前浏览器未启用 WebGL:可以裁剪,但「调色」无法预览与导出。建议用新版 Chrome / Edge / Safari。')
    } else if (!s.graded) {
      setColorWarn(`当前浏览器未能启用调色预览(已降级为只显示原图):${s.log.slice(0, 180)}`)
    }
  }, [])

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const p = readState<Partial<EditParams> & { fileName?: string } | null>('params', null)
    if (p) {
      if (p.crop) setCrop(p.crop)
      if (typeof p.rotate === 'number') setRotate(p.rotate)
      if (p.composition) setComposition(p.composition)
      if (p.subjects) setSubjects(p.subjects)
      if (p.tone) {
        const t = mergeTone(p.tone)
        setTone(t)
        if (p.v === 2 || p.v === 3) {
          setBaseTone(p.baseTone ? mergeTone(p.baseTone) : t)
          // v2 存档里的 style 已经烘进 tone,只记录下来,不再重算
          setLookId(p.v === 2 && p.style && p.style !== 'none' ? p.style : 'none')
        } else {
          // 旧版存档:style 已经烘进 tone,不能再叠一次
          setBaseTone(t)
          setLookId('none')
        }
        setToneSource(p.source ?? 'manual')
      }
      if (p.v === 3) {
        setFilter({
          id: p.filter && FILTERS[p.filter] ? p.filter : 'none',
          amount: typeof p.filterAmount === 'number' ? p.filterAmount : 100,
        })
        setFilterSource(p.filterSource ?? 'manual')
        setFilterWhy(p.filterWhy ?? '')
      }
      if (p.fileName) setFileName(p.fileName)
    }
    const src = readState<string>('image', '')
    if (src) {
      loadImage(src)
        .then((img) => setImage(img))
        .catch(() => {})
    }
  }, [])

  // 参数随会话保存
  useEffect(() => {
    if (!restoredRef.current) return
    writeState('params', {
      crop,
      rotate,
      composition,
      subjects,
      tone,
      baseTone,
      style: lookId,
      filter: filter.id,
      filterAmount: filter.amount,
      filterWhy,
      filterSource,
      source: toneSource,
      v: 3,
      fileName,
    } satisfies Partial<EditParams> & { fileName: string })
  }, [crop, rotate, composition, subjects, tone, baseTone, lookId, filter, filterWhy, filterSource, toneSource, fileName])

  const refreshSessions = useCallback(() => {
    api.sessions().then((r) => setSessions(r.items)).catch(() => {})
  }, [])
  const refreshPresets = useCallback(() => {
    api.presets().then((r) => setPresets(r.items)).catch(() => {})
  }, [])

  /* ---------------- AI 分析 ---------------- */

  const analyzeWith = useCallback(
    async (img: HTMLImageElement) => {
      setBusy('AI 正在分析构图…')
      setError('')
      setAi('thinking', '视觉分析中')
      try {
        const { dataUrl, width, height } = downscaleDataURL(img, 1024, 0.72)
        const { analysis: raw } = await api.analyze(dataUrl, width, height)
        const a: AnalysisResult = { ...raw, intent: normalizeIntent(raw?.intent) }
        setAnalysis(a)
        setCrop(a.crop)
        // 角度只信本地算法(模型估角不可靠):置信度不足时宁可不摆正,也不套用模型的瞎猜
        const rot = detectTilt(img).angle
        setRotate(rot)
        setComposition(a.composition)
        setSubjects(a.subjects)
        // 调色 = 客户端按裁剪区**实测推导**(唯一数值来源)+ 模型意图的定向微调与护栏
        const { tone: measured, stats: s } = sampleAutoTone(img, rot, a.crop)
        const t = applyIntent(measured, a.intent, s)
        setStats(s)
        setBaseTone(t)
        setTone(t)
        setLookId('none')
        setToneSource('auto')
        // 滤镜:模型给语义选择,客户端再过护栏/兜底
        const fc = pickFilter(a.intent, s)
        setFilter({ id: fc.id, amount: fc.amount })
        setFilterSource(fc.source)
        setFilterWhy(fc.why)
        setTab('compose')
        setAi('success', '构图分析完成')
      } catch (e) {
        const msg = e instanceof Error ? e.message : '分析失败'
        setError(msg)
        setAi('error', msg)
      } finally {
        setBusy('')
      }
    },
    [setAi],
  )

  /* ---------------- 上传 / 加载 ---------------- */

  const loadFile = useCallback(
    async (file: File) => {
      setBusy('正在读取照片…')
      setError('')
      try {
        const img = await loadImageFile(file)
        setImage(img)
        setFileName(file.name.replace(/\.[^.]+$/, '') || 'photo')
        setCrop({ x: 0, y: 0, w: 1, h: 1 })
        setRotate(0)
        setComposition('thirds')
        setSubjects([])
        setTone(emptyTone())
        setBaseTone(emptyTone())
        setLookId('none')
        setToneSource('none')
        setFilter({ id: 'none', amount: 100 })
        setFilterSource('none')
        setFilterWhy('')
        setStats(null)
        setAnalysis(null)
        setTab('compose')
        setCompare(false)
        const preview = downscaleDataURL(img, RESUME_MAX, 0.82)
        writeState('image', preview.dataUrl)
        setBusy('')
        // 全自动:已配好视觉模型时,上传即分析
        if (statusRef.current?.hasToken) await analyzeWith(img)
      } catch (e) {
        setError(e instanceof Error ? e.message : '读取失败')
        setBusy('')
      }
    },
    [analyzeWith],
  )

  // 粘贴上传
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile()
          if (f) loadFile(f)
          break
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile])

  /* ---------------- AI 分析 / 自动修图 ---------------- */

  const runAnalyze = useCallback(() => {
    if (image) void analyzeWith(image)
  }, [image, analyzeWith])

  const runAutoTone = useCallback(() => {
    if (!image) return
    // 数值一律来自本图实测;已有 AI 分析时,意图只做定向微调与护栏
    const { tone: measured, stats: s } = sampleAutoTone(image, rotate, crop)
    const t = applyIntent(measured, analysis?.intent ?? null, s)
    setStats(s)
    setBaseTone(t)
    setTone(t)
    setLookId('none')
    setToneSource('auto')
    const fc = pickFilter(analysis?.intent ?? null, s)
    setFilter({ id: fc.id, amount: fc.amount })
    setFilterSource(fc.source)
    setFilterWhy(fc.why)
    setAi('success', '已按本图测算')
  }, [image, rotate, crop, analysis, setAi])

  const runAutoStraighten = useCallback(() => {
    if (!image) return
    const t = detectTilt(image)
    setRotate(t.angle)
    setAi('success', t.angle !== 0 ? `已摆正 ${t.angle.toFixed(1)}°` : '画面已基本水平')
  }, [image, setAi])

  const runPerfect = useCallback(async () => {
    await runAnalyze()
  }, [runAnalyze])

  /** 手动改任一滑块 = 把风格层「拍平」成显式数值,避免叠加歧义 */
  const changeTone = useCallback(
    (patch: Partial<ToneParams>) => {
      const next = mergeTone({ ...tone, ...patch })
      setTone(next)
      setBaseTone(next)
      setLookId('none')
      setToneSource('manual')
    },
    [tone],
  )

  const resetTone = useCallback(() => {
    setTone(emptyTone())
    setBaseTone(emptyTone())
    setLookId('none')
    setToneSource('manual')
  }, [])

  /** 手动换滤镜:不动调色参数(滤镜是独立一层) */
  const chooseFilter = useCallback((id: string) => {
    const next = id === 'none' ? 'none' : FILTERS[id] ? id : 'none'
    setFilter((prev) => ({ id: next, amount: next === 'none' ? 0 : prev.amount > 0 ? prev.amount : 100 }))
    setFilterSource(next === 'none' ? 'none' : 'manual')
    setFilterWhy('')
  }, [])

  const changeFilterAmount = useCallback((amount: number) => {
    setFilter((prev) => ({ ...prev, amount: Math.max(0, Math.min(100, Math.round(amount))) }))
    setFilterSource((s) => (s === 'none' ? 'manual' : s))
  }, [])

  /* ---------------- 作品 / 预设 ---------------- */

  const saveSession = useCallback(
    async (name: string) => {
      if (!image) return
      setBusy('保存中…')
      try {
        const thumb = downscaleDataURL(image, 360, 0.7).dataUrl
        const params: EditParams = {
          crop,
          rotate,
          composition,
          subjects,
          tone,
          style: lookId,
          baseTone,
          source: toneSource,
          filter: filter.id,
          filterAmount: filter.amount,
          filterWhy,
          filterSource,
          v: 3,
        }
        await api.saveSession({ name, thumb, params, analysis })
        refreshSessions()
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存失败')
      } finally {
        setBusy('')
      }
    },
    [image, crop, rotate, composition, subjects, tone, lookId, baseTone, toneSource, filter, filterWhy, filterSource, analysis, refreshSessions],
  )

  const openSession = useCallback((s: SessionItem) => {
    if (s.params) {
      setCrop(s.params.crop)
      setRotate(s.params.rotate)
      setComposition(s.params.composition)
      setSubjects(s.params.subjects ?? [])
      const t = mergeTone(s.params.tone)
      setTone(t)
      if (s.params.v === 2 || s.params.v === 3) {
        setBaseTone(s.params.baseTone ? mergeTone(s.params.baseTone) : t)
        setLookId(s.params.v === 2 && s.params.style && s.params.style !== 'none' ? s.params.style : 'none')
      } else {
        // 旧存档:style 已烘进 tone
        setBaseTone(t)
        setLookId('none')
      }
      if (s.params.v === 3) {
        setFilter({
          id: s.params.filter && FILTERS[s.params.filter] ? s.params.filter : 'none',
          amount: typeof s.params.filterAmount === 'number' ? s.params.filterAmount : 100,
        })
        setFilterSource(s.params.filterSource ?? 'manual')
        setFilterWhy(s.params.filterWhy ?? '')
      } else {
        // v2 及更早:风格已经烘进 tone,不额外叠滤镜
        setFilter({ id: 'none', amount: 100 })
        setFilterSource('none')
        setFilterWhy('')
      }
      setToneSource(s.params.source ?? 'manual')
    }
    setStats(null)
    setAnalysis(s.analysis ? { ...s.analysis, intent: normalizeIntent(s.analysis.intent) } : null)
    setFileName(s.name)
    if (s.thumb) {
      loadImage(s.thumb)
        .then((img) => {
          setImage(img)
          writeState('image', s.thumb || '')
        })
        .catch(() => {})
    }
    setTab('adjust')
  }, [])

  const deleteSession = useCallback(
    async (id: string) => {
      await api.deleteSession(id).catch(() => {})
      refreshSessions()
    },
    [refreshSessions],
  )

  const savePreset = useCallback(
    async (name: string) => {
      await api.savePreset({ name, tone, style: lookId, filter: filter.id, filterAmount: filter.amount }).catch(() => {})
      refreshPresets()
    },
    [tone, lookId, filter, refreshPresets],
  )

  const applyPreset = useCallback((p: PresetItem) => {
    // 用户预设是「整套参数」,直接作为基座;风格层归零
    const t = mergeTone(p.tone)
    setTone(t)
    setBaseTone(t)
    setLookId('none')
    setToneSource('manual')
    setFilter({ id: p.filter && FILTERS[p.filter] ? p.filter : 'none', amount: p.filterAmount ?? 100 })
    setFilterSource(p.filter ? 'manual' : 'none')
    setFilterWhy('')
  }, [])

  const deletePreset = useCallback(
    async (id: string) => {
      await api.deletePreset(id).catch(() => {})
      refreshPresets()
    },
    [refreshPresets],
  )

  /* ---------------- 设置(站长) ---------------- */

  const openSettings = useCallback(async () => {
    setShowSettings(true)
    try {
      const s = await api.settings()
      setSettings(s as unknown as SettingsDataT)
    } catch {
      /* ignore */
    }
  }, [])

  const reloadSettings = useCallback(async () => {
    try {
      setSettings((await api.settings()) as unknown as SettingsDataT)
    } catch {
      /* ignore */
    }
  }, [])

  /* ---------------- 渲染 ---------------- */

  const hasImage = !!image

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-mark">◉</span>
          <span className="brand-name">光圈</span>
          <span className="brand-sub">构图裁剪 · 自动修图</span>
        </div>
        <div className="top-actions">
          <button type="button" className="btn small ghost" onClick={() => setShowSamples(true)} title="内置「待修图」示例,一键载入体验">
            示例
          </button>
          {hasImage && (
            <>
              <button type="button" className="btn small" onClick={() => setTab('adjust')}>
                调色
              </button>
              <button type="button" className="btn small" onClick={runAutoTone}>
                自动修图
              </button>
              <button type="button" className="btn small primary" onClick={runPerfect}>
                一键构图
              </button>
              <button type="button" className="btn small" onClick={() => setShowExport(true)}>
                导出
              </button>
            </>
          )}
          {status?.isOwner && (
            <button type="button" className="btn small ghost" onClick={openSettings}>
              设置
            </button>
          )}
        </div>
      </header>

      {!status?.hasToken && (
        <div className="banner warn">
          尚未配置视觉模型令牌{status?.isOwner ? ':点右上「设置」填入,或让主站签发应用令牌' : ':请联系站长在后台配置'}。
        </div>
      )}
      {colorWarn && (
        <div className="banner err">
          <span>⚠️ {colorWarn}</span>
          <button type="button" className="icon-btn" onClick={() => setColorWarn('')}>
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="banner err">
          <span>{error}</span>
          <button type="button" className="icon-btn" onClick={() => setError('')}>
            ✕
          </button>
        </div>
      )}
      {busy && <div className="banner busy">{busy}</div>}

      <main className={hasImage ? 'main with-image' : 'main'}>
        {!hasImage ? (
          <Uploader onFile={loadFile} busy={busy} />
        ) : (
          <>
            <section className="canvas-col">
              {compare ? (
                <CompareView image={image} rotate={rotate} crop={crop} tone={tone} filter={filter} />
              ) : (
                <CropStage
                  image={image}
                  rotate={rotate}
                  crop={crop}
                  composition={composition}
                  subjects={subjects}
                  tone={tone}
                  filter={filter}
                  showOriginal={holdOriginal}
                  onCrop={setCrop}
                />
              )}
              <div className="stage-tools">
                <button
                  type="button"
                  className={`btn small ${compare ? 'primary' : ''}`}
                  onClick={() => setCompare((v) => !v)}
                  title="在「原图」与「裁剪 + 调色后的效果」之间前后对比"
                >
                  ⇆ {compare ? '返回编辑' : '对比前后'}
                </button>
                {!compare && (
                  <button
                    type="button"
                    className="btn small ghost"
                    onPointerDown={() => setHoldOriginal(true)}
                    onPointerUp={() => setHoldOriginal(false)}
                    onPointerLeave={() => setHoldOriginal(false)}
                    onPointerCancel={() => setHoldOriginal(false)}
                    title="按住可看到未调色的原图(保留裁剪框)"
                  >
                    按住看原图
                  </button>
                )}
                <label className="slider mini" title="手动微调旋转角:直接拖动滑块(这是个滑块,不是按钮)">
                  <span className="slider-label">摆正</span>
                  <input type="range" min={-15} max={15} step={0.1} value={rotate} onChange={(e) => setRotate(Number(e.target.value))} />
                  <span className="slider-val">{rotate.toFixed(1)}°</span>
                </label>
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={runAutoStraighten}
                  title="本地算法自动检测地平线 / 建筑腰线并回正(比模型估角准)"
                >
                  自动摆正
                </button>
                <button type="button" className="btn small ghost" onClick={() => setCrop({ x: 0, y: 0, w: 1, h: 1 })}>
                  重置裁剪
                </button>
                <label className="btn small ghost file-btn">
                  换一张
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) loadFile(f)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            </section>

            <aside className="side">
              <div className="tabs">
                {(
                  [
                    ['compose', '构图'],
                    ['adjust', '调色'],
                    ['works', '作品'],
                  ] as [Tab, string][]
                ).map(([id, label]) => (
                  <button key={id} type="button" className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="tab-body">
                {tab === 'compose' && (
                  <div className="compose">
                    <div className="group">
                      <div className="group-title">构图方式</div>
                      <div className="chips">
                        {COMPOSITIONS.map((c) => (
                          <button key={c.id} type="button" className={`chip ${composition === c.id ? 'on' : ''}`} title={c.hint} onClick={() => setComposition(c.id)}>
                            {c.label}
                          </button>
                        ))}
                      </div>
                      <div className="muted small">{COMPOSITIONS.find((c) => c.id === composition)?.hint}</div>
                    </div>

                    {analysis?.reason && (
                      <div className="group">
                        <div className="group-title">AI 建议</div>
                        <div className="reason">
                          <b>{compositionLabel(analysis.composition)}</b> · {analysis.reason}
                        </div>
                      </div>
                    )}

                    {!!subjects.length && (
                      <div className="group">
                        <div className="group-title">识别到的主体</div>
                        <div className="chips">
                          {subjects.map((s, i) => (
                            <span className="chip static" key={i}>
                              {s.label}
                            </span>
                          ))}
                        </div>
                        <div className="muted small">拖动裁剪框时,主体会自动吸附到构图关键点</div>
                      </div>
                    )}

                    <div className="group">
                      <div className="muted small">
                        提示:拖动裁剪框移动、拉四角/边线缩放。参数与照片只存在你自己的浏览器会话里。
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'adjust' && (
                  <AdjustPanel
                    tone={tone}
                    filter={filter}
                    filterSource={filterSource}
                    filterWhy={filterWhy}
                    source={toneSource}
                    diagnosis={stats ? describeStats(stats, (tone.exposure * EV_SCALE) / 100) : ''}
                    intentText={analysis ? describeIntent(analysis.intent) : ''}
                    image={image}
                    rotate={rotate}
                    crop={crop}
                    onChange={changeTone}
                    onFilter={chooseFilter}
                    onFilterAmount={changeFilterAmount}
                    onAuto={runAutoTone}
                    onReset={resetTone}
                  />
                )}

                {tab === 'works' && (
                  <WorksPanel
                    sessions={sessions}
                    presets={presets}
                    canSave={hasImage}
                    onOpenSession={openSession}
                    onDeleteSession={deleteSession}
                    onSaveSession={saveSession}
                    onApplyPreset={applyPreset}
                    onSavePreset={savePreset}
                    onDeletePreset={deletePreset}
                  />
                )}
              </div>
            </aside>
          </>
        )}
      </main>

      {showExport && image && (
        <ExportDialog image={image} rotate={rotate} crop={crop} tone={tone} filter={filter} fileBase={fileName || 'photo'} onClose={() => setShowExport(false)} />
      )}

      {showSamples && (
        <div className="modal-mask" onClick={() => setShowSamples(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">示例照片(待修图)</div>
            <SampleGallery
              onPick={(f) => {
                setShowSamples(false)
                void loadFile(f)
              }}
            />
            <div className="row2 end" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setShowSamples(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="modal-mask" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">设置</div>
            <SettingsPanel
              data={settings}
              onSaveProvider={(provider) => api.saveSettings({ provider }).then(reloadSettings)}
              onSaveSlot={(prov, patch) => api.saveSettings({ providers: { [prov]: patch } }).then(reloadSettings)}
              onSaveKey={(prov, key) => api.saveKey(prov, key).then(reloadSettings)}
              onToggleVisitorAi={(on) => api.saveSettings({ visitorAi: on }).then(reloadSettings)}
            />
            <div className="row2 end">
              <button type="button" className="btn" onClick={() => setShowSettings(false)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
