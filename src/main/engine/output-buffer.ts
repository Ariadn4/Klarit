/**
 * 命令输出按桶缓冲（engine-execution「命令输出按命令/后台任务分桶缓冲且可回看」）。
 * 桶键：前台命令用 `node:<nodeId>`、后台命令用 `bg:<bgId>`。文件布局 `<baseDir>/<runId>/<bucket>.log`（追加）。
 * 在 `op-chunk` 流式事件之外把输出累积下来，供关重开后回看；不同桶/不同运行互相隔离。
 *
 * 每个桶另带一份**原始流记录** `<bucket>.raw.jsonl`——agent 子进程 stdout 的逐行原样落盘。它与上面的
 * 展示转写**并存、职责相反、不合并**：展示要压缩（工具结果全量刷屏没法看），重建要保真（工具结果恰恰是
 * agent 需要知道的「我读到了什么」），合成一份必然有一边将就。两份同目录、同生共死（clear/remove 一并
 * 回收），但互不覆盖；原始记录不是展示桶，故不进 `listBuckets`。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export interface OutputBuffer {
  append(runId: string, bucket: string, chunk: string): void
  read(runId: string, bucket: string): string
  /**
   * 该桶「原始流记录」的落盘绝对路径（目录已备好，调用方直接逐行追加）；无盘实现返回 null——
   * 调用方据此回落既有展示转写，不报错、不阻断。
   */
  rawPath(runId: string, bucket: string): string | null
  /** 读该桶的原始流记录（供续接重建派生）；无记录返回空串。 */
  readRaw(runId: string, bucket: string): string
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
  const rawFile = (runId: string, bucket: string): string => join(dir(runId), `${encode(bucket)}.raw.jsonl`)
  const readFile = (f: string): string => {
    try {
      return existsSync(f) ? readFileSync(f, 'utf8') : ''
    } catch {
      return ''
    }
  }
  return {
    append(runId, bucket, chunk) {
      mkdirSync(dir(runId), { recursive: true })
      appendFileSync(file(runId, bucket), chunk, 'utf8')
    },
    read: (runId, bucket) => readFile(file(runId, bucket)),
    rawPath(runId, bucket) {
      mkdirSync(dir(runId), { recursive: true }) // 先备好目录：写方（runner）只管往这个路径逐行追加
      return rawFile(runId, bucket)
    },
    readRaw: (runId, bucket) => readFile(rawFile(runId, bucket)),
    listBuckets(runId) {
      const d = dir(runId)
      if (!existsSync(d)) return []
      return readdirSync(d)
        .filter((n) => n.endsWith('.log'))
        .map(decode)
    },
    clear(runId, bucket) {
      rmSync(file(runId, bucket), { force: true })
      rmSync(rawFile(runId, bucket), { force: true }) // 两份同生共死
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
    // 无盘：原始流记录由子进程直接往文件里逐行追加，内存实现无处可写 → 明确没有，调用方回落展示转写。
    rawPath: () => null,
    readRaw: () => '',
    listBuckets: (runId) => [...(runs.get(runId)?.keys() ?? [])],
    clear: (runId, bucket) => {
      runs.get(runId)?.delete(bucket)
    },
    remove: (runId) => {
      runs.delete(runId)
    }
  }
}
