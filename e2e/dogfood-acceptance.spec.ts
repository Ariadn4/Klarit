/**
 * dogfood 验收：2026-08-11 归档那批 change 的真机验证（tasks 里一直挂着没做的那几项）。
 * 全部起真 Electron、真项目、真子进程——命令节点是真跑的，不是桩。
 */
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { seedMultiRepoProject, tempDir } from './helpers'

const MAIN = join(process.cwd(), 'out', 'main', 'index.js')

/** 造一个像样的 dogfood 项目：有 agent 痕迹、有文档、有 git 历史，不是空壳。 */
function makeDogfoodProject(name: string): string {
  const dir = join(tempDir(), name)
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, 'docs'), { recursive: true })
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(join(dir, 'CLAUDE.md'), '# 约定\n\n- 提交用 Conventional Commits\n- 测试先行\n')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, scripts: { test: 'echo ok' } }, null, 2))
  writeFileSync(join(dir, 'docs', 'goals.md'), '# 目标\n\n把事情做完。\n')
  writeFileSync(join(dir, 'docs', 'arch.md'), '# 架构\n\n单进程。\n')
  writeFileSync(join(dir, 'src', 'index.ts'), 'export {}\n')
  const git = (args: string[]): void => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'dogfood@klarit.test'])
  git(['config', 'user.name', 'klarit-dogfood'])
  git(['add', '.'])
  git(['commit', '-m', 'feat: 初始'])
  return dir
}

async function launch(userData: string, env: Record<string, string> = {}): Promise<ElectronApplication> {
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ language: 'zh', defaultAgent: 'claude-code', notifyOnDecision: true }, null, 2)
  )
  return electron.launch({ args: [MAIN, `--user-data-dir=${userData}`], env: { ...process.env, ...env } })
}

/** 起应用 + 预置项目，返回窗口。 */
async function bootProject(
  prefix: string
): Promise<{ app: ElectronApplication; win: Page; repo: string; userData: string }> {
  const repo = makeDogfoodProject(`${prefix}-repo`)
  const userData = tempDir('klarit-ud-')
  seedMultiRepoProject(userData, {
    id: 'p1',
    displayName: prefix,
    members: [{ id: 'm1', rootPath: repo, derivedName: `${prefix}-repo` }]
  })
  const app = await launch(userData)
  const win = await app.firstWindow()
  return { app, win, repo, userData }
}

/**
 * 探本机当前活着的 claude.exe 进程：可执行路径、命令行、父进程名。
 * 用来核对「以绝对路径起 agent、argv 不经 shell 拼接」——父进程若是 cmd.exe 就说明经了 shell。
 */
function probeClaudeProcesses(): Array<{ path: string; cmd: string; parent: string }> {
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name='claude.exe'\" | ForEach-Object { " +
    '$par = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.ParentProcessId)"; ' +
    '[pscustomobject]@{ path = $_.ExecutablePath; cmd = $_.CommandLine; parent = $par.Name } } | ' +
    'ConvertTo-Json -Compress -Depth 3'
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
      encoding: 'utf8'
    }).trim()
    if (!out) return []
    // PS 5.1 没有 -AsArray：单个对象会序列化成对象而非数组，这里归一化。
    const parsed = JSON.parse(out) as unknown
    return (Array.isArray(parsed) ? parsed : [parsed]) as Array<{
      path: string
      cmd: string
      parent: string
    }>
  } catch {
    return []
  }
}

// ── 验收 1：待决策收敛成收件箱（decision-inbox tasks 7.3）───────────────────
test('三张卡自动并发跑到验收门 → 收件箱计数、点条目跳转定位', async () => {
  test.setTimeout(120_000)
  const { app, win } = await bootProject('inbox')

  await win.evaluate(async () => {
    const def = await window.klarit.createWorkflow()
    def.stages = [{ id: 's1', name: '交付' }]
    def.nodes = [
      {
        id: 'n1',
        name: '验收前跑一下',
        stageId: 's1',
        executor: { kind: 'command', commands: [{ command: 'node -e "console.log(1)"' }] },
        outputs: [],
        gate: [{ kind: 'manual', actions: [] }]
      }
    ]
    const saved = await window.klarit.saveWorkflow(def)
    if (saved && (saved as { ok?: boolean }).ok === false) {
      throw new Error(`saveWorkflow 被拒：${JSON.stringify(saved)}`)
    }
    await window.klarit.setActiveWorkflow(def.id)
    await window.klarit.createCards([
      { proposedName: 'card-a', title: '卡A', description: '', typeId: 'feature', relations: [] },
      { proposedName: 'card-b', title: '卡B', description: '', typeId: 'feature', relations: [] },
      { proposedName: 'card-c', title: '卡C', description: '', typeId: 'feature', relations: [] }
    ])
  })
  await win.reload()

  // 通知只在「未聚焦 + 开关开 + 仅新增」时发 → 先挂监听再让窗口失焦。
  await win.evaluate(() => {
    const w = window as unknown as { __notified: unknown[] }
    w.__notified = []
    window.klarit.onDecisionNotify((e) => w.__notified.push(e))
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.blur())

  // 不显式 runCard：卡建出来即由自动排程并发起跑（验收项要的就是「自动并发」）。
  // 三张卡都停在人工验收门 → 收件箱三条
  await expect(async () => {
    const n = await win.evaluate(async () => (await window.klarit.listDecisionInbox()).length)
    expect(n).toBe(3)
  }).toPass({ timeout: 60_000 })

  // 徽标计数
  const inboxBtn = win.getByRole('button', { name: /收件箱/ })
  await expect(inboxBtn.locator('span').first()).toHaveText('3', { timeout: 10_000 })

  // 点条目 → 跳转并定位到那张卡
  const first = await win.evaluate(async () => (await window.klarit.listDecisionInbox())[0].cardName)
  await inboxBtn.click()
  await win.getByRole('dialog').getByText(first, { exact: false }).first().click()
  await expect(win.getByText(first).first()).toBeVisible({ timeout: 10_000 })

  await app.close()
})

// ── 验收 1b：未聚焦发桌面通知（曾经是坏的，dogfood 查出、已修）────────────────
// 原根因：engine 的 raiseDecision 只改内存断点就 emit，落盘在 drive() 末尾；而收件箱的
// getBreakpoint 是 runStore.load()（读盘）。decision 事件到达时盘上那份还没有 pendingDecision，
// refresh() 早退 →「新增」从未被宣告 → 通知丢失；随后 rebuild() 静默补上条目，所以计数是对的、
// 唯独通知没了。修法：raiseDecision 在 emit 前先 deps.store.save(bp)（见 engine-execution 规格
// 「抛决策 MUST 先落盘、再发事件」），单测钉在 engine.test.ts。
test('未聚焦时新增待决策发桌面通知', async () => {
  test.setTimeout(120_000)
  const { app, win } = await bootProject('notify')

  // 只装工作流、**先不建卡**：卡一建出来自动排程立刻起跑，若那时监听还没挂上（或正好在
  // win.reload() 拆重建渲染层的窗口里），通知就发给了一个没有监听的窗口，测出假阴性（已踩过）。
  await win.evaluate(async () => {
    const def = await window.klarit.createWorkflow()
    def.stages = [{ id: 's1', name: '交付' }]
    def.nodes = [
      {
        id: 'n1',
        name: '验收前跑一下',
        stageId: 's1',
        executor: { kind: 'command', commands: [{ command: 'node -e "console.log(1)"' }] },
        outputs: [],
        gate: [{ kind: 'manual', actions: [] }]
      }
    ]
    const saved = await window.klarit.saveWorkflow(def)
    if (saved && (saved as { ok?: boolean }).ok === false) {
      throw new Error(`saveWorkflow 被拒：${JSON.stringify(saved)}`)
    }
    await window.klarit.setActiveWorkflow(def.id)
  })
  await win.reload()

  await win.evaluate(() => {
    const w = window as unknown as { __notified: unknown[] }
    w.__notified = []
    window.klarit.onDecisionNotify((e) => w.__notified.push(e))
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.blur())

  // 监听挂好、窗口已失焦，这时才建卡 → 自动排程起跑 → 抛决策 → 应当发通知
  await win.evaluate(async () => {
    await window.klarit.createCards([
      { proposedName: 'card-n', title: '通知卡', description: '', typeId: 'feature', relations: [] }
    ])
  })

  // app.close() 放 finally：断言一抛就跳过关闭的话，这个 Electron 实例会泄漏，
  // 后续用例被它的巡检/排程回路抢 CPU 而超时（已实测踩过）。
  try {
    await expect(async () => {
      const n = await win.evaluate(async () => (await window.klarit.listDecisionInbox()).length)
      expect(n).toBe(1)
    }).toPass({ timeout: 60_000 })

    const notified = await win.evaluate(
      () => (window as unknown as { __notified: unknown[] }).__notified.length
    )
    expect(notified).toBe(1)
  } finally {
    await app.close()
  }
})

// ── 验收 2：运行记录时间线（run-timeline-view tasks 5.3）─────────────────────
// 门重试走**超时**而非「命令失败」：command 节点的客观门以 error 失败会触发 AI 自愈
// （healCommand 起真 agent 去修，见 engine.ts「脚本类」分支），那条路不产生 gate-retry、
// 还会真花钱。timeout 的 cause 跳过自愈，直接进「自动重试至多 MAX_GATE_RETRY 次」。
test('跑一张含门重试与验收门的卡 → 时间线按节点分段、记下重试、耗时对得上', async () => {
  test.setTimeout(180_000)
  const { app, win } = await bootProject('timeline')

  await win.evaluate(async () => {
    const def = await window.klarit.createWorkflow()
    def.stages = [{ id: 's1', name: '交付' }]
    def.nodes = [
      {
        id: 'n1',
        name: '构建',
        stageId: 's1',
        executor: { kind: 'command', commands: [{ command: 'node -e "console.log(1)"' }] },
        outputs: [],
        // 门把命令睡 8 秒、门限 1 秒 → 必超时 → 自动重试（rerun=gate），满 3 次升级成人工决策。
        gate: [
          {
            kind: 'auto',
            check: { kind: 'inline', command: 'node -e "setTimeout(()=>{}, 8000)"' },
            timeoutSec: 1
          }
        ]
      },
      {
        id: 'n2',
        name: '验收',
        stageId: 's1',
        executor: { kind: 'command', commands: [{ command: 'node -e "console.log(2)"' }] },
        outputs: [],
        gate: [{ kind: 'manual', actions: [] }]
      }
    ]
    const saved = await window.klarit.saveWorkflow(def)
    if (saved && (saved as { ok?: boolean }).ok === false) {
      throw new Error(`saveWorkflow 被拒：${JSON.stringify(saved)}`)
    }
    await window.klarit.setActiveWorkflow(def.id)
    await window.klarit.createCards([
      { proposedName: 'tl-card', title: '时间线卡', description: '', typeId: 'feature', relations: [] }
    ])
  })
  await win.reload()
  // 交给自动排程起跑：显式再 runCard 会造出第二个运行，两次跑互相干扰（已实测踩过）。

  // 门连超 3 次 → 升级成人工决策，停在 n1
  await expect(async () => {
    const st = await win.evaluate(async () => {
      const runs = await window.klarit.listCardRuns('tl-card')
      if (!runs[0]) return null
      const j = await window.klarit.readRunJournal(runs[0].runId)
      return { retries: j.filter((e) => e.kind === 'gate-retry').length, runId: runs[0].runId }
    })
    expect(st?.retries).toBe(3)
  }).toPass({ timeout: 90_000 })

  const runId = await win.evaluate(async () => (await window.klarit.listCardRuns('tl-card'))[0].runId)

  // 回应「跳过本门」→ 继续走到 n2 的人工验收门
  await expect(async () => {
    const pd = await win.evaluate(async (id: string) => {
      const st = await window.klarit.getRunState(id)
      return !!st?.pendingDecision
    }, runId)
    expect(pd).toBe(true)
  }).toPass({ timeout: 30_000 })
  await win.evaluate(async (id: string) => window.klarit.decideRun(id, { optionId: 'skip' }), runId)

  await expect(async () => {
    const n = await win.evaluate(async () => (await window.klarit.listDecisionInbox()).length)
    expect(n).toBe(1)
  }).toPass({ timeout: 60_000 })

  const journal = await win.evaluate(
    async (id: string) => window.klarit.readRunJournal(id),
    runId
  )

  // 分段：两个节点各进入一次，次序为 n1 → n2
  const enters = journal.filter((e) => e.kind === 'node-enter')
  expect(enters.map((e) => ('nodeId' in e ? e.nodeId : ''))).toEqual(['n1', 'n2'])

  // 门重试确实记在 n1 上，且原因是超时、粒度是重跑门
  const retries = journal.filter((e) => e.kind === 'gate-retry')
  expect(retries.length).toBe(3)
  for (const r of retries) {
    expect('nodeId' in r ? r.nodeId : '').toBe('n1')
    expect('attempt' in r ? r.attempt.cause : '').toBe('timeout')
    expect('attempt' in r ? r.attempt.rerun : '').toBe('gate')
  }

  // 耗时对得上：事件时刻单调不减；n1 段跨越了 3 次 1 秒的超时，故至少 3 秒
  const ats = journal.map((e) => e.at)
  expect(ats).toEqual([...ats].sort((a, b) => a - b))
  const n1Enter = enters[0].at
  const n2Enter = enters[1].at
  expect(n2Enter - n1Enter).toBeGreaterThanOrEqual(3000)

  await app.close()
})

// ── 验收 3：项目级定时巡检（scheduled-patrol tasks 8.3）──────────────────────
test('建一条到期即发起的巡检 → 到期真发起、重开只补最近一次', async () => {
  test.setTimeout(300_000) // 主进程分钟级 tick，等得起
  const { app, win } = await bootProject('patrol')

  await win.evaluate(() => {
    const w = window as unknown as { __cands: unknown[] }
    w.__cands = []
    window.klarit.onPatrolCandidates((c) => w.__cands.push(c))
  })

  // everyHours 只校验 > 0 → 0.001 小时 = 3.6 秒，下一次分钟 tick 必到期。
  await win.evaluate(async () => {
    await window.klarit.savePatrol({
      id: 'p-doc',
      name: '文档腐烂扫描',
      trigger: { kind: 'everyHours', hours: 0.001 },
      action: { kind: 'docScan' },
      enabled: true
    })
  })

  // 到期发起：lastRunAt 被记上（「发起即记」，不等成功）
  await expect(async () => {
    const p = await win.evaluate(async () => (await window.klarit.listPatrols())[0])
    expect(typeof p.lastRunAt).toBe('number')
  }).toPass({ timeout: 150_000 })

  const firstRunAt = (await win.evaluate(async () => (await window.klarit.listPatrols())[0].lastRunAt)) as number

  // 停用再启用 → 只补最近一次，不把停用期间欠的次数排队补齐
  await win.evaluate(async () => {
    await window.klarit.setPatrolEnabled('p-doc', false)
    await window.klarit.setPatrolEnabled('p-doc', true)
  })
  await expect(async () => {
    const p = await win.evaluate(async () => (await window.klarit.listPatrols())[0])
    expect(p.lastRunAt).toBeGreaterThan(firstRunAt)
  }).toPass({ timeout: 150_000 })

  await app.close()
})

// ── 验收 5：agent 子进程边界（agent-subprocess-boundary tasks 7.2）──────────
// 起真实 claude CLI，花真钱。四条断言全是可观测事实，不看界面感觉。
test('跑真卡的 agent 节点 → 绝对路径起 CLI、输出无 ANSI、原始流落盘非空、长跑不卡界面', async () => {
  test.setTimeout(420_000)
  const { app, win, userData } = await bootProject('agent')

  const detected = await win.evaluate(async () => {
    const agents = await window.klarit.scanAgents()
    return agents.map((a) => ({ id: a.id, exe: a.executablePath }))
  })
  const claude = detected.find((a) => a.id === 'claude-code')
  test.skip(!claude, '本机没探测到 claude CLI，跳过（这条必须在装了 CLI 的机器上跑）')

  await win.evaluate(async () => {
    const def = await window.klarit.createWorkflow()
    def.stages = [{ id: 's1', name: '交付' }]
    def.nodes = [
      {
        id: 'n1',
        name: '问一句',
        stageId: 's1',
        executor: {
          kind: 'agent',
          instruction: {
            kind: 'inline',
            text: '读一下仓库根目录的 CLAUDE.md，然后只回复 OK 两个字。不要修改、新建或删除任何文件。'
          }
        },
        outputs: [],
        gate: [{ kind: 'manual', actions: [] }]
      }
    ]
    const saved = await window.klarit.saveWorkflow(def)
    if (saved && (saved as { ok?: boolean }).ok === false) {
      throw new Error(`saveWorkflow 被拒：${JSON.stringify(saved)}`)
    }
    await window.klarit.setActiveWorkflow(def.id)
    await window.klarit.createCards([
      { proposedName: 'ag-card', title: 'agent 卡', description: '', typeId: 'feature', relations: [] }
    ])
  })
  await win.reload()

  // (a) 进程确实以绝对路径起、且没经 shell。
  // 必须按「父进程是 electron.exe」筛出**被测应用起的那个** claude.exe——机器上很可能同时有别的
  // claude 会话在跑（比如从终端起的），不筛就会拿错进程、验出假结论（已实测踩过：抓到的那个父进程是
  // powershell.exe，是另一个会话的）。
  let proc: { path: string; cmd: string; parent: string } | undefined
  await expect(async () => {
    proc = probeClaudeProcesses().find((x) => (x.parent ?? '').toLowerCase() === 'electron.exe')
    expect(proc).toBeDefined()
  }).toPass({ timeout: 120_000 })
  const p = proc as { path: string; cmd: string; parent: string }
  expect(p.path).toMatch(/^[A-Za-z]:[\\/]/) // 绝对路径
  expect(p.path.toLowerCase()).toBe((claude as { exe: string }).exe.toLowerCase()) // 就是探测出的那个
  // 父进程是 electron.exe（主进程直起），不是 cmd.exe / powershell.exe → argv 没经 shell 拼接
  expect(p.parent.toLowerCase()).toBe('electron.exe')
  // 无头调用式：复刻 adapter 的 claudeCommon()
  expect(p.cmd).toContain('--output-format')

  // (d) agent 跑着的时候界面仍然响应（不卡）
  const t0 = Date.now()
  await win.getByRole('button', { name: /收件箱/ }).click()
  await win.evaluate(async () => (await window.klarit.listCards()).length)
  expect(Date.now() - t0).toBeLessThan(8000)
  await win.keyboard.press('Escape')

  // 跑到人工验收门
  await expect(async () => {
    const n = await win.evaluate(async () => (await window.klarit.listDecisionInbox()).length)
    expect(n).toBe(1)
  }).toPass({ timeout: 300_000 })

  const runId = await win.evaluate(async () => (await window.klarit.listCardRuns('ag-card'))[0].runId)

  // (c) 原始流记录落盘非空（<userData>/engine-runs/<runId>/node__n1.raw.jsonl）
  const rawFile = join(userData, 'engine-runs', runId, 'node__n1.raw.jsonl')
  const raw = readFileSync(rawFile, 'utf8')
  expect(raw.trim().length).toBeGreaterThan(0)
  expect(raw).toContain('"type"') // 是 claude 的 stream-json NDJSON，不是空壳

  // (b) 展示输出里没有 ANSI 转义
  const shown = await win.evaluate(
    async (id: string) => window.klarit.readRunOutput(id, 'node:n1'),
    runId
  )
  expect(shown.length).toBeGreaterThan(0)
  // ANSI CSI = ESC(0x1b) + '['；展示转写必须已经剥掉它。
  expect(shown).not.toContain('\u001b[')

  await app.close()
})

// ── 验收 6：续接失败走兜底层（agent-subprocess-boundary tasks 7.3）────────────
// 制造方式：跑完一次真 agent（它会用工具读文件，原始流里因此有 tool_use/tool_result），
// 关掉应用，把断点里存的 session 抹掉，再开——续接阶梯第①层（--resume <id>）因此不可用，
// 必然落到第②层「自存重建」。注意不能靠「把 session 改成假 id」来造：runner.resume 只在
// adapter 不支持或进程起不来时返回 null，假 id 是**起得来**的，跑不到兜底层。
test('抹掉断点里的 session → 续接落到自存重建，喂回历史含工具目标与结果', async () => {
  test.setTimeout(600_000)
  const { app, win, userData } = await bootProject('resume')

  const detected = await win.evaluate(async () => (await window.klarit.scanAgents()).map((a) => a.id))
  test.skip(!detected.includes('claude-code'), '本机没探测到 claude CLI，跳过')

  await win.evaluate(async () => {
    const def = await window.klarit.createWorkflow()
    def.stages = [{ id: 's1', name: '交付' }]
    def.nodes = [
      {
        id: 'n1',
        name: '问一句',
        stageId: 's1',
        executor: {
          kind: 'agent',
          instruction: {
            kind: 'inline',
            text: '用工具读一下仓库根目录的 CLAUDE.md，然后用一句话说它要求了什么。不要修改、新建或删除任何文件。'
          }
        },
        outputs: [],
        gate: [{ kind: 'manual', actions: [] }]
      }
    ]
    const saved = await window.klarit.saveWorkflow(def)
    if (saved && (saved as { ok?: boolean }).ok === false) {
      throw new Error(`saveWorkflow 被拒：${JSON.stringify(saved)}`)
    }
    await window.klarit.setActiveWorkflow(def.id)
    await window.klarit.createCards([
      { proposedName: 'rs-card', title: '续接卡', description: '', typeId: 'feature', relations: [] }
    ])
  })
  await win.reload()

  await expect(async () => {
    const n = await win.evaluate(async () => (await window.klarit.listDecisionInbox()).length)
    expect(n).toBe(1)
  }).toPass({ timeout: 300_000 })

  const runId = await win.evaluate(async () => (await window.klarit.listCardRuns('rs-card'))[0].runId)
  await app.close()

  // 抹 session：这是「原生续接不可用」的忠实制造
  const bpFile = join(userData, 'engine-runs', `${runId}.json`)
  const bp = JSON.parse(readFileSync(bpFile, 'utf8')) as {
    agentRuns?: Record<string, { session?: string; prompt?: string }>
  }
  expect(bp.agentRuns?.n1?.session).toBeTruthy() // 先证明本来确实抓到了 session
  const promptBefore = bp.agentRuns?.n1?.prompt ?? ''
  delete bp.agentRuns!.n1.session
  writeFileSync(bpFile, JSON.stringify(bp), 'utf8')

  // 重开，驳回人工门 → 内容驱动回退 → 重入 n1 → 走续接阶梯
  const app2 = await launch(userData)
  const win2 = await app2.firstWindow()
  await win2.evaluate(
    async (id: string) => window.klarit.decideRun(id, { text: '结论太笼统，请说得更具体' }),
    runId
  )

  // 驳回后引擎会先跑一个「回退判定 agent」决定退到哪个节点，再抛 :rollback-confirm。
  // 这里必须顺序等——不能在轮询块里反复 decideRun，那会互相打架（已实测踩过）。
  await expect(async () => {
    const src = await win2.evaluate(async (id: string) => {
      const st = await window.klarit.getRunState(id)
      return st?.pendingDecision?.source ?? ''
    }, runId)
    expect(src).toContain('rollback-confirm')
  }).toPass({ timeout: 300_000 })

  // 选「退回 n1」（非取消项）
  const pick = await win2.evaluate(async (id: string) => {
    const st = await window.klarit.getRunState(id)
    return st?.pendingDecision?.options.map((o) => o.id).find((o) => o !== 'cancel-rollback') ?? ''
  }, runId)
  expect(pick).toBeTruthy()
  await win2.evaluate(
    async (arg: { id: string; opt: string }) => window.klarit.decideRun(arg.id, { optionId: arg.opt }),
    { id: runId, opt: pick }
  )

  // 重入 n1 后，判定走的是续接阶梯哪一层——**看进程命令行**，不看 prompt 字段
  // （实测 agentRuns.prompt 在重入后一字未变，分辨不出第①层还是第②层，是个错的观测点）。
  // 有 --resume = 第①层原生续接；没有 = 第②层自存重建。session 已被抹掉，故必须是第②层。
  let relaunchCmd = ''
  await expect(async () => {
    const hit = probeClaudeProcesses().find((x) => (x.parent ?? '').toLowerCase() === 'electron.exe')
    expect(hit).toBeDefined()
    relaunchCmd = hit!.cmd
  }).toPass({ timeout: 120_000 })
  expect(relaunchCmd).not.toContain('--resume')

  // 等它重跑完回到验收门
  await expect(async () => {
    const st = await win2.evaluate(async (id: string) => {
      const s2 = await window.klarit.getRunState(id)
      return s2?.pendingDecision?.source ?? ''
    }, runId)
    expect(st).toContain('manual-gate')
  }).toPass({ timeout: 300_000 })

  // 兜底层喂回的历史来自**原始流记录**，故直接核对那份记录里确有工具目标与 tool_result。
  const rawFile = join(userData, 'engine-runs', runId, 'node__n1.raw.jsonl')
  const raw = readFileSync(rawFile, 'utf8')
  expect(raw).toContain('"tool_use"')
  expect(raw).toContain('"tool_result"')
  expect(raw).toContain('CLAUDE.md') // 工具目标是具体路径，不是「用了个工具」

  await app2.close()
})
