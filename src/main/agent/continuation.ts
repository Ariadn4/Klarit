/**
 * agent 续接「就高不就低」阶梯的选择逻辑（一处判定，统一覆盖自愈回喂 / 答决策 / 崩溃恢复）：
 * ① 原生 resume（adapter 支持且拉起成功）——接 agent 自己盘上会话，最高保真、覆盖崩溃半路；
 * ② 自存重建（不支持或 resume 失败）——用重拼 prompt（基 prompt + 续接 delta，含自存记录/worktree 现状）全新 start；
 * ③ 最粗兜底重跑节点——即 ② 里 rebuildPrompt 退化为「基 prompt + 无 delta」，由调用方决定 delta 内容。
 *
 * worktree 文件永远垫底：无论走哪层，agent 起来都能读到已落盘的真实改动。
 */

import type { AgentRunner, AgentRunSpec, AgentLaunch } from './runner'

/**
 * 拼「续接」补充段：把「失败详情 / 用户决策答复」交代清楚。
 * - 原生 `--resume` 场景：会话已有完整记忆，只需这段 delta（inject）。
 * - 全新起场景：引擎把它接在**完整任务 prompt（+ 历史记录）**之后（rebuildPrompt）。
 */
export function buildContinuationDelta(reason: {
  failure?: string
  decisionAnswer?: string
  /** 内容驱动回退「修复前向」：被退回节点在现有进展上修复用户驳回的问题，不推倒重来。 */
  forwardFix?: { furthestNode?: string; feedback: string }
}): string {
  const lines: string[] = ['# 续接说明', '继续完成任务；你之前的改动已在 worktree 里，别重复已完成的部分。']
  if (reason.forwardFix && reason.forwardFix.feedback.trim()) {
    const far = reason.forwardFix.furthestNode?.trim()
    lines.push(
      '',
      far
        ? `本需求之前已推进到节点「${far}」，但用户在人工评审里驳回了。用户的意见是：`
        : '用户在人工评审里驳回了本需求。用户的意见是：',
      reason.forwardFix.feedback.trim(),
      '请回到当前这个节点，在现有进展（worktree 里已有下游改动）的基础上**前向修复**这个问题——别重置、别推倒重来、别重复已完成的部分。修好后正常产出，让工作流继续往下走回评审。'
    )
  }
  if (reason.decisionAnswer && reason.decisionAnswer.trim()) {
    lines.push('', '你此前请求了用户决策，用户的决定是：', reason.decisionAnswer.trim(), '请据此继续。')
  }
  if (reason.failure && reason.failure.trim()) {
    lines.push('', '上一次未通过，失败详情：', reason.failure.trim(), '请据此在当前 worktree 修复后继续。')
  }
  return lines.join('\n')
}

/**
 * 续接「就高不就低」阶梯：
 * ① **原生 `--resume <sessionId>`**（有 session id 且 adapter 支持）——接上那条真实会话（带记忆），inject 只需 delta；
 * ② **全新起**（无 session / resume 拉起失败）——`rebuildPrompt` 由引擎按「有无历史记录」拼好
 *    （有历史＝完整任务 + 喂回历史 + delta；无历史＝完整任务 + delta + 读 worktree 现状）。
 * worktree 文件永远垫底。
 */
export function launchContinuation(
  runner: AgentRunner,
  spec: AgentRunSpec,
  opts: { inject: string; rebuildPrompt: string }
): AgentLaunch | null {
  if (spec.sessionId && runner.supportsResume(spec.toolId)) {
    const l = runner.resume({ ...spec, inject: opts.inject })
    if (l) return l // ① 原生 --resume by id
  }
  return runner.start({ ...spec, prompt: opts.rebuildPrompt }) // ② 全新起
}
