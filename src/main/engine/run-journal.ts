/**
 * 运行日志（run journal）的落盘（run-timeline「运行日志由既有事件流派生，不新增埋点」）。
 *
 * 它**不是新的埋点体系**，而是既有 `EngineProgressEvent` 的持久化消费者：引擎在已有的 emit 处
 * 把每个事件原样交过来（单点旁挂），由本模块决定收谁——收全部结构性事件，**只丢 `op-chunk`**。
 * 排除规则落在这里而非引擎里，故未来新增的事件类型自动进日志，无需改任何一处调用。
 *
 * `op-chunk` 的输出字节已由 `output-buffer` 按桶存着；日志只留桶引用（条目自带的 `nodeId`/`bgId`
 * 就是桶键 `node:<nodeId>` / `bg:<bgId>` 的来源），绝不复制字节。
 *
 * 文件布局 `<baseDir>/<runId>/journal.jsonl`（一行一条，追加）——与 `output-buffer` 的桶文件同一个
 * 运行目录，二者同生共死（桶被清掉，日志随之而去），不另立一套保留策略。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineProgressEvent, RunJournalEntry } from '../../shared/types'

export interface RunJournal {
  /** 消费一个进度事件（`op-chunk` 被丢弃）。旁路语义：调用方无需按类型过滤。 */
  append(event: EngineProgressEvent, at: number): void
  /** 读某运行的全部条目（写入次序）；无日志（本能力上线前的运行）返回空。 */
  read(runId: string): RunJournalEntry[]
  /** 清掉某运行的日志（随其输出桶一同回收）。 */
  remove(runId: string): void
}

/** 该事件是否入日志——唯一的收录规则：除流式输出外全收。 */
const toEntry = (event: EngineProgressEvent, at: number): RunJournalEntry | null =>
  event.kind === 'op-chunk' ? null : { ...event, at }

/** 桶文件同款的运行目录名编码（runId 理论上可含 Windows 文件名非法字符）。 */
const encode = (runId: string): string => runId.replace(/[^\w.-]+/g, '__')

export function createRunJournal(baseDir: string): RunJournal {
  const file = (runId: string): string => join(baseDir, encode(runId), 'journal.jsonl')
  return {
    append(event, at) {
      const entry = toEntry(event, at)
      if (!entry) return
      mkdirSync(join(baseDir, encode(event.runId)), { recursive: true })
      appendFileSync(file(event.runId), `${JSON.stringify(entry)}\n`, 'utf8')
    },
    read(runId) {
      try {
        const f = file(runId)
        if (!existsSync(f)) return []
        const out: RunJournalEntry[] = []
        for (const line of readFileSync(f, 'utf8').split('\n')) {
          if (!line.trim()) continue
          try {
            out.push(JSON.parse(line) as RunJournalEntry)
          } catch {
            /* 跳过损坏行（写到一半断电）：能读多少读多少，不让整条时间线消失 */
          }
        }
        return out
      } catch {
        return []
      }
    },
    remove(runId) {
      rmSync(file(runId), { force: true })
    }
  }
}

/** 内存日志（测试/无盘场景）。 */
export function createMemoryRunJournal(): RunJournal {
  const runs = new Map<string, RunJournalEntry[]>()
  return {
    append(event, at) {
      const entry = toEntry(event, at)
      if (!entry) return
      const list = runs.get(event.runId) ?? []
      list.push(entry)
      runs.set(event.runId, list)
    },
    read: (runId) => (runs.get(runId) ?? []).map((e) => JSON.parse(JSON.stringify(e)) as RunJournalEntry),
    remove: (runId) => {
      runs.delete(runId)
    }
  }
}
