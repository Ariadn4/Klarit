import { describe, it, expect, vi } from 'vitest'
import {
  runWorkflowOnboarding,
  buildWorkflowRevisionIntent,
  needsDocScanOnActivate,
  WORKFLOW_ONBOARDING_INTENT,
  type WorkflowOnboardingDeps,
  type WorkflowNodeOverview
} from './workflow-onboarding'
import type { AuthorWorkflowResult } from './orchestrate-service'
import type { Project, WorkflowDefinition, WorkflowProposal } from '../shared/types'
import { lintWorkflow } from '../shared/workflow'

/** 最小合法 Project（成员仓根供 hasHabits，其余字段判据核不看）。 */
function fakeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    displayName: 'Proj',
    derivedName: 'proj',
    members: [
      {
        id: 'm1',
        idKind: 'uuid',
        derivedName: 'repo',
        rootPath: '/repo',
        worktreePaths: ['/repo'],
        git: null,
        gitless: false
      }
    ],
    createdAt: 't',
    updatedAt: 't',
    ...over
  }
}

/** 一份可用提案（issues 空 = 可存库）。 */
function usableProposal(): WorkflowProposal {
  return { workflow: { id: 'wf', name: { zh: 'W' }, stages: [], nodes: [] }, issues: [] }
}

/** 富结果构造器：成功 / 空产出 / 校验不过 / agent 抛错。 */
const ok = (proposal: WorkflowProposal): AuthorWorkflowResult => ({ proposal, failure: undefined })
const empty = (reply?: string): AuthorWorkflowResult => ({ proposal: null, failure: 'empty', reply })
const invalid = (proposal: WorkflowProposal): AuthorWorkflowResult => ({ proposal, failure: 'invalid' })
const threw = (reply?: string): AuthorWorkflowResult => ({ proposal: null, failure: 'threw', reply })

/** 一份带节点/门/多种执行者的可用提案——供校验调试日志的定义概览。 */
function richProposal(): WorkflowProposal {
  return {
    workflow: {
      id: 'wf-rich',
      name: { zh: '定制流' },
      stages: [{ id: 's1', name: { zh: '阶段' } }],
      nodes: [
        {
          id: 'n-agent',
          name: { zh: '写实现' },
          stageId: 's1',
          executor: { kind: 'agent', instruction: { kind: 'inline', text: '写' } },
          outputs: [],
          gate: [{ kind: 'manual' }]
        },
        {
          id: 'n-engine',
          name: { zh: '合并分支' },
          stageId: 's1',
          executor: { kind: 'engine', operation: 'merge-branch' },
          outputs: [],
          gate: [
            { kind: 'auto', check: { kind: 'inline', command: 'npm test' } },
            { kind: 'external', verify: 'pr-merged' }
          ]
        }
      ]
    },
    issues: []
  }
}

/** 一版**触发固化门 lint**的提案：含 merge-branch 固化节点、其前/自身无 manual 门 → 「固化步骤前缺人工验收」。 */
function unlintedProposal(id = 'wf-bad'): WorkflowProposal {
  return {
    workflow: {
      id,
      name: { zh: '缺审批' },
      stages: [{ id: 's1', name: { zh: '交付' } }],
      nodes: [
        {
          id: 'n-merge',
          name: { zh: '合并分支' },
          stageId: 's1',
          executor: { kind: 'engine', operation: 'merge-branch' },
          outputs: [],
          gate: []
        }
      ]
    },
    issues: []
  }
}

/** 同一固化节点、但**挂上 manual 审批门** → lint 干净（修正版）。 */
function lintedProposal(id = 'wf-good'): WorkflowProposal {
  return {
    workflow: {
      id,
      name: { zh: '有审批' },
      stages: [{ id: 's1', name: { zh: '交付' } }],
      nodes: [
        {
          id: 'n-merge',
          name: { zh: '合并分支' },
          stageId: 's1',
          executor: { kind: 'engine', operation: 'merge-branch' },
          outputs: [],
          gate: [{ kind: 'manual' }]
        }
      ]
    },
    issues: []
  }
}

/** 全绿默认 deps（有痕迹 + 有 agent + author 产出可用提案），逐用例按需覆写。 */
function makeDeps(over: Partial<WorkflowOnboardingDeps> = {}): WorkflowOnboardingDeps {
  return {
    hasActiveWorkflow: vi.fn(() => false),
    hasHabits: vi.fn(() => true),
    hasRunnableAgent: vi.fn(() => true),
    assignDefault: vi.fn(),
    authorWorkflow: vi.fn(async () => ok(usableProposal())),
    deliverProposal: vi.fn(),
    reportStatus: vi.fn(),
    log: vi.fn(),
    logProposal: vi.fn(),
    ...over
  }
}

describe('runWorkflowOnboarding 判据核', () => {
  it('有痕迹 + 有 agent → 先派默认占位、后台 author、可用提案主动推送', async () => {
    const deps = makeDeps()
    const project = fakeProject()
    await runWorkflowOnboarding(project, deps)

    // 先派默认作占位（任何时刻不停在无工作流）。
    expect(deps.assignDefault).toHaveBeenCalledWith(project)
    // 无头 author 以系统合成意图触发。
    expect(deps.authorWorkflow).toHaveBeenCalledWith(project.id, WORKFLOW_ONBOARDING_INTENT)
    // 可用提案主动推送。
    expect(deps.deliverProposal).toHaveBeenCalledWith(project, usableProposal())
  })

  it('无痕迹 → 只派默认，不触发 author、不推送', async () => {
    const deps = makeDeps({ hasHabits: vi.fn(() => false) })
    await runWorkflowOnboarding(fakeProject(), deps)

    expect(deps.assignDefault).toHaveBeenCalledOnce()
    expect(deps.authorWorkflow).not.toHaveBeenCalled()
    expect(deps.deliverProposal).not.toHaveBeenCalled()
  })

  it('有痕迹但没能跑的 agent → 只派默认，不触发 author', async () => {
    const deps = makeDeps({ hasRunnableAgent: vi.fn(() => false) })
    await runWorkflowOnboarding(fakeProject(), deps)

    expect(deps.assignDefault).toHaveBeenCalledOnce()
    expect(deps.authorWorkflow).not.toHaveBeenCalled()
    expect(deps.deliverProposal).not.toHaveBeenCalled()
  })

  it('已有活动工作流（reused / 幂等重跑）→ 整条判据跳过', async () => {
    const deps = makeDeps({ hasActiveWorkflow: vi.fn(() => true) })
    await runWorkflowOnboarding(fakeProject({ activeWorkflowId: 'existing' }), deps)

    expect(deps.assignDefault).not.toHaveBeenCalled()
    expect(deps.authorWorkflow).not.toHaveBeenCalled()
    expect(deps.deliverProposal).not.toHaveBeenCalled()
  })

  it('author 抛错 → 回落占位默认、不推送、不抛', async () => {
    const deps = makeDeps({
      authorWorkflow: vi.fn(async () => {
        throw new Error('agent boom')
      })
    })
    await expect(runWorkflowOnboarding(fakeProject(), deps)).resolves.toBeUndefined()

    expect(deps.assignDefault).toHaveBeenCalledOnce()
    expect(deps.deliverProposal).not.toHaveBeenCalled()
  })

  it('author 空产出（null）→ 停在占位默认、不推送', async () => {
    const deps = makeDeps({ authorWorkflow: vi.fn(async () => empty()) })
    await runWorkflowOnboarding(fakeProject(), deps)

    expect(deps.assignDefault).toHaveBeenCalledOnce()
    expect(deps.deliverProposal).not.toHaveBeenCalled()
  })

  it('author 提案 issues 非空（不可存库）→ 停在占位默认、不推送', async () => {
    const deps = makeDeps({
      authorWorkflow: vi.fn(async () =>
        invalid({ workflow: { id: 'wf', name: { zh: 'W' }, stages: [], nodes: [] }, issues: ['缺删分支节点'] })
      )
    })
    await runWorkflowOnboarding(fakeProject(), deps)

    expect(deps.assignDefault).toHaveBeenCalledOnce()
    expect(deps.deliverProposal).not.toHaveBeenCalled()
  })

  it('命中支：报 generating（author 起跑）→ done（结束），底栏进度可显可清', async () => {
    const deps = makeDeps()
    const project = fakeProject()
    await runWorkflowOnboarding(project, deps)
    expect(deps.reportStatus).toHaveBeenCalledWith(project, 'generating')
    expect(deps.reportStatus).toHaveBeenLastCalledWith(project, 'done')
  })

  it('author 抛错 → 报 failed（清底栏指示）', async () => {
    const deps = makeDeps({
      authorWorkflow: vi.fn(async () => {
        throw new Error('boom')
      })
    })
    const project = fakeProject()
    await runWorkflowOnboarding(project, deps)
    expect(deps.reportStatus).toHaveBeenCalledWith(project, 'generating')
    expect(deps.reportStatus).toHaveBeenLastCalledWith(project, 'failed')
  })

  it('未命中 author 支（无痕迹）→ 不报生成进度（底栏不显）', async () => {
    const deps = makeDeps({ hasHabits: vi.fn(() => false) })
    await runWorkflowOnboarding(fakeProject(), deps)
    expect(deps.reportStatus).not.toHaveBeenCalled()
  })

  it('派默认占位在门控之前——命中支也先占位（保证任何时刻有工作流）', async () => {
    const order: string[] = []
    const deps = makeDeps({
      assignDefault: vi.fn(() => order.push('assignDefault')),
      authorWorkflow: vi.fn(async () => {
        order.push('author')
        return ok(usableProposal())
      })
    })
    await runWorkflowOnboarding(fakeProject(), deps)
    expect(order).toEqual(['assignDefault', 'author'])
  })
})

describe('WORKFLOW_ONBOARDING_INTENT（系统合成意图措辞，设计决策 #10）', () => {
  it('告知 author 可直接查看本项目文件以推断习惯', () => {
    // 可直接读项目文件（纠正「跑在 scratch、拿不到项目路径、只能靠 prompt 上下文猜」的根因）。
    expect(WORKFLOW_ONBOARDING_INTENT).toMatch(/直接(查看|读)/)
    // 点到具体痕迹来源（.claude/、CLAUDE.md、git）。
    expect(WORKFLOW_ONBOARDING_INTENT).toContain('CLAUDE.md')
    expect(WORKFLOW_ONBOARDING_INTENT).toMatch(/git/i)
  })

  it('带只读约束：只探查、只输出工作流、不改动任何文件', () => {
    // 只读探查。
    expect(WORKFLOW_ONBOARDING_INTENT).toMatch(/只读/)
    // 唯一产出是工作流定义。
    expect(WORKFLOW_ONBOARDING_INTENT).toContain('工作流')
    // 不改动/新建/删除任何文件。
    expect(WORKFLOW_ONBOARDING_INTENT).toMatch(/不.*(改动|修改|新建|创建|删除).*文件/)
  })
})

describe('runWorkflowOnboarding 调试日志（自动提案留可查记录）', () => {
  it('可用提案 → 记一条含目标项目 + 定义概览（节点/执行者/门种）+ 空 issues', async () => {
    const logProposal = vi.fn()
    const deps = makeDeps({
      authorWorkflow: vi.fn(async () => ok(richProposal())),
      logProposal
    })
    const project = fakeProject({ id: 'proj-x', displayName: '项目X' })
    await runWorkflowOnboarding(project, deps)

    expect(logProposal).toHaveBeenCalledTimes(1)
    const record = logProposal.mock.calls[0][0]
    // 目标项目 id/name。
    expect(record.project).toEqual({ id: 'proj-x', name: '项目X' })
    // 空 issues + 成功结果分类。
    expect(record.issues).toEqual([])
    expect(record.outcome).toBe('proposed')
    // 定义概览：id + 逐节点执行者种类/engine operation/门种。
    expect(record.overview.id).toBe('wf-rich')
    expect(record.overview.nodeCount).toBe(2)
    const agentNode = record.overview.nodes.find((n: WorkflowNodeOverview) => n.id === 'n-agent')
    expect(agentNode.executorKind).toBe('agent')
    expect(agentNode.gateKinds).toEqual(['manual'])
    const engineNode = record.overview.nodes.find((n: WorkflowNodeOverview) => n.id === 'n-engine')
    expect(engineNode.executorKind).toBe('engine')
    expect(engineNode.engineOperation).toBe('merge-branch')
    expect(engineNode.gateKinds).toEqual(['auto', 'external'])
  })

  it('提案 issues 非空（不可存库）→ 记一条含概览 + issues + 失败原因', async () => {
    const logProposal = vi.fn()
    const deps = makeDeps({
      authorWorkflow: vi.fn(async () =>
        invalid({ workflow: { id: 'wf', name: { zh: 'W' }, stages: [], nodes: [] }, issues: ['缺删分支节点'] })
      ),
      logProposal
    })
    await runWorkflowOnboarding(fakeProject(), deps)

    const record = logProposal.mock.calls[0][0]
    expect(record.outcome).toBe('unusable')
    expect(record.issues).toEqual(['缺删分支节点'])
    expect(record.overview.id).toBe('wf')
    expect(typeof record.failureReason).toBe('string')
  })

  it('author 空产出 → 记一条含失败原因（无产出，无概览）', async () => {
    const logProposal = vi.fn()
    const deps = makeDeps({ authorWorkflow: vi.fn(async () => empty()), logProposal })
    await runWorkflowOnboarding(fakeProject(), deps)

    const record = logProposal.mock.calls[0][0]
    expect(record.outcome).toBe('empty')
    expect(typeof record.failureReason).toBe('string')
    expect(record.overview).toBeUndefined()
  })

  it('author 抛错 → 记一条含失败原因（错误信息）', async () => {
    const logProposal = vi.fn()
    const deps = makeDeps({
      authorWorkflow: vi.fn(async () => {
        throw new Error('agent boom')
      }),
      logProposal
    })
    await runWorkflowOnboarding(fakeProject(), deps)

    const record = logProposal.mock.calls[0][0]
    expect(record.outcome).toBe('error')
    expect(record.failureReason).toContain('agent boom')
    expect(record.overview).toBeUndefined()
  })

  it('未命中 author 支（无痕迹）→ 不留调试日志', async () => {
    const logProposal = vi.fn()
    const deps = makeDeps({ hasHabits: vi.fn(() => false), logProposal })
    await runWorkflowOnboarding(fakeProject(), deps)
    expect(logProposal).not.toHaveBeenCalled()
  })

  it('agent 调用抛错（rich threw）→ 记 error + 原因带 reply', async () => {
    const logProposal = vi.fn()
    const deps = makeDeps({
      authorWorkflow: vi.fn(async () => threw('（未能产出提案：agent 调用失败或未配置默认 agent）')),
      logProposal
    })
    await runWorkflowOnboarding(fakeProject(), deps)

    const record = logProposal.mock.calls[0][0]
    expect(record.outcome).toBe('error')
    expect(record.failureReason).toContain('agent 调用失败')
    expect(record.overview).toBeUndefined()
  })
})

describe('runWorkflowOnboarding 有界自动重试（设计决策 #11：失败重来一次）', () => {
  it('成功于首次 → 不重试（author 恰调一次），报 done', async () => {
    const deps = makeDeps()
    const project = fakeProject()
    await runWorkflowOnboarding(project, deps)

    expect(deps.authorWorkflow).toHaveBeenCalledTimes(1)
    expect(deps.deliverProposal).toHaveBeenCalledOnce()
    expect(deps.reportStatus).toHaveBeenLastCalledWith(project, 'done')
  })

  it('首次失败 → 重试一次；重试成功即推送提案（无需回落）', async () => {
    const authorWorkflow = vi
      .fn<WorkflowOnboardingDeps['authorWorkflow']>()
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(ok(usableProposal()))
    const deps = makeDeps({ authorWorkflow })
    const project = fakeProject()
    await runWorkflowOnboarding(project, deps)

    // 恰重试一次（共两次调用）。
    expect(authorWorkflow).toHaveBeenCalledTimes(2)
    // 重试成功 → 主动推送，不报 failed。
    expect(deps.deliverProposal).toHaveBeenCalledWith(project, usableProposal())
    expect(deps.reportStatus).toHaveBeenLastCalledWith(project, 'done')
  })

  it('两次都失败 → 回落占位默认，记失败种类，报 failed（底栏轻提示）', async () => {
    const authorWorkflow = vi.fn<WorkflowOnboardingDeps['authorWorkflow']>(async () => empty())
    const logProposal = vi.fn()
    const deps = makeDeps({ authorWorkflow, logProposal })
    const project = fakeProject()
    await runWorkflowOnboarding(project, deps)

    // 至多一次重试（不循环）。
    expect(authorWorkflow).toHaveBeenCalledTimes(2)
    // 回落占位默认（起始已派一次）、不推送。
    expect(deps.assignDefault).toHaveBeenCalledOnce()
    expect(deps.deliverProposal).not.toHaveBeenCalled()
    // 记失败种类 + 报 failed。
    expect(logProposal).toHaveBeenCalledTimes(1)
    expect(logProposal.mock.calls[0][0].outcome).toBe('empty')
    expect(deps.reportStatus).toHaveBeenLastCalledWith(project, 'failed')
  })

  it('首次失败重试仍失败（不同种类）→ 按最后一次种类记日志', async () => {
    const authorWorkflow = vi
      .fn<WorkflowOnboardingDeps['authorWorkflow']>()
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce(
        invalid({ workflow: { id: 'wf', name: { zh: 'W' }, stages: [], nodes: [] }, issues: ['坏'] })
      )
    const logProposal = vi.fn()
    const deps = makeDeps({ authorWorkflow, logProposal })
    await runWorkflowOnboarding(fakeProject(), deps)

    expect(authorWorkflow).toHaveBeenCalledTimes(2)
    expect(logProposal).toHaveBeenCalledTimes(1)
    expect(logProposal.mock.calls[0][0].outcome).toBe('unusable')
  })
})

describe('needsDocScanOnActivate（需求驱动扫描判据，纯可单测）', () => {
  /** 含 engine/archive-docs 节点的工作流定义。 */
  const withArchiveDocs = (): WorkflowDefinition => ({
    id: 'wf-arch',
    name: { zh: '带归档' },
    stages: [{ id: 's1', name: { zh: '阶段' } }],
    nodes: [
      {
        id: 'n-arch',
        name: { zh: '归档文档' },
        stageId: 's1',
        executor: { kind: 'engine', operation: 'archive-docs' },
        outputs: []
      }
    ]
  })

  /** 不含 archive-docs 的工作流定义（引擎 merge-branch）。 */
  const withoutArchiveDocs = (): WorkflowDefinition => ({
    id: 'wf-plain',
    name: { zh: '直合' },
    stages: [{ id: 's1', name: { zh: '阶段' } }],
    nodes: [
      {
        id: 'n-merge',
        name: { zh: '合并分支' },
        stageId: 's1',
        executor: { kind: 'engine', operation: 'merge-branch' },
        outputs: []
      }
    ]
  })

  it('含 archive-docs + 无登记表 → true', () => {
    expect(needsDocScanOnActivate(withArchiveDocs(), false)).toBe(true)
  })

  it('含 archive-docs + 已有登记表 → false', () => {
    expect(needsDocScanOnActivate(withArchiveDocs(), true)).toBe(false)
  })

  it('不含 archive-docs → false（即便无登记表）', () => {
    expect(needsDocScanOnActivate(withoutArchiveDocs(), false)).toBe(false)
  })

  it('null / undefined def → false', () => {
    expect(needsDocScanOnActivate(null, false)).toBe(false)
    expect(needsDocScanOnActivate(undefined, false)).toBe(false)
  })
})

describe('buildWorkflowRevisionIntent（修订意图构造，纯可单测）', () => {
  it('嵌入上版定义 JSON + 全部告警文字 + 补人工审批门的指令', () => {
    const prev = unlintedProposal('wf-prev').workflow
    const intent = buildWorkflowRevisionIntent(prev, ['固化步骤前缺人工验收', '另一条告警'])
    // 上版定义整体嵌入（id 出现在 JSON 里）。
    expect(intent).toContain('wf-prev')
    expect(intent).toContain(JSON.stringify(prev))
    // 每条告警文字都喂回。
    expect(intent).toContain('固化步骤前缺人工验收')
    expect(intent).toContain('另一条告警')
    // 指令方向：补人工审批门（manual）。
    expect(intent).toMatch(/人工审批|manual/)
  })
})

describe('runWorkflowOnboarding 固化门确定性补审批（设计决策 #16：不赌 LLM，取代 #15 的喂回修订对本规则）', () => {
  it('author 缺固化前审批门 → 确定性插入 manual 门，投递工作流 lint 干净，author 仅调一次（不走 LLM 修订）', async () => {
    const authorWorkflow = vi.fn<WorkflowOnboardingDeps['authorWorkflow']>(async () =>
      ok(unlintedProposal())
    )
    const deps = makeDeps({ authorWorkflow })
    const project = fakeProject()
    await runWorkflowOnboarding(project, deps)

    // 确定性补审批门先跑、lint 已清 → 不再触发 LLM 喂回修订（author 仅调一次）。
    expect(authorWorkflow).toHaveBeenCalledTimes(1)
    expect(authorWorkflow.mock.calls[0][1]).toBe(WORKFLOW_ONBOARDING_INTENT)

    // 投递提案的工作流：lint 干净（含机械插入的 manual 门）。
    expect(deps.deliverProposal).toHaveBeenCalledTimes(1)
    const delivered = (deps.deliverProposal as ReturnType<typeof vi.fn>).mock.calls[0][1] as WorkflowProposal
    expect(lintWorkflow(delivered.workflow)).toEqual([])
    // 第一个固化节点（merge-branch）之前存在一道 manual 门。
    const nodes = delivered.workflow.nodes
    const mergeIdx = nodes.findIndex(
      (n) => n.executor.kind === 'engine' && n.executor.operation === 'merge-branch'
    )
    expect(mergeIdx).toBeGreaterThan(0)
    expect(nodes.slice(0, mergeIdx).some((n) => (n.gate ?? []).some((g) => g.kind === 'manual'))).toBe(true)
    expect(deps.reportStatus).toHaveBeenLastCalledWith(project, 'done')
  })

  it('确定性补审批后 lint 已清 → 日志记 proposed、0 轮修订、空残留告警', async () => {
    const authorWorkflow = vi.fn<WorkflowOnboardingDeps['authorWorkflow']>(async () =>
      ok(unlintedProposal())
    )
    const logProposal = vi.fn()
    const deps = makeDeps({ authorWorkflow, logProposal })
    await runWorkflowOnboarding(fakeProject(), deps)

    const record = logProposal.mock.calls[0][0]
    expect(record.outcome).toBe('proposed')
    // 确定性修复先跑、lint 已清 → 修订循环不触发。
    expect(record.revisionPasses).toBe(0)
    expect(record.lintWarnings).toEqual([])
  })

  it('author 产出本就含固化前 manual 门 → 确定性修复为 no-op，直接投递，日志记 0 轮修订、空残留告警', async () => {
    const authorWorkflow = vi.fn<WorkflowOnboardingDeps['authorWorkflow']>(async () =>
      ok(lintedProposal())
    )
    const logProposal = vi.fn()
    const deps = makeDeps({ authorWorkflow, logProposal })
    await runWorkflowOnboarding(fakeProject(), deps)

    expect(authorWorkflow).toHaveBeenCalledTimes(1)
    expect(deps.deliverProposal).toHaveBeenCalledTimes(1)
    const record = logProposal.mock.calls[0][0]
    expect(record.outcome).toBe('proposed')
    expect(record.revisionPasses).toBe(0)
    expect(record.lintWarnings).toEqual([])
  })
})
