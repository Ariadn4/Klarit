import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import {
  makeGitProject,
  makePlainProject,
  makeMultiRepoContainer,
  seedUserData,
  seedMultiRepoProject,
  seedProjectNoSession,
  tempDir
} from './helpers'

const MAIN = join(process.cwd(), 'out', 'main', 'index.js')

interface LaunchOpts {
  userData: string
  importDirs?: string[]
}

async function launch({ userData, importDirs }: LaunchOpts): Promise<ElectronApplication> {
  // 预置 settings.json 固定语言(zh)并设默认 agent——后者避免装了 agent 的机器首启弹「选择默认 agent」
  // 引导遮罩(z-[100])拦截点击。不写则在开发机上几乎所有点击型用例都会被该遮罩挡住。
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ language: 'zh', defaultAgent: 'claude-code' }, null, 2)
  )
  return electron.launch({
    args: [MAIN, `--user-data-dir=${userData}`],
    env: {
      ...process.env,
      KLARIT_E2E_IMPORT_DIRS: (importDirs ?? []).join(';')
    }
  })
}

test('首次启动无项目时显示「导入新项目」', async () => {
  const app = await launch({ userData: tempDir('klarit-ud-') })
  const win = await app.firstWindow()
  await expect(win.getByRole('button', { name: /导入新项目/ })).toBeVisible()
  await app.close()
})

test('导入 git 项目：文件树出现，项目名为文件夹名', async () => {
  const repo = makeGitProject('alpha-repo')
  const app = await launch({ userData: tempDir('klarit-ud-'), importDirs: [repo] })
  const win = await app.firstWindow()

  await win.getByRole('button', { name: /导入新项目/ }).click()

  // 切换器显示派生名
  await expect(win.getByRole('button', { name: /alpha-repo/ })).toBeVisible()
  // 文件树展示项目目录内容
  await expect(win.getByText('hello.txt')).toBeVisible()
  await expect(win.getByText('src')).toBeVisible()
  await app.close()
})

test('导入无 git 目录也能登记并展示', async () => {
  const dir = makePlainProject('plain-proj')
  const app = await launch({ userData: tempDir('klarit-ud-'), importDirs: [dir] })
  const win = await app.firstWindow()
  await win.getByRole('button', { name: /导入新项目/ }).click()
  await expect(win.getByRole('button', { name: /plain-proj/ })).toBeVisible()
  await expect(win.getByText('hello.txt')).toBeVisible()
  await app.close()
})

test('空窗口选项目时在本窗口打开（不新开窗口）', async () => {
  const repo = makeGitProject('inplace')
  const userData = tempDir('klarit-ud-')
  // registry 有项目但 session 为空 → 启动得到一个空窗口 + 可选列表。
  seedProjectNoSession(userData, {
    id: 'id-inplace',
    displayName: 'inplace',
    members: [{ id: 'id-inplace', rootPath: repo, derivedName: 'inplace' }]
  })

  const app = await launch({ userData })
  const win = await app.firstWindow()
  // 空状态：切换器显示「选择项目」
  await win.getByRole('button', { name: /选择项目/ }).click()
  await win.getByRole('menuitemradio', { name: /inplace/ }).click()

  // 在本窗口打开：窗口数仍为 1，且显示该项目
  await expect(win.getByRole('button', { name: /inplace/ })).toBeVisible()
  await expect(win.getByText('hello.txt')).toBeVisible()
  expect(app.windows().length).toBe(1)
  await app.close()
})

test('从切换器打开另一个项目：开新窗口，原窗口不变', async () => {
  const repoA = makeGitProject('proj-a')
  const repoB = makeGitProject('proj-b')
  const userData = tempDir('klarit-ud-')
  seedUserData(
    userData,
    [
      { id: 'id-a', rootPath: repoA, displayName: 'proj-a' },
      { id: 'id-b', rootPath: repoB, displayName: 'proj-b' }
    ],
    ['id-a']
  )

  const app = await launch({ userData })
  const winA = await app.firstWindow()
  await expect(winA.getByRole('button', { name: /proj-a/ })).toBeVisible()

  // 打开切换器并选择 proj-b
  await winA.getByRole('button', { name: /proj-a/ }).click()
  await winA.getByRole('menuitemradio', { name: /proj-b/ }).click()

  // 出现第二个窗口
  await expect.poll(() => app.windows().length).toBe(2)
  const winB = app.windows().find((w) => w !== winA)!
  await expect(winB.getByRole('button', { name: /proj-b/ })).toBeVisible()
  // 原窗口仍是 proj-a
  await expect(winA.getByRole('button', { name: /proj-a/ })).toBeVisible()
  await app.close()
})

test('关闭后重开恢复上次的项目', async () => {
  const repo = makeGitProject('restore-me')
  const userData = tempDir('klarit-ud-')
  seedUserData(userData, [{ id: 'id-r', rootPath: repo, displayName: 'restore-me' }], ['id-r'])

  const app = await launch({ userData })
  const win = await app.firstWindow()
  await expect(win.getByRole('button', { name: /restore-me/ })).toBeVisible()
  await expect(win.getByText('hello.txt')).toBeVisible()
  await app.close()
})

test('导入含多子仓的容器 → 直接组成多仓项目（无需确认）', async () => {
  const { container } = makeMultiRepoContainer('product', ['frontend', 'backend'])
  const app = await launch({ userData: tempDir('klarit-ud-'), importDirs: [container] })
  const win = await app.firstWindow()

  await win.getByRole('button', { name: /导入新项目/ }).click()

  // 不再有确认条：含 ≥2 个 git 子仓的目录**直接组成多仓项目、无需确认**
  // （见 project-service.ts「目录自身非 git 且其下含 ≥2 个子仓 → 直接组成多仓项目」）。
  // 切换器显示容器名，侧边栏文件树里出现两个成员仓目录
  await expect(win.getByRole('button', { name: /product/ })).toBeVisible()
  await expect(win.getByText('frontend')).toBeVisible()
  await expect(win.getByText('backend')).toBeVisible()
  await app.close()
})

test('多仓项目关闭重开按 userData 分组复原', async () => {
  const { repoDirs } = makeMultiRepoContainer('restore-multi', ['web', 'api'])
  const userData = tempDir('klarit-ud-')
  seedMultiRepoProject(userData, {
    id: 'grp-restore',
    displayName: 'restore-multi',
    members: [
      { id: 'm-web', rootPath: repoDirs.web, derivedName: 'web' },
      { id: 'm-api', rootPath: repoDirs.api, derivedName: 'api' }
    ]
  })

  const app = await launch({ userData })
  const win = await app.firstWindow()
  await expect(win.getByRole('button', { name: /restore-multi/ })).toBeVisible()
  await expect(win.getByText('web')).toBeVisible()
  await expect(win.getByText('api')).toBeVisible()
  await app.close()
})

test('外部删除一个成员目录 → 显示缺失，项目不丢', async () => {
  const { repoDirs } = makeMultiRepoContainer('with-missing', ['keep', 'gone'])
  const userData = tempDir('klarit-ud-')
  seedMultiRepoProject(userData, {
    id: 'grp-missing',
    displayName: 'with-missing',
    members: [
      { id: 'm-keep', rootPath: repoDirs.keep, derivedName: 'keep' },
      { id: 'm-gone', rootPath: repoDirs.gone, derivedName: 'gone' }
    ]
  })
  // 在 Klarit 之外删掉一个成员目录
  rmSync(repoDirs.gone, { recursive: true, force: true })

  const app = await launch({ userData })
  const win = await app.firstWindow()
  // 项目不丢、另一个成员照常。
  // **不再断言逐成员的「缺失」标记**：侧边栏已改成「以项目目录为根的普通文件树」（子仓只是普通文件夹），
  // 带该标记的 RepoGroup 组件已不被渲染。仍然存在的是「全员缺失 → 项目级提示」，见下一条用例。
  await expect(win.getByRole('button', { name: /with-missing/ })).toBeVisible()
  await expect(win.getByText('keep')).toBeVisible()
  await app.close()
})

test('成员目录全被外部删除 → 给项目级「找不到」提示，项目不丢', async () => {
  const { container, repoDirs } = makeMultiRepoContainer('all-gone', ['a1', 'a2'])
  const userData = tempDir('klarit-ud-')
  seedMultiRepoProject(userData, {
    id: 'grp-all-gone',
    displayName: 'all-gone',
    members: [
      { id: 'm-a1', rootPath: repoDirs.a1, derivedName: 'a1' },
      { id: 'm-a2', rootPath: repoDirs.a2, derivedName: 'a2' }
    ]
  })
  rmSync(container, { recursive: true, force: true })

  const app = await launch({ userData })
  const win = await app.firstWindow()
  await expect(win.getByRole('button', { name: /all-gone/ })).toBeVisible() // 项目不丢
  await expect(win.getByText('该项目的目录在磁盘上找不到了（被移动或删除）。')).toBeVisible()
  await expect(win.getByRole('button', { name: '从项目列表中移除' })).toBeVisible()
  await app.close()
})

test('设置·需求卡类型：列出默认类型、新增自定义类型、预览自动生成分解 skill', async () => {
  const repo = makeGitProject('card-types-proj')
  const userData = tempDir('klarit-ud-')
  seedUserData(userData, [{ id: 'id-ct', rootPath: repo, displayName: 'card-types-proj' }], ['id-ct'])

  const app = await launch({ userData })
  const win = await app.firstWindow()
  await expect(win.getByRole('button', { name: /card-types-proj/ })).toBeVisible()

  // 打开设置 → 切到「需求卡类型」分区
  await win.getByRole('button', { name: '设置' }).click()
  await win.getByRole('button', { name: '需求卡', exact: true }).click()

  // 默认类型开箱在册（首启种入 epic/feature/bug；显示名见 shared/card-type.ts 的 DEFAULT_CARD_TYPES）
  await expect(win.getByText('Epic')).toBeVisible()
  await expect(win.getByText('Feat')).toBeVisible()
  await expect(win.getByText('Bug')).toBeVisible()

  // 新增一个自定义子叶类型并保存。列表外壳换成了通用 ListEditor，新建按钮用 common.add（「新建」），
  // 原先的专属 aria `cardTypeLibrary.newAria` 已无人引用。
  await win.getByRole('button', { name: '新建', exact: true }).click()
  await win.getByLabel('类型名称').fill('探路')
  await win.getByLabel('类型描述').fill('不确定性高、先探路不交付')
  await win.getByRole('button', { name: '保存' }).click()

  // 回到列表，新类型出现（持久化经真实 main 进程 IPC + userData 落盘）
  await expect(win.getByText('探路')).toBeVisible()

  // 自动生成的分解 skill 预览含新类型的描述（注册表是单一来源）
  await win.getByRole('button', { name: '预览分解 skill' }).click()
  await expect(win.getByLabel('自动生成的分解 skill 文本')).toContainText('不确定性高、先探路不交付')

  await app.close()
})

test('解绑成员仓：项目少一个成员、磁盘目录仍在、重开后仍然如此', async () => {
  const { repoDirs } = makeMultiRepoContainer('unlink-me', ['keep2', 'drop'])
  const userData = tempDir('klarit-ud-')
  seedMultiRepoProject(userData, {
    id: 'grp-unlink',
    displayName: 'unlink-me',
    members: [
      { id: 'm-keep2', rootPath: repoDirs.keep2, derivedName: 'keep2' },
      { id: 'm-drop', rootPath: repoDirs.drop, derivedName: 'drop' }
    ]
  })

  let app = await launch({ userData })
  let win = await app.firstWindow()
  await expect(win.getByText('drop')).toBeVisible() // 文件树里作为普通文件夹出现

  // **不点侧边栏的解绑按钮**：侧边栏已改成「以项目目录为根的普通文件树」，带解绑按钮的 RepoGroup
  // 组件已不被任何地方渲染（`unlinkMember` IPC 仍在，但目前没有界面入口）。这里直接走 IPC，
  // 验它仍然管用：成员减一、磁盘目录不删、重开后仍然如此。
  await win.evaluate(async () => window.klarit.unlinkMember('grp-unlink', 'm-drop'))

  await expect(async () => {
    const n = await win.evaluate(async () => {
      const list = await window.klarit.listProjects()
      return list.find((p) => p.id === 'grp-unlink')?.members.length ?? -1
    })
    expect(n).toBe(1)
  }).toPass({ timeout: 10_000 })
  expect(existsSync(repoDirs.drop)).toBe(true) // 不删磁盘

  // 关软件重开：解绑已落盘
  await app.close()
  app = await launch({ userData })
  win = await app.firstWindow()
  const members = await win.evaluate(async () => {
    const list = await window.klarit.listProjects()
    return list.find((p) => p.id === 'grp-unlink')?.members.map((m) => m.derivedName) ?? []
  })
  expect(members).toEqual(['keep2'])
  await app.close()
})
