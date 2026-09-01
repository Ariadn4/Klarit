import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import {
  HABIT_CONTEXT_MANIFEST_NAME,
  cleanupHabitContext,
  materializeHabitContext,
  withHabitContextPack,
  type HabitContextDeps,
  type HabitContextMember
} from './habit-context'
import { authorWorkflow, createOrchestrateSeam, type OpsProducer, type OrchestrateDeps } from './orchestrate-service'
import { lintWorkflow } from '../shared/workflow'
import type { CardTypeDef, WorkflowDefinition } from '../shared/types'
import { testTmpDir } from './test-tmp'

/** 本用例文件建的所有真实临时目录，收尾统一删。 */
const trash: string[] = []

function tmpDir(prefix: string): string {
  const dir = testTmpDir(`klarit-${prefix}-`)
  trash.push(dir)
  return dir
}

/** 在某根下写一个文件（自动建父目录），返回其绝对路径。 */
function put(root: string, rel: string, content: string): string {
  const abs = join(root, ...rel.split('/'))
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  return abs
}

/** 递归列出某目录下的全部相对路径（供「不写进成员仓」的前后对照）。 */
function listAll(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      out.push(relative(root, abs).split(sep).join('/'))
      if (statSync(abs).isDirectory()) walk(abs)
    }
  }
  walk(root)
  return out.sort()
}

/** 一份可注入的最小 deps：应用临时区 + git 桩（默认无提交历史）。 */
function makeDeps(over: Partial<HabitContextDeps> = {}): HabitContextDeps {
  return { tmpRoot: tmpDir('apptmp'), git: () => () => null, ...over }
}

afterEach(() => {
  while (trash.length > 0) {
    const dir = trash.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('materializeHabitContext 逐字物化', () => {
  it('包内副本与原文件逐字节相同（无摘要、无截断、无改写）', () => {
    const repo = tmpDir('repo')
    // 混 CRLF/LF、Unicode、无结尾换行、长正文——任何"顺手规整"都会破坏字节相等。
    const body = ['# CLAUDE.md', '规矩一：先写测试。\r\n混行尾', '中文 + emoji 🙂', 'x'.repeat(5000), '结尾无换行'].join('\n')
    const src = put(repo, 'CLAUDE.md', body)

    const pack = materializeHabitContext([{ name: 'web', root: repo }], makeDeps())
    expect(pack).not.toBeNull()
    const copy = join(pack!.dir, 'web', 'CLAUDE.md')
    expect(readFileSync(copy)).toEqual(readFileSync(src))
    expect(statSync(copy).size).toBe(statSync(src).size)
    expect(pack!.files.map((f) => f.packRelPath)).toContain('web/CLAUDE.md')
  })

  it('目录标记（.claude/）整棵逐字复制，子目录结构保留', () => {
    const repo = tmpDir('repo')
    put(repo, '.claude/settings.json', '{"permissions":{"allow":["Bash(npm test)"]}}')
    put(repo, '.claude/skills/deploy/SKILL.md', '# deploy\n照这个来。')

    const pack = materializeHabitContext([{ name: 'web', root: repo }], makeDeps())
    expect(readFileSync(join(pack!.dir, 'web', '.claude', 'settings.json'), 'utf8')).toBe(
      '{"permissions":{"allow":["Bash(npm test)"]}}'
    )
    expect(readFileSync(join(pack!.dir, 'web', '.claude', 'skills', 'deploy', 'SKILL.md'), 'utf8')).toBe(
      '# deploy\n照这个来。'
    )
  })

  it('超大文件 → 整个不收录 + manifest 标注「过大未收录」，包内不出现半截内容', () => {
    const repo = tmpDir('repo')
    const head = 'HEAD-MARKER-规矩第一条'
    put(repo, 'CLAUDE.md', head + '\n' + 'y'.repeat(9000))
    put(repo, 'AGENTS.md', '小文件照收')

    const pack = materializeHabitContext([{ name: 'web', root: repo }], makeDeps({ maxFileBytes: 1024 }))
    // 整个不收录：包内没有该文件。
    expect(existsSync(join(pack!.dir, 'web', 'CLAUDE.md'))).toBe(false)
    expect(pack!.files.map((f) => f.packRelPath)).not.toContain('web/CLAUDE.md')
    // manifest 标注真实路径 + 「过大未收录」。
    const manifest = readFileSync(pack!.manifestPath, 'utf8')
    expect(manifest).toContain(join(repo, 'CLAUDE.md'))
    expect(manifest).toContain('过大未收录')
    // 断言不出现半截内容：正文任何片段都不该进包（含 manifest）。
    for (const rel of listAll(pack!.dir)) {
      const abs = join(pack!.dir, rel)
      if (statSync(abs).isDirectory()) continue
      expect(readFileSync(abs, 'utf8')).not.toContain(head)
    }
    // 未超限的痕迹照收（不因一份过大而整包作废）。
    expect(readFileSync(join(pack!.dir, 'web', 'AGENTS.md'), 'utf8')).toBe('小文件照收')
  })

  it('多仓同名 CLAUDE.md → 各落各成员仓子目录，互不覆盖', () => {
    const web = tmpDir('repo-web')
    const api = tmpDir('repo-api')
    put(web, 'CLAUDE.md', 'WEB 的规矩')
    put(api, 'CLAUDE.md', 'API 的规矩')

    const pack = materializeHabitContext(
      [
        { name: 'web', root: web },
        { name: 'api', root: api }
      ],
      makeDeps()
    )
    expect(readFileSync(join(pack!.dir, 'web', 'CLAUDE.md'), 'utf8')).toBe('WEB 的规矩')
    expect(readFileSync(join(pack!.dir, 'api', 'CLAUDE.md'), 'utf8')).toBe('API 的规矩')
  })

  it('成员仓显示名撞名 → 包内子目录去重，二者都能被读到', () => {
    const one = tmpDir('repo-1')
    const two = tmpDir('repo-2')
    put(one, 'CLAUDE.md', '第一个 app')
    put(two, 'CLAUDE.md', '第二个 app')

    const pack = materializeHabitContext(
      [
        { name: 'app', root: one },
        { name: 'app', root: two }
      ],
      makeDeps()
    )
    const bodies = pack!.files.map((f) => readFileSync(join(pack!.dir, ...f.packRelPath.split('/')), 'utf8')).sort()
    expect(bodies).toEqual(['第一个 app', '第二个 app'])
    expect(new Set(pack!.files.map((f) => f.packRelPath)).size).toBe(2)
  })

  it('包建在应用临时区：不在任何成员仓内、不在项目目录内，且成员仓一个字节都没被动过', () => {
    const projectDir = tmpDir('project')
    const web = join(projectDir, 'web')
    mkdirSync(web, { recursive: true })
    put(web, 'CLAUDE.md', '规矩')
    const before = listAll(projectDir)

    const appTmp = tmpDir('apptmp')
    const pack = materializeHabitContext([{ name: 'web', root: web }], makeDeps({ tmpRoot: appTmp }))

    expect(resolve(pack!.dir).startsWith(resolve(appTmp) + sep)).toBe(true)
    expect(resolve(pack!.dir).startsWith(resolve(web) + sep)).toBe(false)
    expect(resolve(pack!.dir).startsWith(resolve(projectDir) + sep)).toBe(false)
    // 成员仓/项目目录内容前后完全一致（没往用户仓库里写任何东西）。
    expect(listAll(projectDir)).toEqual(before)
  })

  it('无任何痕迹命中 → 不建包（返回 null，临时区不留目录）', () => {
    const repo = tmpDir('repo')
    put(repo, 'README.md', '啥痕迹也没有')
    const appTmp = tmpDir('apptmp')

    expect(materializeHabitContext([{ name: 'web', root: repo }], makeDeps({ tmpRoot: appTmp }))).toBeNull()
    expect(existsSync(appTmp) ? readdirSync(appTmp) : []).toEqual([])
  })
})

describe('上下文包 manifest 组成', () => {
  function fixture(): { pack: NonNullable<ReturnType<typeof materializeHabitContext>>; repo: string; manifest: string } {
    const repo = tmpDir('repo')
    put(repo, 'CLAUDE.md', '规矩')
    put(repo, '.claude/settings.json', '{}')
    put(repo, 'README.md', 'README-独有内容-不该被读进 manifest')
    put(repo, 'package.json', '{\n  "name": "web",\n  "scripts": {\n    "test": "vitest run",\n    "build": "tsc -b"\n  }\n}')
    put(repo, 'src/main/deep/secret.txt', 'DEEP-SECRET-内容')

    const gitLog = 'a1b2c3d feat(x): 加了个东西\ne4f5g6h fix(y): 修了个 bug'
    const pack = materializeHabitContext(
      [{ name: 'web', root: repo }],
      makeDeps({ git: () => (args) => (args[0] === 'log' ? gitLog : null), treeDepth: 2 })
    )
    return { pack: pack!, repo, manifest: readFileSync(pack!.manifestPath, 'utf8') }
  }

  it('列出每个包内文件的真实绝对路径与包内位置', () => {
    const { pack, repo, manifest } = fixture()
    expect(pack.manifestPath).toBe(join(pack.dir, HABIT_CONTEXT_MANIFEST_NAME))
    for (const f of pack.files) {
      expect(manifest).toContain(f.packRelPath)
      expect(manifest).toContain(f.sourcePath)
    }
    expect(manifest).toContain(join(repo, 'CLAUDE.md'))
    expect(manifest).toContain('web/CLAUDE.md')
  })

  it('列出成员仓清单（名 + 仓根真实路径）', () => {
    const { repo, manifest } = fixture()
    expect(manifest).toContain('成员仓')
    expect(manifest).toContain(repo)
    expect(manifest).toContain('web')
  })

  it('含 git log --oneline 原样输出（逐行原文，Klarit 不归纳）', () => {
    const { manifest } = fixture()
    expect(manifest).toContain('git log --oneline')
    expect(manifest).toContain('a1b2c3d feat(x): 加了个东西')
    expect(manifest).toContain('e4f5g6h fix(y): 修了个 bug')
  })

  it('git log 用注入的 runner 逐仓跑 --oneline -n N（不自己解析提交）', () => {
    const repo = tmpDir('repo')
    put(repo, 'CLAUDE.md', '规矩')
    const calls: { root: string; args: string[] }[] = []
    materializeHabitContext(
      [{ name: 'web', root: repo }],
      makeDeps({
        gitLogCount: 7,
        git: (root) => (args) => {
          calls.push({ root, args })
          return 'deadbee chore: x'
        }
      })
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].root).toBe(repo)
    expect(calls[0].args).toEqual(['log', '--oneline', '-n', '7'])
  })

  it('含各成员仓 package.json 的 scripts（原样，不归纳）', () => {
    const { manifest } = fixture()
    expect(manifest).toContain('scripts')
    expect(manifest).toContain('"test": "vitest run"')
    expect(manifest).toContain('"build": "tsc -b"')
  })

  it('含深度受限的项目目录清单：只列路径、不读内容、不越深度', () => {
    const { manifest } = fixture()
    // 深度内的路径列出。
    expect(manifest).toContain('src/main/')
    expect(manifest).toContain('README.md')
    // 越深的不列。
    expect(manifest).not.toContain('src/main/deep/')
    expect(manifest).not.toContain('secret.txt')
    // 只列路径——列到的文件其内容绝不出现。
    expect(manifest).not.toContain('README-独有内容-不该被读进 manifest')
    expect(manifest).not.toContain('DEEP-SECRET-内容')
  })
})

describe('上下文包生命周期（per-run：每次新建、结束即清）', () => {
  it('每次调用新建一个包（两次调用互不复用同一目录）', async () => {
    const repo = tmpDir('repo')
    put(repo, 'CLAUDE.md', '规矩')
    const deps = makeDeps()
    const members: HabitContextMember[] = [{ name: 'web', root: repo }]

    const dirs: string[] = []
    await withHabitContextPack(members, deps, async ({ pack }) => void dirs.push(pack!.dir))
    await withHabitContextPack(members, deps, async ({ pack }) => void dirs.push(pack!.dir))
    expect(dirs[0]).not.toBe(dirs[1])
  })

  it('正常结束 → 包被清理，临时区不残留', async () => {
    const repo = tmpDir('repo')
    put(repo, 'CLAUDE.md', '规矩')
    const appTmp = tmpDir('apptmp')

    let packDir = ''
    const out = await withHabitContextPack([{ name: 'web', root: repo }], makeDeps({ tmpRoot: appTmp }), async ({ pack }) => {
      packDir = pack!.dir
      expect(existsSync(join(packDir, HABIT_CONTEXT_MANIFEST_NAME))).toBe(true)
      return 'done'
    })
    expect(out).toBe('done')
    expect(existsSync(packDir)).toBe(false)
    expect(readdirSync(appTmp)).toEqual([])
  })

  it('author 失败/超时（回调抛错）→ 同样清理，错误原样透传', async () => {
    const repo = tmpDir('repo')
    put(repo, 'CLAUDE.md', '规矩')
    const appTmp = tmpDir('apptmp')

    let packDir = ''
    await expect(
      withHabitContextPack([{ name: 'web', root: repo }], makeDeps({ tmpRoot: appTmp }), async ({ pack }) => {
        packDir = pack!.dir
        throw new Error('agent 编排调用超时')
      })
    ).rejects.toThrow('agent 编排调用超时')
    expect(existsSync(packDir)).toBe(false)
    expect(readdirSync(appTmp)).toEqual([])
  })

  it('清理失败不影响主流程（包目录已被外部删掉也不抛）', async () => {
    const repo = tmpDir('repo')
    put(repo, 'CLAUDE.md', '规矩')
    const out = await withHabitContextPack([{ name: 'web', root: repo }], makeDeps(), async ({ pack }) => {
      rmSync(pack!.dir, { recursive: true, force: true })
      return 'ok'
    })
    expect(out).toBe('ok')
    // 直接对已消失的包再清一次也不抛。
    expect(() => cleanupHabitContext({ dir: join(tmpdir(), 'klarit-not-there'), manifestPath: '', files: [], omitted: [] })).not.toThrow()
  })
})

describe('author 的可访问目录（挂包不挂仓根，回退路径保留）', () => {
  it('可访问目录只有上下文包，不含任何成员仓根', async () => {
    const web = tmpDir('repo-web')
    const api = tmpDir('repo-api')
    put(web, 'CLAUDE.md', 'W')
    put(api, 'AGENTS.md', 'A')

    let seen: string[] = []
    await withHabitContextPack(
      [
        { name: 'web', root: web },
        { name: 'api', root: api }
      ],
      makeDeps(),
      async ({ addDirs, pack }) => {
        seen = addDirs
        expect(addDirs).toEqual([pack!.dir])
      }
    )
    expect(seen).not.toContain(web)
    expect(seen).not.toContain(api)
  })

  it('无痕迹 → 无包、可访问目录为空（不回落挂仓根）', async () => {
    const repo = tmpDir('repo')
    put(repo, 'README.md', '无痕迹')
    await withHabitContextPack([{ name: 'web', root: repo }], makeDeps(), async ({ addDirs, pack }) => {
      expect(pack).toBeNull()
      expect(addDirs).toEqual([])
    })
  })

  it('回退方案（dogfood 若发现漏得厉害）：mountMemberRoots → 包 + 仓根一起挂，manifest 仍在', async () => {
    const web = tmpDir('repo-web')
    put(web, 'CLAUDE.md', 'W')
    await withHabitContextPack(
      [{ name: 'web', root: web }],
      makeDeps({ mountMemberRoots: true }),
      async ({ addDirs, pack }) => {
        expect(addDirs).toEqual([pack!.dir, web])
      }
    )
  })

  it('回退方案下无痕迹 → 仍挂仓根（包为 null 不代表没得看）', async () => {
    const repo = tmpDir('repo')
    put(repo, 'README.md', '无痕迹')
    await withHabitContextPack(
      [{ name: 'web', root: repo }],
      makeDeps({ mountMemberRoots: true }),
      async ({ addDirs, pack }) => {
        expect(pack).toBeNull()
        expect(addDirs).toEqual([repo])
      }
    )
  })
})

describe('产出契约不变（回归）：author 照旧产整份、照旧过脚手架规整与两闸校验', () => {
  const TYPES: CardTypeDef[] = [
    { id: 'epic', name: 'Epic', description: '', archetype: 'container' },
    { id: 'feat', name: 'Feat', description: '', archetype: 'leaf' }
  ]
  const orchestrateDeps = (): OrchestrateDeps => ({
    getCards: () => [],
    getTypes: () => TYPES,
    getGoals: () => '',
    getConstitution: () => []
  })

  it('在上下文包里跑 author：产出仍是整份定义，经固定脚手架规整、两闸校验干净', async () => {
    const repo = tmpDir('repo')
    put(repo, 'CLAUDE.md', '先写测试。')

    // author 照旧产整份（脊柱摆错），规整应把干活节点当中间、套固定头尾。
    const misordered: WorkflowDefinition = {
      id: 'habit',
      name: { zh: '习惯流' },
      stages: [{ id: 's', name: { zh: '干活' } }],
      nodes: [
        { id: 'do-work', name: { zh: '实现' }, stageId: 's', executor: { kind: 'agent', instruction: { kind: 'inline', text: '实现需求' } }, outputs: [] },
        { id: 'merge', name: { zh: '合并' }, stageId: 's', executor: { kind: 'engine', operation: 'merge-branch' }, outputs: [] }
      ]
    }
    const produce: OpsProducer = async () => ({ ops: [], reply: '按习惯搭了个流', workflow: { workflow: misordered } })

    const result = await withHabitContextPack([{ name: 'web', root: repo }], makeDeps(), ({ pack }) => {
      expect(pack).not.toBeNull()
      return authorWorkflow(orchestrateDeps(), produce, 'proj-1', '照习惯写')
    })

    const wf = result.proposal?.workflow
    expect(wf).toBeTruthy()
    const ops = wf!.nodes.map((n) => (n.executor.kind === 'engine' ? n.executor.operation : n.id))
    expect(ops.slice(0, 3)).toEqual(['create-branch', 'open-worktree', 'link-env'])
    expect(wf!.nodes.some((n) => n.id === 'do-work')).toBe(true)
    expect(ops[ops.length - 1]).toBe('delete-branch')
    expect(result.proposal?.issues).toEqual([])
    expect(lintWorkflow(wf!)).toEqual([])
    expect(result.failure).toBeUndefined()
  })

  it('author 失败（空产出）→ 富结果照旧区分种类，且包照样清理', async () => {
    const repo = tmpDir('repo')
    put(repo, 'CLAUDE.md', '规矩')
    const appTmp = tmpDir('apptmp')
    const produce: OpsProducer = async () => ({ ops: [], reply: '暂不需要新流' })

    const result = await withHabitContextPack([{ name: 'web', root: repo }], makeDeps({ tmpRoot: appTmp }), () =>
      authorWorkflow(orchestrateDeps(), produce, 'proj-1', '照习惯写')
    )
    expect(result.proposal).toBeNull()
    expect(result.failure).toBe('empty')
    expect(readdirSync(appTmp)).toEqual([])
  })

  it('聊天写工作流路不受影响：走 seam 直出整份、不套脚手架、不建上下文包', async () => {
    const appTmp = tmpDir('apptmp')
    const chatDef: WorkflowDefinition = {
      id: 'chat-flow',
      name: { zh: '聊天里搭的流' },
      stages: [{ id: 's', name: { zh: '干活' } }],
      nodes: [
        { id: 'only-node', name: { zh: '干活' }, stageId: 's', executor: { kind: 'agent', instruction: { kind: 'inline', text: '干' } }, outputs: [] }
      ]
    }
    const produce: OpsProducer = async () => ({ ops: [], workflow: { workflow: chatDef } })
    // 聊天路走 seam（不经 authorWorkflow、不经 withHabitContextPack）——产出原样整份，临时区始终为空。
    const outcome = await createOrchestrateSeam(orchestrateDeps(), produce).orchestrate({ intent: '给我搭个流' }, 'proj-1')
    const wf = 'unbound' in outcome ? undefined : outcome.workflow?.workflow
    expect(wf?.id).toBe('chat-flow')
    expect(wf?.nodes.map((n) => n.id)).toEqual(['only-node'])
    expect(readdirSync(appTmp)).toEqual([])
  })
})
