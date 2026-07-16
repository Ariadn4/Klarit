import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { makeGitProject, seedUserData, tempDir } from './helpers'

const MAIN = join(process.cwd(), 'out', 'main', 'index.js')

/** 启动 app，绑定一个 git 项目，并置 KLARIT_E2E_WORKFLOW=1 让编排返回一个（故意缺删分支的）工作流产出。 */
async function launchWithProject(): Promise<{ app: ElectronApplication; userData: string }> {
  const repo = makeGitProject('wf-authoring')
  const userData = tempDir('klarit-ud-')
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ language: 'zh', defaultAgent: 'claude-code' }, null, 2)
  )
  seedUserData(userData, [{ id: 'id-wf', rootPath: repo, displayName: 'wf-authoring' }], ['id-wf'])
  const app = await electron.launch({
    args: [MAIN, `--user-data-dir=${userData}`],
    env: { ...process.env, KLARIT_E2E_WORKFLOW: '1' }
  })
  return { app, userData }
}

test('全局对话：写工作流意图 → 只读预览（含自动补的删分支节点）→ 存库落进工作流库', async () => {
  const { app } = await launchWithProject()
  const win = await app.firstWindow()
  await expect(win.getByRole('button', { name: /wf-authoring/ })).toBeVisible()

  // 打开全局对话面板（底栏「项目Agent」入口）
  await win.getByRole('button', { name: '项目Agent' }).click()
  const input = win.getByLabel('对话输入')
  await expect(input).toBeEnabled() // 会话就绪（activeId 已设）

  // 发一条写工作流意图；e2e 假 producer 返回一个缺 delete-branch 的 PR 流 → 编排核 repair 补齐
  await input.fill('帮我做个带评审门的 PR 工作流')
  await win.getByRole('button', { name: '发送' }).click()

  // 聊天里给出精简板子：只有「工作流提案」+「预览草稿」入口
  await expect(win.getByText('工作流提案')).toBeVisible()
  await win.getByRole('button', { name: '预览草稿' }).click()

  // 打开完整编辑器（草稿态）浮层：显示名输入带流名、节点列表里出现 repair 自动补的删分支节点（产出本身没给）
  const dialog = win.getByRole('dialog', { name: '预览草稿' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input').first()).toHaveValue('PR 流（E2E）')
  await expect(dialog.getByText('删本地分支', { exact: true })).toBeVisible()

  // 「设置为本项目工作流」仅在保存为正式后出现
  await expect(dialog.getByRole('button', { name: '设置为本项目工作流' })).toHaveCount(0)
  // 「保存为正式工作流」入库
  await dialog.getByRole('button', { name: '保存为正式工作流' }).click()
  await expect(dialog.getByRole('button', { name: '设置为本项目工作流' })).toBeVisible()

  // 真持久化：工作流库里出现该包（经真实 saveWorkflow IPC + workflow-store 落盘）
  const ids = await win.evaluate(async () => {
    const list = await (window as unknown as { klarit: { listWorkflows: () => Promise<Array<{ id: string }>> } }).klarit.listWorkflows()
    return list.map((s) => s.id)
  })
  expect(ids).toContain('e2e-pr-flow')

  await app.close()
})
