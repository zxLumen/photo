/**
 * 应用内嵌入(博客应用栏 iframe)时与宿主的通信。
 * 跨子域 iframe 只能靠 postMessage;宿主 origin 由 document.referrer 反推。
 * **绝不退化到 '*'** —— 取不到就不发。
 */
const HOST_ORIGIN = (() => {
  try {
    return document.referrer ? new URL(document.referrer).origin : ''
  } catch {
    return ''
  }
})()

export const EMBEDDED = typeof window !== 'undefined' && window.parent !== window && !!HOST_ORIGIN

export function postToHost(data: Record<string, unknown>): void {
  if (!EMBEDDED) return
  try {
    window.parent.postMessage(data, HOST_ORIGIN)
  } catch {
    /* ignore */
  }
}

export type AiState = 'idle' | 'thinking' | 'working' | 'busy' | 'success' | 'error' | 'blocked'

/** 按博客 docs/AI-STATUS.md 上报 AI 状态(应用 id 必须是 'photo') */
export function reportAiStatus(state: AiState, detail?: string): void {
  postToHost({ type: 'zx:ai-status', app: 'photo', state, detail: detail ? detail.slice(0, 120) : undefined })
}

/** 通知宿主「本应用可用」(宿主一般自行处理,这里冗余上报不影响) */
export function reportAvailability(available: boolean): void {
  postToHost({ type: 'zx:ai-available', app: 'photo', available })
}
