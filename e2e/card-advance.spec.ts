import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { makeGitProject, seedMultiRepoProject, tempDir } from './helpers'

const MAIN = join(process.cwd(), 'out', 'main', 'index.js')

async function launch(userData: string): Promise<ElectronApplication> {
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ language: 'zh', defaultAgent: 'claude-code' }, null, 2)
  )
  return electron.launch({ args: [MAIN, `--user-data-dir=${userData}`], env: { ...process.env } })
}

// 验收 #2：末节点是长驻 command（如 npm start 类验收），运行卡在该节点；
// 「中止并完成流程」应中止命令并使运行走到终局（卡→已完成）。
test('末节点长驻命令：中止并完成流程 → 卡进入已完成', async () => {
  const repo = makeGitProject('adv-repo')
  const userData = tempDir('klarit-ud-')
  seedMultiRepoProject(userData, {
    id: 'proj-1',
    displayName: 'adv',
    members: [{ id: 'm1', rootPath: repo, derivedName: 'adv-repo' }]
  })
  const app = await launch(userData)
  const win = await app.firstWindow()

  // 造一个「单命令节点、命令永不退出」的工作流并激活。
  await win.evaluate(async () => {
    const def = await window.klarit.createWorkflow()
    def.stages = [{ id: 's1', name: '验收' }]
    def.nodes = [
      {
        id: 'n1',
        name: '启动验收',
        stageId: 's1',
        executor: { kind: 'command', commands: [{ command: 'node -e "setInterval(()=>{},1000000)"' }] },
        outputs: []
      }
    ]
    const saved = await window.klarit.saveWorkflow(def)
    if (saved && (saved as { ok?: boolean }).ok === false) {
      // 不能静默吞：保存被拒的话卡会去跑**默认工作流**，用例看似在跑其实测的是别的东西。
      throw new Error(`saveWorkflow 被拒：${JSON.stringify(saved)}`)
    }
    await window.klarit.setActiveWorkflow(def.id)
    await window.klarit.createCards([
      { proposedName: 'accept-me', title: '验收卡', description: '', typeId: 'feature', relations: [] }
    ])
  })
  await win.reload()

  await win.getByText('验收卡').click()
  // 不点「运行」：卡建出来即由自动排程起跑（auto-run-todo），此时按钮已是「暂停」。

  // 命令进入执行、末节点推进按钮出现。
  const abortFinish = win.getByRole('button', { name: '中止并完成流程' })
  await expect(abortFinish).toBeVisible({ timeout: 15_000 })
  await abortFinish.click()

  // 运行走到终局 → 卡状态已完成。
  await expect(async () => {
    const c = await win.evaluate(async () => (await window.klarit.listCards())[0])
    expect(c.status).toBe('已完成')
  }).toPass({ timeout: 15_000 })

  await app.close()
})
