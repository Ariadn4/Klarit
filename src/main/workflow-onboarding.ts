/**
 * 导入后「自动为项目落定一份工作流」的**判据核**（workflow-onboarding）：非 reused 导入 + 文档分析 agent
 * 腾出后跑一次。判据门——有 agent 习惯痕迹 且 有能跑的默认 agent → 后台无头 author 产出提案主动推送；
 * 否则派内置默认（本地直合）兜底。**先派默认作占位**，author 提案作「升级」浮层，弃用/失败即停在默认——
 * 任何时刻项目不停在「无工作流」态。所有副作用经注入 deps（fs/registry/Electron 都在外），此核纯可单测。
 */

import { ensureApprovalBeforeFinalization, lintWorkflow, workflowUsesArchiveDocs } from '../shared/workflow'
import type { Localized } from '../shared/localized'
import type { Project, WorkflowDefinition, WorkflowGenPhase, WorkflowProposal } from '../shared/types'
import type { AuthorWorkflowResult } from './orchestrate-service'

/** 概览里取语言表第一个非空文本（供开发者读，无需按当前语言解析）。 */
function pickName(name: Localized | undefined): string | undefined {
  if (!name) return undefined
  for (const k of Object.keys(name)) {
    const v = name[k]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return undefined
}

/** 单个节点的调试概览：执行者种类 + engine operation（仅 engine）+ 各门种（按序）。 */
export interface WorkflowNodeOverview {
  id: string
  name?: string
  executorKind: string
  /** engine 执行者的 operation（仅 `kind==='engine'` 时给）。 */
  engineOperation?: string
  /** 该节点各门把种类（`auto`/`manual`/`external`），按序。 */
  gateKinds: string[]
}

/** 工作流定义的紧凑概览：id/name + 节点数 + 逐节点执行者/门概览。 */
export interface WorkflowDefinitionOverview {
  id: string
  name?: string
  nodeCount: number
  nodes: WorkflowNodeOverview[]
}

/** author 结果的调试记录分类：提案推送 / 不可存库 / author 返回 null / author 抛错。 */
export type WorkflowOnboardingLogOutcome = 'proposed' | 'unusable' | 'empty' | 'error'

/**
 * 自动 author 产出的调试记录（成功/失败都记，供开发者事后复现，不打扰用户）。至少含目标项目、
 * 产出的定义概览、校验 issues，失败时含原因（见 spec「自动生成的提案留可供调试的日志」）。
 */
export interface WorkflowOnboardingLogRecord {
  /** 目标项目（id + 显示名）。 */
  project: { id: string; name: string }
  outcome: WorkflowOnboardingLogOutcome
  /** 产出的工作流定义概览（author 有产出时给；null/抛错时省）。 */
  overview?: WorkflowDefinitionOverview
  /** 校验问题（author 有产出时给）。 */
  issues?: string[]
  /** 失败/不可用原因（unusable/empty/error 时给）。 */
  failureReason?: string
  /** 投递前跑的固化门 lint 喂回修订轮数（仅 proposed 时给：0=首版即过，>0=修订过 N 轮）。 */
  revisionPasses?: number
  /** 最终投递版的残留 lint 告警（仅 proposed 时给；空=已改到不再告警，非空=达上界仍带警告投递）。 */
  lintWarnings?: string[]
}

/**
 * 需求驱动文档扫描的**触发判据**（方案 A：激活即扫，纯函数便于单测）：一个含 `archive-docs` 引擎节点的
 * 工作流成为项目活动工作流、且该项目**尚无登记表**时，才需要扫描去 populate。不含 archive-docs（如兜底本地
 * 直合、opsx:archive agent 节点）或已有登记表 → 免扫。null/undefined def 安全回落 false。
 */
export function needsDocScanOnActivate(
  def: WorkflowDefinition | null | undefined,
  hasRegistry: boolean
): boolean {
  return !!def && workflowUsesArchiveDocs(def) && !hasRegistry
}

/** 从项目取调试记录用的项目引用（id + 显示名）。 */
function projectRef(project: Project): { id: string; name: string } {
  return { id: project.id, name: project.displayName }
}

/** 把工作流定义压成紧凑调试概览：逐节点取执行者种类、engine operation 与门种。 */
function buildOverview(def: WorkflowDefinition): WorkflowDefinitionOverview {
  return {
    id: def.id,
    name: pickName(def.name),
    nodeCount: def.nodes.length,
    nodes: def.nodes.map((node) => {
      const overview: WorkflowNodeOverview = {
        id: node.id,
        name: pickName(node.name),
        executorKind: node.executor.kind,
        gateKinds: (node.gate ?? []).map((g) => g.kind)
      }
      if (node.executor.kind === 'engine') overview.engineOperation = node.executor.operation
      return overview
    })
  }
}

/**
 * 判据核依赖（注入以便单测，不绑 fs/registry/Electron）。
 * - `hasActiveWorkflow`：该项目是否已有活动工作流（含 reused 重开的已知项目）——为真则整条判据跳过，
 *   保证同一项目至多跑一次、不覆盖用户已有 `activeWorkflowId`。
 * - `hasHabits`：各成员仓根是否带 agent 习惯痕迹（wraps `hasAgentHabits`）。
 * - `hasRunnableAgent`：本机是否有能跑的默认 agent（设了默认 agent 且它在 detectedAgents 里）。
 * - `assignDefault`：立即派内置默认工作流（本地直合）为活动工作流（占位 / 兜底）。
 * - `authorWorkflow`：无头 author，以系统合成意图产出**富结果**（区分抛错/空产出/校验不过，见设计决策 #11）。
 * - `deliverProposal`：把可用提案投递到该项目的全局对话（作 agent 消息追加 + 推送渲染层打开并选中该会话）。
 * - `reportStatus`：可选后台生成进度（底栏用）——命中 author 支时起跑报 `generating`、结束报 `done`/`failed`。
 * - `log`：可选软日志（失败至多轻提示，绝不打断用户、绝不抛）。
 * - `logProposal`：可选结构化调试记录——命中 author 支产出提案（成功/失败）时记一条含目标项目、
 *   定义概览、issues、失败原因，落在开发者可读处（日志文件/结构化 log），不打扰用户、绝不抛。
 */
export interface WorkflowOnboardingDeps {
  hasActiveWorkflow: (project: Project) => boolean
  hasHabits: (project: Project) => boolean
  hasRunnableAgent: () => boolean
  assignDefault: (project: Project) => void
  authorWorkflow: (projectId: string, intent: string) => Promise<AuthorWorkflowResult>
  deliverProposal: (project: Project, proposal: WorkflowProposal) => void
  reportStatus?: (project: Project, phase: WorkflowGenPhase) => void
  log?: (message: string) => void
  logProposal?: (record: WorkflowOnboardingLogRecord) => void
}

/**
 * 系统合成意图（第一步直白版，措辞打磨归第二步 `workflow-from-habits`）：让 author agent 自己去探项目习惯。
 * 不经用户打字、不追加会话——供后台无头调用。项目各成员仓真实路径已作可访问目录（`--add-dir`）挂给 agent
 * （设计决策 #10），故意图告知「可直接查看本项目文件」并加只读约束（只探查、只输出工作流、不改动任何文件）。
 */
export const WORKFLOW_ONBOARDING_INTENT =
  '这是一个已有项目,它的文件已作为可访问目录挂给你。请直接查看这些文件——看它平时怎么使用 AI 编程 agent(如 .claude/、CLAUDE.md、.cursor、AGENTS.md 等)以及它的 git/交付习惯(如 git log),据此为它写一份贴合的 Klarit 工作流。约束:只做只读探查——只查看、不要修改、新建或删除任何文件;你唯一的产出是这份工作流定义本身。'

/**
 * 固化门 lint 喂回 author 的**修订-复检**循环上界（设计决策 #15）：author 产出可用提案后投递前跑
 * `lintWorkflow`，命中告警就把「告警 + 上版定义」喂回令其补审批门再产出，至多修订 N 轮；仍告警则带警告
 * 投递（UI 软 lint 仍提示），不无限循环、不阻断。
 */
export const WORKFLOW_ONBOARDING_REVISION_MAX = 2

/**
 * 合成一段**修订意图**喂回 author（决策 #15，纯函数便于单测）：把上一版工作流定义（整体 JSON）与命中的
 * lint 告警文字嵌进去，指令 author 在触发告警的不可逆固化步骤之前（或就挂在该固化节点上）补一道人工审批
 * （`manual`）门以消除告警，并输出**完整**的修正版工作流。不依赖草稿基准线程——整体替换。
 */
export function buildWorkflowRevisionIntent(prevDef: WorkflowDefinition, warnings: string[]): string {
  const warningLines = warnings.map((w) => `- ${w}`).join('\n')
  return [
    '你上一版工作流未过固化门软校验(lint),请据以下告警修订后重新产出。',
    `软校验告警:\n${warningLines}`,
    '产品硬原则:不可逆固化(合入主线 merge-branch / 推送 push-branch / 对外开 PR open-pr)之前必须有一道人工审批(manual)门,与项目是否"自主/无人值守"无关。请在触发告警的固化步骤之前(或就挂在该固化节点自身上)补上人工审批门,消除上述告警。',
    '上一版工作流定义(JSON),请在此基础上整体修正后输出**完整**的修正版:',
    JSON.stringify(prevDef),
    '约束:只输出修正后的完整工作流定义本身,不要改动、新建或删除任何文件。'
  ].join('\n\n')
}

/**
 * 单次 author 尝试的归一结果：成功（带可存库提案），或失败（带日志分类 + 可读原因 + 可选概览/issues）。
 * 把 dep 抛错、rich 结果的三类失败（threw/empty/invalid）统一收敛，供重试判定与末次记日志复用。
 */
type AuthorAttempt =
  | { ok: true; proposal: WorkflowProposal }
  | {
      ok: false
      outcome: WorkflowOnboardingLogOutcome
      failureReason: string
      overview?: WorkflowDefinitionOverview
      issues?: string[]
    }

/**
 * 跑一次工作流 onboarding 判据。至多一次（`hasActiveWorkflow` 为真即跳过）；先派默认占位关上 guard，
 * 命中支再后台 author 升级为提案。命中支首次失败 → **有界自动重试一次**（设计决策 #11），仍失败才回落——
 * author 抛错 / 空产出 / 提案 `issues` 非空 → 停在占位默认、不推送、不抛，最终失败经 `reportStatus('failed')`
 * 触发底栏轻提示，并按失败种类记调试日志（不再一律「返回 null」）。
 */
export async function runWorkflowOnboarding(
  project: Project,
  deps: WorkflowOnboardingDeps
): Promise<void> {
  // Guard：已有活动工作流（含 reused 重开的已知项目）→ 整条跳过，不覆盖、保证至多一次。
  if (deps.hasActiveWorkflow(project)) return

  // 立即派内置默认作**占位**：任何时刻项目不停在无工作流；并关上 guard（下次 hasActiveWorkflow 为真）。
  deps.assignDefault(project)

  // 门控：无痕迹 / 没能跑的默认 agent → 停在占位默认（生成了也跑不动）。
  if (!deps.hasHabits(project) || !deps.hasRunnableAgent()) return

  // 单次 author 尝试：把 dep 抛错与 rich 三类失败都归一成「成功 / 失败(分类+原因)」。意图外注入以复用于修订轮。
  const attempt = async (intent: string): Promise<AuthorAttempt> => {
    let result: AuthorWorkflowResult
    try {
      result = await deps.authorWorkflow(project.id, intent)
    } catch (err) {
      return { ok: false, outcome: 'error', failureReason: `author 抛错：${String(err)}` }
    }
    const { proposal, failure, reply } = result
    // 可用提案（存在且 issues 空 = 可存库）→ 成功。
    if (proposal && proposal.issues.length === 0) return { ok: true, proposal }
    // 校验不过：提案在但 issues 非空（failure==='invalid'），仍带概览/issues 供记日志。
    if (proposal) {
      return {
        ok: false,
        outcome: 'unusable',
        failureReason: '提案 issues 非空，不可存库',
        overview: buildOverview(proposal.workflow),
        issues: proposal.issues
      }
    }
    // 无产出：区分 agent 调用抛错（threw，带 reply）与跑通无产出（empty）。
    if (failure === 'threw') {
      return { ok: false, outcome: 'error', failureReason: `author agent 调用失败${reply ? `：${reply}` : ''}` }
    }
    return { ok: false, outcome: 'empty', failureReason: reply ? `author 无产出：${reply}` : 'author 返回 null（无产出）' }
  }

  // 命中支：起跑报 generating（底栏进度）。有界自动重试——首次失败重试一次，仍失败才回落（至多一次、不循环）。
  deps.reportStatus?.(project, 'generating')
  let res = await attempt(WORKFLOW_ONBOARDING_INTENT)
  if (!res.ok) res = await attempt(WORKFLOW_ONBOARDING_INTENT)

  if (res.ok) {
    // 投递前**确定性**补「不可逆固化前人工审批门」（设计决策 #16：不赌 LLM）：实测 author 反复把「验收」做成
    // agent/command 节点而非 manual 门、喂回修订多轮仍不改；lint 已精确知道缺口，补它是机械动作。故对 author 产出
    // 先跑 `ensureApprovalBeforeFinalization`（幂等、对合规产出 no-op），使投递工作流**必然**带审批门、该 lint 永不再报。
    // 仅自动路强加；聊天写工作流路由用户显式控门，不在本函数。
    const withApproval = (p: WorkflowProposal): WorkflowProposal => ({
      ...p,
      workflow: ensureApprovalBeforeFinalization(p.workflow)
    })
    // 确定性补后再跑 lint；本规则已清 → 循环不触发。喂回修订循环保留作**其它** lint 规则的兜底（决策 #16/#15）：
    // 命中告警则把「告警 + 上版定义」喂回 author 有界修订，改到不再告警即投修正版，达上界仍告警则带警告投最后一版
    // （UI 软 lint 仍提示、不阻断）。修订未产出可用提案即止，投上一版可用提案（补审批门后再复检）。
    let proposal = withApproval(res.proposal)
    let warnings = lintWorkflow(proposal.workflow)
    let revisionPasses = 0
    while (warnings.length > 0 && revisionPasses < WORKFLOW_ONBOARDING_REVISION_MAX) {
      revisionPasses++
      const revised = await attempt(buildWorkflowRevisionIntent(proposal.workflow, warnings))
      if (!revised.ok) break
      proposal = withApproval(revised.proposal)
      warnings = lintWorkflow(proposal.workflow)
    }

    // 可用提案 → 投递进全局对话（作 agent 消息追加 + 推送渲染层打开并选中该会话），记 proposed，报 done（清底栏指示）。
    deps.deliverProposal(project, proposal)
    deps.logProposal?.({
      project: projectRef(project),
      outcome: 'proposed',
      overview: buildOverview(proposal.workflow),
      issues: proposal.issues,
      revisionPasses,
      lintWarnings: warnings
    })
    deps.reportStatus?.(project, 'done')
    return
  }

  // 重试后仍失败：停在占位默认、不推送、不抛。按种类记调试日志 + 报 failed（触发底栏轻提示「已用默认」）。
  deps.log?.(`workflow-onboarding: ${res.failureReason}，停在默认工作流`)
  deps.logProposal?.({
    project: projectRef(project),
    outcome: res.outcome,
    overview: res.overview,
    issues: res.issues,
    failureReason: res.failureReason
  })
  deps.reportStatus?.(project, 'failed')
}
