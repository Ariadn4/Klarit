/**
 * 命令输出按桶缓冲（engine-execution「命令输出按命令/后台任务分桶缓冲且可回看」）。
 * 桶键：前台命令用 `node:<nodeId>`、后台命令用 `bg:<bgId>`。文件布局 `<baseDir>/<runId>/<bucket>.log`（追加）。
 * 在 `op-chunk` 流式事件之外把输出累积下来，供关重开后回看；不同桶/不同运行互相隔离。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export interface OutputBuffer {
  append(runId: string, bucket: string, chunk: string): void
  read(runId: string, bucket: string): string
  listBuckets(runId: string): string[]
  /** 清空某桶累积（复用桶重新开跑前用，如同一门动作重启复用同一格输出）。 */
  clear(runId: string, bucket: string): void
  remove(runId: string): void
}

/** 桶键 ↔ 文件名编码（桶键含 `:`，Windows 文件名非法，编码为 `__`）。 */
const encode = (bucket: string): string => bucket.replace(/[^\w.-]+/g, '__')
const decode = (file: string): string => file.replace(/\.log$/, '').replace(/__/g, ':')

export function createOutputBuffer(baseDir: string): OutputBuffer {
  const dir = (runId: string): string => join(baseDir, encode(runId))
  const file = (runId: string, bucket: string): string => join(dir(runId), `${encode(bucket)}.log`)
  return {
    append(runId, bucket, chunk) {
      mkdirSync(dir(runId), { recursive: true })
      appendFileSync(file(runId, bucket), chunk, 'utf8')
    },
    read(runId, bucket) {
      try {
        const f = file(runId, bucket)
        return existsSync(f) ? readFileSync(f, 'utf8') : ''
      } catch {
        return ''
      }
    },
    listBuckets(runId) {
      const d = dir(runId)
      if (!existsSync(d)) return []
      return readdirSync(d)
        .filter((n) => n.endsWith('.log'))
        .map(decode)
    },
    clear(runId, bucket) {
      rmSync(file(runId, bucket), { force: true })
    },
    remove(runId) {
      rmSync(dir(runId), { recursive: true, force: true })
    }
  }
}

export function createMemoryOutputBuffer(): OutputBuffer {
  const runs = new Map<string, Map<string, string>>()
  const bucketsOf = (runId: string): Map<string, string> => {
    let m = runs.get(runId)
    if (!m) {
      m = new Map()
      runs.set(runId, m)
    }
    return m
  }
  return {
    append(runId, bucket, chunk) {
      const m = bucketsOf(runId)
      m.set(bucket, (m.get(bucket) ?? '') + chunk)
    },
    read: (runId, bucket) => runs.get(runId)?.get(bucket) ?? '',
    listBuckets: (runId) => [...(runs.get(runId)?.keys() ?? [])],
    clear: (runId, bucket) => {
      runs.get(runId)?.delete(bucket)
    },
    remove: (runId) => {
      runs.delete(runId)
    }
  }
}
