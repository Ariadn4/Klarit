/**
 * agent 子进程「怎么被起来」的约束（本 change 的进方向）：绝对路径、不经 shell 字符串拼接、
 * `.cmd` 逐项加引号、env 净化、透传参数封元字符。**两处调用点共用同一实现**，故同一份用例
 * 分别跑过 `agent/runner`（引擎节点/续接）与 `agent-runner`（分解/全局对话）两条路径。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import type { DetectedAgent } from '../../shared/types'

const spawnMock = vi.fn()
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
  execFileSync: vi.fn()
}))

const { realAgentRunner } = await import('./runner')
const { setDetectedAgents } = await import('./launch')
const { headlessInvocation, runAgentHeadless } = await import('../agent-runner')

const isWin = process.platform === 'win32'
const BIN = isWin ? 'C:\\klarit-bin' : '/klarit-bin'
const EXE = join(BIN, 'claude.exe')
const CMD = join(BIN, 'claude.cmd')
const WT = isWin ? 'C:\\repo--wt--feat' : '/repo--wt--feat'
const COMSPEC = process.env.ComSpec ?? 'cmd.exe'

function detected(executablePath: string): DetectedAgent {
  return { id: 'claude-code', name: 'Claude Code', models: [], executablePath }
}

/** 假子进程：够 runner / headless 挂监听与写 stdin。 */
function fakeChild(): EventEmitter & Record<string, unknown> {
  const c = new EventEmitter() as EventEmitter & Record<string, unknown>
  c.pid = 4242
  c.stdout = new EventEmitter()
  c.stderr = new EventEmitter()
  c.stdin = { write: vi.fn(), end: vi.fn() }
  return c
}

/** 模拟 cmd 的引号状态扫描：落在引号外的元字符就是「能拼出第二条命令」的口子。 */
function metaOutsideQuotes(line: string): string[] {
  const leaked: string[] = []
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && '&|<>^'.includes(ch)) leaked.push(ch)
  }
  return leaked
}

/** 最近一次 spawn 的 `[命令, 参数, 选项]`。 */
function lastSpawn(): [string, string[], Record<string, unknown>] {
  return spawnMock.mock.calls.at(-1) as [string, string[], Record<string, unknown>]
}

beforeEach(() => {
  spawnMock.mockReset()
  spawnMock.mockImplementation(() => fakeChild())
  setDetectedAgents([detected(EXE)])
})

afterEach(() => {
  vi.unstubAllEnvs()
  setDetectedAgents([])
})

/** 两条调用点：同一份约束都要成立。 */
const CASES = [
  {
    name: '引擎节点 agent（agent/runner）',
    launch: (opts: { extraDirs?: string[] } = {}) => {
      realAgentRunner.start({ toolId: 'claude-code', cwd: WT, prompt: '完整 prompt', ...opts })
    }
  },
  {
    name: '分解 / 全局对话（agent-runner）',
    launch: () => {
      void runAgentHeadless(headlessInvocation('claude-code'), '完整 prompt').catch(() => {})
    }
  }
]

describe.each(CASES)('共用启动约束 · $name', ({ launch }) => {
  it('以解析出的绝对路径启动，不把裸命令名交给 shell', () => {
    launch()
    const [cmd, args, opts] = lastSpawn()
    expect(cmd).toBe(EXE)
    expect(cmd).not.toBe('claude')
    expect(Array.isArray(args)).toBe(true)
    expect(opts.shell).toBeFalsy() // .exe 直起：参数走数组，结构上没有拼接面
    expect(opts.windowsVerbatimArguments).toBeFalsy()
  })

  it('子进程环境无着色、不声称终端能力（父进程带这些键时亦然）', () => {
    vi.stubEnv('WT_SESSION', 'abc-123')
    vi.stubEnv('COLORTERM', 'truecolor')
    vi.stubEnv('FORCE_COLOR', '3')
    launch()
    const env = lastSpawn()[2].env as NodeJS.ProcessEnv
    expect(env.NO_COLOR).toBe('1')
    expect(env.FORCE_COLOR).toBe('0')
    expect(env.WT_SESSION).toBeUndefined()
    expect(env.COLORTERM).toBeUndefined()
    expect(env.PATH ?? env.Path).toBeTruthy() // 只剔除终端能力相关键，其余照旧继承
  })

  it('.cmd 形态经 cmd.exe，可执行路径与每个参数各自加引号', () => {
    setDetectedAgents([detected(CMD)])
    launch()
    const [cmd, args, opts] = lastSpawn()
    expect(cmd).toBe(COMSPEC)
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(opts.windowsVerbatimArguments).toBe(true) // 引号由我们加，不让 Node 再拼一层
    const line = args[3]
    expect(line.startsWith(`""${CMD}" `)).toBe(true)
    expect(line.endsWith('"')).toBe(true)
    expect(line).toContain('"-p"') // 每个参数各自加引号
  })
})

describe('共用启动约束 · 两处调用点一致', () => {
  it('解析不到可信绝对路径 → 归技术失败，两处均不回落裸命令名', async () => {
    setDetectedAgents([]) // 未检测到 claude
    expect(realAgentRunner.start({ toolId: 'claude-code', cwd: WT, prompt: 'p' })).toBeNull()
    await expect(runAgentHeadless(headlessInvocation('claude-code'), 'p')).rejects.toThrow()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('探测结果不是绝对路径 → 同样拒起（不信任非绝对路径）', () => {
    setDetectedAgents([detected('claude.cmd')])
    expect(realAgentRunner.start({ toolId: 'claude-code', cwd: WT, prompt: 'p' })).toBeNull()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('未落地的外壳 → null，不启动任何进程', () => {
    expect(realAgentRunner.start({ toolId: 'nope', cwd: WT, prompt: 'p' })).toBeNull()
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

describe('.cmd 形态的参数转义', () => {
  beforeEach(() => setDetectedAgents([detected(CMD)]))

  it('含空格 / & / " 的参数以字面值抵达，不产生第二条命令', () => {
    const spaced = isWin ? 'C:\\a b\\x & y' : '/a b/x & y'
    const quoted = isWin ? 'C:\\q"uote' : '/q"uote'
    realAgentRunner.start({ toolId: 'claude-code', cwd: WT, prompt: 'p', extraDirs: [spaced, quoted] })
    const line = lastSpawn()[1][3]
    expect(line).toContain(`"${spaced}"`) // 含空格与 & 的整项被引号包住 → cmd 不把 & 当命令分隔
    expect(line).toContain(`"${quoted.replace('"', '""')}"`) // 参数内的引号加倍，引号配对不被破坏
    // 按 cmd 的引号状态扫描（/s 会先去掉最外层那对引号）：引号外不该出现任何元字符，
    // 否则就能拼出第二条命令。
    expect(metaOutsideQuotes(line.slice(1, -1))).toEqual([])
  })

  it('参数含 %（cmd 变量展开）或换行 → 拒起，不静默改写', () => {
    realAgentRunner.start({ toolId: 'claude-code', cwd: WT, prompt: 'p', extraDirs: ['/tmp/%PATH%'] })
    expect(spawnMock).not.toHaveBeenCalled()
  })
})

describe('透传参数（extraArgs）边界', () => {
  it('含 shell 元字符 → 启动归技术失败并给出可辨认原因，不剥掉该参数照常启动', () => {
    const chunks: string[] = []
    const launch = realAgentRunner.start({
      toolId: 'claude-code',
      cwd: WT,
      prompt: 'p',
      extraArgs: '--foo & calc',
      onChunk: (_s, c) => chunks.push(c)
    })
    expect(launch).toBeNull()
    expect(spawnMock).not.toHaveBeenCalled()
    expect(chunks.join('')).toMatch(/元字符/)
  })

  it('普通 extraArgs 照旧按空白切分原样传入 argv', () => {
    realAgentRunner.start({ toolId: 'claude-code', cwd: WT, prompt: 'p', extraArgs: '--foo bar' })
    const args = lastSpawn()[1]
    expect(args).toContain('--foo')
    expect(args).toContain('bar')
  })
})

describe('续接（resume）走同一套启动', () => {
  it('原生 --resume 也以绝对路径启动、不经 shell', () => {
    realAgentRunner.resume({ toolId: 'claude-code', cwd: WT, inject: '续', sessionId: 'sid-1' })
    const [cmd, args, opts] = lastSpawn()
    expect(cmd).toBe(EXE)
    expect(opts.shell).toBeFalsy()
    expect(args[args.indexOf('--resume') + 1]).toBe('sid-1')
  })
})
