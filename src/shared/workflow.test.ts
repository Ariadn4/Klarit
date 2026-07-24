import { describe, it, expect } from 'vitest'
import type { DocRegistry, WorkflowDefinition, WorkflowGateItem, WorkflowNode } from './types'
import {
  isSafeRelativePath,
  validateWorkflow,
  checkBranchPairing,
  createAcceptanceSampleWorkflow,
  createRollbackSampleWorkflow,
  createDefaultWorkflow,
  createDefaultWorkflowPr,
  createRealPrWorkflow,
  workflowSummary,
  lintWorkflow,
  ensureApprovalBeforeFinalization,
  IRREVERSIBLE_FINALIZATION_OPS,
  migrateWorkflowShape,
  ENGINE_OPERATIONS,
  engineOpCapabilities,
  buildAuthorWorkflowSkill,
  buildArchiveDelegation,
  repairWorkflow,
  workflowUsesArchiveDocs
} from './workflow'

function node(over: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 'n1',
    name: { zh: '写代码' },
    stageId: 's1',
    executor: { kind: 'agent', instruction: { kind: 'inline', text: '实现需求' } },
    outputs: [],
    ...over
  }
}

function workflow(over: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: 'wf-1',
    name: { zh: '默认工作流' },
    stages: [{ id: 's1', name: { zh: '开发' } }],
    nodes: [node()],
    ...over
  }
}

describe('workflowUsesArchiveDocs', () => {
  it('含 engine archive-docs 节点 → true', () => {
    const def = workflow({
      nodes: [
        node({ id: 'impl' }),
        node({ id: 'arch', executor: { kind: 'engine', operation: 'archive-docs' } })
      ]
    })
    expect(workflowUsesArchiveDocs(def)).toBe(true)
  })

  it('有 engine 节点但无 archive-docs → false', () => {
    const def = workflow({
      nodes: [
        node({ id: 'cb', executor: { kind: 'engine', operation: 'create-branch' } }),
        node({ id: 'mb', executor: { kind: 'engine', operation: 'merge-branch' } })
      ]
    })
    expect(workflowUsesArchiveDocs(def)).toBe(false)
  })

  it('仅有 agent 节点引用已装 archive 技能（非引擎 archive-docs）→ false', () => {
    const def = workflow({
      nodes: [node({ id: 'arch', executor: { kind: 'agent', instruction: { kind: 'installed', name: 'opsx:archive' } } })]
    })
    expect(workflowUsesArchiveDocs(def)).toBe(false)
  })

  it('空 / 缺失节点列表 → false', () => {
    expect(workflowUsesArchiveDocs(workflow({ nodes: [] }))).toBe(false)
    expect(workflowUsesArchiveDocs({ id: 'x', name: { zh: '无节点' }, stages: [] } as unknown as WorkflowDefinition)).toBe(false)
    expect(workflowUsesArchiveDocs(undefined as unknown as WorkflowDefinition)).toBe(false)
  })
})

describe('isSafeRelativePath', () => {
  it('接受合规相对路径', () => {
    expect(isSafeRelativePath('docs/report.md')).toBe(true)
    expect(isSafeRelativePath('skills/review.md')).toBe(true)
    expect(isSafeRelativePath('a')).toBe(true)
  })

  it('拒绝绝对路径（POSIX / Windows 盘符 / UNC）', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false)
    expect(isSafeRelativePath('C:\\Users\\x')).toBe(false)
    expect(isSafeRelativePath('\\\\server\\share')).toBe(false)
  })

  it('拒绝含 .. 段与空串', () => {
    expect(isSafeRelativePath('../escape')).toBe(false)
    expect(isSafeRelativePath('a/../b')).toBe(false)
    expect(isSafeRelativePath('')).toBe(false)
    expect(isSafeRelativePath('   ')).toBe(false)
  })
})

describe('engineOpCapabilities', () => {
  it('封闭操作集为 10 个操作（含平台预制的 open-pr 与 archive-docs；核查已合并不是操作、是外部门）', () => {
    expect([...ENGINE_OPERATIONS]).toEqual([
      'create-branch',
      'open-worktree',
      'link-env',
      'merge-branch',
      'push-branch',
      'remove-worktree',
      'delete-branch',
      'delete-remote-branch',
      'open-pr',
      'archive-docs'
    ])
    expect([...ENGINE_OPERATIONS]).not.toContain('verify-pr-merged')
  })

  it('supportsGate 仅 push-branch 与 open-pr 为真；产出位仅 archive-docs 为真（其写文档并提交）；固化位仅三个不可逆固化操作为真（archive-docs 提交到特性分支、可回退，不属固化）', () => {
    const finalizeOps = new Set(['merge-branch', 'push-branch', 'open-pr'])
    for (const op of ENGINE_OPERATIONS) {
      expect(engineOpCapabilities(op)).toEqual({
        producesOutputs: op === 'archive-docs',
        supportsGate: op === 'push-branch' || op === 'open-pr',
        supportsWritableScope: false,
        finalizesIrreversibly: finalizeOps.has(op)
      })
    }
  })

  it('archive-docs 不支持门（不可在其上挂门）、产出位为是、不属不可逆固化（提交到特性分支、合入前驳回即随分支丢弃、可回退）', () => {
    const cap = engineOpCapabilities('archive-docs')
    expect(cap.supportsGate).toBe(false)
    expect(cap.producesOutputs).toBe(true)
    expect(cap.finalizesIrreversibly).toBe(false)
  })

  it('复合别名 delete-branch-worktree 回落为各项皆否（仍被识别、不在下拉）', () => {
    expect(engineOpCapabilities('delete-branch-worktree')).toEqual({
      producesOutputs: false,
      supportsGate: false,
      supportsWritableScope: false,
      finalizesIrreversibly: false
    })
    expect([...ENGINE_OPERATIONS]).not.toContain('delete-branch-worktree')
  })

  it('空串/未知操作回落为各项皆否，不抛异常', () => {
    const none = {
      producesOutputs: false,
      supportsGate: false,
      supportsWritableScope: false,
      finalizesIrreversibly: false
    }
    expect(engineOpCapabilities('')).toEqual(none)
    expect(engineOpCapabilities('totally-unknown-op')).toEqual(none)
  })
})

describe('buildAuthorWorkflowSkill', () => {
  const skill = buildAuthorWorkflowSkill()

  it('覆盖全部引擎操作（单一来源，无遗漏）', () => {
    for (const op of ENGINE_OPERATIONS) {
      expect(skill).toContain(op)
    }
  })

  it('列出全部执行者类型', () => {
    for (const kind of ['agent', 'engine', 'command', 'subworkflow']) {
      expect(skill).toContain(kind)
    }
  })

  it('写明分支配对约束（建了分支必须删）', () => {
    expect(skill).toContain('create-branch')
    expect(skill).toContain('delete-branch')
    // 明确点出配对语义，避免 agent 建了不删导致 checkBranchPairing 判无效。
    expect(skill).toMatch(/配对|必须.*删|删.*分支/)
  })

  it('教 agent 只输出结构化工作流对象（收尾约定）', () => {
    expect(skill).toMatch(/workflow/)
    expect(skill).toMatch(/baseId/)
    expect(skill).toMatch(/JSON|结构化|只输出/)
  })

  it('讲清 agent 节点由运行时编程 agent 执行、其自带技能，别写死本地 skill 路径', () => {
    // 运行时 agent（Claude Code/Codex/Cursor 等）自带其已装技能；作者只写自然语言任务、别臆测技能产物或路径。
    expect(skill).toMatch(/运行时|执行时/)
    expect(skill).toMatch(/自带|已装|已安装/)
    expect(skill).toMatch(/inline/)
    // 明确 file 只用于包内 skill 文件，别为外部技能臆造路径
    expect(skill).toMatch(/包内/)
  })

  it('教多仓目标（target）：引擎 git 操作默认逐涉及仓、可按 tag/仓收窄', () => {
    expect(skill).toMatch(/多仓|成员仓/)
    expect(skill).toMatch(/target/)
    expect(skill).toMatch(/tag/)
  })

  it('讲清 command/门命令只在主仓跑、不逐仓，别硬编跨仓路径', () => {
    expect(skill).toMatch(/主仓/)
    expect(skill).toMatch(/不逐仓|只.*跑一次|只测主仓/)
    expect(skill).toMatch(/别写死|硬编|--prefix/)
  })

  it('劝阻脆弱的「必须失败」红门，改用绿门 + 指令里做测试先行', () => {
    expect(skill).toMatch(/反着判|必须失败/)
    expect(skill).toMatch(/绿门|通过才/)
    expect(skill).toMatch(/测试先行|先写测试/)
  })

  it('reply/description 面向需求、不复述引擎既定机制', () => {
    expect(skill).toMatch(/面向需求/)
    expect(skill).toMatch(/不要复述|别复述|复述是噪音/)
  })

  it('随引擎操作集自动生成——每个操作名都出现（改操作集即改文本）', () => {
    // 逐一断言即「文本由 ENGINE_OPERATIONS 派生」的可验证代理：任一操作从集合移除，此断言即变。
    const missing = ENGINE_OPERATIONS.filter((op) => !skill.includes(op))
    expect(missing).toEqual([])
  })

  it('不含非法/越界引擎操作（如已废的复合别名不进 skill）', () => {
    expect(skill).not.toContain('delete-branch-worktree')
  })

  it('讲清引擎操作是平台预制节点、内部实现可由 agent 支撑', () => {
    expect(skill).toMatch(/预制|封装/)
    // open-pr 内部委派 agent 应对各平台差异——作者无需关心内部
    expect(skill).toMatch(/内部.*agent|agent.*支撑|委派/)
  })

  it('讲清 open-pr 逐仓、平台无关的面向需求语义', () => {
    expect(skill).toContain('open-pr')
    expect(skill).toMatch(/PR|MR/)
    // 平台无关：不臆造具体平台 CLI（gh/glab）
    expect(skill).toMatch(/平台无关|各平台|平台/)
  })

  it('讲清 archive-docs 的面向需求语义：读登记表、按习惯归档、并行/串行、产生提交', () => {
    expect(skill).toContain('archive-docs')
    // 读文档登记表
    expect(skill).toMatch(/登记表/)
    // 按 kind 归档（动态就地更新 / 快照按习惯追加）
    expect(skill).toMatch(/就地更新|动态/)
    expect(skill).toMatch(/追加|快照/)
    // 子 agent 支持时并行、否则串行退化
    expect(skill).toMatch(/子 ?agent|并行|串行/)
    // 产生并提交
    expect(skill).toMatch(/提交/)
  })

  it('讲清外部门 external：等平台合并、pr-merged、打回即回退', () => {
    expect(skill).toContain('external')
    expect(skill).toContain('pr-merged')
    expect(skill).toMatch(/外部门/)
    expect(skill).toMatch(/合并/)
    // 门把三类都出现
    for (const k of ['auto', 'manual', 'external']) expect(skill).toContain(k)
  })
})

describe('buildAuthorWorkflowSkill 新增正向讲原因的搭流约束', () => {
  const skill = buildAuthorWorkflowSkill()

  it('教「连续收敛的作业交给同一个 agent 节点」并讲清原因（连续上下文与反馈闭环）', () => {
    expect(skill).toContain('同一个 agent 节点')
    // 讲原因：靠 agent 保持连续上下文 + 反馈闭环把事做到位
    expect(skill).toMatch(/连续.*上下文/)
    expect(skill).toMatch(/反馈闭环/)
  })

  it('说明何时才该分节点（明确交接产物 / 换了执行者或仓）', () => {
    expect(skill).toMatch(/交接产物/)
    expect(skill).toMatch(/换了执行者|换了.*仓/)
  })

  it('教「固化步骤排在人工验收之后」并讲清原因（离开可回退区、难收回、留最后一次人判）', () => {
    expect(skill).toMatch(/固化/)
    expect(skill).toMatch(/人工评审|人工验收/)
    expect(skill).toMatch(/离开.*可回退|难收回|难以收回/)
    // 留最后一次人判：满意才固化，不满意还能打回改
    expect(skill).toMatch(/满意才固化|满意.*固化/)
    expect(skill).toMatch(/打回|退回/)
  })

  it('固化类步骤只轻点、留可外推余地（不穷举）', () => {
    expect(skill).toContain('封存归档等')
    expect(skill).toMatch(/外推/)
  })

  it('这两条以正向讲原因表达，不以「不要/禁止」把它们写成罗列禁令', () => {
    expect(skill).not.toContain('不要把连续')
    expect(skill).not.toContain('禁止分节点')
    expect(skill).not.toContain('禁止先固化')
    expect(skill).not.toContain('不要先固化')
  })

  it('教「要人拍板/验收处落成 manual 门」并讲清原因（唯 manual 门弹决策、可驳回、真的会等人）', () => {
    expect(skill).toMatch(/拍板|验收/)
    expect(skill).toContain('manual')
    // 讲原因：manual 门弹出决策、可驳回、这才真的会等人拦得住
    expect(skill).toMatch(/弹.*决策|弹出决策/)
    expect(skill).toMatch(/驳回/)
    expect(skill).toMatch(/真.*等人|拦得住/)
    // 指明「叫验收却跑命令/agent 的普通节点」并不真等人
    expect(skill).toMatch(/只是叫.*验收|徒有其名|普通节点/)
  })

  it('这条以正向讲原因表达，不以「不要/禁止」为主句式', () => {
    expect(skill).not.toContain('不要把验收')
    expect(skill).not.toContain('禁止把验收')
    expect(skill).not.toContain('不要用命令节点做验收')
  })
})

describe('buildAuthorWorkflowSkill —— 不可逆固化前必有人工审批（硬要求）', () => {
  const skill = buildAuthorWorkflowSkill()

  it('把「不可逆固化前必有一道人工审批 manual 门」立为硬要求，并点名固化类别', () => {
    // 硬要求措辞
    expect(skill).toMatch(/硬要求|必须/)
    // 落成 manual 门
    expect(skill).toContain('manual')
    // 固化类别点名（合并回主干 / 推送 / 开 PR）
    expect(skill).toMatch(/合并回主干|合入主线/)
    expect(skill).toMatch(/推送/)
    expect(skill).toMatch(/开 ?PR/)
  })

  it('说明不因项目「自主/无人值守」而省，并讲清原因（人来把最后一关）', () => {
    expect(skill).toMatch(/自主|无人值守/)
    // 不因自主就省掉这道门
    expect(skill).toMatch(/不.*省/)
    // 原因：人来把最后一关
    expect(skill).toMatch(/最后一关|最后一道|人来把关/)
  })

  it('这条以正向讲原因表达，不以负向禁止为主句式', () => {
    expect(skill).not.toContain('不要固化')
    expect(skill).not.toContain('禁止无人值守')
  })
})

describe('buildArchiveDelegation', () => {
  const reg = (over: Partial<DocRegistry> = {}): DocRegistry => ({
    memberId: 'app',
    docs: [],
    conventionPreamble: '',
    conventionApproved: false,
    ...over
  })

  it('dynamic 条目合成就地更新指令（只留现状、不留旧版）', () => {
    const text = buildArchiveDelegation(
      reg({ docs: [{ id: 'docs/architecture.md', location: 'docs/architecture.md', kind: 'dynamic', habitPrompt: '', approved: false }] })
    )
    expect(text).toContain('docs/architecture.md')
    expect(text).toMatch(/就地更新|最新现状/)
    expect(text).toMatch(/不留旧版|只留现状|不留历史|不留差异/)
  })

  it('snapshot 条目合成追加冻结指令（既有内容不回改）', () => {
    const text = buildArchiveDelegation(
      reg({ docs: [{ id: 'docs/adr', location: 'docs/adr', kind: 'snapshot', habitPrompt: '', approved: false, isFolder: true, coversFiles: ['docs/adr/0001.md'] }] })
    )
    expect(text).toContain('docs/adr')
    expect(text).toMatch(/追加/)
    expect(text).toMatch(/不.*回改|不修改既有|冻结/)
  })

  it('仅 approved 的 habitPrompt 被注入；未审批不注入其习惯文本', () => {
    const approved = buildArchiveDelegation(
      reg({ docs: [{ id: 'CHANGELOG.md', location: 'CHANGELOG.md', kind: 'snapshot', habitPrompt: '仅重大改动才落一条', approved: true }] })
    )
    expect(approved).toContain('仅重大改动才落一条')

    const draft = buildArchiveDelegation(
      reg({ docs: [{ id: 'CHANGELOG.md', location: 'CHANGELOG.md', kind: 'snapshot', habitPrompt: '仅重大改动才落一条', approved: false }] })
    )
    expect(draft).not.toContain('仅重大改动才落一条')
    // 未审批仍按 kind 兜底给出动作
    expect(draft).toContain('CHANGELOG.md')
    expect(draft).toMatch(/追加/)
  })

  it('仅 conventionApproved 的项目公约作前言注入', () => {
    const approved = buildArchiveDelegation(
      reg({ conventionPreamble: '所有文档用中文写', conventionApproved: true, docs: [{ id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false }] })
    )
    expect(approved).toContain('所有文档用中文写')

    const draft = buildArchiveDelegation(
      reg({ conventionPreamble: '所有文档用中文写', conventionApproved: false, docs: [{ id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false }] })
    )
    expect(draft).not.toContain('所有文档用中文写')
  })

  it('支持子 agent 时给并行提示、否则给串行提示', () => {
    const docs = [{ id: 'README.md', location: 'README.md', kind: 'dynamic' as const, habitPrompt: '', approved: false }]
    const parallel = buildArchiveDelegation(reg({ docs }), { subagents: true })
    expect(parallel).toMatch(/并行|子 ?agent/)
    const serial = buildArchiveDelegation(reg({ docs }), { subagents: false })
    expect(serial).toMatch(/顺次|逐条|串行/)
  })

  it('指令要求提交文档改动（归档产生提交，非外部动作丢弃）', () => {
    const text = buildArchiveDelegation(
      reg({ docs: [{ id: 'README.md', location: 'README.md', kind: 'dynamic', habitPrompt: '', approved: false }] })
    )
    expect(text).toMatch(/提交/)
  })
})

describe('external 外部门（门把第三类）', () => {
  const nodeWithGate = (gate: WorkflowGateItem[]): WorkflowDefinition =>
    workflow({ nodes: [node({ gate })] })

  it('validateWorkflow 接受合法外部门 { external, pr-merged }', () => {
    expect(validateWorkflow(nodeWithGate([{ kind: 'external', verify: 'pr-merged' }]))).toEqual({ ok: true })
  })

  it('validateWorkflow 拒绝空/不支持的 verify', () => {
    const bad = nodeWithGate([{ kind: 'external', verify: 'bogus' } as unknown as WorkflowGateItem])
    expect(validateWorkflow(bad).ok).toBe(false)
  })

  it('repairWorkflow 保留合法外部门、丢非法', () => {
    const def = repairWorkflow(
      nodeWithGate([
        { kind: 'external', verify: 'pr-merged' },
        { kind: 'external', verify: 'bogus' } as unknown as WorkflowGateItem
      ])
    )
    expect(def.nodes[0].gate).toEqual([{ kind: 'external', verify: 'pr-merged' }])
  })

  it('migrateWorkflowShape 对合法外部门幂等、丢未知 verify', () => {
    const migrated = migrateWorkflowShape(nodeWithGate([{ kind: 'external', verify: 'pr-merged' }]))
    expect(migrated.nodes[0].gate).toEqual([{ kind: 'external', verify: 'pr-merged' }])
    const dropped = migrateWorkflowShape(
      nodeWithGate([{ kind: 'external', verify: 'future-kind' } as unknown as WorkflowGateItem])
    )
    expect(dropped.nodes[0].gate ?? []).toEqual([])
  })
})

describe('repairWorkflow', () => {
  /** 修复后必须同时过结构校验与分支配对校验（「直接给合法工作流」的契约）。 */
  const expectValid = (def: WorkflowDefinition): void => {
    expect(validateWorkflow(def).ok).toBe(true)
    expect(checkBranchPairing(def).ok).toBe(true)
  }

  it('agent 执行配置的非法 effort 被剔除（不丢节点，修复后过校验）', () => {
    const def = workflow({
      nodes: [
        node({
          executor: {
            kind: 'agent',
            instruction: { kind: 'inline', text: '做' },
            exec: { toolId: 'claude-code', effort: 'ultra' as never }
          }
        })
      ]
    })
    const repaired = repairWorkflow(def)
    expectValid(repaired)
    const ex = repaired.nodes[0].executor
    expect(ex.kind === 'agent' && ex.exec?.effort).toBeUndefined()
    expect(ex.kind === 'agent' && ex.exec?.toolId).toBe('claude-code')
  })

  it('合法工作流原样有效（幂等，不破坏已合法定义）', () => {
    const def = createDefaultWorkflow('good')
    const repaired = repairWorkflow(def)
    expectValid(repaired)
    expect(repaired.nodes.length).toBe(def.nodes.length)
  })

  it('建了分支却没删分支 → 自动补一个 delete-branch 节点', () => {
    const leaky: WorkflowDefinition = {
      id: 'leaky',
      name: { zh: '漏分支流' },
      stages: [{ id: 's1', name: { zh: '准备' } }],
      nodes: [node({ id: 'cb', stageId: 's1', executor: { kind: 'engine', operation: 'create-branch' } })]
    }
    const repaired = repairWorkflow(leaky)
    expect(repaired.nodes.some((n) => n.executor.kind === 'engine' && n.executor.operation === 'delete-branch')).toBe(true)
    expectValid(repaired)
  })

  it('节点 stageId 缺失/越界 → 纠到某个有效阶段', () => {
    const def: WorkflowDefinition = {
      id: 'bad-stage',
      name: { zh: '流' },
      stages: [{ id: 's1', name: { zh: '开发' } }],
      nodes: [node({ id: 'n1', stageId: 'nonexistent' })]
    }
    const repaired = repairWorkflow(def)
    expect(repaired.nodes[0].stageId).toBe('s1')
    expectValid(repaired)
  })

  it('显示名为空 → 填充后合法', () => {
    const def = { id: 'no-name', name: {}, stages: [{ id: 's1', name: { zh: '开发' } }], nodes: [] } as unknown as WorkflowDefinition
    expectValid(repairWorkflow(def))
  })

  it('无阶段 → 补一个默认阶段并把节点归入它', () => {
    const def = { id: 'no-stage', name: { zh: '流' }, stages: [], nodes: [node({ id: 'n1', stageId: 'x' })] } as unknown as WorkflowDefinition
    const repaired = repairWorkflow(def)
    expect(repaired.stages.length).toBeGreaterThanOrEqual(1)
    expectValid(repaired)
  })

  it('执行者非法的节点 → 丢弃（不臆造），其余保留且合法', () => {
    const def = {
      id: 'bad-exec',
      name: { zh: '流' },
      stages: [{ id: 's1', name: { zh: '开发' } }],
      nodes: [
        node({ id: 'ok', stageId: 's1' }),
        { id: 'broken', name: { zh: '坏' }, stageId: 's1', executor: { kind: 'engine', operation: '' }, outputs: [] }
      ]
    } as unknown as WorkflowDefinition
    const repaired = repairWorkflow(def)
    expect(repaired.nodes.some((n) => n.id === 'ok')).toBe(true)
    expect(repaired.nodes.some((n) => n.id === 'broken')).toBe(false)
    expectValid(repaired)
  })

  it('非法产出/门/可写范围 → 过滤为合法子集，节点仍在且合法', () => {
    const def = {
      id: 'dirty',
      name: { zh: '流' },
      stages: [{ id: 's1', name: { zh: '开发' } }],
      nodes: [
        {
          id: 'n1',
          name: { zh: '实现' },
          stageId: 's1',
          executor: { kind: 'agent', instruction: { kind: 'inline', text: '做' } },
          outputs: [{ destination: { kind: 'file', path: '../escape.md' }, template: { kind: 'none' }, required: true }],
          writableScope: ['C:\\abs\\path', 'ok/dir'],
          gate: [{ kind: 'manual', actions: [{ label: '', command: '' }] }]
        }
      ]
    } as unknown as WorkflowDefinition
    const repaired = repairWorkflow(def)
    expect(repaired.nodes[0].id).toBe('n1')
    expectValid(repaired)
  })
})

describe('validateWorkflow', () => {
  it('完整合法工作流通过', () => {
    expect(validateWorkflow(workflow())).toEqual({ ok: true })
  })

  it('id / 显示名为空判非法', () => {
    expect(validateWorkflow(workflow({ id: '' })).ok).toBe(false)
    expect(validateWorkflow(workflow({ name: { zh: '   ' } })).ok).toBe(false)
  })

  it('节点执行者类型非法判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'nope' } as never })] })).ok).toBe(false)
  })

  it('节点 stageId 未引用有效阶段判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ stageId: 'missing' })] })).ok).toBe(false)
  })

  it('agent 执行配置：声明合法 effort 通过、字段完整保留', () => {
    const n = node({
      executor: {
        kind: 'agent',
        instruction: { kind: 'inline', text: '做' },
        exec: { toolId: 'claude-code', model: 'opus', effort: 'high' }
      }
    })
    expect(validateWorkflow(workflow({ nodes: [n] }))).toEqual({ ok: true })
    expect(n.executor.kind === 'agent' && n.executor.exec?.effort).toBe('high')
  })

  it('agent 执行配置：effort 枚举外值判非法并给可读原因', () => {
    const n = node({
      executor: {
        kind: 'agent',
        instruction: { kind: 'inline', text: '做' },
        exec: { effort: 'ultra' as never }
      }
    })
    const r = validateWorkflow(workflow({ nodes: [n] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/effort/)
  })

  it('agent 执行配置：无 effort 字段（旧定义）仍合法', () => {
    const n = node({
      executor: {
        kind: 'agent',
        instruction: { kind: 'inline', text: '做' },
        exec: { toolId: 'claude-code', model: 'gpt' }
      }
    })
    expect(validateWorkflow(workflow({ nodes: [n] }))).toEqual({ ok: true })
  })

  it('engine / command / subworkflow 缺驱动指令判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'engine', operation: '' } })] })).ok).toBe(false)
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: '' }] } })] })).ok).toBe(false)
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'subworkflow', workflowId: '' } })] })).ok).toBe(false)
  })

  it('command 命令列表：至少一条、各条命令行非空', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'npm test' }] } })] }))).toEqual({ ok: true })
    // 两条命令均合法
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'serve-a' }, { command: 'serve-b', label: '前端' }] } })] }))).toEqual({ ok: true })
    // 空数组非法
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [] } })] })).ok).toBe(false)
    // 某条命令行为空非法
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'ok' }, { command: '  ' }] } })] })).ok).toBe(false)
  })

  it('command 前置检查命令：缺省合法、声明则非空（逐条）', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'deploy', check: 'is-deployed' }] } })] }))).toEqual({ ok: true })
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'deploy', check: '  ' }] } })] })).ok).toBe(false)
  })

  it('超时秒数：缺省合法、正数合法、0/负数/非数值判非法', () => {
    const cmd = (timeoutSec: unknown): WorkflowDefinition =>
      workflow({ nodes: [node({ executor: { kind: 'command', commands: [{ command: 'x', timeoutSec }] } as never })] })
    expect(validateWorkflow(cmd(undefined))).toEqual({ ok: true })
    expect(validateWorkflow(cmd(30))).toEqual({ ok: true })
    expect(validateWorkflow(cmd(0)).ok).toBe(false)
    expect(validateWorkflow(cmd(-5)).ok).toBe(false)
    expect(validateWorkflow(cmd('20')).ok).toBe(false)
    // 客观门 timeoutSec
    const gate = workflow({
      nodes: [node({ executor: { kind: 'command', commands: [{ command: 'x' }] }, gate: [{ kind: 'auto', check: { kind: 'inline', command: 'lint' }, timeoutSec: -1 }] })]
    })
    expect(validateWorkflow(gate).ok).toBe(false)
    // 动作按钮 timeoutSec
    const act = workflow({
      nodes: [node({ executor: { kind: 'command', commands: [{ command: 'x' }] }, gate: [{ kind: 'manual', actions: [{ label: '启动', command: 'serve', timeoutSec: 0 }] }] })]
    })
    expect(validateWorkflow(act).ok).toBe(false)
  })

  it('迁移：旧单命令 command 归一为 commands[]，保留 check/timeoutSec 与门超时', () => {
    const raw = {
      id: 'wf-1',
      name: 'x',
      stages: [{ id: 's1', name: '开发' }],
      nodes: [
        {
          id: 'n1',
          name: 'c',
          stageId: 's1',
          executor: { kind: 'command', command: 'serve', check: 'is-up', timeoutSec: 10 },
          outputs: [],
          gate: [
            { kind: 'auto', check: { kind: 'inline', command: 'lint' }, timeoutSec: 20 },
            { kind: 'manual', actions: [{ label: '启动', command: 'npm start', timeoutSec: 30 }] }
          ]
        }
      ]
    }
    const def = migrateWorkflowShape(raw)
    expect(def.nodes[0].executor).toEqual({ kind: 'command', commands: [{ command: 'serve', check: 'is-up', timeoutSec: 10 }] })
    const gates = def.nodes[0].gate!
    expect((gates[0] as { timeoutSec?: number }).timeoutSec).toBe(20)
    expect((gates[1] as { actions: Array<{ timeoutSec?: number }> }).actions[0].timeoutSec).toBe(30)
    expect(validateWorkflow(def)).toEqual({ ok: true })
  })

  it('迁移：新形状 commands[] 幂等（含 label）', () => {
    const raw = {
      id: 'wf-1',
      name: 'x',
      stages: [{ id: 's1', name: '开发' }],
      nodes: [{ id: 'n1', name: 'c', stageId: 's1', executor: { kind: 'command', commands: [{ command: 'a', label: 'A' }, { command: 'b' }] }, outputs: [] }]
    }
    const def = migrateWorkflowShape(raw)
    expect(def.nodes[0].executor).toEqual({ kind: 'command', commands: [{ command: 'a', label: 'A' }, { command: 'b' }] })
  })

  it('agent file 形态：绝对路径或 .. 判非法', () => {
    const abs = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'file', path: '/abs/skill.md' } } })] })
    const esc = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'file', path: '../skill.md' } } })] })
    const r1 = validateWorkflow(abs)
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.reason).toMatch(/路径|skill\.md/)
    expect(validateWorkflow(esc).ok).toBe(false)
  })

  it('agent file 形态：包内相对路径通过', () => {
    const ok = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'file', path: 'skills/review.md' } } })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
  })

  it('agent installed 形态：非空调用名通过、空名判非法', () => {
    const ok = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'installed', name: 'opsx:explore' } } })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
    const bad = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'installed', name: '  ' } } })] })
    expect(validateWorkflow(bad).ok).toBe(false)
  })

  it('产出 file 路径非法（绝对/..）判非法', () => {
    const abs = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: '/abs/report.md' }, template: { kind: 'none' }, required: true }] })] })
    expect(validateWorkflow(abs).ok).toBe(false)
    const esc = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: '../report.md' }, template: { kind: 'none' }, required: true }] })] })
    expect(validateWorkflow(esc).ok).toBe(false)
  })

  it('产出路径非 .md 判非法', () => {
    const bad = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'docs/report.txt' }, template: { kind: 'none' }, required: true }] })] })
    const r = validateWorkflow(bad)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/markdown|\.md/)
  })

  it('合法 file 产出（不声明模板 / 引用模板）通过', () => {
    const none = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'docs/change/spec.md' }, template: { kind: 'none' }, required: true }] })] })
    expect(validateWorkflow(none)).toEqual({ ok: true })
    const ref = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'docs/change/spec.md' }, template: { kind: 'ref', ref: { packId: 'p', itemId: 'spec-template' } }, required: true }] })] })
    expect(validateWorkflow(ref)).toEqual({ ok: true })
  })

  it('可写范围路径非法判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ writableScope: ['../outside'] })] })).ok).toBe(false)
  })

  it('自动校验命令行：缺命令判非法、有命令通过', () => {
    const bad = workflow({ nodes: [node({ gate: [{ kind: 'auto', check: { kind: 'inline', command: '' } }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
    const ok = workflow({ nodes: [node({ gate: [{ kind: 'auto', check: { kind: 'inline', command: 'npm test' } }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
  })

  it('自动校验引用：条目 id 非空通过、空判非法；不强制引用存在', () => {
    const ok = workflow({ nodes: [node({ gate: [{ kind: 'auto', check: { kind: 'ref', ref: { packId: 'p', itemId: 'run-tests' } } }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
    const bad = workflow({ nodes: [node({ gate: [{ kind: 'auto', check: { kind: 'ref', ref: { packId: '', itemId: '' } } }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
  })

  it('产出模板引用：条目 id 非空通过、空判非法', () => {
    const ok = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'a.md' }, template: { kind: 'ref', ref: { packId: 'p', itemId: 'spec-template' } }, required: false }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
    const bad = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'a.md' }, template: { kind: 'ref', ref: { packId: 'p', itemId: '' } }, required: false }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
  })

  it('自动校验检查项目标须匹配本节点产出路径', () => {
    const bad = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'a.md' }, template: { kind: 'none' }, required: true }], gate: [{ kind: 'auto', check: { kind: 'inline', command: 'x' }, targets: ['b.md'] }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
    const ok = workflow({ nodes: [node({ outputs: [{ destination: { kind: 'file', path: 'a.md' }, template: { kind: 'none' }, required: true }], gate: [{ kind: 'auto', check: { kind: 'inline', command: 'x' }, targets: ['a.md'] }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
  })

  it('人工评审动作按钮缺名称/命令判非法；零动作合法', () => {
    const bad = workflow({ nodes: [node({ gate: [{ kind: 'manual', actions: [{ label: '启动', command: '' }] }] })] })
    expect(validateWorkflow(bad).ok).toBe(false)
    const ok = workflow({ nodes: [node({ gate: [{ kind: 'manual', actions: [{ label: '启动', command: 'npm start' }] }] })] })
    expect(validateWorkflow(ok)).toEqual({ ok: true })
    // 无动作按钮（零）也合法
    expect(validateWorkflow(workflow({ nodes: [node({ gate: [{ kind: 'manual' }] })] }))).toEqual({ ok: true })
  })

  it('agent 不声明 exec 合法；声明 exec 各字段合法', () => {
    expect(validateWorkflow(workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } } })] }))).toEqual({ ok: true })
    const withExec = workflow({ nodes: [node({ executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' }, exec: { toolId: 'claude-code', model: 'opus' } } })] })
    expect(validateWorkflow(withExec)).toEqual({ ok: true })
  })

  it('未声明 newRequirementInstruction 合法', () => {
    expect(validateWorkflow(workflow())).toEqual({ ok: true })
  })

  it('newRequirementInstruction：inline 文本与 file 合规相对路径通过', () => {
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'inline', text: '把描述分解成多张卡' } }))
    ).toEqual({ ok: true })
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'file', path: 'skills/decompose.md' } }))
    ).toEqual({ ok: true })
  })

  it('newRequirementInstruction：越界 file 路径被拒', () => {
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'file', path: '../escape.md' } })).ok
    ).toBe(false)
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'file', path: 'C:\\abs.md' } })).ok
    ).toBe(false)
  })

  it('newRequirementInstruction：形态非法被拒', () => {
    expect(
      validateWorkflow(workflow({ newRequirementInstruction: { kind: 'whatever' } as never })).ok
    ).toBe(false)
  })
})

describe('validateWorkflow — 节点目标仓选择 target', () => {
  const engineNode = (over: Partial<WorkflowNode> = {}): WorkflowNode =>
    node({ id: 'e1', name: { zh: '建分支' }, executor: { kind: 'engine', operation: 'create-branch' }, ...over })

  it('缺省 target 合法', () => {
    expect(validateWorkflow(workflow({ nodes: [engineNode()] }))).toEqual({ ok: true })
  })

  it('target=all 合法', () => {
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'all' } })] }))).toEqual({ ok: true })
  })

  it('target=tag：标签非空合法、空判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'tag', tag: '后端' } })] }))).toEqual({ ok: true })
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'tag', tag: '  ' } })] })).ok).toBe(false)
  })

  it('target=repo：memberId 非空合法、空判非法', () => {
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'repo', memberId: 'm1' } })] }))).toEqual({ ok: true })
    expect(validateWorkflow(workflow({ nodes: [engineNode({ target: { kind: 'repo', memberId: '' } })] })).ok).toBe(false)
  })

  it('target=fromUpstream：引用前置且声明结构化输出的 agent 节点合法', () => {
    const agent = node({
      id: 'a1',
      name: { zh: '分诊' },
      executor: { kind: 'agent', instruction: { kind: 'inline', text: '判涉及仓' }, structuredOutput: { repos: true } }
    })
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: 'a1' } })
    expect(validateWorkflow(workflow({ nodes: [agent, eng] }))).toEqual({ ok: true })
  })

  it('target=fromUpstream：引用不存在的节点判非法', () => {
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: '不存在' } })
    expect(validateWorkflow(workflow({ nodes: [eng] })).ok).toBe(false)
  })

  it('target=fromUpstream：引用后置节点判非法', () => {
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: 'a1' } })
    const agent = node({
      id: 'a1',
      name: { zh: '分诊' },
      executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' }, structuredOutput: { repos: true } }
    })
    // eng 在前、agent 在后 → 非法
    expect(validateWorkflow(workflow({ nodes: [eng, agent] })).ok).toBe(false)
  })

  it('target=fromUpstream：引用非 agent 节点判非法', () => {
    const notAgent = node({ id: 'c1', name: { zh: '命令' }, executor: { kind: 'command', commands: [{ command: 'x' }] } })
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: 'c1' } })
    expect(validateWorkflow(workflow({ nodes: [notAgent, eng] })).ok).toBe(false)
  })

  it('target=fromUpstream：引用的 agent 未声明结构化输出判非法', () => {
    const agent = node({ id: 'a1', name: { zh: '普通 agent' }, executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } } })
    const eng = engineNode({ target: { kind: 'fromUpstream', nodeId: 'a1' } })
    expect(validateWorkflow(workflow({ nodes: [agent, eng] })).ok).toBe(false)
  })

  it('agent 节点声明结构化输出本身合法', () => {
    const agent = node({
      id: 'a1',
      name: { zh: '分诊' },
      executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' }, structuredOutput: { repos: true } }
    })
    expect(validateWorkflow(workflow({ nodes: [agent] }))).toEqual({ ok: true })
  })
})

describe('checkBranchPairing', () => {
  const engineNode = (id: string, operation: string): WorkflowNode =>
    node({ id, name: { zh: id }, executor: { kind: 'engine', operation } })

  it('建分支无删分支判无效，带可读原因', () => {
    const def = workflow({ nodes: [engineNode('c', 'create-branch')] })
    const r = checkBranchPairing(def)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/create-branch/)
      expect(r.reason).toMatch(/delete-branch/)
    }
  })

  it('建分支且有删分支判有效', () => {
    const def = workflow({
      nodes: [engineNode('c', 'create-branch'), engineNode('d', 'delete-branch-worktree')]
    })
    expect(checkBranchPairing(def)).toEqual({ ok: true })
  })

  it('既不建分支也不删分支判有效（无分支可泄漏）', () => {
    expect(checkBranchPairing(workflow())).toEqual({ ok: true })
    // 只删不建也有效（不做反向校验）
    expect(checkBranchPairing(workflow({ nodes: [engineNode('d', 'delete-branch-worktree')] }))).toEqual({ ok: true })
  })

  it('默认种子工作流通过分支配对校验', () => {
    expect(checkBranchPairing(createDefaultWorkflow('seed-x'))).toEqual({ ok: true })
  })
})

describe('createDefaultWorkflow', () => {
  it('用注入 id 生成合法的、以 engine 操作为主的线性工作流', () => {
    const def = createDefaultWorkflow('seed-1')
    expect(def.id).toBe('seed-1')
    expect(validateWorkflow(def)).toEqual({ ok: true })
    const engineNodes = def.nodes.filter((n) => n.executor.kind === 'engine')
    expect(engineNodes.length).toBeGreaterThanOrEqual(3)
    const ops = engineNodes.map((n) => (n.executor as { operation: string }).operation)
    expect(ops).toContain('create-branch')
    expect(ops).toContain('open-worktree')
    expect(ops).toContain('merge-branch')
    // 每个节点都归属一个已声明的阶段
    const stageIds = new Set(def.stages.map((s) => s.id))
    expect(def.nodes.every((n) => stageIds.has(n.stageId))).toBe(true)
  })

  it('本地直合默认含新词表交付段（合并/push/删 worktree/删本地分支）', () => {
    const ops = createDefaultWorkflow('seed-2')
      .nodes.filter((n) => n.executor.kind === 'engine')
      .map((n) => (n.executor as { operation: string }).operation)
    expect(ops).toEqual([
      'create-branch',
      'open-worktree',
      'link-env',
      'merge-branch',
      'push-branch',
      'remove-worktree',
      'delete-branch'
    ])
  })
})

describe('createDefaultWorkflow —— 合并前人工审批门（重大步骤须审批的产品硬原则）', () => {
  it('过 lintWorkflow：合并前含 manual 门，无「固化步骤前缺人工验收」告警', () => {
    expect(lintWorkflow(createDefaultWorkflow('x'))).toEqual([])
  })

  it('过 validateWorkflow 与 checkBranchPairing', () => {
    const def = createDefaultWorkflow('x')
    expect(validateWorkflow(def)).toEqual({ ok: true })
    expect(checkBranchPairing(def)).toEqual({ ok: true })
  })

  it('第一个固化节点（merge-branch）之前或其自身上有一道 manual 门', () => {
    const def = createDefaultWorkflow('x')
    const mergeIdx = def.nodes.findIndex(
      (n) => n.executor.kind === 'engine' && (n.executor as { operation: string }).operation === 'merge-branch'
    )
    expect(mergeIdx).toBeGreaterThanOrEqual(0)
    const upToMerge = def.nodes.slice(0, mergeIdx + 1)
    expect(upToMerge.some((n) => (n.gate ?? []).some((g) => g.kind === 'manual'))).toBe(true)
  })

  it('该 manual 门挂在支持挂门的节点上（不挂在 supportsGate=false 的 merge-branch 引擎节点上）', () => {
    const def = createDefaultWorkflow('x')
    for (const n of def.nodes) {
      if ((n.gate ?? []).length === 0) continue
      // 引擎节点若挂门，其操作必须 supportsGate=true；非引擎节点（如 command 评审节点）不受此限
      if (n.executor.kind === 'engine') {
        expect(engineOpCapabilities((n.executor as { operation: string }).operation).supportsGate).toBe(true)
      }
    }
  })

  it('显示名/描述不宣示「无人值守 / unattended / 免审批」', () => {
    const def = createDefaultWorkflow('x')
    const blob = JSON.stringify([def.name, def.description])
    expect(blob).not.toMatch(/无人值守|unattended|免审批/i)
  })
})

describe('createDefaultWorkflowPr', () => {
  it('合法、过分支配对，交付段含 push 需求分支/人工门/删云端分支', () => {
    const def = createDefaultWorkflowPr('pr-1')
    expect(validateWorkflow(def)).toEqual({ ok: true })
    expect(checkBranchPairing(def)).toEqual({ ok: true })
    const engineNodes = def.nodes.filter((n) => n.executor.kind === 'engine')
    const ops = engineNodes.map((n) => (n.executor as { operation: string }).operation)
    expect(ops).toContain('push-branch')
    expect(ops).toContain('delete-remote-branch')
    expect(ops).toContain('delete-branch')
    // push 需求分支节点挂了人工评审门
    const pushFeature = def.nodes.find((n) => n.id === 'push-feature')
    expect(pushFeature?.gate?.[0]?.kind).toBe('manual')
  })

  describe('createRealPrWorkflow（真 PR：合并在平台上发生）', () => {
    it('合法、过分支配对，open-pr 挂 external(pr-merged) 门，不含 merge-branch/verify 节点', () => {
      const def = createRealPrWorkflow('real-pr-1')
      expect(def.id).toBe('real-pr-1')
      expect(validateWorkflow(def)).toEqual({ ok: true })
      expect(checkBranchPairing(def)).toEqual({ ok: true })
      const ops = def.nodes
        .filter((n) => n.executor.kind === 'engine')
        .map((n) => (n.executor as { operation: string }).operation)
      expect(ops).toContain('open-pr')
      // 「核查已合并」不再是操作/节点，而是外部门
      expect(ops).not.toContain('verify-pr-merged')
      // 真 PR 的本质：合并在平台上发生，Klarit 不本地合并
      expect(ops).not.toContain('merge-branch')
      expect(ops).toContain('create-branch')
      expect(ops).toContain('delete-branch')
      // open-pr 节点挂了一道 external(pr-merged) 门
      const openPr = def.nodes.find((n) => n.id === 'open-pr')
      expect(openPr?.gate?.[0]).toEqual({ kind: 'external', verify: 'pr-merged' })
    })

    it('节点名双语（zh + en）', () => {
      const def = createRealPrWorkflow('real-pr-2')
      for (const n of def.nodes) {
        expect(n.name.zh?.length ?? 0).toBeGreaterThan(0)
        expect(n.name.en?.length ?? 0).toBeGreaterThan(0)
      }
    })
  })

  it('两个默认工作流都通过分支配对校验', () => {
    expect(checkBranchPairing(createDefaultWorkflow('a'))).toEqual({ ok: true })
    expect(checkBranchPairing(createDefaultWorkflowPr('b'))).toEqual({ ok: true })
  })
})

describe('createAcceptanceSampleWorkflow', () => {
  it('合法、含三个验收面:两前台命令 / 两后台命令 / 两门动作按钮', () => {
    const def = createAcceptanceSampleWorkflow('acc-1')
    expect(validateWorkflow(def)).toEqual({ ok: true })
    const fg = def.nodes.find((n) => n.id === 'two-foreground')!
    expect(fg.executor.kind === 'command' && fg.executor.commands).toHaveLength(2)
    const bg = def.nodes.find((n) => n.id === 'two-background')!
    expect(bg.executor.kind === 'command' && bg.executor.commands).toHaveLength(2)
    const gate = def.nodes.find((n) => n.id === 'two-gate-actions')!
    expect(gate.gate?.[0]?.kind).toBe('manual')
    const actions = gate.gate?.[0]?.kind === 'manual' ? gate.gate[0].actions : []
    expect(actions).toHaveLength(2)
  })
})

describe('createRollbackSampleWorkflow', () => {
  it('合法、过分支配对，含 plan(产 PLAN.md)/implement(agent)/评审门', () => {
    const def = createRollbackSampleWorkflow('rb-1')
    expect(validateWorkflow(def)).toEqual({ ok: true })
    expect(checkBranchPairing(def)).toEqual({ ok: true })
    const plan = def.nodes.find((n) => n.id === 'plan')!
    expect(plan.executor.kind).toBe('agent')
    expect(plan.outputs.map((o) => o.destination.path)).toContain('PLAN.md')
    expect(plan.outputs.find((o) => o.destination.path === 'PLAN.md')?.required).toBe(true)
    const impl = def.nodes.find((n) => n.id === 'implement')!
    expect(impl.executor.kind).toBe('agent')
    // 评审节点挂人工评审门（驳回入口）
    const review = def.nodes.find((n) => n.id === 'review')!
    expect(review.gate?.[0]?.kind).toBe('manual')
  })
})

describe('workflowSummary', () => {
  it('有效工作流：提取 id 与 name，不带 invalidReason', () => {
    expect(workflowSummary(workflow({ id: 'x', name: { zh: '流程 X' } }))).toEqual({ id: 'x', name: { zh: '流程 X' } })
  })

  it('无效工作流（建分支无删分支）：摘要带 invalidReason', () => {
    const def = workflow({
      id: 'y',
      name: { zh: '流程 Y' },
      nodes: [node({ id: 'c', name: { zh: 'c' }, executor: { kind: 'engine', operation: 'create-branch' } })]
    })
    const s = workflowSummary(def)
    expect(s.id).toBe('y')
    expect(s.name).toEqual({ zh: '流程 Y' })
    expect(s.invalidReason).toMatch(/delete-branch/)
  })

  it('触发软校验的工作流：摘要带 warnings（非阻断，不进 invalidReason）', () => {
    const def = workflow({
      id: 'z',
      name: { zh: '流程 Z' },
      nodes: [node({ id: 'm', name: { zh: 'm' }, executor: { kind: 'engine', operation: 'merge-branch' } })]
    })
    const s = workflowSummary(def)
    expect(s.warnings).toContain('固化步骤前缺人工验收')
    // 软校验是隐患告警，不是「不可用」——不落 invalidReason
    expect(s.invalidReason).toBeUndefined()
  })
})

describe('lintWorkflow', () => {
  const engineNode = (id: string, operation: string, gate?: WorkflowGateItem[]): WorkflowNode =>
    node({ id, name: { zh: id }, executor: { kind: 'engine', operation }, ...(gate ? { gate } : {}) })
  const manualGateNode = (id: string): WorkflowNode =>
    node({
      id,
      name: { zh: id },
      executor: { kind: 'command', commands: [{ command: 'echo review' }] },
      gate: [{ kind: 'manual', actions: [{ label: '看改动', command: 'git diff' }] }]
    })

  it('固化操作集从引擎能力单一来源派生（恰为三个不可逆固化操作，不含 archive-docs）', () => {
    expect([...IRREVERSIBLE_FINALIZATION_OPS].sort()).toEqual(
      ['merge-branch', 'open-pr', 'push-branch']
    )
    expect([...IRREVERSIBLE_FINALIZATION_OPS]).not.toContain('archive-docs')
  })

  it('固化操作之前无任何 manual 门 → 告警「固化步骤前缺人工验收」', () => {
    const def = workflow({ nodes: [engineNode('m', 'merge-branch')] })
    expect(lintWorkflow(def)).toContain('固化步骤前缺人工验收')
  })

  it('三类固化操作各自在无前置/无门时都告警', () => {
    for (const op of ['merge-branch', 'push-branch', 'open-pr']) {
      expect(lintWorkflow(workflow({ nodes: [engineNode('x', op)] }))).toContain('固化步骤前缺人工验收')
    }
  })

  it('archive-docs 不算固化：单它（无 merge/push/open-pr）不触发告警（提交到特性分支、可回退）', () => {
    expect(lintWorkflow(workflow({ nodes: [engineNode('a', 'archive-docs')] }))).toEqual([])
  })

  it('manual 门排在所有固化操作之前 → 不告警', () => {
    const def = workflow({ nodes: [manualGateNode('review'), engineNode('m', 'merge-branch')] })
    expect(lintWorkflow(def)).toEqual([])
  })

  it('工作流不含任何固化操作 → 不告警', () => {
    expect(lintWorkflow(workflow())).toEqual([])
  })

  it('manual 门就挂在第一个固化节点自身上 → 不告警（该门在其固化动作生效前拦一道人来拍板，是正规打法）', () => {
    const def = workflow({
      nodes: [engineNode('m', 'merge-branch', [{ kind: 'manual', actions: [{ label: 'x', command: 'y' }] }])]
    })
    expect(lintWorkflow(def)).toEqual([])
  })

  it('manual 门挂在第一个固化节点（push-branch）自身上 → 不告警', () => {
    const def = workflow({
      nodes: [engineNode('p', 'push-branch', [{ kind: 'manual', actions: [{ label: '看提交', command: 'git log' }] }])]
    })
    expect(lintWorkflow(def)).toEqual([])
  })

  it('不看命令文本：仅靠取反命令表达「红门」的工作流不被 lint 标记', () => {
    const def = workflow({
      nodes: [
        node({
          id: 'g',
          name: { zh: 'g' },
          executor: { kind: 'command', commands: [{ command: '! npm test' }] },
          gate: [{ kind: 'auto', check: { kind: 'inline', command: '! npm test' } }]
        })
      ]
    })
    expect(lintWorkflow(def)).toEqual([])
  })

  it('软校验不影响 validateWorkflow / checkBranchPairing 的结果', () => {
    const def = workflow({ nodes: [engineNode('m', 'merge-branch')] })
    // lint 告警，但两套校验仍判 ok（merge 无 create-branch，不触发配对；结构合法）
    expect(lintWorkflow(def).length).toBeGreaterThan(0)
    expect(validateWorkflow(def)).toEqual({ ok: true })
    expect(checkBranchPairing(def)).toEqual({ ok: true })
  })
})

describe('ensureApprovalBeforeFinalization（确定性补固化前审批门，设计决策 #16）', () => {
  const engineNode = (id: string, operation: string, gate?: WorkflowGateItem[]): WorkflowNode =>
    node({ id, name: { zh: id }, executor: { kind: 'engine', operation }, ...(gate ? { gate } : {}) })
  const manualNode = (id: string): WorkflowNode =>
    node({
      id,
      name: { zh: id },
      executor: { kind: 'command', commands: [{ command: 'echo review' }] },
      gate: [{ kind: 'manual', actions: [{ label: '看改动', command: 'git diff' }] }]
    })

  it('固化前缺 manual 门 → 在第一个固化节点前插入带 manual 门的复核节点，lint 转干净', () => {
    const def = workflow({ nodes: [engineNode('m', 'merge-branch')] })
    expect(lintWorkflow(def)).toContain('固化步骤前缺人工验收')

    const fixed = ensureApprovalBeforeFinalization(def)
    // lint 不再命中该告警（且本例无其它告警 → 空）。
    expect(lintWorkflow(fixed)).not.toContain('固化步骤前缺人工验收')
    expect(lintWorkflow(fixed)).toEqual([])
    // 恰插入一个节点，排在固化节点之前。
    expect(fixed.nodes.length).toBe(def.nodes.length + 1)
    const mergeIdx = fixed.nodes.findIndex(
      (n) => n.executor.kind === 'engine' && n.executor.operation === 'merge-branch'
    )
    const review = fixed.nodes[mergeIdx - 1]
    expect(review).toBeDefined()
    // 复核节点：command 执行者 + manual 门 + 与固化节点同 stage + 双语名。
    expect(review.executor.kind).toBe('command')
    expect((review.gate ?? []).some((g) => g.kind === 'manual')).toBe(true)
    expect(review.stageId).toBe('s1')
    expect(review.name.zh).toBeTruthy()
    expect(review.name.en).toBeTruthy()
    // 仍过硬校验与分支配对。
    expect(validateWorkflow(fixed)).toEqual({ ok: true })
    expect(checkBranchPairing(fixed)).toEqual({ ok: true })
  })

  it('幂等：二次应用不再重复插入（applying twice = applying once）', () => {
    const def = workflow({ nodes: [engineNode('m', 'merge-branch')] })
    const once = ensureApprovalBeforeFinalization(def)
    const twice = ensureApprovalBeforeFinalization(once)
    expect(twice).toEqual(once)
    expect(twice.nodes.length).toBe(once.nodes.length)
  })

  it('已在固化前含 manual 门 → 原样返回（no-op，覆盖“已有审批门”）', () => {
    const def = workflow({ nodes: [manualNode('review'), engineNode('m', 'merge-branch')] })
    expect(lintWorkflow(def)).toEqual([])
    expect(ensureApprovalBeforeFinalization(def)).toBe(def)
  })

  it('无任何固化操作 → 原样返回（no-op）', () => {
    const def = workflow() // 单 agent 节点，无固化操作
    expect(ensureApprovalBeforeFinalization(def)).toBe(def)
  })

  it('插入的复核节点 id 不与既有节点冲突', () => {
    // 既有节点先占用默认复核 id → helper 须另起一个唯一 id，不产生重复 id。
    const def = workflow({
      nodes: [
        node({
          id: 'approve-before-finalizing',
          name: { zh: 'x' },
          executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } }
        }),
        engineNode('m', 'merge-branch')
      ]
    })
    const fixed = ensureApprovalBeforeFinalization(def)
    const ids = fixed.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(lintWorkflow(fixed)).toEqual([])
  })

  it('多个固化操作 → 只在第一个固化节点前插一次', () => {
    const def = workflow({ nodes: [engineNode('p', 'push-branch'), engineNode('m', 'merge-branch')] })
    const fixed = ensureApprovalBeforeFinalization(def)
    expect(fixed.nodes.length).toBe(def.nodes.length + 1)
    // 插在第一个固化（push-branch）之前。
    expect((fixed.nodes[0].gate ?? []).some((g) => g.kind === 'manual')).toBe(true)
    expect(fixed.nodes[1].id).toBe('p')
  })
})

describe('migrateWorkflowShape', () => {
  it('对新形状幂等（默认种子往返不变）', () => {
    const def = createDefaultWorkflow('seed')
    expect(migrateWorkflowShape(JSON.parse(JSON.stringify(def)))).toEqual(def)
  })

  it('旧产出有路径→file 目的地+none 模板（丢弃旧 type/format）', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } }, outputs: [{ type: 'report', format: 'md', path: 'docs/r.md', required: true }] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].outputs).toEqual([
      { destination: { kind: 'file', path: 'docs/r.md' }, template: { kind: 'none' }, required: true }
    ])
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })

  it('旧 inline/file 模板 → none（嵌入形态已废）；ref 模板保留', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'command', command: 'x' }, outputs: [
        { destination: { kind: 'file', path: 'a.md' }, template: { kind: 'inline', text: '## x' }, required: false },
        { destination: { kind: 'file', path: 'b.md' }, template: { kind: 'ref', ref: { packId: 'p', itemId: 't' } }, required: false }
      ] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].outputs[0].template).toEqual({ kind: 'none' })
    expect(migrated.nodes[0].outputs[1].template).toEqual({ kind: 'ref', ref: { packId: 'p', itemId: 't' } })
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })

  it('旧产出无路径（卡片数据）丢弃', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'engine', operation: 'create-branch' }, outputs: [{ type: 'note', format: 'text', required: false }] }]
    }
    expect(migrateWorkflowShape(old).nodes[0].outputs).toEqual([])
  })

  it('旧检查项：无命令 auto 丢弃、manual 保留为新形状', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'command', command: 'x' }, outputs: [], gate: [{ kind: 'auto', description: '客观' }, { kind: 'manual', description: '人工' }] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].gate).toEqual([{ kind: 'manual' }])
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })

  it('旧 auto 检查项有命令 → inline 校验', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'command', command: 'x' }, outputs: [], gate: [{ kind: 'auto', description: '客观', command: 'npm test' }] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].gate).toEqual([{ kind: 'auto', check: { kind: 'inline', command: 'npm test' } }])
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })

  it('agent 无 exec 保持原样、迁移后合法', () => {
    const old = {
      id: 'w', name: 'W', stages: [{ id: 's', name: 'S' }],
      nodes: [{ id: 'n', name: 'N', stageId: 's', executor: { kind: 'agent', instruction: { kind: 'inline', text: 'x' } }, outputs: [] }]
    }
    const migrated = migrateWorkflowShape(old)
    expect(migrated.nodes[0].executor).toEqual({ kind: 'agent', instruction: { kind: 'inline', text: 'x' } })
    expect(validateWorkflow(migrated)).toEqual({ ok: true })
  })
})
