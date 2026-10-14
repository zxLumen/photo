/**
 * 大模型服务商预设。默认走**博客 AI 网关**(真实 key 只在主站,子应用拿应用令牌),
 * 也保留直连选项,便于本地调试。
 *
 * 注意:本应用要**看图**,所以所选模型必须支持多模态(视觉)。
 */
export const PROVIDERS = [
  {
    id: 'zxGateway',
    label: '博客 AI 网关',
    defaultModel: '',
    defaultBaseURL: process.env.ZX_AI_GATEWAY_URL || 'http://localhost:3000/api/ai/v1',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash-vision-exp',
    defaultBaseURL: 'https://api.deepseek.com',
  },
  {
    id: 'zhipu',
    label: '智谱',
    defaultModel: 'glm-4.6v',
    defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    defaultBaseURL: 'https://api.openai.com/v1',
  },
  {
    id: 'opencodeGo',
    label: 'opencode Go',
    defaultModel: 'deepseek-v4.1-flash',
    defaultBaseURL: 'https://opencode.ai/zen/go/v1',
  },
  { id: 'custom', label: '自定义', defaultModel: '', defaultBaseURL: '' },
]

export const providerById = (id) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]

export const detectProvider = (baseURL) => {
  const url = String(baseURL || '').toLowerCase()
  if (url.includes('opencode.ai')) return 'opencodeGo'
  if (url.includes('deepseek')) return 'deepseek'
  if (url.includes('bigmodel.cn')) return 'zhipu'
  if (url.includes('openai.com')) return 'openai'
  if (url.includes('/api/ai/')) return 'zxGateway'
  return 'custom'
}
