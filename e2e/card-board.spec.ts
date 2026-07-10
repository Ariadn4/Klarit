import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { makeGitProject, seedMultiRepoProject, tempDir } from './helpers'

const MAIN = join(process.cwd(), 'out', 'main', 'index.js')

async function launch(userData: string): Promise<ElectronApplication> {
  mkdirSync(userData, { recursive: true })
  // 固定语言 zh + 预置默认 agent，避免首启「选择 agent」引导遮罩挡点击。
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ language: 'zh', defaultAgent: 'claude-code' }, null, 2)
  )
  return electron.launch({ args: [MAIN, `--user-data-dir=${userData}`], env: { ...process.env } })
}

// B1 验收：建卡（经统一接缝落库，绕开需 agent 的分解）→ 看板出卡 → 详情运行 → 绑卡 → 关重开持久化。
test('需求卡 B1：建卡→看板出卡→详情运行绑卡→关软件重开仍在', async () => {
  const repo = makeGitProject('card-repo')
  const userData = tempDir('klarit-ud-')
  seedMultiRepoProject(userData, {
    id: 'proj-1',
    displayName: 'card-proj',
    members: [{ id: 'm1', rootPath: repo, derivedName: 'card-repo' }]
  })

  let app = await launch(userData)
  let win = await app.firstWindow()

  // 激活一个默认工作流（首启已种入两个默认）。
  const wfId = await win.evaluate(async () => {
    const list = await window.klarit.listWorkflows()
    await window.klarit.setActiveWorkflow(list[0].id)
    return list[0].id
  })
  expect(wfId).toBeTruthy()

  // 经统一创建接缝落库一张 leaf 卡（typeId 用默认种子 feature）。
  await win.evaluate(async () => {
    await window.klarit.createCards([
      { proposedName: 'add-thing', title: '加个东西', description: '验收卡', typeId: 'feature', relations: [] }
    ])
  })
  await win.reload()

  // 看板「待办」列出现该卡。
  const todo = win.getByRole('region', { name: '待办' })
  await expect(todo.getByText('加个东西')).toBeVisible()

  // 点卡 → 详情面板打开（出现「运行」控制）。
  await win.getByText('加个东西').click()
  const runBtn = win.getByRole('button', { name: '运行' })
  await expect(runBtn).toBeVisible()

  // 点运行 → 卡绑定运行（activeRunId）。引擎在真 git 仓上跑默认工作流。
  await runBtn.click()
  await expect(async () => {
    const card = await win.evaluate(async () => (await window.klarit.listCards())[0])
    expect(card.activeRunId).toBeTruthy()
  }).toPass({ timeout: 20_000 })

  // 关软件重开 → 卡与其运行关联都在（持久化、不入 git、按项目身份关联）。
  await app.close()
  app = await launch(userData)
  win = await app.firstWindow()
  const persisted = await win.evaluate(async () => (await window.klarit.listCards())[0])
  expect(persisted.proposedName).toBe('add-thing')
  expect(persisted.activeRunId).toBeTruthy()
  // 重开后卡仍在看板上可见。
  await expect(win.getByText('加个东西')).toBeVisible()

  await app.close()
})
