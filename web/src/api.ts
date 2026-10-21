import type { AnalysisResult, EditParams, PresetItem, SessionItem, StatusInfo, ToneParams } from './types.js'

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error((e as { error?: string }).error || `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  status: () => fetch('/api/status').then(j<StatusInfo>),

  analyze: (image: string, width: number, height: number) =>
    post('/api/analyze', { image, width, height }).then(j<{ analysis: AnalysisResult; usage: { inTokens: number; outTokens: number } }>),

  sessions: () => fetch('/api/sessions').then(j<{ items: SessionItem[]; total: number }>),
  session: (id: string) => fetch(`/api/sessions/${id}`).then(j<{ item: SessionItem }>),
  saveSession: (payload: { id?: string; name: string; thumb: string; params: EditParams; analysis: AnalysisResult | null }) =>
    post('/api/sessions', payload).then(j<{ item: SessionItem }>),
  deleteSession: (id: string) => fetch(`/api/sessions/${id}`, { method: 'DELETE' }).then(j<{ ok: boolean }>),

  presets: () => fetch('/api/presets').then(j<{ items: PresetItem[] }>),
  savePreset: (payload: { id?: string; name: string; tone: ToneParams; style: string; filter?: string; filterAmount?: number }) =>
    post('/api/presets', payload).then(j<{ item: PresetItem }>),
  deletePreset: (id: string) => fetch(`/api/presets/${id}`, { method: 'DELETE' }).then(j<{ ok: boolean }>),

  settings: () => fetch('/api/settings').then(j<Record<string, unknown>>),
  saveSettings: (patch: Record<string, unknown>) => post('/api/settings', patch).then(j<Record<string, unknown>>),
  saveKey: (provider: string, key: string) => post('/api/settings/key', { provider, key }).then(j<Record<string, unknown>>),
}
