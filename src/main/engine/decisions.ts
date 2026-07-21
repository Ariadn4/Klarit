/**
 * 失败 → **统一前进式人工决策** 的映射。每个选项都让流程继续(继续/跳过本节点/重做/换法),
 * **无「中止」死结**。只有"意图取舍 / 破坏性 / 凭据环境"类失败才抛人工;技术性失败(冲突/测试/越界)
 * 属 agent 自愈(本能力不实现);琐碎的(瞬时锁、环境缺失)由引擎自动处理、不抛决策。
 *
 * **文案全部是 i18n key,引擎不写死语言**——渲染层按当前选中语言翻译(切语言实时跟随)。
 * `raw`(git 原始输出)只放字段供开发/测试排查,正式 UI 不渲染。本能力产生的决策 `sourceKind` 恒为 `engine`。
 */

import type { AgentHandshake, EngineDecision, EngineDecisionOption, GateAttempt } from '../../shared/types'

const K = 'engineDecision'
const SKIP_NODE: EngineDecisionOption = { id: 'skip', labelKey: `${K}.optSkipNode` }
const RETRY: EngineDecisionOption = { id: 'retry', labelKey: `${K}.optRetry` }

/** 某失败是否由引擎**自动跳过**(不打扰任何人):环境性、不阻断交付的。 */
export function isAutoSkippable(operation: string, _outcome: string): boolean {
  return operation === 'link-env' || operation === 'delete-remote-branch'
}

/** 按操作 + 失败归类给出前进式人工决策;未枚举的回落「重试 / 跳过」。`extra.address`=push 当前远端地址。 */
export function buildFailureDecision(
  nodeId: string,
  nodeName: string,
  operation: string,
  outcome: string,
  detail: string,
  extra: { address?: string } = {}
): EngineDecision {
  const make = (
    titleKey: string,
    options: EngineDecisionOption[],
    rest: Partial<EngineDecision> = {}
  ): EngineDecision => ({
    source: `${nodeId}:${outcome}`,
    sourceKind: 'engine',
    titleKey,
    options,
    raw: detail || undefined,
    // 除人工评审门外，所有决策恒带一个自由输入框（追问/让 AI 帮处理）；push 无远端等专用填空经 rest 覆盖。
    input: { labelKey: `${K}.freeInput`, placeholderKey: `${K}.freeInputPlaceholder` },
    ...rest
  })

  if (operation === 'push-branch' && outcome === 'non-fast-forward') {
    return make(`${K}.pushNonFastForward`, [
      { id: 'pull-rebase', labelKey: `${K}.optPullRebase`, detailKey: `${K}.detailPullRebase`, recommended: true },
      { id: 'force', labelKey: `${K}.optForcePush`, detailKey: `${K}.detailForcePush` },
      { id: 'skip', labelKey: `${K}.optSkipPush` }
    ])
  }
  if (operation === 'push-branch' && outcome === 'auth') {
    return make(`${K}.pushAuth`, [
      { id: 'retry', labelKey: `${K}.optRetryAuth`, recommended: true },
      { id: 'skip', labelKey: `${K}.optSkipPush` }
    ])
  }
  if (operation === 'push-branch') {
    // 无远端,以及"地址不对 / 传不上去"的其它失败:都给「填/改远端地址 + 跳过」,可反复重填。
    const addr = extra.address?.trim()
    return make(
      addr ? `${K}.pushBadAddress` : `${K}.pushNoRemote`,
      [{ id: 'skip', labelKey: `${K}.optSkipPush` }],
      {
        titleParams: addr ? { address: addr } : undefined,
        input: { labelKey: `${K}.inputRemoteAddress`, placeholderKey: `${K}.inputRemotePlaceholder` }
      }
    )
  }
  if (operation === 'delete-branch' && outcome === 'not-merged') {
    return make(`${K}.deleteNotMerged`, [
      { id: 'merge-then-delete', labelKey: `${K}.optMergeThenDelete`, detailKey: `${K}.detailMergeThenDelete`, recommended: true },
      { id: 'force', labelKey: `${K}.optForceDelete`, detailKey: `${K}.detailForceDelete` },
      { id: 'skip', labelKey: `${K}.optKeepBranchSkip` }
    ])
  }
  if (operation === 'open-worktree') {
    return make(`${K}.worktreePathOccupied`, [
      { id: 'recreate', labelKey: `${K}.optRecreate`, detailKey: `${K}.detailRecreate` },
      { id: 'suffix', labelKey: `${K}.optSuffix`, detailKey: `${K}.detailSuffix` }
    ])
  }
  if (operation === 'remove-worktree') {
    return make(`${K}.worktreeBusy`, [
      { id: 'retry', labelKey: `${K}.optRetryClosed`, recommended: true },
      { id: 'force', labelKey: `${K}.optForceRemove`, detailKey: `${K}.detailForceRemove` },
      { id: 'skip', labelKey: `${K}.optSkipKeepWorktree` }
    ])
  }
  if (operation === 'open-pr') {
    // agent 开 PR 不可用(无默认 agent)——终局失败,给重试/跳过(前进式)。
    return make(`${K}.openPrNoAgent`, [RETRY, SKIP_NODE], { titleParams: { node: nodeName }, reason: detail || undefined })
  }
  if (operation === 'archive-docs' && outcome === 'no-registry') {
    // 该成员仓从未建立文档登记表——挂起提示先建表(去设置/onboarding 建),再重试或跳过。
    return make(`${K}.archiveNoRegistry`, [RETRY, SKIP_NODE], { titleParams: { node: nodeName }, reason: detail || undefined })
  }
  if (operation === 'archive-docs') {
    // 归档委派 agent 不可用(无默认 agent)——终局失败,给重试/跳过(前进式)。
    return make(`${K}.archiveNoAgent`, [RETRY, SKIP_NODE], { titleParams: { node: nodeName }, reason: detail || undefined })
  }
  if (operation === 'merge-branch' && outcome === 'conflict') {
    // heal 超限/不可用才回落到此;`reason`=冲突详情(哪些文件冲突),让用户看到具体是什么冲突。
    return make(`${K}.mergeConflict`, [{ id: 'skip', labelKey: `${K}.optSkipMerge` }], { reason: detail || undefined })
  }
  return make(`${K}.generic`, [RETRY, SKIP_NODE], { titleParams: { node: nodeName }, reason: detail || undefined })
}

/**
 * 命令节点非零退出 → 前进式兜底决策(重试 / 跳过本节点)。`reason`=命令输出(给用户看「为什么失败」);
 * 退出码不进用户文案,只进 `raw` 供开发排查。
 */
export function buildCommandFailedDecision(
  nodeId: string,
  command: string,
  code: number,
  output: string
): EngineDecision {
  return {
    source: `${nodeId}:command-failed`,
    sourceKind: 'engine',
    titleKey: `${K}.commandFailed`,
    titleParams: { command },
    options: [RETRY, SKIP_NODE],
    input: { labelKey: `${K}.freeInput`, placeholderKey: `${K}.freeInputPlaceholder` },
    reason: output || undefined,
    raw: `exit ${code}${output ? `\n${output}` : ''}`
  }
}

/** 命令节点超时 → 前进式决策(重试 / 跳过本节点)。 */
export function buildCommandTimeoutDecision(
  nodeId: string,
  command: string,
  sec: number,
  output: string
): EngineDecision {
  return {
    source: `${nodeId}:command-timeout`,
    sourceKind: 'engine',
    titleKey: `${K}.commandTimeout`,
    titleParams: { command, sec },
    options: [RETRY, SKIP_NODE],
    input: { labelKey: `${K}.freeInput`, placeholderKey: `${K}.freeInputPlaceholder` },
    reason: output || undefined,
    raw: output || undefined
  }
}

/**
 * 人工评审门把 → 决策。唯一选项「通过」＝满意过门；**在自由输入框写下不满意的点并提交** ＝ 驳回，触发内容
 * 驱动回退（只读判定 → 确认 → 重入前向修复，见 content-driven-rollback）——框空则提交禁用，天然保证「驳回必带
 * 理由」。不另设「驳回」按钮（框即驳回入口）。携带动作按钮 + 可打开产出供回显。
 */
export function buildManualGateDecision(
  nodeId: string,
  nodeName: string,
  actions?: Array<{ label: string; index: number }>,
  outputs?: Array<{ name: string; path: string }>
): EngineDecision {
  return {
    source: `${nodeId}:manual-gate`,
    sourceKind: 'engine',
    titleKey: `${K}.manualReview`,
    titleParams: { node: nodeName },
    options: [{ id: 'pass', labelKey: `${K}.optPass`, recommended: true }],
    // 评审门开放自由输入：写下不满意的点即触发内容驱动回退（留空 + 通过＝照旧过门）。
    input: { labelKey: `${K}.rejectReason`, placeholderKey: `${K}.rejectReasonPlaceholder` },
    ...(actions && actions.length ? { actions } : {}),
    ...(outputs && outputs.length ? { outputs } : {})
  }
}

/**
 * 外部门（`external`）挂起决策——等平台把 PR 合并。唯一前进选项「开始收尾」＝**再核查一次**（真合了才过门、
 * 没合就再挂回来，点击不放行）；自由输入框即**打回入口**：写下不满意的点即触发内容驱动回退（同人工评审门那套）。
 * 不带 reason（状态框）——标题「PR 确认已合并后，点击以进行收尾工作」已足够，`source` 标 `:external-gate` 供 decide 路由。
 */
export function buildExternalGateDecision(
  nodeId: string,
  _nodeName: string,
  prLinks?: Array<{ repo?: string; url: string }>,
  rechecked?: boolean
): EngineDecision {
  // open-pr 回报的 PR 链接 → 可点击链接（label=仓名，缺仓名时用「查看 PR」）。
  const links = (prLinks ?? [])
    .filter((p) => p && typeof p.url === 'string' && p.url.trim() !== '')
    .map((p) => ({ label: p.repo || '查看 PR', url: p.url }))
  return {
    source: `${nodeId}:external-gate`,
    sourceKind: 'engine',
    // 初次挂起给引导语；用户点了「开始收尾」但核查仍未合并 → 换成「检测到尚未合并」的反馈。
    titleKey: rechecked ? `${K}.prStillNotMerged` : `${K}.prNotMerged`,
    options: [{ id: 'recheck', labelKey: `${K}.optRecheckMerged`, recommended: true }],
    // 自由输入框即打回入口（写反馈 → 内容驱动回退，退回之前节点改）。
    input: { labelKey: `${K}.rejectReason`, placeholderKey: `${K}.rejectReasonPlaceholder` },
    ...(links.length ? { links } : {})
  }
}

/**
 * 回退确认决策（内容驱动回退第二步）：只读判定 agent 提名的候选回退节点渲染为**主选 + 备选** options
 * （`id`=目标节点 id、`label`=节点名、`detail`=理由），附「取消回退」选项与自由输入（写内容可重唤判定）。
 * `raw` 暂存本次驳回意见，供用户确认后注入被退回节点的「修复前向」续接（dev 字段、不渲染）。
 */
export function buildRollbackConfirmDecision(
  nodeId: string,
  title: string | undefined,
  candidates: Array<{ nodeId: string; nodeName: string; reason?: string; recommended?: boolean }>,
  feedback: string
): EngineDecision {
  const options: EngineDecisionOption[] = candidates.map((c) => ({
    id: c.nodeId,
    label: c.nodeName,
    ...(c.reason ? { detail: c.reason } : {}),
    ...(c.recommended ? { recommended: true } : {})
  }))
  options.push({ id: 'cancel-rollback', labelKey: `${K}.optCancelRollback` })
  return {
    source: `${nodeId}:rollback-confirm`,
    sourceKind: 'engine',
    titleKey: `${K}.rollbackConfirm`,
    options,
    input: { labelKey: `${K}.rollbackRejudge`, placeholderKey: `${K}.rollbackRejudgePlaceholder` },
    reason: title || undefined,
    raw: feedback
  }
}

/**
 * agent 运行时经握手提问（`status='need-decision'`）→ **`sourceKind='agent'`** 决策，落单卡详情面板。
 * 选项取自握手 `decision.options`（**原始 label**、非 i18n key）；`freeInput` 时附自由输入（开放答案转交原 agent）；
 * agent 的具体问题放 `reason`。无选项时兜底一个前进式「继续」，绝不留死结。
 */
export function buildAgentDecision(nodeId: string, nodeName: string, handshake: AgentHandshake): EngineDecision {
  const d = handshake.decision
  const options: EngineDecisionOption[] = (d?.options ?? []).map((o) => ({
    id: o.id,
    label: o.label,
    ...(o.detail ? { detail: o.detail } : {}),
    ...(o.recommended ? { recommended: true } : {})
  }))
  if (options.length === 0) options.push({ id: 'continue', labelKey: `${K}.agentContinue`, recommended: true })
  return {
    source: `${nodeId}:agent-ask`,
    sourceKind: 'agent',
    titleKey: `${K}.agentAsk`,
    titleParams: { node: nodeName },
    options,
    multi: d?.multi ?? false,
    ...(d?.freeInput ? { input: { labelKey: `${K}.agentFreeInput` } } : {}),
    reason: d?.title || handshake.note || undefined
  }
}

/**
 * 可写范围越界自愈超限 → 前进式决策。选项 MUST 含**「放宽可写范围」**（越界常因范围声明过窄，缺此选项
 * 会陷死循环）。`reason`=越界文件清单（已还原）。sourceKind=engine（引擎强制的基线门把）。
 */
export function buildScopeDecision(nodeId: string, nodeName: string, outOfScope: string[]): EngineDecision {
  return {
    source: `${nodeId}:scope-violation`,
    sourceKind: 'engine',
    titleKey: `${K}.scopeViolation`,
    titleParams: { node: nodeName, count: outOfScope.length },
    options: [
      { id: 'widen-scope', labelKey: `${K}.optWidenScope`, detailKey: `${K}.detailWidenScope`, recommended: true },
      RETRY,
      SKIP_NODE
    ],
    input: { labelKey: `${K}.freeInput`, placeholderKey: `${K}.freeInputPlaceholder` },
    reason: outOfScope.join('\n') || undefined
  }
}

/**
 * 客观门未过 → 前进式决策。`reason`=检查命令输出(给用户看「为什么没过」,不显示退出码)。
 * 当因超时自动重跑多次后升级,附 `history` 展示重跑记录;命令/引擎节点门报错则立即交用户(无 history)。
 * 选项:重跑此检查(荐)/ 重跑本节点 / 跳过此检查(future 可接 agent 自愈)。
 */
export function buildGateDecision(
  nodeId: string,
  nodeName: string,
  opts: { reason?: string; history?: GateAttempt[] } = {}
): EngineDecision {
  const escalated = !!opts.history && opts.history.length > 0
  return {
    source: `${nodeId}:${escalated ? 'gate-escalated' : 'gate-failed'}`,
    sourceKind: 'engine',
    titleKey: escalated ? `${K}.gateEscalated` : `${K}.gateFailed`,
    titleParams: escalated ? { node: nodeName, count: opts.history!.length } : { node: nodeName },
    options: [
      { id: 'retry', labelKey: `${K}.optRerunGate`, recommended: true },
      { id: 'rerun-node', labelKey: `${K}.optRerunNode` },
      { id: 'skip', labelKey: `${K}.optSkipGate` }
    ],
    input: { labelKey: `${K}.freeInput`, placeholderKey: `${K}.freeInputPlaceholder` },
    ...(escalated ? { gateHistory: opts.history } : {}),
    reason: opts.reason || undefined
  }
}
