/** 工作流的纯逻辑：路径安全、定义校验、默认种子、摘要。main 与 renderer 共享，无 fs / yaml 依赖。 */

import type {
  AgentInstruction,
  GateCheck,
  NodeExecutor,
  WorkflowDefinition,
  WorkflowGateItem,
  WorkflowNode,
  WorkflowOutput,
  WorkflowStage,
  WorkflowSummary,
  WorkflowValidation
} from './types'
import { DEFAULT_CARD_TYPES, validateSuggestedTypes } from './card-type'
import { hasAnyLanguage, resolveLocalized } from './localized'
import type { Localized } from './localized'
import { DEFAULT_LANGUAGE } from './language'

/** 双语文案速记（种子构造用）。 */
function L(zh: string, en: string): Localized {
  return { zh, en }
}

const EXECUTOR_KINDS: ReadonlyArray<NodeExecutor['kind']> = [
  'agent',
  'engine',
  'command',
  'subworkflow'
]

/**
 * 引擎操作的能力声明：该操作是否会产出文档、是否需要检查/门、是否需要可写范围。
 * UI 据此决定节点详情里「产出 / 检查 / 可写范围」三块的显隐（见 workflow-editor），
 * 也是将来引擎执行期「该操作会不会产出/写盘」的声明来源。不进 workflow.yaml（UI/校验侧元数据）。
 */
export interface EngineOpCapabilities {
  producesOutputs: boolean
  supportsGate: boolean
  supportsWritableScope: boolean
}

const NO_ENGINE_CAP: EngineOpCapabilities = {
  producesOutputs: false,
  supportsGate: false,
  supportsWritableScope: false
}

/** push-branch 是天然的人工评审点：唯一支持门把的引擎操作。 */
const PUSH_ENGINE_CAP: EngineOpCapabilities = {
  producesOutputs: false,
  supportsGate: true,
  supportsWritableScope: false
}

/**
 * 引擎内置操作集（封闭操作集）——UI 下拉、校验与引擎执行的单一来源。
 * 8 个均为确定性 git/worktree/fs 动作：产出/可写范围皆否；门把仅 push-branch 为是（推送后可挂人工评审）。
 * 旧 `delete-branch-worktree` 作为**复合别名**仍被识别（执行期 = remove-worktree + delete-branch），
 * 不列入下拉（既有种子包靠 engineOpCapabilities 的回落与 checkBranchPairing 的别名识别保持兼容）。
 */
const ENGINE_OPERATION_SPECS: Readonly<Record<string, EngineOpCapabilities>> = {
  'create-branch': NO_ENGINE_CAP,
  'open-worktree': NO_ENGINE_CAP,
  'link-env': NO_ENGINE_CAP,
  'merge-branch': NO_ENGINE_CAP,
  'push-branch': PUSH_ENGINE_CAP,
  'remove-worktree': NO_ENGINE_CAP,
  'delete-branch': NO_ENGINE_CAP,
  'delete-remote-branch': NO_ENGINE_CAP
}

/** 旧复合别名（删 worktree + 删本地分支）；仍被校验与引擎识别，但不进下拉。 */
export const LEGACY_DELETE_BRANCH_WORKTREE = 'delete-branch-worktree'

/** 操作名数组（下拉与既有引用用），顺序即声明顺序。 */
export const ENGINE_OPERATIONS = Object.keys(ENGINE_OPERATION_SPECS) as ReadonlyArray<string>

/** 查询某引擎操作的能力声明；未知/空操作回落为三项皆否（保证 UI 显隐逻辑无须特判）。 */
export function engineOpCapabilities(op: string): EngineOpCapabilities {
  return ENGINE_OPERATION_SPECS[op] ?? NO_ENGINE_CAP
}

/**
 * 是否为「相对分支/包目录」的合规路径：非空、非绝对（POSIX 根 / Windows 盘符 / UNC）、不含 `..` 段。
 * 产出路径、可写范围、agent file 形态的 skill 路径共用此约束。
 */
export function isSafeRelativePath(p: unknown): boolean {
  if (typeof p !== 'string') return false
  const t = p.trim()
  if (t === '') return false
  if (t.startsWith('/') || t.startsWith('\\')) return false
  if (/^[A-Za-z]:/.test(t)) return false
  return !t.split(/[\\/]+/).some((seg) => seg === '..')
}

function nonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s.trim() !== ''
}

/** 校验可选超时秒数：缺省合法；声明则须为正数。非法返回原因片段,合法返回 null。 */
function badTimeout(v: unknown): string | null {
  if (v === undefined || v === null) return null
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? null : '超时秒数须为正数'
}

function validateInstruction(instr: AgentInstruction, where: string): string | null {
  if (instr?.kind === 'inline') {
    return typeof instr.text === 'string' ? null : `${where}：内联 prompt 缺少文本`
  }
  if (instr?.kind === 'file') {
    return isSafeRelativePath(instr.path)
      ? null
      : `${where}：skill 文件路径必须是包内相对路径（禁绝对路径与 ..）：${String(instr.path)}`
  }
  return `${where}：agent 驱动指令形态非法（应为 inline 或 file）`
}

function validateExecutor(executor: NodeExecutor, where: string): string | null {
  if (!executor || !EXECUTOR_KINDS.includes(executor.kind)) {
    return `${where}：执行者类型非法（应为 agent / engine / command / subworkflow 之一）`
  }
  switch (executor.kind) {
    case 'agent':
      return validateInstruction(executor.instruction, where)
    case 'engine':
      return nonEmpty(executor.operation) ? null : `${where}：engine 操作 spec 为空`
    case 'command': {
      if (!Array.isArray(executor.commands) || executor.commands.length === 0) {
        return `${where}：command 节点未声明命令`
      }
      for (const c of executor.commands) {
        if (!c || !nonEmpty(c.command)) return `${where}：command 命令行为空`
        if (c.check !== undefined && !nonEmpty(c.check)) return `${where}：command 前置检查命令为空`
        const t = badTimeout(c.timeoutSec)
        if (t) return `${where}：command ${t}`
      }
      return null
    }
    case 'subworkflow':
      return nonEmpty(executor.workflowId) ? null : `${where}：subworkflow 未指定目标工作流`
    default:
      return `${where}：执行者类型非法`
  }
}

/** 校验一个产出：file 目的地路径合规且 `.md`、模板 file 路径合规。 */
function validateOutput(out: WorkflowOutput, where: string): string | null {
  const dest = out?.destination
  if (!dest || dest.kind !== 'file') {
    return `${where}：产出目的地非法（v1 仅支持 file 形态）`
  }
  if (!isSafeRelativePath(dest.path)) {
    return `${where}：产出路径必须是相对分支目录路径（禁绝对路径与 ..）：${String(dest.path)}`
  }
  if (!/\.md$/i.test(dest.path.trim())) {
    return `${where}：v1 产出须为 markdown（路径以 .md 结尾）：${dest.path}`
  }
  const tpl = out.template
  if (tpl?.kind === 'ref' && (!nonEmpty(tpl.ref?.packId) || !nonEmpty(tpl.ref?.itemId))) {
    return `${where}：产出模板引用的规则库条目 id 不能为空`
  }
  return null
}

/** 校验检查项序列：auto 校验（命令行非空 / 引用条目 id 非空）且目标匹配本节点产出路径；manual 动作按钮名称/命令非空。 */
function validateGate(
  gate: WorkflowGateItem[],
  outputPaths: Set<string>,
  where: string
): string | null {
  for (let i = 0; i < gate.length; i++) {
    const g = gate[i]
    const at = `${where} 检查项 ${i + 1}`
    if (g?.kind === 'auto') {
      const check = g.check
      if (check?.kind === 'inline') {
        if (!nonEmpty(check.command)) return `${at}：自动校验缺校验命令`
      } else if (check?.kind === 'ref') {
        if (!nonEmpty(check.ref?.packId) || !nonEmpty(check.ref?.itemId)) {
          return `${at}：自动校验引用的规则库条目 id 不能为空`
        }
      } else {
        return `${at}：自动校验缺校验（应为命令行或引用条目）`
      }
      for (const t of g.targets ?? []) {
        if (!outputPaths.has(t)) return `${at}：校验目标未匹配本节点任何产出路径：${String(t)}`
      }
      const tt = badTimeout(g.timeoutSec)
      if (tt) return `${at}：${tt}`
    } else if (g?.kind === 'manual') {
      for (const a of g.actions ?? []) {
        if (!nonEmpty(a?.label) || !nonEmpty(a?.command)) {
          return `${at}：人工评审的动作按钮缺名称或命令`
        }
        const tt = badTimeout(a.timeoutSec)
        if (tt) return `${at}：动作「${a.label}」${tt}`
      }
    } else {
      return `${at}：检查项类型非法（应为 auto 或 manual）`
    }
  }
  return null
}

/**
 * 校验节点的目标仓选择（多仓扇出，见 repo-targeting）：缺省合法（= 卡涉及仓全集）；
 * `tag` 标签非空、`repo` memberId 非空；`fromUpstream` 须引用一个**在本节点之前**、
 * 为 **agent** 且**声明了结构化输出（repos）**的节点。
 */
function validateTarget(
  n: WorkflowNode,
  where: string,
  nodes: WorkflowNode[],
  index: number
): string | null {
  const t = n.target
  if (t === undefined) return null
  switch (t.kind) {
    case 'all':
      return null
    case 'tag':
      return nonEmpty(t.tag) ? null : `${where}：target=tag 的标签不能为空`
    case 'repo':
      return nonEmpty(t.memberId) ? null : `${where}：target=repo 的成员仓 id 不能为空`
    case 'fromUpstream': {
      if (!nonEmpty(t.nodeId)) return `${where}：target=fromUpstream 未指定上游节点`
      const refIdx = nodes.findIndex((m) => m.id === t.nodeId)
      if (refIdx < 0) return `${where}：target=fromUpstream 引用的上游节点不存在：${t.nodeId}`
      if (refIdx >= index) return `${where}：target=fromUpstream 引用的节点必须在本节点之前：${t.nodeId}`
      const ref = nodes[refIdx]
      if (ref.executor?.kind !== 'agent') {
        return `${where}：target=fromUpstream 引用的节点必须是 agent 节点：${t.nodeId}`
      }
      if (!ref.executor.structuredOutput?.repos) {
        return `${where}：target=fromUpstream 引用的 agent 节点必须声明结构化输出（涉及仓）：${t.nodeId}`
      }
      return null
    }
    default:
      return `${where}：target 类型非法`
  }
}

function validateNode(
  n: WorkflowNode,
  where: string,
  stageIds: Set<string>,
  nodes: WorkflowNode[],
  index: number
): string | null {
  if (!nonEmpty(n.stageId) || !stageIds.has(n.stageId)) {
    return `${where}：未归属到一个有效阶段`
  }
  const exec = validateExecutor(n.executor, where)
  if (exec) return exec
  const outputs = n.outputs ?? []
  for (const out of outputs) {
    const reason = validateOutput(out, where)
    if (reason) return reason
  }
  const gateReason = validateGate(
    n.gate ?? [],
    new Set(outputs.map((o) => o.destination?.path).filter((p): p is string => typeof p === 'string')),
    where
  )
  if (gateReason) return gateReason
  for (const scope of n.writableScope ?? []) {
    if (!isSafeRelativePath(scope)) {
      return `${where}：可写范围必须是相对分支目录路径（禁绝对路径与 ..）：${String(scope)}`
    }
  }
  const targetReason = validateTarget(n, where, nodes, index)
  if (targetReason) return targetReason
  return null
}

/**
 * 校验工作流定义结构：id / 显示名非空、每个节点恰一个合法执行者、产出与可写范围及 agent file 路径合规。
 * 不校验 id 在库内唯一（由库服务在保存/导入时另行判定）。
 */
export function validateWorkflow(def: WorkflowDefinition): WorkflowValidation {
  if (!def || typeof def !== 'object') return { ok: false, reason: '工作流定义为空或非对象' }
  if (!nonEmpty(def.id)) return { ok: false, reason: '工作流 id 不能为空' }
  if (!hasAnyLanguage(def.name)) return { ok: false, reason: '工作流显示名不能为空（至少一种语言）' }
  if (!Array.isArray(def.stages) || def.stages.length === 0) {
    return { ok: false, reason: '工作流至少需要一个阶段' }
  }
  if (!Array.isArray(def.nodes)) return { ok: false, reason: '工作流缺少节点列表' }
  const stageIds = new Set(def.stages.map((s) => s.id))
  for (let i = 0; i < def.nodes.length; i++) {
    const n = def.nodes[i]
    const reason = validateNode(n, `节点「${resolveLocalized(n.name, DEFAULT_LANGUAGE) || n.id}」`, stageIds, def.nodes, i)
    if (reason) return { ok: false, reason }
  }
  // 可选的「新建需求」分解指令：声明时复用 agent 驱动指令的 inline/file 校验。
  if (def.newRequirementInstruction !== undefined) {
    const reason = validateInstruction(def.newRequirementInstruction, '新建需求指令')
    if (reason) return { ok: false, reason }
  }
  // 可选的「建议 leaf 类型」：声明时每项须为合法类型定义且 archetype 为 leaf（容器不经工作流播种）。
  if (def.suggestedTypes !== undefined) {
    const v = validateSuggestedTypes(def.suggestedTypes)
    if (!v.ok) return v
  }
  return { ok: true }
}

/**
 * 分支配对语义校验：若有 `create-branch` 节点，则必须至少有一个 `delete-branch-worktree` 节点，
 * 否则分支/worktree 会被泄漏，判为无效。只约束「建了必须删」单一方向，不做顺序/计数/反向校验。
 * 这是与结构校验（validateWorkflow）分离的「可载入但不可用」软标记——无效工作流仍被列出，只是被标记并拦截。
 */
export function checkBranchPairing(def: WorkflowDefinition): WorkflowValidation {
  const isEngineOp = (n: WorkflowNode, op: string): boolean =>
    n.executor?.kind === 'engine' && n.executor.operation === op
  const nodes = def?.nodes ?? []
  const hasCreate = nodes.some((n) => isEngineOp(n, 'create-branch'))
  // 删本地分支可以是 delete-branch，或旧复合别名 delete-branch-worktree。
  const hasDelete = nodes.some(
    (n) => isEngineOp(n, 'delete-branch') || isEngineOp(n, LEGACY_DELETE_BRANCH_WORKTREE)
  )
  if (hasCreate && !hasDelete) {
    return {
      ok: false,
      reason: '工作流建了分支（create-branch）却没有对应的删分支节点（delete-branch），分支/worktree 会被泄漏'
    }
  }
  return { ok: true }
}

/** 提取轻量摘要（列表/选择器用）；未通过分支配对校验时带出无效原因，供 UI 标「（无效）」并禁用选择。 */
export function workflowSummary(def: WorkflowDefinition): WorkflowSummary {
  const v = checkBranchPairing(def)
  return v.ok ? { id: def.id, name: def.name } : { id: def.id, name: def.name, invalidReason: v.reason }
}

/** 引擎节点速记。 */
function engineNode(
  id: string,
  name: Localized,
  stageId: string,
  operation: string,
  gate?: WorkflowNode['gate']
): WorkflowNode {
  return { id, name, stageId, executor: { kind: 'engine', operation }, outputs: [], ...(gate ? { gate } : {}) }
}

/** 两个默认工作流共用的前半段（准备 + 实现占位）。节点名双语；inline 提示词只喂 AI，保持单语言。 */
function defaultPrelude(): WorkflowNode[] {
  return [
    engineNode('create-branch', L('建分支', 'Create branch'), 'prepare', 'create-branch'),
    engineNode('open-worktree', L('开 worktree', 'Open worktree'), 'prepare', 'open-worktree'),
    engineNode('link-env', L('关联环境', 'Link env'), 'prepare', 'link-env'),
    {
      id: 'implement',
      name: L('实现需求（占位，将来由 agent 干活）', 'Implement (placeholder; agent will do this later)'),
      stageId: 'build',
      executor: { kind: 'agent', instruction: { kind: 'inline', text: '按需求卡活现状实现，遵守宪法与测试先行。' } },
      outputs: []
    }
  ]
}

const DEFAULT_STAGES: WorkflowStage[] = [
  { id: 'prepare', name: L('准备', 'Prepare') },
  { id: 'build', name: L('实现', 'Build') },
  { id: 'deliver', name: L('交付', 'Deliver') }
]

/**
 * 内置默认工作流（本地直合）：建分支→开 worktree→关联环境→〔实现占位〕→合并→push main→删 worktree→删本地分支。
 * 全程本地、可无人值守跑完，作引擎的第一个集成 smoke。id 由调用方注入；亦用作「新建工作流」的默认模板。
 */
export function createDefaultWorkflow(id: string): WorkflowDefinition {
  return {
    id,
    name: L('默认工作流（本地直合）', 'Default workflow (local merge)'),
    description: L(
      '需求→交付的本地脊柱：开分支/worktree→实现→合并回主干→推送主干→清理。全程本地、可无人值守跑完。',
      'Local spine from requirement to delivery: branch/worktree → implement → merge to main → push → cleanup. Fully local, unattended.'
    ),
    suggestedTypes: DEFAULT_CARD_TYPES.map((t) => ({ ...t })),
    stages: DEFAULT_STAGES.map((s) => ({ ...s })),
    nodes: [
      ...defaultPrelude(),
      engineNode('merge-branch', L('合并分支', 'Merge branch'), 'deliver', 'merge-branch'),
      engineNode('push-main', L('推送主干', 'Push main'), 'deliver', 'push-branch'),
      engineNode('remove-worktree', L('删 worktree', 'Remove worktree'), 'deliver', 'remove-worktree'),
      engineNode('delete-branch', L('删本地分支', 'Delete local branch'), 'deliver', 'delete-branch')
    ]
  }
}

/**
 * 内置默认工作流（PR 模式）：前半段同上，交付段为 push 需求分支→〔人工评审门〕→合并→push main→删云端分支→删 worktree→删本地分支。
 * 纯引擎 + 门骨架（不依赖 gh），可在本地裸仓上 hermetic 跑通；真正的 gh PR 留作后续 command 升级。
 */
export function createDefaultWorkflowPr(id: string): WorkflowDefinition {
  return {
    id,
    name: L('默认工作流（PR 模式）', 'Default workflow (PR mode)'),
    description: L(
      '需求→交付的 PR 脊柱：push 需求分支→人工评审→合并→推送主干→删云端分支→清理。供需评审/CI 的项目。',
      'PR spine from requirement to delivery: push feature branch → manual review → merge → push main → delete remote branch → cleanup. For projects needing review/CI.'
    ),
    suggestedTypes: DEFAULT_CARD_TYPES.map((t) => ({ ...t })),
    stages: DEFAULT_STAGES.map((s) => ({ ...s })),
    nodes: [
      ...defaultPrelude(),
      engineNode('push-feature', L('push 需求分支', 'Push feature branch'), 'deliver', 'push-branch', [
        { kind: 'manual', actions: [{ label: '查看分支提交', command: 'git log --oneline -10' }] }
      ]),
      engineNode('merge-branch', L('合并分支', 'Merge branch'), 'deliver', 'merge-branch'),
      engineNode('push-main', L('推送主干', 'Push main'), 'deliver', 'push-branch'),
      engineNode('delete-remote-branch', L('删云端分支', 'Delete remote branch'), 'deliver', 'delete-remote-branch'),
      engineNode('remove-worktree', L('删 worktree', 'Remove worktree'), 'deliver', 'remove-worktree'),
      engineNode('delete-branch', L('删本地分支', 'Delete local branch'), 'deliver', 'delete-branch')
    ]
  }
}

/**
 * 内置「验收样例」工作流:专为验证「同节点多命令输出各自分开、各自可中止」而设,含三个节点——
 * ①一个节点两条前台命令(各流几行后退出) ②一个节点两条长驻命令(手动转后台) ③一个人工评审节点带两个动作按钮。
 * 命令用 `node -e` 跨平台最小脚本,不依赖用户装什么(node 随本 app 环境即有)。
 */
export function createAcceptanceSampleWorkflow(id: string): WorkflowDefinition {
  // 短命令:每 400ms 打一行、5 行后退出 0(便于观察并发前台输出后节点自然完成)。
  const shortPrint = (tag: string): string =>
    `node -e "let i=0;const t=setInterval(()=>{console.log('${tag} '+(++i));if(i>=5){clearInterval(t);process.exit(0)}},400)"`
  // 长驻命令:每秒打一行、永不退出(供转后台 / 门动作按钮演示可中止)。
  const longServe = (tag: string): string =>
    `node -e "setInterval(()=>console.log('${tag} '+new Date().toISOString()),1000)"`
  return {
    id,
    name: L('验收样例（多命令输出分流）', 'Acceptance sample (multi-command outputs)'),
    description: L(
      '验证同一节点多条命令输出各自分开、各自可中止:①两条前台命令 ②两条转后台命令 ③两个门动作按钮。命令为 node 最小脚本、可无依赖跑。',
      'Verifies that a node’s multiple command outputs stay separated and independently abortable: (1) two foreground commands, (2) two detach-to-background commands, (3) two gate action buttons. Commands are minimal node scripts, dependency-free.'
    ),
    suggestedTypes: DEFAULT_CARD_TYPES.map((t) => ({ ...t })),
    stages: [{ id: 'verify', name: L('验收', 'Verify') }],
    nodes: [
      {
        id: 'two-foreground',
        name: L('两条前台命令', 'Two foreground commands'),
        stageId: 'verify',
        executor: {
          kind: 'command',
          commands: [
            { label: '前台 A', command: shortPrint('前台A') },
            { label: '前台 B', command: shortPrint('前台B') }
          ]
        },
        outputs: []
      },
      {
        id: 'two-background',
        name: L('两条后台命令（手动转后台）', 'Two background commands (detach)'),
        stageId: 'verify',
        executor: {
          kind: 'command',
          commands: [
            { label: '服务 A', command: longServe('服务A') },
            { label: '服务 B', command: longServe('服务B') }
          ]
        },
        outputs: []
      },
      {
        id: 'two-gate-actions',
        name: L('两个门动作按钮', 'Two gate action buttons'),
        stageId: 'verify',
        executor: { kind: 'command', commands: [{ command: `node -e "console.log('准备验收')"` }] },
        outputs: [],
        gate: [
          {
            kind: 'manual',
            actions: [
              { label: '启动服务 A', command: longServe('门-服务A') },
              { label: '启动服务 B', command: longServe('门-服务B') }
            ]
          }
        ]
      }
    ]
  }
}

/**
 * 内置「验收样例（评审门驳回 → 内容驱动回退）」工作流:专为验收人工评审门驳回后的**重入式内容驱动回退**——
 * plan 写方案(产出 PLAN.md)、implement 写代码 → 人工评审门驳回并写下不满意的点 → 只读判定 agent 溯源提名回退
 * 节点 → 确认 → **重入该节点在现有进展上前向修复**(不重置、不作废下游) → 前向重流回评审门复审。
 * 需已配置默认 agent CLI(plan/implement/判定都要真 agent)。全程本地直合、可无远端跑完。
 */
export function createRollbackSampleWorkflow(id: string): WorkflowDefinition {
  return {
    id,
    name: L('验收样例（评审门驳回 → 内容驱动回退）', 'Acceptance sample (gate reject → content-driven rollback)'),
    description: L(
      '验收人工评审门驳回后的内容驱动回退：plan 写方案(PLAN.md)、implement 写代码 → 评审门驳回并写明不满意的点 → 只读判定 agent 溯源提名回退节点 → 确认 → 重入该节点在现有进展上前向修复 → 回评审门复审。需已配置默认 agent CLI。',
      'Verifies content-driven rollback after a manual-review rejection: plan writes PLAN.md, implement writes code → reject at the review gate with a note → the read-only judge agent traces provenance and nominates a rollback node → confirm → re-enter that node to fix forward on top of existing progress → back to the review gate. Requires a configured default agent CLI.'
    ),
    suggestedTypes: DEFAULT_CARD_TYPES.map((t) => ({ ...t })),
    stages: [
      { id: 'prepare', name: L('准备', 'Prepare') },
      { id: 'build', name: L('实现', 'Build') },
      { id: 'review', name: L('评审', 'Review') },
      { id: 'deliver', name: L('交付', 'Deliver') }
    ],
    nodes: [
      engineNode('create-branch', L('建分支', 'Create branch'), 'prepare', 'create-branch'),
      engineNode('open-worktree', L('开 worktree', 'Open worktree'), 'prepare', 'open-worktree'),
      engineNode('link-env', L('关联环境', 'Link env'), 'prepare', 'link-env'),
      {
        id: 'plan',
        name: L('写方案', 'Plan'),
        stageId: 'build',
        executor: {
          kind: 'agent',
          instruction: { kind: 'inline', text: '为本需求卡写一份简短实现方案，产出到 PLAN.md：包含目标、实现步骤、验收点。方案要具体到能据此写代码。' }
        },
        outputs: [{ destination: { kind: 'file', path: 'PLAN.md' }, template: { kind: 'none' }, required: true }]
      },
      {
        id: 'implement',
        name: L('实现', 'Implement'),
        stageId: 'build',
        executor: {
          kind: 'agent',
          instruction: { kind: 'inline', text: '按 PLAN.md 实现这个需求，写出代码。改动保持小而可运行；遵守宪法与测试先行。' }
        },
        outputs: []
      },
      {
        id: 'review',
        name: L('人工评审', 'Manual review'),
        stageId: 'review',
        executor: {
          kind: 'command',
          commands: [{ command: `node -e "console.log('待评审：查看本卡改动；满意就选「通过」提交，不满意在下方写明再提交，会判定回退到哪个节点修复')"` }]
        },
        // 评审实现节点本身不产声明式产出——评审材料是代码改动，不挂上一阶段的 PLAN.md。
        outputs: [],
        // 动作按钮＝命令验收：真跑起来看它是否满足需求（跑测试 / 试运行中英文问候），而非只看 diff。
        // 真实项目里这类按钮通常是「启动 app」跑 npm run dev / npm start；本 dogfood 仓是裸 node 模块，故用 node 命令。
        gate: [
          {
            kind: 'manual',
            actions: [
              { label: '运行测试验收', command: 'node --test' },
              {
                label: '试运行（中/英问候）',
                command: `node -e "const g=require('./greet.js');console.log('zh:',g('zh'));console.log('en:',g('en'))"`
              }
            ]
          }
        ]
      },
      engineNode('merge-branch', L('合并分支', 'Merge branch'), 'deliver', 'merge-branch'),
      engineNode('remove-worktree', L('删 worktree', 'Remove worktree'), 'deliver', 'remove-worktree'),
      engineNode('delete-branch', L('删本地分支', 'Delete local branch'), 'deliver', 'delete-branch')
    ]
  }
}

// ── 旧包形状迁移 ─────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 归一一个可翻字段：旧的裸字符串 → `{zh: 值}`；已是语言表则保留；其余 → 空表。读旧包（单语言名）不崩。 */
function migrateLocalizedField(v: unknown): Localized {
  if (typeof v === 'string') return v.trim() === '' ? {} : { [DEFAULT_LANGUAGE]: v }
  if (isRec(v)) {
    const out: Localized = {}
    for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val
    return out
  }
  return {}
}

/** 模板归一：只认 `ref`（保留全限定引用），旧 `inline`/`file` 嵌入形态已废 → `none`（内容迁库需人工，旧 dogfood 数据基本为空）。 */
function migrateTemplate(t: unknown): WorkflowOutput['template'] {
  if (isRec(t) && t.kind === 'ref' && isRec(t.ref)) {
    return { kind: 'ref', ref: { packId: String(t.ref.packId ?? ''), itemId: String(t.ref.itemId ?? '') } }
  }
  return { kind: 'none' }
}

/** 旧产出 `{type, format, path?, required}` → 新 `{destination, template, required}`；无路径（卡片数据）丢弃。 */
function migrateOutput(o: unknown): WorkflowOutput | null {
  if (!isRec(o)) return null
  // 已是新形状：归一 template、规范 required。
  if (isRec(o.destination)) {
    return {
      destination: o.destination as WorkflowOutput['destination'],
      template: migrateTemplate(o.template),
      required: !!o.required
    }
  }
  // 旧形状：有路径→file 目的地（丢弃旧 type/format）；无路径→卡片数据，card 未落地，丢弃。
  if (typeof o.path === 'string' && o.path.trim() !== '') {
    return { destination: { kind: 'file', path: o.path }, template: { kind: 'none' }, required: !!o.required }
  }
  return null
}

/**
 * 旧检查项 → 新判别联合（丢弃旧 `description`）。auto：新形状带 `check` 直接保留；旧形状 `command:string` → `check:{kind:'inline',command}`，
 * 空命令的 auto（旧占位，无可执行内容）丢弃。
 */
function migrateGateItem(g: unknown): WorkflowGateItem | null {
  if (!isRec(g)) return null
  if (g.kind === 'auto') {
    const targets = Array.isArray(g.targets)
      ? g.targets.filter((t): t is string => typeof t === 'string')
      : undefined
    // 新形状：已带 check。
    if (isRec(g.check)) {
      const item: WorkflowGateItem = { kind: 'auto', check: g.check as GateCheck }
      if (targets) item.targets = targets
      if (typeof g.timeoutSec === 'number') item.timeoutSec = g.timeoutSec
      return item
    }
    // 旧形状：command 裸字符串 → inline 校验；空命令丢弃。
    const command = typeof g.command === 'string' ? g.command : ''
    if (command.trim() === '') return null
    const item: WorkflowGateItem = { kind: 'auto', check: { kind: 'inline', command } }
    if (targets) item.targets = targets
    return item
  }
  if (g.kind === 'manual') {
    const item: WorkflowGateItem = { kind: 'manual' }
    if (Array.isArray(g.actions)) {
      item.actions = g.actions.filter(isRec).map((a) => ({
        label: String(a.label ?? ''),
        command: String(a.command ?? ''),
        ...(typeof a.timeoutSec === 'number' ? { timeoutSec: a.timeoutSec } : {})
      }))
    }
    return item
  }
  return null
}

/** 旧单命令 command 执行者（直接带 `command`/`check`/`timeoutSec`）→ 新 `commands: CommandSpec[]`；新形状幂等。 */
function migrateExecutor(ex: unknown): unknown {
  if (!isRec(ex) || ex.kind !== 'command') return ex
  // 新形状：已带 commands 数组，原样保留（归一每条为 CommandSpec 形状）。
  if (Array.isArray(ex.commands)) {
    const commands = ex.commands.filter(isRec).map((c) => {
      const spec: Rec = { command: String(c.command ?? '') }
      if (typeof c.label === 'string') spec.label = c.label
      if (typeof c.check === 'string') spec.check = c.check
      if (typeof c.timeoutSec === 'number') spec.timeoutSec = c.timeoutSec
      return spec
    })
    return { kind: 'command', commands }
  }
  // 旧形状：单 command 字段 → 单元素 commands。
  const spec: Rec = { command: typeof ex.command === 'string' ? ex.command : '' }
  if (typeof ex.check === 'string') spec.check = ex.check
  if (typeof ex.timeoutSec === 'number') spec.timeoutSec = ex.timeoutSec
  return { kind: 'command', commands: [spec] }
}

function migrateNode(n: unknown): unknown {
  if (!isRec(n)) return n
  const next: Rec = { ...n, name: migrateLocalizedField(n.name) }
  if (isRec(n.executor) && n.executor.kind === 'command') {
    next.executor = migrateExecutor(n.executor)
  }
  if (Array.isArray(n.outputs)) {
    next.outputs = n.outputs.map(migrateOutput).filter((o): o is WorkflowOutput => o !== null)
  }
  if (Array.isArray(n.gate)) {
    next.gate = n.gate.map(migrateGateItem).filter((g): g is WorkflowGateItem => g !== null)
  }
  return next
}

/**
 * 把解析自 `workflow.yaml` 的原始对象归一为当前数据模型（在反序列化处调用，读旧包不崩）：
 * 产出/检查项旧形状迁移到新形状，无 `exec` 的 agent 保持原样（exec 可选）。对新形状幂等。
 */
export function migrateWorkflowShape(raw: unknown): WorkflowDefinition {
  if (!isRec(raw) || !Array.isArray(raw.nodes)) return raw as WorkflowDefinition
  const stages = Array.isArray(raw.stages)
    ? raw.stages.map((s) => (isRec(s) ? { ...s, name: migrateLocalizedField(s.name) } : s))
    : raw.stages
  const next: Rec = { ...(raw as Rec), name: migrateLocalizedField(raw.name), nodes: raw.nodes.map(migrateNode) }
  if (stages !== undefined) next.stages = stages
  if (raw.description !== undefined) next.description = migrateLocalizedField(raw.description)
  return next as unknown as WorkflowDefinition
}
