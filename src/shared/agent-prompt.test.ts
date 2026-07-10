import { describe, it, expect } from 'vitest'
import type { EffectiveConstitutionRule, RulePack } from './rule-pack'
import type { WorkflowOutput } from './types'
import {
  assembleAgentPrompt,
  resolveOutputs,
  CARD_DESCRIPTION_SLOT,
  PROMPT_MARKERS,
  PROMPT_SECTIONS,
  REPLY_LANGUAGE_INSTRUCTION,
  engineProtocolBody,
  healMergeTask,
  healCommandTask,
  healDispositionTask,
  type AssembleAgentPromptInput
} from './agent-prompt'

const CONSTITUTION: EffectiveConstitutionRule[] = [
  { packId: 'p', itemId: 'test-first', name: '测试先行', text: '先写测试再实现。' },
  { packId: 'p', itemId: 'decouple', name: '解耦', text: '低耦合高内聚。' }
]

function input(over: Partial<AssembleAgentPromptInput> = {}): AssembleAgentPromptInput {
  return {
    language: 'zh',
    promptText: '实现这个需求',
    constitution: CONSTITUTION,
    writableScope: ['src/'],
    outputs: [{ path: 'docs/spec.md', required: true, templateContent: '## 背景\n## 方案' }],
    ...over
  }
}

describe('assembleAgentPrompt — 回复语言', () => {
  it('恒在且置于最前；zh / en 给对应语言指令', () => {
    const zh = assembleAgentPrompt(input({ language: 'zh' }))
    expect(zh.indexOf(PROMPT_SECTIONS.language)).toBe(0)
    expect(zh).toContain(REPLY_LANGUAGE_INSTRUCTION.zh)
    const en = assembleAgentPrompt(input({ language: 'en' }))
    expect(en).toContain(REPLY_LANGUAGE_INSTRUCTION.en)
    expect(en).not.toContain(REPLY_LANGUAGE_INSTRUCTION.zh)
  })
})

describe('heal / 处置 任务段', () => {
  it('合并冲突版含仓/分支/主线、冲突文件、保留两侧意图、不要自己提交', () => {
    const t = healMergeTask({ repo: 'web', branch: 'feat-x', base: 'main', conflictFiles: ['src/a.ts', 'src/b.ts'] })
    expect(t).toContain('web')
    expect(t).toContain('feat-x')
    expect(t).toContain('main')
    expect(t).toContain('src/a.ts')
    expect(t).toContain('src/b.ts')
    expect(t).toContain('两侧意图')
    expect(t).toContain('不要自己提交')
  })

  it('命令失败版含命令、输出、改到通过、不要自己提交、非代码问题请求决策', () => {
    const t = healCommandTask({ repo: 'api', branch: 'feat-y', command: 'npm test', output: 'FAIL foo.test' })
    expect(t).toContain('npm test')
    expect(t).toContain('FAIL foo.test')
    expect(t).toContain('不要自己提交')
    expect(t).toContain('请求决策')
  })

  it('处置版含失败背景、用户意见、改/答疑双路', () => {
    const t = healDispositionTask({ repo: 'web', branch: 'feat-z', background: 'push 无远端', userInput: '这是什么意思' })
    expect(t).toContain('push 无远端')
    expect(t).toContain('这是什么意思')
    expect(t).toContain('把处置建议作为决策选项交回用户')
  })

  it('确定可复现（同输入同输出）', () => {
    const a = healMergeTask({ repo: 'web', branch: 'b', base: 'main', conflictFiles: ['x'] })
    const b = healMergeTask({ repo: 'web', branch: 'b', base: 'main', conflictFiles: ['x'] })
    expect(a).toBe(b)
  })

  it('作为 promptText 喂 assembleAgentPrompt 时公共输入（宪法/协议）仍在、任务段即 heal 文本', () => {
    const task = healMergeTask({ repo: 'web', branch: 'b', base: 'main', conflictFiles: ['src/a.ts'] })
    const out = assembleAgentPrompt(input({ promptText: task }))
    expect(out).toContain(PROMPT_SECTIONS.constitution)
    expect(out).toContain(PROMPT_SECTIONS.protocol)
    expect(out).toContain('src/a.ts')
    // 任务段紧接 # 任务 标题
    expect(out).toContain(`${PROMPT_SECTIONS.task}\n${task}`)
  })
})

describe('assembleAgentPrompt — 层次顺序', () => {
  it('全层齐备时按 回复语言→宪法→任务→需求卡占位→可写范围→产出 顺序产出', () => {
    const out = assembleAgentPrompt(input())
    const idx = (s: string): number => out.indexOf(s)
    expect(idx(PROMPT_SECTIONS.language)).toBeLessThan(idx(PROMPT_SECTIONS.constitution))
    expect(idx(PROMPT_SECTIONS.constitution)).toBeGreaterThanOrEqual(0)
    expect(idx(PROMPT_SECTIONS.constitution)).toBeLessThan(idx(PROMPT_SECTIONS.task))
    expect(idx(PROMPT_SECTIONS.task)).toBeLessThan(idx(PROMPT_SECTIONS.card))
    expect(idx(PROMPT_SECTIONS.card)).toBeLessThan(idx(PROMPT_SECTIONS.writableScope))
    expect(idx(PROMPT_SECTIONS.writableScope)).toBeLessThan(idx(PROMPT_SECTIONS.outputs))
  })

  it('各分节带标志性内容（宪法条目、任务文本、产出路径）', () => {
    const out = assembleAgentPrompt(input())
    expect(out).toContain('测试先行')
    expect(out).toContain('实现这个需求')
    expect(out).toContain('docs/spec.md')
  })

  it('客观门不进 prompt 文本（没有「客观门」分节）', () => {
    expect(assembleAgentPrompt(input())).not.toContain('客观门')
  })
})

describe('assembleAgentPrompt — 需求卡只注入描述、用 \'\'\' 框住', () => {
  it('预览态（无真实卡）：# 你当前正在处理这个需求 + \'\'\'围栏 + 描述占位槽；不含标题/类型/关系字段', () => {
    const out = assembleAgentPrompt(input())
    expect(out).toContain(PROMPT_SECTIONS.card)
    expect(out).toContain(CARD_DESCRIPTION_SLOT)
    // 描述被 '''围栏框住
    expect(out).toContain(`${PROMPT_SECTIONS.card}\n'''\n${CARD_DESCRIPTION_SLOT}\n'''`)
    // 不再注入标题/类型/关系子标题
    expect(out).not.toContain('## 标题')
    expect(out).not.toContain('## 类型')
    expect(out).not.toContain('## 关系')
  })
})

describe('assembleAgentPrompt — 产出（带引导语与文件框架）', () => {
  it('产出区有引导语（让 AI 知道这是要产出的文件、按模板写、删注释）', () => {
    const out = assembleAgentPrompt(input())
    expect(out).toContain(PROMPT_MARKERS.outputsIntro)
  })
  it('每个产出标清路径与必选/可选', () => {
    const out = assembleAgentPrompt(input({ outputs: [{ path: 'a.md', required: false, templateContent: 'X' }] }))
    expect(out).toContain('产出文件：a.md')
    expect(out).toContain('可选')
  })
  it('模板为 ref 时拼入已解析内容、附前导语并用 ``` 围栏包住模板原文', () => {
    const out = assembleAgentPrompt(input({ outputs: [{ path: 'a.md', required: true, templateContent: '## 章节X' }] }))
    expect(out).toContain('## 章节X')
    expect(out).toContain(PROMPT_MARKERS.templateLead)
    expect(out).toContain('```markdown')
  })
  it('模板为 none（templateContent=null）注「无固定模板」', () => {
    const out = assembleAgentPrompt(input({ outputs: [{ path: 'a.md', required: true, templateContent: null }] }))
    expect(out).toContain(PROMPT_MARKERS.noTemplate)
  })
  it('ref 解析不到（templateContent=undefined）降级提示而不崩', () => {
    const out = assembleAgentPrompt(input({ outputs: [{ path: 'a.md', required: true, templateContent: undefined }] }))
    expect(out).toContain(PROMPT_MARKERS.unresolvedTemplate)
  })
  it('产出路径为空给「未指定路径」提示而非裸括号', () => {
    const out = assembleAgentPrompt(input({ outputs: [{ path: '', required: false, templateContent: null }] }))
    expect(out).toContain(PROMPT_MARKERS.outputNoPath)
  })
})

describe('assembleAgentPrompt — 空层省略 / 默认说明', () => {
  it('宪法为空整节省略', () => {
    expect(assembleAgentPrompt(input({ constitution: [] }))).not.toContain(PROMPT_SECTIONS.constitution)
  })
  it('产出为空整节省略', () => {
    expect(assembleAgentPrompt(input({ outputs: [] }))).not.toContain(PROMPT_SECTIONS.outputs)
  })
  it('可写范围为空给「整条分支可写」默认说明（不省略该节）', () => {
    const out = assembleAgentPrompt(input({ writableScope: [] }))
    expect(out).toContain(PROMPT_SECTIONS.writableScope)
    expect(out).toContain(PROMPT_MARKERS.scopeWholeBranch)
  })
  it('promptText=null（读文件失败）显错而不崩', () => {
    const out = assembleAgentPrompt(input({ promptText: null }))
    expect(out).toContain(PROMPT_MARKERS.promptUnreadable)
  })
  it('不留空标题（无内容的节不出现其标题）', () => {
    const out = assembleAgentPrompt({ language: 'zh', promptText: 'x', constitution: [], writableScope: [], outputs: [] })
    expect(out).not.toContain(PROMPT_SECTIONS.constitution)
    expect(out).not.toContain(PROMPT_SECTIONS.outputs)
  })
})

describe('assembleAgentPrompt — 引擎交互协议层（恒在，握手路径注入）', () => {
  it('协议层恒在，即便其它层皆空（无卡、无产出、无宪法）', () => {
    const out = assembleAgentPrompt({ language: 'zh', promptText: '', constitution: [], writableScope: [], outputs: [] })
    expect(out).toContain(PROMPT_SECTIONS.protocol)
    expect(out).toContain(engineProtocolBody())
  })

  it('协议层含握手指令：status/decision/repos/note、stdout 仅展示', () => {
    const out = assembleAgentPrompt(input())
    expect(out).toContain('status')
    expect(out).toContain('need-decision')
    expect(out).toContain('decision')
    expect(out).toContain('note')
    expect(out).toContain('stdout')
  })

  it('注入 handshakePath → 协议层用该绝对路径；缺省用占位（预览态）', () => {
    const withPath = assembleAgentPrompt(input({ handshakePath: 'C:/ud/engine-runs/r1/handshake/plan.json' }))
    expect(withPath).toContain('C:/ud/engine-runs/r1/handshake/plan.json')
    const preview = assembleAgentPrompt(input())
    expect(preview).toContain('运行时注入')
  })

  it('协议层位于最末（产出之后）', () => {
    const out = assembleAgentPrompt(input())
    expect(out.indexOf(PROMPT_SECTIONS.outputs)).toBeLessThan(out.indexOf(PROMPT_SECTIONS.protocol))
    const noOut = assembleAgentPrompt(input({ outputs: [] }))
    expect(noOut.indexOf(PROMPT_SECTIONS.writableScope)).toBeLessThan(noOut.indexOf(PROMPT_SECTIONS.protocol))
  })
})

describe('assembleAgentPrompt — 涉及成员仓层（执行期注入多仓布局）', () => {
  it('给 repos 则输出各仓名/标签/路径与主-额外目录标注', () => {
    const out = assembleAgentPrompt(
      input({
        repos: [
          { name: 'web', tag: '前端', path: '/wt/web', primary: true },
          { name: 'api', tag: '后端', path: '/wt/api' }
        ]
      })
    )
    expect(out).toContain(PROMPT_SECTIONS.repos)
    expect(out).toContain('web（前端）：/wt/web（当前工作目录）')
    expect(out).toContain('api（后端）：/wt/api（额外工作目录（--add-dir））')
  })
  it('不给 repos（单仓/预览）则省略该层', () => {
    expect(assembleAgentPrompt(input())).not.toContain(PROMPT_SECTIONS.repos)
  })
})

describe('assembleAgentPrompt — 执行期注入真实卡（只描述、空则省整节）', () => {
  it('给真实卡：只注入描述正文（围栏框住），不含标题/类型/占位', () => {
    const out = assembleAgentPrompt(input({ card: { title: '登录页', type: 'feature', description: '实现邮箱登录' } }))
    expect(out).toContain(`${PROMPT_SECTIONS.card}\n'''\n实现邮箱登录\n'''`)
    expect(out).not.toContain('登录页') // 标题不注入
    expect(out).not.toContain(CARD_DESCRIPTION_SLOT) // 有真值 → 不留占位
  })
  it('执行期描述为空 → 整节省略（不把占位漏给 AI）', () => {
    const out = assembleAgentPrompt(input({ card: { title: 'x', description: '' } }))
    expect(out).not.toContain(PROMPT_SECTIONS.card)
    expect(out).not.toContain(CARD_DESCRIPTION_SLOT)
  })
})

describe('assembleAgentPrompt — 确定可复现', () => {
  it('相同输入多次调用逐字相同', () => {
    expect(assembleAgentPrompt(input())).toBe(assembleAgentPrompt(input()))
  })
})

describe('resolveOutputs — 规则库模板引用解析', () => {
  const packs: RulePack[] = [
    {
      id: 'pk',
      name: { zh: '包', en: 'Pack' },
      items: [
        { kind: 'output-template', id: 'tpl', name: { zh: '规格模板', en: 'Spec' }, content: { zh: '## 背景', en: '## Background' } },
        { kind: 'objective-check', id: 'chk', name: { zh: '跑测试', en: 'Run tests' }, command: 'npm test' }
      ]
    }
  ]

  it('产出 none → null；ref 命中 → 按语言解析内容；ref 缺失 → undefined；ref 指向非模板条目 → undefined', () => {
    const outputs: WorkflowOutput[] = [
      { destination: { kind: 'file', path: 'a.md' }, template: { kind: 'none' }, required: false },
      { destination: { kind: 'file', path: 'b.md' }, template: { kind: 'ref', ref: { packId: 'pk', itemId: 'tpl' } }, required: true },
      { destination: { kind: 'file', path: 'c.md' }, template: { kind: 'ref', ref: { packId: 'pk', itemId: 'gone' } }, required: false },
      { destination: { kind: 'file', path: 'd.md' }, template: { kind: 'ref', ref: { packId: 'pk', itemId: 'chk' } }, required: false }
    ]
    const r = resolveOutputs(outputs, packs, 'zh')
    expect(r[0].templateContent).toBeNull()
    expect(r[1].templateContent).toBe('## 背景')
    expect(r[2].templateContent).toBeUndefined()
    expect(r[3].templateContent).toBeUndefined()
    // 按语言解析：en 取英文模板
    expect(resolveOutputs(outputs, packs, 'en')[1].templateContent).toBe('## Background')
  })
})
