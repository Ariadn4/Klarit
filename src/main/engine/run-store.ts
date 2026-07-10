/** 运行断点的持久化:每个运行 = `<baseDir>/<runId>.json`。引擎据此跨进程恢复。 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RunBreakpoint } from '../../shared/types'

export interface RunStore {
  load: (runId: string) => RunBreakpoint | null
  save: (bp: RunBreakpoint) => void
  list: () => RunBreakpoint[]
  remove: (runId: string) => void
}

/** 文件持久化(userData/engine-runs/)。 */
export function createRunStore(baseDir: string): RunStore {
  const file = (runId: string): string => join(baseDir, `${runId}.json`)
  return {
    load(runId) {
      try {
        const f = file(runId)
        return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as RunBreakpoint) : null
      } catch {
        return null
      }
    },
    save(bp) {
      mkdirSync(baseDir, { recursive: true })
      writeFileSync(file(bp.runId), JSON.stringify(bp, null, 2), 'utf8')
    },
    list() {
      if (!existsSync(baseDir)) return []
      const out: RunBreakpoint[] = []
      for (const name of readdirSync(baseDir)) {
        if (!name.endsWith('.json')) continue
        try {
          out.push(JSON.parse(readFileSync(join(baseDir, name), 'utf8')) as RunBreakpoint)
        } catch {
          /* 跳过损坏 */
        }
      }
      return out
    },
    remove(runId) {
      rmSync(file(runId), { force: true })
    }
  }
}

/** 内存持久化(测试/无盘场景)。 */
export function createMemoryRunStore(): RunStore {
  const map = new Map<string, RunBreakpoint>()
  return {
    load: (runId) => {
      const bp = map.get(runId)
      return bp ? (JSON.parse(JSON.stringify(bp)) as RunBreakpoint) : null
    },
    save: (bp) => {
      map.set(bp.runId, JSON.parse(JSON.stringify(bp)) as RunBreakpoint)
    },
    list: () => [...map.values()].map((bp) => JSON.parse(JSON.stringify(bp)) as RunBreakpoint),
    remove: (runId) => {
      map.delete(runId)
    }
  }
}
