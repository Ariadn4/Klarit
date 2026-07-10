/**
 * 分解服务：解析生效分解 prompt 并以注入的 producer 产出候选卡后规整+校验。推理外包给 producer
 * （外部 AI / 将来的 agent 运行时），本服务只负责 prompt 解析与候选卡的规整/校验，止于产出（不落库）。
 *
 * 生效 prompt 解析顺序：覆盖 skill（激活工作流「新建需求」指令 → 全局手写/导入覆盖 skill）
 * → 由项目在册类型自动生成的分解 skill（兜底，始终非空）。
 */

import type { CandidateCard, CardTypeDef, DecomposeInput, DecomposeResult, WorkflowDefinition } from '../shared/types'
import { buildDecomposeSkill, normalizeCandidateBatch, validateCandidateBatch } from '../shared/decomposition'
import { typeArchetypeMap } from '../shared/card-type'

/** 解析生效 prompt 所需的依赖（注入以便测试，不绑 Electron）。 */
export interface ResolveDeps {
  /** 当前项目激活的工作流 id；无则 null。 */
  getActiveWorkflowId: () => string | null
  /** 读某工作流定义；不存在返回 null。 */
  getWorkflow: (id: string) => WorkflowDefinition | null
  /** 读某工作流包内 skill 文件内容（按相对包路径）；不存在/越界返回 null。 */
  readWorkflowSkill: (workflowId: string, relPath: string) => string | null
  /** 项目在册需求卡类型（含未绑定项目时的默认集）——既作自动生成 skill 的输入，也作候选校验的注册表。 */
  getTypes: () => CardTypeDef[]
  /** 全局手写/导入的覆盖 skill 内容；无则 null（无覆盖时用自动生成 skill 兜底）。 */
  readOverride: () => string | null
}

/** producer：拿生效 prompt 与输入产出候选卡（外部 AI / agent 运行时）。 */
export type CandidateProducer = (prompt: string, input: DecomposeInput) => Promise<CandidateCard[]>

/**
 * 解析生效分解 prompt：
 * 1) 激活工作流的新建需求指令（inline 文本 / file 读包内 skill）；
 * 2) 全局手写/导入的覆盖 skill；
 * 3) 由项目在册类型自动生成的分解 skill（兜底，只要至少有默认类型即非空）。
 */
export function resolveDecomposePrompt(deps: ResolveDeps): string {
  const wfId = deps.getActiveWorkflowId()
  if (wfId) {
    const instr = deps.getWorkflow(wfId)?.newRequirementInstruction
    if (instr?.kind === 'inline' && instr.text.trim() !== '') return instr.text
    if (instr?.kind === 'file') {
      const content = deps.readWorkflowSkill(wfId, instr.path)
      if (content && content.trim() !== '') return content
    }
  }
  const override = deps.readOverride()
  if (override && override.trim() !== '') return override
  return buildDecomposeSkill(deps.getTypes())
}

/**
 * 跑一次分解：解析 prompt → 注入的 producer 产出候选 → 规整（预取名去重）→ 按项目注册表校验 → 返回结果。
 * 不抛异常；不合候选（含 typeId 不在册）进 issues 供审阅界面提示，不静默回落。
 */
export async function runDecompose(
  input: DecomposeInput,
  deps: ResolveDeps,
  produce: CandidateProducer
): Promise<DecomposeResult> {
  const prompt = resolveDecomposePrompt(deps)
  const raw = await produce(prompt, input)
  const candidates = normalizeCandidateBatch(raw ?? [])
  const { issues } = validateCandidateBatch(candidates, typeArchetypeMap(deps.getTypes()))
  return { candidates, issues }
}
