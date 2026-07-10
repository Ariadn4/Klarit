import type { WorkflowDefinition, RunBreakpoint, CardArchetype, CardStatus, RunState } from '@shared/types'
import { resolveLocalized } from '@shared/localized'
import { DEFAULT_LANGUAGE } from '@shared/language'

/**
 * 活跃运行态 → 卡生命周期状态（供详情头部**实时**显示，避免读到未推送而陈旧的 `card.status`）。
 * `aborted` 无映射（回落 `card.status`）。
 */
export function runStateToCardStatus(state: RunState): CardStatus | null {
  switch (state) {
    case 'running':
      return '进行中'
    case 'waiting-decision':
      return '等待决策'
    case 'paused':
      return '已暂停'
    case 'done':
      return '已完成'
    default:
      return null
  }
}

/** 「待办」书挡列的固定 key——sentinel，不来自工作流，避免与任何阶段 id 冲突。 */
export const TODO_COLUMN_KEY = '__todo__'
/** 「已完成」书挡列的固定 key——sentinel，恒在列序末位。 */
export const DONE_COLUMN_KEY = '__done__'

/** 看板的一列：书挡（todo/done）或工作流阶段（stage）。 */
export interface BoardColumn {
  /** 列 key：书挡用 sentinel，阶段用 stage.id。 */
  key: string
  /** 列名：书挡用本地化文案，阶段用 stage.name。 */
  title: string
  kind: 'todo' | 'stage' | 'done'
}

/**
 * 拼装看板列：`[待办书挡] + 激活工作流各阶段（按序）+ [已完成书挡]`。
 * - 书挡列为常量、恒在首尾，独立于工作流；`activeWorkflow` 为 null（未激活或定义缺失）时只返回两列书挡。
 * - 中间阶段列以工作流 `stages` 为单一来源，顺序即列序、不去重不重排；
 *   即便某阶段名恰为「待办/已完成」，它仍以自己的 stage.id 作 key 独立成中间列（与 sentinel 不冲突）。
 */
export function buildBoardColumns(
  activeWorkflow: WorkflowDefinition | null,
  labels: { todo: string; done: string },
  lang: string = DEFAULT_LANGUAGE
): BoardColumn[] {
  const stages: BoardColumn[] = (activeWorkflow?.stages ?? []).map((s) => ({
    key: s.id,
    title: resolveLocalized(s.name, lang),
    kind: 'stage'
  }))
  return [
    { key: TODO_COLUMN_KEY, title: labels.todo, kind: 'todo' },
    ...stages,
    { key: DONE_COLUMN_KEY, title: labels.done, kind: 'done' }
  ]
}

/** 由工作流定义建 `nodeId → stageId` 索引；工作流为 null 返回空索引。 */
export function nodeToStage(workflow: WorkflowDefinition | null): Record<string, string> {
  const map: Record<string, string> = {}
  for (const n of workflow?.nodes ?? []) map[n.id] = n.stageId
  return map
}

/** 计算卡片列定位所需的最小输入（archetype/状态/是否有运行/当前节点/运行是否已完成，由调用方从卡与断点提取）。 */
export interface CardColumnInput {
  archetype: CardArchetype
  status: CardStatus
  hasActiveRun: boolean
  currentNodeId: string | null
  /**
   * 该卡关联运行是否已 `done`（取自断点 `state`）。与卡状态 `已完成` 是两条**独立更新**的口子
   * （断点走引擎事件、卡状态走卡库重载），完成瞬间可能一先一后到达。任一为真即归已完成列，
   * 避免「断点已 done（currentNodeId=null）但卡状态尚未跟上 → 误落待办」的一帧闪动。
   */
  runDone: boolean
}

/**
 * 纯派生：算一张卡所在的列 key（列与运行状态正交）。
 * - `container`：恒「待办」；`opts.allChildrenDone` 为真（有子卡且全归档）→「已完成」。
 * - `leaf`：状态「已完成」**或运行已 done** →「已完成」；「未开始」或无运行 →「待办」；
 *   其余（进行中/已暂停/等待决策）→ 当前节点所属 stage 列；无法映射到该工作流的某阶段则回落「待办」。
 * 子工作流不改变列归属（卡按顶层节点落列，穿透只影响圆点文案）。
 */
export function cardColumn(
  card: CardColumnInput,
  workflow: WorkflowDefinition | null,
  opts?: { allChildrenDone?: boolean }
): string {
  if (card.archetype === 'container') {
    return opts?.allChildrenDone ? DONE_COLUMN_KEY : TODO_COLUMN_KEY
  }
  // leaf：卡状态已完成、或其运行断点已 done（两条独立口子，任一到达即归已完成，防完成瞬间闪待办）。
  if (card.status === '已完成' || card.runDone) return DONE_COLUMN_KEY
  if (card.status === '未开始' || !card.hasActiveRun) return TODO_COLUMN_KEY
  if (!card.currentNodeId) return TODO_COLUMN_KEY
  const stageId = nodeToStage(workflow)[card.currentNodeId]
  // 当前节点对应的 stage 须确实是工作流的一列，否则回落待办（工作流缺失/损坏/节点游离）。
  const exists = (workflow?.stages ?? []).some((s) => s.id === stageId)
  return stageId && exists ? stageId : TODO_COLUMN_KEY
}

/** 运行圆点的可视形态（颜色取语义令牌；"呼吸"=动画态、"静止"=无动画）。 */
export type DotShape = 'breathing' | 'static'
export type DotColor = 'blue' | 'violet' | 'amber' | 'red'
export interface RunDot {
  shape: DotShape
  color: DotColor
  /** 细状态语义（供渲染层选括号文案/决策标题）：工作中 / 检查中 / 等待决策。暂停不改此语义（见 `paused`）。 */
  state: 'working' | 'checking' | 'waiting-decision'
  /** 是否暂停：仅把圆点从呼吸变静止 + 由渲染层加一个暂停图标；不改颜色/括号文案。 */
  paused: boolean
  /** 当前节点名（取 nodePath 末项→否则 currentNodeId→否则 null）。 */
  nodeLabel: string | null
}

/**
 * 纯派生：算卡上运行圆点（运行状态的可视投影）。一次写全、数据留口——
 * `agent` 紫点本期无真实运行点亮（agent 节点被跳过），子工作流穿透读 `nodePath` 末项。
 * - **有待决策（含暂停时仍待决策）→ 恒红**（优先于阶段色：卡在决策上，暂停不改红）。
 * - `gate` 阶段 → 黄（checking）。
 * - `executing` → 按当前节点执行者：agent→紫、engine/command→蓝（working）。
 * - **`paused`（已暂停）→ `paused:true`**：圆点由呼吸变**静止**，颜色/括号文案**不变**（仍是工作中/检查中/决策），
 *   暂停由渲染层另加一个暂停图标表示，而非改括号文案。
 * - 无断点 / `done` / `aborted` → 无圆点（null）。
 */
export function runDot(
  breakpoint: RunBreakpoint | null,
  workflow: WorkflowDefinition | null,
  lang: string = DEFAULT_LANGUAGE
): RunDot | null {
  if (!breakpoint) return null
  const path = breakpoint.nodePath
  const nodeId = (path && path.length ? path[path.length - 1] : breakpoint.currentNodeId) ?? null
  const node = nodeId ? (workflow?.nodes ?? []).find((n) => n.id === nodeId) ?? null : null
  const nodeLabel = node ? resolveLocalized(node.name, lang) : nodeId

  if (breakpoint.state === 'done' || breakpoint.state === 'aborted') return null
  const paused = breakpoint.state === 'paused'
  // 有待决策 → 恒**红**(优先于阶段色):暂停一个待决策的运行,它仍是"卡在决策上",只是被暂停,不该变蓝。
  if (breakpoint.pendingDecision || breakpoint.state === 'waiting-decision') {
    return { shape: 'static', color: 'red', state: 'waiting-decision', paused, nodeLabel }
  }
  // 无待决策:running 呼吸、paused 静止(未在工作但不隐藏),颜色按阶段。done/aborted 才无点。
  if (breakpoint.state !== 'running' && !paused) return null
  const shape: DotShape = paused ? 'static' : 'breathing'
  if (breakpoint.phase.kind === 'gate') {
    return { shape, color: 'amber', state: 'checking', paused, nodeLabel }
  }
  if (breakpoint.phase.kind === 'executing') {
    const color: DotColor = node?.executor.kind === 'agent' ? 'violet' : 'blue'
    return { shape, color, state: 'working', paused, nodeLabel }
  }
  return null
}
