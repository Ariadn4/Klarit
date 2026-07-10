/**
 * 产物溯源派生视图（纯函数，不新建持久化存储）：从运行断点 + 工作流节点，派生「每个节点生产了哪些产物」，
 * 供人工评审门驳回时的**只读回退判定 agent** 定位「问题最早在哪个节点产生」。见 docs/failure-handling.md §5.2。
 *
 * - **声明式产出**：按 `node.outputs[].destination.path` 归到声明它的节点（静态、来自工作流定义）。
 * - **代码隐式产出**：按每个 agent 节点 `git diff <startSha>..<commitSha>` 的改动文件归到该节点（多仓各自成立）。
 *   SHA 锚点来自 `bp.agentRuns[nodeId].{startSha,commitSha}[memberId]`（已由 agent 执行落库）。
 *
 * 只覆盖 **agent 代码产物 + 声明式产出**；command 节点隐式产物入图属后续。缺 SHA 的节点不产代码产物、不入图。
 */

import type { RunBreakpoint, WorkflowNode } from '../../shared/types'

/** 一个节点的产物归属：声明式产出路径 + 代码改动文件（跨其全部目标仓合并去重）。 */
export interface LineageEntry {
  nodeId: string
  /** 该节点声明的产出文件路径（相对分支目录）。 */
  declared: string[]
  /** 该节点提交的代码改动文件（startSha..commitSha 的 diff，多仓合并）。 */
  code: string[]
}

/** 取某成员仓两 SHA 之间改动文件名的函数（注入以便测试；真实由引擎用 git 实现）。 */
export type DiffNames = (memberId: string, fromSha: string, toSha: string) => string[]

/**
 * 派生产物溯源：按节点顺序遍历,逐节点收集声明式产出 + 代码改动文件。纯函数——git 访问经 `diffNames` 注入。
 * 只对有 `startSha` 与 `commitSha` 的（成员仓）算代码 diff；缺任一则该仓无代码产物。
 */
export function deriveLineage(bp: RunBreakpoint, nodes: WorkflowNode[], diffNames: DiffNames): LineageEntry[] {
  const entries: LineageEntry[] = []
  for (const node of nodes) {
    const declared = (node.outputs ?? []).map((o) => o.destination.path).filter((p) => !!p)
    const code = new Set<string>()
    const run = bp.agentRuns?.[node.id]
    if (run?.startSha && run.commitSha) {
      for (const memberId of Object.keys(run.commitSha)) {
        const from = run.startSha[memberId]
        const to = run.commitSha[memberId]
        if (!from || !to) continue
        for (const f of diffNames(memberId, from, to)) if (f) code.add(f)
      }
    }
    if (declared.length || code.size) {
      entries.push({ nodeId: node.id, declared, code: [...code] })
    }
  }
  return entries
}

/**
 * 把溯源渲染成喂给判定 agent 的文本（每节点：序号 + id + 名 + 声明式产出 + 代码改动文件）。
 * `nameOf` 把节点解析为显示名（引擎侧按语言解析）。判定 agent 据此把驳回意见映射到最早节点。
 */
export function renderLineage(entries: LineageEntry[], nameOf: (nodeId: string) => string): string {
  if (!entries.length) return '（本需求暂无可溯源的产物记录）'
  return entries
    .map((e, i) => {
      const lines = [`${i + 1}. 节点 id=\`${e.nodeId}\`（${nameOf(e.nodeId)}）`]
      if (e.declared.length) lines.push(`   - 声明式产出：${e.declared.join('、')}`)
      if (e.code.length) lines.push(`   - 代码改动文件：${e.code.join('、')}`)
      return lines.join('\n')
    })
    .join('\n')
}
