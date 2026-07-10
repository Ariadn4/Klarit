import { describe, it, expect } from 'vitest'
import { assembleAgentPrompt, rollbackJudgmentTask, PROMPT_SECTIONS } from './agent-prompt'

describe('rollbackJudgmentTask — 只读回退判定任务段', () => {
  it('声明只读、要求给主选+备选回退节点写进握手，不含改代码指令', () => {
    const t = rollbackJudgmentTask({ node: '验收', userInput: 'UI 体验不对', lineage: '1. 节点 id=`impl`（实现）' })
    expect(t).toContain('只读顾问')
    expect(t).toContain('UI 体验不对')
    expect(t).toContain('impl')
    expect(t).toContain('recommended')
    // 强调不重置、不作废下游、不自行改代码
    expect(t).toContain('不重置')
    expect(t).toContain('不要自行修改代码')
  })
})

describe('assembleAgentPrompt — 只读模式省略可写范围与产出', () => {
  const base = {
    language: 'zh' as const,
    promptText: '判定任务',
    constitution: [],
    writableScope: [],
    outputs: []
  }

  it('readOnly=true → prompt 不含「可写范围」「产出」两节', () => {
    const p = assembleAgentPrompt({ ...base, readOnly: true })
    expect(p).not.toContain(PROMPT_SECTIONS.writableScope)
    expect(p).not.toContain(PROMPT_SECTIONS.outputs)
    // 任务段与引擎交互协议仍在
    expect(p).toContain(PROMPT_SECTIONS.task)
    expect(p).toContain(PROMPT_SECTIONS.protocol)
  })

  it('默认（非只读）仍输出「可写范围」节（整条分支可写）', () => {
    const p = assembleAgentPrompt(base)
    expect(p).toContain(PROMPT_SECTIONS.writableScope)
  })
})
