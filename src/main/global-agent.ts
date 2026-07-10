/**
 * 全局 agent 接缝：把「新建需求」入口与外部 AI 调用收敛到同一「解析 prompt → 产出候选卡」链路。
 * 只产出候选卡（管理状态），不碰代码/git；候选归当前绑定项目，未绑定给空态。落库归下一个 change。
 */

import type {
  CandidateCard,
  DecomposeInput,
  DecomposeOutcome,
  DecomposePromptOutcome
} from '../shared/types'
import { normalizeCandidateBatch, validateCandidateBatch } from '../shared/decomposition'
import { typeArchetypeMap } from '../shared/card-type'
import { resolveDecomposePrompt, runDecompose, type CandidateProducer, type ResolveDeps } from './decompose-service'

export interface DecomposeSeam {
  /** 内置 producer 路径：解析生效 prompt → producer 产出候选；未绑定项目给空态。 */
  decompose: (input: DecomposeInput, projectId: string | null) => Promise<DecomposeOutcome>
  /** 外部 AI 路径：接收外部产出的候选，规整+校验（不旁路）后回传供人审；未绑定给空态。 */
  submit: (candidates: CandidateCard[], projectId: string | null) => Promise<DecomposeOutcome>
  /** 解析当前项目的生效分解 prompt（供外部 AI 读取 skill）；未绑定给空态。 */
  resolvePrompt: (projectId: string | null) => DecomposePromptOutcome
}

export function createDecomposeSeam(deps: ResolveDeps, produce: CandidateProducer): DecomposeSeam {
  return {
    async decompose(input, projectId) {
      if (!projectId) return { unbound: true }
      return runDecompose(input, deps, produce)
    },

    async submit(candidates, projectId) {
      if (!projectId) return { unbound: true }
      const normalized = normalizeCandidateBatch(candidates ?? [])
      const { issues } = validateCandidateBatch(normalized, typeArchetypeMap(deps.getTypes()))
      return { candidates: normalized, issues }
    },

    resolvePrompt(projectId) {
      if (!projectId) return { unbound: true }
      return { prompt: resolveDecomposePrompt(deps) }
    }
  }
}
