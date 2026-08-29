import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeAgentProbe, scanAgents, type AgentProbe } from './agents'
import { SUPPORTED_AGENTS } from '../shared/agents'

const isWin = process.platform === 'win32'
/** 该平台的合法可执行形态（win 上护栏只认 .exe/.cmd）。 */
const EXT = isWin ? '.cmd' : ''

let root: string
/** 受控解析目录（Klarit 自己的目录，非任何用户仓）。 */
let bin: string
/** 假装的「已注册项目 / 需求卡 worktree」目录。 */
let worktree: string

/** 造一个真实存在的可执行文件，返回其绝对路径。 */
function makeExe(dir: string, name: string, ext = EXT): string {
  const p = join(dir, `${name}${ext}`)
  writeFileSync(p, '@echo off\n')
  return p
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'klarit-agents-'))
  bin = join(root, 'bin')
  worktree = join(root, 'proj--wt--feat')
  mkdirSync(bin, { recursive: true })
  mkdirSync(worktree, { recursive: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** 每个受支持命令都解析到 bin 下的同名真实可执行文件。 */
function probeInBin(): AgentProbe {
  return (command) => [join(bin, `${command}${EXT}`)]
}

describe('scanAgents — 探测留下绝对路径', () => {
  beforeAll(() => {
    for (const a of SUPPORTED_AGENTS) makeExe(bin, a.command)
  })

  it('探测到的 agent 带可执行绝对路径，id/name/models 行为不变', () => {
    const claude = SUPPORTED_AGENTS.find((a) => a.id === 'claude-code')!
    const { agents } = scanAgents(probeInBin())
    expect(agents.map((a) => a.id)).toEqual(SUPPORTED_AGENTS.map((a) => a.id))
    const detected = agents.find((a) => a.id === 'claude-code')!
    expect(detected.name).toBe(claude.name)
    expect(detected.models).toEqual(claude.models)
    expect(detected.executablePath).toBe(join(bin, `${claude.command}${EXT}`))
  })

  it('未检测到任何 agent 时返回空列表、不抛，原因为「未解析到」', () => {
    const { agents, issues } = scanAgents(() => [])
    expect(agents).toEqual([])
    expect(issues.every((i) => i.reason === 'not-found')).toBe(true)
    expect(issues.map((i) => i.id)).toEqual(SUPPORTED_AGENTS.map((a) => a.id))
  })

  it('相对路径候选被拒 → 视为未检测到，原因可辨认为「被护栏拒绝」', () => {
    const { agents, issues } = scanAgents((command) => [`./${command}${EXT}`])
    expect(agents).toEqual([])
    expect(issues.every((i) => i.reason === 'rejected-by-guard')).toBe(true)
  })

  it('候选不是真实文件（不存在 / 是目录）→ 被拒', () => {
    const missing = scanAgents((command) => [join(bin, `nope-${command}${EXT}`)])
    expect(missing.agents).toEqual([])
    expect(missing.issues.every((i) => i.reason === 'rejected-by-guard')).toBe(true)
    const dir = scanAgents(() => [worktree])
    expect(dir.agents).toEqual([])
    expect(dir.issues.every((i) => i.reason === 'rejected-by-guard')).toBe(true)
  })

  it('候选落在已注册项目 / 需求卡 worktree 目录内 → 被拒，原因是护栏而非未安装', () => {
    for (const a of SUPPORTED_AGENTS) makeExe(worktree, a.command)
    const { agents, issues } = scanAgents((command) => [join(worktree, `${command}${EXT}`)], {
      forbiddenDirs: [worktree]
    })
    expect(agents).toEqual([])
    expect(issues.every((i) => i.reason === 'rejected-by-guard')).toBe(true)
    // 子目录内同样被拒
    const sub = join(worktree, 'node_modules', '.bin')
    mkdirSync(sub, { recursive: true })
    const inSub = makeExe(sub, 'claude')
    const nested = scanAgents(() => [inSub], { forbiddenDirs: [worktree] })
    expect(nested.agents).toEqual([])
  })

  it.runIf(isWin)('可执行形态不属该平台已知形态（非 .exe/.cmd）→ 被拒', () => {
    makeExe(bin, 'claude', '.txt')
    const { agents, issues } = scanAgents(() => [join(bin, 'claude.txt')])
    expect(agents).toEqual([])
    expect(issues.every((i) => i.reason === 'rejected-by-guard')).toBe(true)
  })

  it('多候选按解析顺序取第一个通过护栏的（where 会先列出无扩展名/仓内的同名文件）', () => {
    const good = join(bin, `claude${EXT}`)
    const { agents } = scanAgents(
      () => [join(worktree, `claude${EXT}`), './claude', good],
      { forbiddenDirs: [worktree] },
      [SUPPORTED_AGENTS.find((a) => a.id === 'claude-code')!]
    )
    expect(agents).toHaveLength(1)
    expect(agents[0].executablePath).toBe(good)
  })

  it('单个候选被护栏拒绝不影响其余 agent，整体不抛', () => {
    const codex = SUPPORTED_AGENTS.find((a) => a.id === 'codex')!
    const { agents, issues } = scanAgents((command) =>
      command === codex.command ? ['relative/codex'] : [join(bin, `${command}${EXT}`)]
    )
    expect(agents.map((a) => a.id)).not.toContain('codex')
    expect(agents).toHaveLength(SUPPORTED_AGENTS.length - 1)
    expect(issues).toEqual([{ id: 'codex', reason: 'rejected-by-guard', candidates: ['relative/codex'] }])
  })

  it('单个探测抛错/超时不影响其余 agent，整体成功返回', () => {
    const codex = SUPPORTED_AGENTS.find((a) => a.id === 'codex')!
    const probe: AgentProbe = vi.fn((command) => {
      if (command === codex.command) throw new Error('timeout')
      return [join(bin, `${command}${EXT}`)]
    })
    const { agents, issues } = scanAgents(probe)
    expect(agents.map((a) => a.id)).not.toContain('codex')
    expect(agents).toHaveLength(SUPPORTED_AGENTS.length - 1)
    expect(issues).toEqual([{ id: 'codex', reason: 'not-found', candidates: [] }])
  })
})

describe.runIf(isWin)('makeAgentProbe — 解析钉在受控工作目录下', () => {
  const NAME = 'klarit-probe-fake-agent'

  it('worktree 内的同名文件不成为候选（解析不在该目录下进行）', () => {
    makeExe(worktree, NAME, '.cmd')
    // 反证：where 的搜索范围含**当前目录**——在 worktree 下解析就会把仓内那个文件当成候选。
    expect(makeAgentProbe(worktree)(NAME)).toContain(join(worktree, `${NAME}.cmd`))
    // 钉住受控目录后，仓内同名文件不出现在候选里（PATH 里也没有它 → 无候选）。
    expect(makeAgentProbe(bin)(NAME)).toEqual([])
  })

  it('解析不到时返回空候选、不抛', () => {
    expect(() => makeAgentProbe(bin)('klarit-definitely-not-installed-xyz')).not.toThrow()
    expect(makeAgentProbe(bin)('klarit-definitely-not-installed-xyz')).toEqual([])
  })
})
