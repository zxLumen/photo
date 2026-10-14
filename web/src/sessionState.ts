import { useEffect, useState } from 'react'

/**
 * 跨「整页刷新」保状态:写入 sessionStorage(宿主刷新 / iframe 重建都能扛过)。
 * 约定见博客 docs/APP-EMBED.md;前缀用本应用 id。
 */
const PREFIX = 'zx-app-state:photo:'

export function readState<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeState<T>(key: string, value: T): void {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 超限:忽略 */
  }
}

/** 像 useState 一样用,但值随会话保存、刷新后恢复。 */
export function useSessionState<T>(key: string, initial: T | (() => T)) {
  const [state, setState] = useState<T>(() => readState(key, typeof initial === 'function' ? (initial as () => T)() : initial))
  useEffect(() => {
    writeState(key, state)
  }, [key, state])
  return [state, setState] as const
}
