/**
 * 导入后自动派工作流的**底栏生成状态**（workflowGen store，比照 documents store 的 `analyzing`）：
 * 后台 author 起跑时 main 推 `generating`、结束推 `done`/`failed`；底栏 `WorkflowGenStatus` 据此显/隐指示。
 * 只告知进度、不打断用户（提案就绪后的弹出走 modalQueue 协调器，与本状态无关）。
 *
 * `failed` 不即隐——实测里指示一闪即无、用户无从知情。改为亮一条自动消失的轻提示
 * 「未能生成定制工作流，已用默认工作流」（`failedNotice`），过一会儿由计时器自行清掉。
 */

import { create } from 'zustand'
import type { WorkflowGenPhase } from '@shared/types'

/** 失败轻提示的自动消失时长（毫秒）：给用户看清「已用默认工作流」的窗口，随后归空、不占位。 */
export const WORKFLOW_GEN_FAILED_NOTICE_MS = 5000

/** 待清 failed 轻提示的计时器句柄——每次新事件都先清掉，避免旧计时误清后来的指示。 */
let failedNoticeTimer: ReturnType<typeof setTimeout> | null = null
function clearFailedNoticeTimer(): void {
  if (failedNoticeTimer !== null) {
    clearTimeout(failedNoticeTimer)
    failedNoticeTimer = null
  }
}

interface WorkflowGenState {
  /** 后台工作流生成进行中（底栏显示转圈指示）。 */
  generating: boolean
  /** 生成失败后的自动消失轻提示窗口（底栏显示「已用默认工作流」）。 */
  failedNotice: boolean
  /**
   * 应用一条生成进度事件：
   * - `generating`：显示生成中，清掉任何失败提示与其计时；
   * - `done`：立即清空（成功后走提案弹出，本状态不占位）；
   * - `failed`：亮失败轻提示并起一个计时，到点自行清空。
   */
  setStatus: (phase: WorkflowGenPhase) => void
}

export const useWorkflowGenStore = create<WorkflowGenState>((set) => ({
  generating: false,
  failedNotice: false,
  setStatus: (phase) => {
    clearFailedNoticeTimer()
    if (phase === 'generating') {
      set({ generating: true, failedNotice: false })
    } else if (phase === 'failed') {
      set({ generating: false, failedNotice: true })
      failedNoticeTimer = setTimeout(() => {
        failedNoticeTimer = null
        set({ failedNotice: false })
      }, WORKFLOW_GEN_FAILED_NOTICE_MS)
    } else {
      set({ generating: false, failedNotice: false })
    }
  }
}))
