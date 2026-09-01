import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import type { EngineProgressEvent } from '../../shared/types'
import { createRunJournal, createMemoryRunJournal, type RunJournal } from './run-journal'
import { testTmpDir } from '../test-tmp'

/** 八类结构性事件各一（顺序即写入次序）。 */
const STRUCTURAL: EngineProgressEvent[] = [
  { kind: 'state', runId: 'r1', state: 'running' },
  { kind: 'node-enter', runId: 'r1', nodeId: 'n1' },
  { kind: 'phase', runId: 'r1', nodeId: 'n1', phase: { kind: 'executing' } },
  { kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'bg1', label: '起服务', status: 'started' },
  { kind: 'gate-retry', runId: 'r1', nodeId: 'n1', gateIndex: 0, attempt: { cause: 'timeout', rerun: 'gate' }, count: 1 },
  { kind: 'skip', runId: 'r1', nodeId: 'n1', reason: '转后台,进入下一节点' },
  { kind: 'node-exit', runId: 'r1', nodeId: 'n1' },
  {
    kind: 'decision',
    runId: 'r1',
    decision: { source: 'n2:manual-gate', sourceKind: 'engine', titleKey: 'k', options: [] }
  }
]

function contract(name: string, make: () => RunJournal): void {
  describe(name, () => {
    let journal: RunJournal
    beforeEach(() => {
      journal = make()
    })

    it('八类结构性事件按 runId 可读回，顺序与时刻保留', () => {
      STRUCTURAL.forEach((evt, i) => journal.append(evt, 1000 + i))
      const entries = journal.read('r1')
      expect(entries.map((e) => e.kind)).toEqual([
        'state',
        'node-enter',
        'phase',
        'background',
        'gate-retry',
        'skip',
        'node-exit',
        'decision'
      ])
      expect(entries.map((e) => e.at)).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007])
      // 载荷字段原样保留（各事件类型自身的字段）。
      expect(entries[4]).toMatchObject({ nodeId: 'n1', gateIndex: 0, attempt: { cause: 'timeout', rerun: 'gate' }, count: 1 })
      expect(entries.every((e) => e.runId === 'r1')).toBe(true)
    })

    it('op-chunk 不入 journal：只留桶引用（nodeId/bgId），不复制输出字节', () => {
      journal.append({ kind: 'node-enter', runId: 'r1', nodeId: 'n1' }, 1)
      for (let i = 0; i < 50; i++) {
        journal.append(
          { kind: 'op-chunk', runId: 'r1', nodeId: 'n1', stream: 'stdout', chunk: `字节-${i}\n`, cmdIndex: 0 },
          2 + i
        )
      }
      journal.append({ kind: 'background', runId: 'r1', nodeId: 'n1', bgId: 'bg1', label: '起服务', status: 'started' }, 99)
      const entries = journal.read('r1')
      expect(entries.map((e) => e.kind)).toEqual(['node-enter', 'background'])
      expect(JSON.stringify(entries)).not.toContain('字节-')
      // 桶引用仍在：node:<nodeId> / bg:<bgId> 都能由条目派生。
      expect(entries.map((e) => ('nodeId' in e ? e.nodeId : null))).toEqual(['n1', 'n1'])
      expect(entries[1]).toMatchObject({ bgId: 'bg1' })
    })

    it('读不存在的 runId → 返回空、不抛', () => {
      expect(() => journal.read('ghost')).not.toThrow()
      expect(journal.read('ghost')).toEqual([])
    })

    it('运行隔离：不同 runId 各自成册', () => {
      journal.append({ kind: 'node-enter', runId: 'r1', nodeId: 'a' }, 1)
      journal.append({ kind: 'node-enter', runId: 'r2', nodeId: 'b' }, 2)
      expect(journal.read('r1')).toHaveLength(1)
      expect(journal.read('r2')).toHaveLength(1)
      expect(journal.read('r2')[0]).toMatchObject({ nodeId: 'b' })
    })

    it('remove 清掉某运行的日志（与输出桶同生共死）', () => {
      journal.append({ kind: 'node-enter', runId: 'r1', nodeId: 'a' }, 1)
      journal.append({ kind: 'node-enter', runId: 'r2', nodeId: 'b' }, 2)
      journal.remove('r1')
      expect(journal.read('r1')).toEqual([])
      expect(journal.read('r2')).toHaveLength(1)
    })
  })
}

contract('createMemoryRunJournal', () => createMemoryRunJournal())

describe('createRunJournal（文件持久化）', () => {
  let dir: string
  beforeEach(() => {
    dir = testTmpDir('klarit-journal-')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  contract('file-backed', () => createRunJournal(dir))

  it('关重开后仍可读回该运行的完整事件序列', () => {
    createRunJournal(dir).append({ kind: 'node-enter', runId: 'r1', nodeId: 'n1' }, 5)
    createRunJournal(dir).append({ kind: 'node-exit', runId: 'r1', nodeId: 'n1' }, 9)
    const reopened = createRunJournal(dir).read('r1')
    expect(reopened.map((e) => [e.kind, e.at])).toEqual([
      ['node-enter', 5],
      ['node-exit', 9]
    ])
  })
})
