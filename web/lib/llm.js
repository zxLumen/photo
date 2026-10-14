/**
 * OpenAI 兼容的上游调用:多模态(视觉)对话。
 * 与 luminari / StockApp / yijing64 的 llm.js 同源,保留 image_url 多模态支持。
 */

export const endpointURL = (baseURL) => {
  const trimmed = String(baseURL ?? '').trim()
  if (!trimmed) return null
  try {
    return new URL('chat/completions', trimmed.endsWith('/') ? trimmed : `${trimmed}/`)
  } catch {
    return null
  }
}

export const isOpenCode = (baseURL) => String(baseURL ?? '').toLowerCase().includes('opencode.ai')

export const standardHeaders = (config, sessionId) => {
  /** @type {Record<string,string>} */
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Photo/1.0',
  }
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  if (isOpenCode(config.baseURL)) headers['x-opencode-session'] = sessionId
  return headers
}

/** messages 里 content 可以是纯字符串,也可以是 ContentPart[](多模态)。原样透传 */
export const requestBody = ({ model, messages, maxTokens, stream = false, temperature = 0.4, noThinking = false }) => {
  const body = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature,
    max_tokens: maxTokens,
    stream,
  }
  if (noThinking) body.reasoning_effort = 'none'
  return body
}

/** 把上游错误正文变成一句能看懂的话(纯文本 / JSON 都兼容)。 */
export const friendlyDetail = (text) => {
  const t = String(text ?? '').trim()
  if (!t) return ''
  try {
    const j = JSON.parse(t)
    return j?.error?.message || j?.message || j?.error || t.slice(0, 300)
  } catch {
    return t.slice(0, 300)
  }
}

/** 非流式单轮补全,返回 { text, inTokens, outTokens, finishReason }。 */
export async function completeChat(config, { messages, maxTokens = 1500, temperature = 0.4, noThinking = true, sessionId = 'photo', signal }) {
  const url = endpointURL(config.baseURL)
  if (!url) throw new Error('模型端点未配置')
  const res = await fetch(url, {
    method: 'POST',
    headers: standardHeaders(config, sessionId),
    body: JSON.stringify(requestBody({ model: config.model, messages, maxTokens, temperature, noThinking })),
    signal,
  })
  const raw = await res.text()
  if (!res.ok) throw new Error(`上游 ${res.status}:${friendlyDetail(raw)}`)
  let json
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`上游返回非 JSON:${raw.slice(0, 200)}`)
  }
  const msg = json?.choices?.[0]?.message
  const text = typeof msg?.content === 'string' ? msg.content : Array.isArray(msg?.content) ? msg.content.map((c) => c?.text ?? '').join('') : ''
  return {
    text,
    inTokens: json?.usage?.prompt_tokens ?? 0,
    outTokens: json?.usage?.completion_tokens ?? 0,
    finishReason: json?.choices?.[0]?.finish_reason ?? '',
  }
}
