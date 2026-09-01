/**
 * agent 原始流记录落盘（本 change 的出方向）：agent stdout **逐行原样**进 `historyPath`，
 * 与「给人看的展示转写」是两份并存、职责相反的记录——展示要压缩（工具结果全量刷屏没法看），
 * 原始要保真（工具结果恰恰是重建时 agent 需要知道的「我读到了什么」）。
 *
 * 落盘 MUST 逐行即时：崩溃/关软件半路时的可重建性，不拿去换界面流畅。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { DetectedAgent } from '../../shared/types'
import { testTmpDir } from '../test-tmp'

const spawnMock = vi.fn()
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFileSync: vi.fn()
}))

const { realAgentRunner } = await import('./runner')
const { setDetectedAgents } = await import('./launch')

const isWin = process.platform === 'win32'
const EXE = join(isWin ? 'C:\\klarit-bin' : '/klarit-bin', 'claude.exe')
const AGENT: DetectedAgent = { id: 'claude-code', name: 'Claude Code', models: [], executablePath: EXE }

/** 假子进程：可从测试侧往 stdout 喂行。 */
function fakeChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: unknown; pid: number } {
  const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: unknown; pid: number }
  c.pid = 4242
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  c.stdin = { write: vi.fn(), end: vi.fn() }
  return c
}

let child: ReturnType<typeof fakeChild>
let dir: string

/** claude stream-json 的一段真实形状：init 系统事件 + 工具调用 + 工具结果 + 文本 + 完成。 */
const LINES = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sid-1', tools: ['Read', 'Edit'] }),
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/main/engine/engine-very-long-name.ts' } }
      ]
    }
  }),
  JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '第 42 行：export function createEngine' }] }
  }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '我看完了，开始改。' }] } }),
  JSON.stringify({ type: 'result', result: '完成' })
]

beforeEach(() => {
  spawnMock.mockReset()
  child = fakeChild()
  spawnMock.mockImplementation(() => child)
  setDetectedAgents([AGENT])
  dir = testTmpDir('klarit-hist-')
})

afterEach(() => {
  setDetectedAgents([])
  rmSync(dir, { recursive: true, force: true })
})

describe('原始流记录逐行落盘', () => {
  it('逐行原样落盘，含展示转写会折叠的事件（工具结果 / 系统事件）', () => {
    const historyPath = join(dir, 'node-n1.raw.jsonl')
    const shown: string[] = []
    realAgentRunner.start({
      toolId: 'claude-code',
      cwd: dir,
      prompt: 'p',
      historyPath,
      onChunk: (s, c) => {
        if (s === 'stdout') shown.push(c)
      }
    })
    child.stdout.emit('data', Buffer.from(`${LINES.join('\n')}\n`))

    const raw = readFileSync(historyPath, 'utf8')
    expect(raw.split('\n').filter((l) => l.trim())).toEqual(LINES) // 逐行原样、一行不少、不改写
    expect(raw).toContain('"type":"system"') // 展示转写整类丢弃的系统事件仍在
    expect(raw).toContain('tool_result') // 展示转写整类丢弃的工具结果仍在
    expect(raw).toContain('src/main/engine/engine-very-long-name.ts') // 完整目标，未被展示的 80 字截断削过

    // 展示转写照旧压缩：不含工具结果/系统事件 —— 两份并存、互不取代
    const display = shown.join('')
    expect(display).toContain('[工具] Read')
    expect(display).not.toContain('tool_result')
    expect(display).not.toContain('"type":"system"')
  })

  it('运行半路中断 → 原始记录与展示转写均含到中断为止的内容（非空）', () => {
    const historyPath = join(dir, 'node-n2.raw.jsonl')
    const shown: string[] = []
    const launch = realAgentRunner.start({
      toolId: 'claude-code',
      cwd: dir,
      prompt: 'p',
      historyPath,
      onChunk: (s, c) => {
        if (s === 'stdout') shown.push(c)
      }
    })
    // 只流出前三行就被杀（关软件/崩溃）
    child.stdout.emit('data', Buffer.from(`${LINES.slice(0, 3).join('\n')}\n`))
    launch?.kill()

    const raw = readFileSync(historyPath, 'utf8')
    expect(raw.split('\n').filter((l) => l.trim())).toEqual(LINES.slice(0, 3))
    expect(shown.join('')).toContain('[工具] Read')
  })

  it('落盘逐行即时：每来一行就已在盘上，不等运行结束、不等缓冲攒够', () => {
    const historyPath = join(dir, 'node-n3.raw.jsonl')
    realAgentRunner.start({ toolId: 'claude-code', cwd: dir, prompt: 'p', historyPath })
    for (const [i, line] of LINES.entries()) {
      child.stdout.emit('data', Buffer.from(`${line}\n`))
      expect(readFileSync(historyPath, 'utf8').split('\n').filter((l) => l.trim())).toHaveLength(i + 1)
    }
  })

  it('半行（分片抵达）不落盘，凑齐整行才落 —— 记录里没有被腰斩的 JSON', () => {
    const historyPath = join(dir, 'node-n4.raw.jsonl')
    realAgentRunner.start({ toolId: 'claude-code', cwd: dir, prompt: 'p', historyPath })
    const line = LINES[1]
    child.stdout.emit('data', Buffer.from(line.slice(0, 20)))
    expect(existsSync(historyPath) ? readFileSync(historyPath, 'utf8') : '').toBe('')
    child.stdout.emit('data', Buffer.from(`${line.slice(20)}\n`))
    expect(readFileSync(historyPath, 'utf8')).toBe(`${line}\n`)
  })
})
