import { statSync, readFileSync } from 'node:fs'
import type { ReadFileResult } from '../shared/types'

/** 预览大小上限（2MB）：超过则不返回完整内容，避免卡 monaco / 占内存。 */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

/** 二进制判定的探测窗口：只看前若干 KB 有无 NUL 字节，开销恒定。 */
const SNIFF_BYTES = 8000

function isBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, SNIFF_BYTES)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

/**
 * 只读读取文件供预览：先 stat 判大小，再读内容判二进制。纯函数、不写盘，便于单测。
 * - 超过 {@link MAX_PREVIEW_BYTES} → too-large（不读内容）
 * - 含 NUL 字节 → binary（不返回文本）
 * - stat/read 失败（ENOENT/EACCES 等）→ error
 */
export function readFileForPreview(filePath: string): ReadFileResult {
  let size: number
  try {
    size = statSync(filePath).size
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) }
  }
  if (size > MAX_PREVIEW_BYTES) return { kind: 'too-large', size }
  let buf: Buffer
  try {
    buf = readFileSync(filePath)
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) }
  }
  if (isBinary(buf)) return { kind: 'binary' }
  return { kind: 'text', content: buf.toString('utf8') }
}
