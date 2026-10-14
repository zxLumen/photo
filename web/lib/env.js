import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 加载 web/.env(若存在)。**必须作为 server.js 的第一个 import**,因为 `scope.js` 的
 * `DATA_DIR` 是模块级常量,依赖 import 时就已读好的 env。
 *
 * Node 22+ 原生 `process.loadEnvFile`;旧 Node 或文件不存在时静默跳过。
 */
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath)
} catch {
  /* 静默:无 .env 属正常;真需要变量时由 npm 脚本的 --env-file-if-exists 兜底 */
}
