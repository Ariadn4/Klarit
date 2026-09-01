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

// 多后台命令：一个不限时（运行中）、一个限时（超时被杀）；超时后条目**保留并标「已超时中止」**，不消失。
test('后台命令：多个并存 + 超时中止后保留标状态（可清除）', async () => {
  test.setTimeout(120_000)
  const repo = makeGitProject('bg-repo')
  const userData = tempDir('klarit-ud-')
  seedMultiRepoProject(userData, {
    id: 'proj-1',
    displayName: 'bg',
    members: [{ id: 'm1', rootPath: repo, derivedName: 'bg-repo' }]
  })
  const app = await launch(userData)
  const win = await app.firstWindow()

  // 工作流：节点5 长命令(不限时) → 节点6 长命令(限时3s) → 节点7 人工门(挂住运行,便于观察后台)。
  await win.evaluate(async () => {
    const tick = (n: string): string => `node -e "setInterval(()=>console.log('${n}'),400)"`
    const def = await window.klarit.createWorkflow()
    def.stages = [{ id: 's1', name: '验收' }]
    def.nodes = [
      { id: 'n5', name: '节点5·中段长命令（转后台）', stageId: 's1', executor: { kind: 'command', commands: [{ command: tick('bg5') }] }, outputs: [] },
      { id: 'n6', name: '节点6·长命令（限时20s，此处3s）', stageId: 's1', executor: { kind: 'command', commands: [{ command: tick('bg6'), timeoutSec: 3 }] }, outputs: [] },
      { id: 'n7', name: '节点7·人工门', stageId: 's1', executor: { kind: 'command', commands: [{ command: 'echo hold' }] }, outputs: [], gate: [{ kind: 'manual', actions: [] }] }
    ]
    const saved = await window.klarit.saveWorkflow(def)
    if (saved && (saved as { ok?: boolean }).ok === false) {
      throw new Error(`saveWorkflow 被拒：${JSON.stringify(saved)}`)
    }
    await window.klarit.setActiveWorkflow(def.id)
    await window.klarit.createCards([
      { proposedName: 'bg-demo', title: '多后台命令演示', description: '', typeId: 'feature', relations: [] }
    ])
  })
  await win.reload()

  await win.getByText('多后台命令演示').click()
  // 不点「运行」：卡建出来即由自动排程起跑（auto-run-todo）。

  // 节点5 执行中 → 转后台；随后节点6 执行中 → 转后台。
  // 这几处等的是**真子进程的调度与节点推进**，全套连跑时机器被前面的用例占着，
  // playwright 配置里 expect 默认的 10 秒余量不够（单跑必过、全套里抖过一次）。故显式放宽。
  const detach = win.getByRole('button', { name: '进入下一节点（转后台）' })
  await detach.click()
  await expect(detach).toBeVisible({ timeout: 30_000 }) // 节点6 的转后台按钮
  await detach.click()

  // 节点6 后台命令 3s 后超时被杀 → 条目保留、标「已超时中止」（不消失）。
  await expect(win.getByText('已超时中止')).toBeVisible({ timeout: 30_000 })
  // 节点5 后台仍在运行（可中止）。两条后台并存。
  await expect(win.getByRole('button', { name: '中止' })).toBeVisible()
  await expect(win.getByText('节点5·中段长命令（转后台）')).toBeVisible()
  // 后台命令输出各归各桶(节点5 转后台后其输出进 bg 桶,不再是「暂无输出」)。
  await expect(win.getByText('bg5', { exact: false }).first()).toBeVisible()

  await app.close()
})
