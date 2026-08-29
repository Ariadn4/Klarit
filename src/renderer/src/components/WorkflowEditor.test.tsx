import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WorkflowDefinition, WorkflowNode, WorkflowValidation } from '@shared/types'
import type { RulePack } from '@shared/rule-pack'
import { WorkflowEditor } from './WorkflowEditor'

function fixture(): WorkflowDefinition {
  return {
    id: 'wf',
    name: { zh: '流程A' },
    description: {},
    stages: [
      { id: 's1', name: { zh: '开发' } },
      { id: 's2', name: { zh: '交付' } }
    ],
    nodes: [
      {
        id: 'n1',
        name: { zh: '写代码' },
        stageId: 's1',
        executor: { kind: 'agent', instruction: { kind: 'inline', text: 'do it' } },
        outputs: []
      }
    ]
  }
}

let saveResult: WorkflowValidation

function installKlarit(over: Record<string, unknown> = {}): void {
  const api = {
    getWorkflow: vi.fn(async () => fixture()),
    saveWorkflow: vi.fn(async () => saveResult),
    createSkillFile: vi.fn(async (_id: string, name: string) => `skills/${name}`),
    importSkillFile: vi.fn(async () => 'skills/imported.md'),
    readSkillFile: vi.fn(async () => '# 审查清单'),
    previewAgentNodePrompt: vi.fn(async () => '# 宪法\n- 测试先行\n\n# 任务\n拼装结果'),
    ...over
  }
  ;(globalThis as unknown as { window: { klarit: unknown } }).window.klarit = api
}

beforeEach(() => {
  saveResult = { ok: true }
  installKlarit()
})

function renderEditor() {
  return render(
    <WorkflowEditor workflowId="wf" others={[]} onClose={() => {}} onSaved={() => {}} />
  )
}

describe('WorkflowEditor 草稿态（initialDef）', () => {
  it('给了 initialDef → 用它种子、不按 id 从库读', async () => {
    const getWorkflow = vi.fn(async () => fixture())
    installKlarit({ getWorkflow })
    const draft: WorkflowDefinition = { ...fixture(), id: 'draft-x', name: { zh: '草稿流' } }
    render(<WorkflowEditor workflowId="draft-x" initialDef={draft} others={[]} onClose={() => {}} onSaved={() => {}} />)
    // 渲染的是传入的草稿定义
    expect(await screen.findByDisplayValue('草稿流')).toBeInTheDocument()
    // 未走 getWorkflow（草稿不落库、不从库读）
    expect(getWorkflow).not.toHaveBeenCalled()
  })

  const footerLabels = { close: '关闭', save: '保存为正式工作流', update: '更新工作流', saveAndActive: '保存并设为本项目工作流' }

  it('chromeless 未激活：主按钮「保存并设为本项目工作流」一键保存并激活（无二次确认）', async () => {
    const saveWorkflow = vi.fn(async (_def: WorkflowDefinition) => ({ ok: true }) as WorkflowValidation)
    const onSetActive = vi.fn(async (_id: string) => {})
    installKlarit({ saveWorkflow })
    const draft: WorkflowDefinition = { ...fixture(), id: 'draft-x', name: { zh: '草稿流' } }
    render(
      <WorkflowEditor workflowId="draft-x" initialDef={draft} chromeless footerLabels={footerLabels} onSetActive={onSetActive} others={[]} onClose={() => {}} onSaved={() => {}} />
    )
    await screen.findByDisplayValue('草稿流')
    // 无独立「设置为本项目工作流」按钮、无「保存为正式工作流」按钮——合并成一个主按钮
    expect(screen.queryByRole('button', { name: '设置为本项目工作流' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存为正式工作流' })).not.toBeInTheDocument()
    // 一键：点主按钮 → 先保存入库、再激活（无二次确认）
    await userEvent.click(screen.getByRole('button', { name: '保存并设为本项目工作流' }))
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onSetActive).toHaveBeenCalledWith('draft-x'))
  })

  it('chromeless 保存校验不过 → 不激活', async () => {
    const saveWorkflow = vi.fn(async (_def: WorkflowDefinition) => ({ ok: false, reason: '不合法' }) as WorkflowValidation)
    const onSetActive = vi.fn(async (_id: string) => {})
    installKlarit({ saveWorkflow })
    const draft: WorkflowDefinition = { ...fixture(), id: 'draft-x', name: { zh: '草稿流' } }
    render(
      <WorkflowEditor workflowId="draft-x" initialDef={draft} chromeless footerLabels={footerLabels} onSetActive={onSetActive} others={[]} onClose={() => {}} onSaved={() => {}} />
    )
    await screen.findByDisplayValue('草稿流')
    await userEvent.click(screen.getByRole('button', { name: '保存并设为本项目工作流' }))
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalledTimes(1))
    expect(onSetActive).not.toHaveBeenCalled()
  })

  it('chromeless isActive：已是激活工作流 → 主按钮仅「更新工作流」、点击只保存不激活', async () => {
    const saveWorkflow = vi.fn(async (_def: WorkflowDefinition) => ({ ok: true }) as WorkflowValidation)
    const onSetActive = vi.fn(async (_id: string) => {})
    installKlarit({ saveWorkflow })
    const draft: WorkflowDefinition = { ...fixture(), id: 'draft-x', name: { zh: '草稿流' } }
    render(
      <WorkflowEditor workflowId="draft-x" initialDef={draft} chromeless isActive footerLabels={footerLabels} onSetActive={onSetActive} others={[]} onClose={() => {}} onSaved={() => {}} />
    )
    await screen.findByDisplayValue('草稿流')
    // 已激活：不显「保存并设为本项目工作流」，主按钮是「更新工作流」
    expect(screen.queryByRole('button', { name: '保存并设为本项目工作流' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '更新工作流' }))
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalledTimes(1))
    expect(onSetActive).not.toHaveBeenCalled()
  })

  it('chromeless libraryFirst：库里读不到（已删）→ 回落草稿，不卡加载中', async () => {
    const getWorkflow = vi.fn(async () => null) // 模拟已删
    installKlarit({ getWorkflow })
    const draft: WorkflowDefinition = { ...fixture(), id: 'draft-x', name: { zh: '草稿流' } }
    render(
      <WorkflowEditor workflowId="draft-x" initialDef={draft} libraryFirst chromeless footerLabels={footerLabels} others={[]} onClose={() => {}} onSaved={() => {}} />
    )
    // 读库返回 null → 回落到草稿定义（显草稿名），而非一直「加载中」
    expect(await screen.findByDisplayValue('草稿流')).toBeInTheDocument()
    expect(getWorkflow).toHaveBeenCalledWith('draft-x')
  })

  it('草稿态保存 → 调 saveWorkflow 落库、回调 onSaved', async () => {
    const saveWorkflow = vi.fn(async (_def: WorkflowDefinition) => ({ ok: true }) as WorkflowValidation)
    const onSaved = vi.fn()
    installKlarit({ saveWorkflow })
    const draft: WorkflowDefinition = { ...fixture(), id: 'draft-x', name: { zh: '草稿流' } }
    render(<WorkflowEditor workflowId="draft-x" initialDef={draft} others={[]} onClose={() => {}} onSaved={onSaved} />)
    await screen.findByDisplayValue('草稿流')
    await userEvent.click(screen.getByRole('button', { name: /保存/ }))
    await waitFor(() => expect(saveWorkflow).toHaveBeenCalled())
    expect(saveWorkflow.mock.calls[0][0].id).toBe('draft-x')
    expect(onSaved).toHaveBeenCalled()
  })
})

/** 节点改为「点击进入详情视图」编辑：先点节点行进入详情，才能看到/编辑节点字段。 */
async function enterNode(name = '写代码'): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: `编辑节点 ${name}` }))
}
async function backToNodes(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /返回节点列表/ }))
}

describe('WorkflowEditor 表单编辑', () => {
  it('各字段按类型呈现并填入当前值', async () => {
    renderEditor()
    expect(await screen.findByLabelText('工作流名')).toHaveValue('流程A')
    await enterNode()
    expect(await screen.findByLabelText('节点名')).toHaveValue('写代码')
    expect(screen.getByLabelText('执行者类型')).toHaveValue('agent')
    expect(screen.getByLabelText('prompt')).toHaveValue('do it')
  })

  it('切换执行者类型展示对应驱动指令字段', async () => {
    renderEditor()
    await enterNode()
    await userEvent.selectOptions(screen.getByLabelText('执行者类型'), 'engine')
    expect(screen.getByText('引擎操作 spec')).toBeInTheDocument()
    expect(screen.queryByLabelText('prompt')).not.toBeInTheDocument()
  })

  it('切到使用文件时只展示新建/导入按钮，无路径输入', async () => {
    renderEditor()
    await enterNode()
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '驱动指令形态' })).getByRole('radio', { name: '使用文件' }))
    expect(screen.queryByLabelText('prompt')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建 skill' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入文件' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('skills/xxx.md')).not.toBeInTheDocument()
  })

  it('新建 skill 后只展示文件名（非路径），点名称查看内容', async () => {
    renderEditor()
    await enterNode()
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '驱动指令形态' })).getByRole('radio', { name: '使用文件' }))
    await userEvent.click(screen.getByRole('button', { name: '新建 skill' }))
    await userEvent.type(screen.getByLabelText('skill 文件名'), 'review.md')
    await userEvent.type(screen.getByLabelText('skill 内容'), '# 审查')
    await userEvent.click(screen.getByRole('button', { name: '保存 skill' }))
    expect(window.klarit.createSkillFile).toHaveBeenCalledWith('wf', 'review.md', '# 审查')
    // 展示文件名而非路径
    const nameBtn = await screen.findByRole('button', { name: 'review.md' })
    expect(screen.queryByText('skills/review.md')).not.toBeInTheDocument()
    // 点击文件名查看内容
    await userEvent.click(nameBtn)
    expect(window.klarit.readSkillFile).toHaveBeenCalledWith('wf', 'skills/review.md')
    await waitFor(() => expect(screen.getByText('# 审查清单')).toBeInTheDocument())
  })

  it('导入外部文件后展示文件名', async () => {
    renderEditor()
    await enterNode()
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '驱动指令形态' })).getByRole('radio', { name: '使用文件' }))
    await userEvent.click(screen.getByRole('button', { name: '导入文件' }))
    expect(window.klarit.importSkillFile).toHaveBeenCalledWith('wf')
    await waitFor(() => expect(screen.getByRole('button', { name: 'imported.md' })).toBeInTheDocument())
  })

  it('可写范围默认无输入框；加一个后路径非法实时标红且保存被阻止', async () => {
    renderEditor()
    await enterNode()
    // 默认无可写范围输入
    expect(screen.queryByLabelText('可写范围 1')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /加可写路径/ }))
    const pathInput = screen.getByLabelText('可写范围 1')
    await userEvent.type(pathInput, '/abs/x')
    expect(pathInput).toHaveAttribute('aria-invalid', 'true')
    await backToNodes()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(window.klarit.saveWorkflow).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('节点可选所属阶段，列出全部阶段', async () => {
    renderEditor()
    await enterNode()
    const stageSelect = screen.getByLabelText('所属阶段')
    expect(stageSelect).toHaveValue('s1')
    await userEvent.selectOptions(stageSelect, 's2')
    expect(stageSelect).toHaveValue('s2')
  })

  it('加产出：file 路径输入 + 模板只「不声明/从规则库引用」', async () => {
    renderEditor()
    await enterNode()
    await userEvent.click(screen.getByRole('button', { name: '加产出' }))
    expect(screen.getByLabelText('产出路径 1')).toBeInTheDocument()
    // 模板默认不声明；只有两态、不再有「手写/使用文件」嵌入
    const tplGroup = screen.getByRole('radiogroup', { name: '产出模板形态 1' })
    expect(within(tplGroup).queryByRole('radio', { name: '手写' })).not.toBeInTheDocument()
    expect(within(tplGroup).queryByRole('radio', { name: '使用文件' })).not.toBeInTheDocument()
    await userEvent.click(within(tplGroup).getByRole('radio', { name: '从规则库引用' }))
    // 引用态出现选择器 + 新建按钮
    expect(screen.getByLabelText('产出模板引用 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建' })).toBeInTheDocument()
  })

  it('加检查项：自动校验只有校验命令（无说明）；切人工评审直接显示动作按钮文案+命令', async () => {
    renderEditor()
    await enterNode()
    await userEvent.click(screen.getByRole('button', { name: '加检查项' }))
    // 默认 auto：有校验命令、无「说明」字段
    expect(screen.getByLabelText('校验命令 1')).toBeInTheDocument()
    expect(screen.queryByLabelText('检查项说明 1')).not.toBeInTheDocument()
    // 切 manual：直接出现一行动作按钮（文案 + 命令），无需先点「加」
    await userEvent.selectOptions(screen.getByLabelText('检查项类型 1'), 'manual')
    expect(screen.queryByLabelText('校验命令 1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('动作名称 1.1')).toBeInTheDocument()
    expect(screen.getByLabelText('动作命令 1.1')).toBeInTheDocument()
    // 可再加一行
    await userEvent.click(screen.getByRole('button', { name: '加动作按钮' }))
    expect(screen.getByLabelText('动作名称 1.2')).toBeInTheDocument()
  })

  it('产出模板与自动校验可「从规则库引用」，选择器按类型列条目', async () => {
    const rulePacks: RulePack[] = [
      {
        id: 'p1',
        name: { zh: 'P1', en: 'P1' },
        items: [
          { kind: 'output-template', id: 'tpl', name: { zh: '规格模板', en: 'Spec' }, content: { zh: '## x', en: '## x' } },
          { kind: 'objective-check', id: 'chk', name: { zh: '跑测试', en: 'Run tests' }, command: 'npm test' }
        ]
      }
    ]
    render(<WorkflowEditor workflowId="wf" others={[]} rulePacks={rulePacks} onClose={() => {}} onSaved={() => {}} />)
    await enterNode()
    // 产出模板：切「规则库」→ 引用选择器列出 output-template 条目
    await userEvent.click(screen.getByRole('button', { name: '加产出' }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '产出模板形态 1' })).getByRole('radio', { name: '从规则库引用' }))
    const tplRef = screen.getByLabelText('产出模板引用 1')
    expect(within(tplRef).getByRole('option', { name: '规格模板' })).toBeInTheDocument()
    // 自动校验：切「从规则库引用」→ 引用选择器列出 objective-check 条目
    await userEvent.click(screen.getByRole('button', { name: '加检查项' }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '校验形态 1' })).getByRole('radio', { name: '从规则库引用' }))
    const chkRef = screen.getByLabelText('校验引用 1')
    expect(within(chkRef).getByRole('option', { name: '跑测试' })).toBeInTheDocument()
    expect(screen.queryByLabelText('校验命令 1')).not.toBeInTheDocument()
  })

  it('模板「新建」把内容写进规则库并引用它', async () => {
    const saveRulePack = vi.fn(async (_pack: unknown) => ({ ok: true }))
    const allRulePacks = vi.fn(async () => [{ id: 'p1', name: { en: 'P1' }, items: [] }])
    installKlarit({ saveRulePack, allRulePacks })
    const rulePacks: RulePack[] = [{ id: 'p1', name: { en: 'P1' }, items: [] }]
    render(<WorkflowEditor workflowId="wf" others={[]} rulePacks={rulePacks} onClose={() => {}} onSaved={() => {}} />)
    await enterNode()
    await userEvent.click(screen.getByRole('button', { name: '加产出' }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '产出模板形态 1' })).getByRole('radio', { name: '从规则库引用' }))
    await userEvent.click(screen.getByRole('button', { name: '新建' }))
    await userEvent.type(screen.getByLabelText('模板条目名称 1'), '我的模板')
    await userEvent.type(screen.getByLabelText('模板条目内容 1'), '## 背景')
    await userEvent.click(screen.getByRole('button', { name: '保存到规则库' }))
    await waitFor(() => expect(saveRulePack).toHaveBeenCalled())
    const savedPack = saveRulePack.mock.calls[0][0] as unknown as { items: Array<{ kind: string; name: Record<string, string> }> }
    // 单语言内嵌表单按当前界面语言（zh）写入语言表
    expect(savedPack.items.some((it) => it.kind === 'output-template' && it.name.zh === '我的模板')).toBe(true)
  })

  it('engine 操作为下拉（含内置操作）', async () => {
    renderEditor()
    await enterNode()
    await userEvent.selectOptions(screen.getByLabelText('执行者类型'), 'engine')
    const opSelect = screen.getByLabelText('引擎操作')
    expect(opSelect.tagName).toBe('SELECT')
    expect(within(opSelect).getByRole('option', { name: 'create-branch' })).toBeInTheDocument()
  })

  it('agent 执行配置：工具下拉来自 detectedAgents，模型建议随工具联动 + 额外参数', async () => {
    render(
      <WorkflowEditor
        workflowId="wf"
        others={[]}
        detectedAgents={[
          { id: 'claude-code', name: 'Claude Code', executablePath: 'C:\bin\claude.exe', models: [{ id: 'claude-opus-4-8', name: 'Opus 4.8' }] }
        ]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )
    await enterNode()
    const toolSelect = screen.getByLabelText('执行工具')
    expect(within(toolSelect).getByRole('option', { name: '跟随全局（不声明）' })).toBeInTheDocument()
    expect(within(toolSelect).getByRole('option', { name: 'Claude Code' })).toBeInTheDocument()
    // 选工具后，模型 combobox 聚焦弹出该工具的完整建议清单（自绘弹层，不按已有值过滤）
    await userEvent.selectOptions(toolSelect, 'claude-code')
    const modelInput = screen.getByLabelText('执行模型')
    expect(modelInput.tagName).toBe('INPUT')
    await userEvent.click(modelInput)
    expect(screen.getByRole('option', { name: /claude-opus-4-8/ })).toBeInTheDocument()
    // 可手输建议清单外的任意模型 id
    await userEvent.type(modelInput, 'claude-fable-6-preview')
    expect(modelInput).toHaveValue('claude-fable-6-preview')
    expect(screen.getByLabelText('额外参数')).toBeInTheDocument()
  })

  it('agent 执行配置：effort 下拉含跟随全局与全五档，可声明节点覆盖', async () => {
    renderEditor()
    await enterNode()
    const effortSelect = screen.getByLabelText('执行 effort')
    expect(within(effortSelect).getByRole('option', { name: '跟随全局（不声明）' })).toBeInTheDocument()
    expect(within(effortSelect).getByRole('option', { name: 'max' })).toBeInTheDocument()
    await userEvent.selectOptions(effortSelect, 'max')
    expect(effortSelect).toHaveValue('max')
  })

  it('阶段可新增，节点的阶段下拉随之更新', async () => {
    renderEditor()
    await screen.findByRole('button', { name: '编辑节点 写代码' })
    await userEvent.click(screen.getByRole('button', { name: /加阶段/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: '阶段名 3' })).toBeInTheDocument())
  })

  it('加节点 / 删节点', async () => {
    renderEditor()
    await screen.findByRole('button', { name: '编辑节点 写代码' })
    await userEvent.click(screen.getByRole('button', { name: /加节点/ }))
    // 加节点后进入新节点详情；返回列表再核对数量
    await backToNodes()
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^编辑节点/ })).toHaveLength(2))
    await userEvent.click(screen.getByRole('button', { name: '删除节点 写代码' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^编辑节点/ })).toHaveLength(1))
  })

  it('保存合法定义调用 saveWorkflow 并提示已保存', async () => {
    renderEditor()
    await screen.findByRole('button', { name: '编辑节点 写代码' })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(window.klarit.saveWorkflow).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('已保存')).toBeInTheDocument())
  })

  it('保存非法定义（空显示名）被阻止并提示原因', async () => {
    renderEditor()
    const nameInput = await screen.findByLabelText('工作流名')
    await userEvent.clear(nameInput)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(window.klarit.saveWorkflow).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('建分支无删分支：点保存弹模态提示且不写盘', async () => {
    // 一个含 create-branch 却无 delete-branch-worktree 的工作流（结构合法、分支配对不过）。
    installKlarit({
      getWorkflow: vi.fn(async () => ({
        id: 'wf',
        name: { zh: '流程A' },
        stages: [{ id: 's1', name: { zh: '准备' } }],
        nodes: [
          { id: 'c', name: { zh: '建分支' }, stageId: 's1', executor: { kind: 'engine', operation: 'create-branch' }, outputs: [] }
        ]
      }))
    })
    renderEditor()
    await screen.findByRole('button', { name: '编辑节点 建分支' })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/delete-branch/)).toBeInTheDocument()
    expect(window.klarit.saveWorkflow).not.toHaveBeenCalled()
    // 「知道了」关闭模态
    await userEvent.click(within(dialog).getByRole('button', { name: '知道了' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('建分支且有删分支：点保存不弹模态、正常写盘', async () => {
    installKlarit({
      getWorkflow: vi.fn(async () => ({
        id: 'wf',
        name: { zh: '流程A' },
        stages: [{ id: 's1', name: { zh: '准备' } }],
        nodes: [
          { id: 'c', name: { zh: '建分支' }, stageId: 's1', executor: { kind: 'engine', operation: 'create-branch' }, outputs: [] },
          { id: 'd', name: { zh: '删分支' }, stageId: 's1', executor: { kind: 'engine', operation: 'delete-branch-worktree' }, outputs: [] }
        ]
      }))
    })
    renderEditor()
    await screen.findByRole('button', { name: '编辑节点 建分支' })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.klarit.saveWorkflow).toHaveBeenCalled()
  })
})

describe('节点设置块按执行者能力呈现', () => {
  it('agent 节点呈现可写范围/产出/检查三块', async () => {
    renderEditor()
    await enterNode()
    expect(screen.getByRole('button', { name: /加可写路径/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加产出' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加检查项' })).toBeInTheDocument()
  })

  it('engine 节点选中 create-branch：三块均不呈现', async () => {
    renderEditor()
    await enterNode()
    await userEvent.selectOptions(screen.getByLabelText('执行者类型'), 'engine')
    await userEvent.selectOptions(screen.getByLabelText('引擎操作'), 'create-branch')
    expect(screen.queryByRole('button', { name: /加可写路径/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加产出' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加检查项' })).not.toBeInTheDocument()
  })

  it('engine 节点未选操作：三块均不呈现', async () => {
    renderEditor()
    await enterNode()
    await userEvent.selectOptions(screen.getByLabelText('执行者类型'), 'engine')
    expect(screen.getByLabelText('引擎操作')).toHaveValue('')
    expect(screen.queryByRole('button', { name: /加可写路径/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加产出' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加检查项' })).not.toBeInTheDocument()
  })

  it('subworkflow 节点：三块均不呈现（由被调工作流内部节点承担）', async () => {
    // 需有「其它工作流」可选，subworkflow 执行者才有目标。
    render(
      <WorkflowEditor
        workflowId="wf"
        others={[{ id: 'other', name: { zh: '另一条工作流' } }]}
        onClose={() => {}}
        onSaved={() => {}}
      />
    )
    await enterNode()
    await userEvent.selectOptions(screen.getByLabelText('执行者类型'), 'subworkflow')
    expect(screen.getByLabelText('目标工作流')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /加可写路径/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加产出' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加检查项' })).not.toBeInTheDocument()
  })
})

/** 一个引擎操作 archive-docs 的节点（带/不带 archiveDocs 由参数控制）。 */
function archiveDocsFixture(archiveDocs?: Array<{ path: string; kind: 'dynamic' | 'snapshot' }>): WorkflowDefinition {
  return {
    id: 'wf',
    name: { zh: '流程A' },
    description: {},
    stages: [{ id: 's1', name: { zh: '开发' } }],
    nodes: [
      {
        id: 'ar',
        name: { zh: '归档文档' },
        stageId: 's1',
        executor: { kind: 'engine', operation: 'archive-docs', ...(archiveDocs ? { archiveDocs } : {}) },
        outputs: []
      }
    ]
  }
}

describe('WorkflowEditor archive-docs 归档文档清单', () => {
  it('archive-docs 节点逐条展示路径 + 动态/快照，可编辑', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => archiveDocsFixture([{ path: 'README.md', kind: 'dynamic' }])) })
    renderEditor()
    await enterNode('归档文档')
    expect(screen.getByText('归档文档清单')).toBeInTheDocument()
    expect(screen.getByLabelText('归档文档路径 1')).toHaveValue('README.md')
    expect(screen.getByLabelText('归档方式 1')).toHaveValue('dynamic')
  })

  it('加文档：追加一条新条目', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => archiveDocsFixture([{ path: 'README.md', kind: 'dynamic' }])) })
    renderEditor()
    await enterNode('归档文档')
    expect(screen.queryByLabelText('归档文档路径 2')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '加文档' }))
    expect(screen.getByLabelText('归档文档路径 2')).toBeInTheDocument()
    expect(screen.getByLabelText('归档方式 2')).toHaveValue('dynamic')
  })

  it('切换 kind：改动态为快照更新草稿', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => archiveDocsFixture([{ path: 'README.md', kind: 'dynamic' }])) })
    renderEditor()
    await enterNode('归档文档')
    await userEvent.selectOptions(screen.getByLabelText('归档方式 1'), 'snapshot')
    expect(screen.getByLabelText('归档方式 1')).toHaveValue('snapshot')
  })

  it('删除条目：移除该行', async () => {
    installKlarit({
      getWorkflow: vi.fn(async () =>
        archiveDocsFixture([
          { path: 'README.md', kind: 'dynamic' },
          { path: 'CHANGELOG.md', kind: 'snapshot' }
        ])
      )
    })
    renderEditor()
    await enterNode('归档文档')
    expect(screen.getByLabelText('归档文档路径 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '删除归档文档 1' }))
    // 删首条后只剩一行，第二行不再存在
    expect(screen.getByLabelText('归档文档路径 1')).toHaveValue('CHANGELOG.md')
    expect(screen.queryByLabelText('归档文档路径 2')).not.toBeInTheDocument()
  })

  it('改路径：更新草稿', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => archiveDocsFixture([{ path: 'README.md', kind: 'dynamic' }])) })
    renderEditor()
    await enterNode('归档文档')
    const input = screen.getByLabelText('归档文档路径 1')
    await userEvent.clear(input)
    await userEvent.type(input, 'docs/spec.md')
    expect(input).toHaveValue('docs/spec.md')
  })

  it('空配置：显示空态提示（不提登记表），而非什么都不显示', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => archiveDocsFixture()) })
    renderEditor()
    await enterNode('归档文档')
    expect(screen.getByText('归档文档清单')).toBeInTheDocument()
    expect(screen.getByText('尚未指定要归档的文档。')).toBeInTheDocument()
    expect(screen.queryByLabelText('归档文档路径 1')).not.toBeInTheDocument()
  })

  it('非 archive-docs 引擎节点：不显示归档文档清单块', async () => {
    renderEditor()
    await enterNode()
    await userEvent.selectOptions(screen.getByLabelText('执行者类型'), 'engine')
    await userEvent.selectOptions(screen.getByLabelText('引擎操作'), 'create-branch')
    expect(screen.queryByText('归档文档清单')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加文档' })).not.toBeInTheDocument()
  })

  it('非引擎（agent）节点：不显示归档文档清单块', async () => {
    renderEditor()
    await enterNode()
    expect(screen.queryByText('归档文档清单')).not.toBeInTheDocument()
  })
})

describe('查看完整 prompt 预览', () => {
  it('仅 agent 节点详情顶栏出现查看按钮，切到 engine 后消失', async () => {
    renderEditor()
    await enterNode()
    expect(screen.getByRole('button', { name: '查看完整 prompt' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('执行者类型'), 'engine')
    expect(screen.queryByRole('button', { name: '查看完整 prompt' })).not.toBeInTheDocument()
  })

  it('点击按钮打开只读模态、展示拼装结果', async () => {
    renderEditor()
    await enterNode()
    await userEvent.click(screen.getByRole('button', { name: '查看完整 prompt' }))
    const dialog = await screen.findByRole('dialog', { name: '提交给 AI 的完整 prompt' })
    await waitFor(() => expect(within(dialog).getByText(/拼装结果/)).toBeInTheDocument())
    // 关闭后模态消失
    await userEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('预览传入当前（含未保存）编辑中的节点', async () => {
    const preview = vi.fn(async (_id: string, _node: WorkflowNode) => '# 任务\n改后的内容')
    installKlarit({ previewAgentNodePrompt: preview })
    renderEditor()
    await enterNode()
    // 改 prompt 但不保存
    const box = screen.getByLabelText('prompt')
    await userEvent.clear(box)
    await userEvent.type(box, '改后的 prompt')
    await userEvent.click(screen.getByRole('button', { name: '查看完整 prompt' }))
    await screen.findByRole('dialog', { name: '提交给 AI 的完整 prompt' })
    // 传给主进程的节点带着未保存的新文本
    const lastNode = preview.mock.calls.at(-1)?.[1]
    const instr = lastNode?.executor.kind === 'agent' ? lastNode.executor.instruction : undefined
    expect(instr).toEqual({ kind: 'inline', text: '改后的 prompt' })
  })

  it('文件模式：节点 prompt 为 file 形态时也能预览（主进程负责读内容）', async () => {
    const preview = vi.fn(async () => '# 任务\n（无法读取 skill 文件内容）')
    installKlarit({ previewAgentNodePrompt: preview })
    renderEditor()
    await enterNode()
    await userEvent.click(within(screen.getByRole('radiogroup', { name: '驱动指令形态' })).getByRole('radio', { name: '使用文件' }))
    await userEvent.click(screen.getByRole('button', { name: '查看完整 prompt' }))
    const dialog = await screen.findByRole('dialog', { name: '提交给 AI 的完整 prompt' })
    await waitFor(() => expect(within(dialog).getByText(/无法读取 skill 文件内容/)).toBeInTheDocument())
    expect(preview).toHaveBeenCalled()
  })
})

/** 固化操作（merge-branch）在前、其前无任何 manual 门的工作流 —— 触发首条软校验。 */
function finalizeFixture(): WorkflowDefinition {
  return {
    id: 'wf',
    name: { zh: '流程A' },
    description: {},
    stages: [
      { id: 's1', name: { zh: '开发' } },
      { id: 's2', name: { zh: '交付' } }
    ],
    nodes: [
      {
        id: 'n1',
        name: { zh: '写代码' },
        stageId: 's1',
        executor: { kind: 'agent', instruction: { kind: 'inline', text: 'do it' } },
        outputs: []
      },
      {
        id: 'merge',
        name: { zh: '合并' },
        stageId: 's2',
        executor: { kind: 'engine', operation: 'merge-branch' },
        outputs: []
      }
    ]
  }
}

/** 三个节点：manual 门 / auto+manual 门 / 无门 —— 用于节点列表门徽标展示。 */
function gateBadgeFixture(): WorkflowDefinition {
  return {
    id: 'wf',
    name: { zh: '流程A' },
    description: {},
    stages: [{ id: 's1', name: { zh: '开发' } }],
    nodes: [
      {
        id: 'n1',
        name: { zh: '人工评审' },
        stageId: 's1',
        executor: { kind: 'agent', instruction: { kind: 'inline', text: 'do it' } },
        outputs: [],
        gate: [{ kind: 'manual' }]
      },
      {
        id: 'n2',
        name: { zh: '双门' },
        stageId: 's1',
        executor: { kind: 'agent', instruction: { kind: 'inline', text: 'do it' } },
        outputs: [],
        gate: [{ kind: 'auto', check: { kind: 'inline', command: 'npm test' } }, { kind: 'manual' }]
      },
      {
        id: 'n3',
        name: { zh: '无门' },
        stageId: 's1',
        executor: { kind: 'agent', instruction: { kind: 'inline', text: 'do it' } },
        outputs: []
      }
    ]
  }
}

/** 取节点列表某行的容器（按 data-node-id）。 */
function nodeRow(id: string): HTMLElement {
  const row = document.querySelector(`[data-node-id="${id}"]`)
  if (!row) throw new Error(`no node row ${id}`)
  return row as HTMLElement
}

describe('WorkflowEditor 节点列表门徽标', () => {
  it('挂了 manual 门的节点行显示 manual 徽标（展开文案）', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => gateBadgeFixture()) })
    renderEditor()
    await screen.findByRole('button', { name: '编辑节点 人工评审' })
    const row = within(nodeRow('n1'))
    expect(row.getByText('需人工评审')).toBeInTheDocument()
    expect(row.queryByText('自动校验门')).not.toBeInTheDocument()
    expect(row.queryByText('外部门')).not.toBeInTheDocument()
  })

  it('同时挂 auto + manual → 两类徽标都标出（展开文案）', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => gateBadgeFixture()) })
    renderEditor()
    await screen.findByRole('button', { name: '编辑节点 双门' })
    const row = within(nodeRow('n2'))
    expect(row.getByText('自动校验门')).toBeInTheDocument()
    expect(row.getByText('需人工评审')).toBeInTheDocument()
  })

  it('有门节点渲染徽标行（按 group aria-label 可定位）', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => gateBadgeFixture()) })
    renderEditor()
    await screen.findByRole('button', { name: '编辑节点 人工评审' })
    const row = within(nodeRow('n1'))
    expect(row.getByLabelText('门检查点')).toBeInTheDocument()
  })

  it('无门节点行不显示任何门徽标（无徽标行）', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => gateBadgeFixture()) })
    renderEditor()
    await screen.findByRole('button', { name: '编辑节点 无门' })
    const row = within(nodeRow('n3'))
    expect(row.queryByText('需人工评审')).not.toBeInTheDocument()
    expect(row.queryByText('自动校验门')).not.toBeInTheDocument()
    expect(row.queryByText('外部门')).not.toBeInTheDocument()
    expect(row.queryByLabelText('门检查点')).not.toBeInTheDocument()
  })
})

describe('WorkflowEditor 软校验告警（非阻断）', () => {
  it('固化步骤前无人工门 → 显示告警「固化步骤前缺人工验收」', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => finalizeFixture()) })
    renderEditor()
    expect(await screen.findByText('固化步骤前缺人工验收')).toBeInTheDocument()
    // 告警不是硬错误 alert（硬错误才用 role=alert）
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('在固化步骤前的节点上加一道人工门 → 告警清除（随编辑实时重算）', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => finalizeFixture()) })
    renderEditor()
    expect(await screen.findByText('固化步骤前缺人工验收')).toBeInTheDocument()
    // 进 merge 之前的节点，加一个检查项并切为人工评审
    await enterNode('写代码')
    await userEvent.click(screen.getByRole('button', { name: '加检查项' }))
    await userEvent.selectOptions(screen.getByLabelText('检查项类型 1'), 'manual')
    await backToNodes()
    // 现在固化前有人工门 → 告警消失
    await waitFor(() => expect(screen.queryByText('固化步骤前缺人工验收')).not.toBeInTheDocument())
  })

  it('告警只是提示、绝不禁用/拦截保存', async () => {
    installKlarit({ getWorkflow: vi.fn(async () => finalizeFixture()) })
    renderEditor()
    await screen.findByText('固化步骤前缺人工验收')
    const saveBtn = screen.getByRole('button', { name: '保存' })
    expect(saveBtn).toBeEnabled()
    await userEvent.click(saveBtn)
    // 有告警仍照常写盘（告警非阻断）
    expect(window.klarit.saveWorkflow).toHaveBeenCalled()
  })
})
