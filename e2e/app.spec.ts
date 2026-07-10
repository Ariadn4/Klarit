import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'
import { join } from 'node:path'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

test('导入含多子仓的容器 → 确认 → 侧边栏出现成员分组', async () => {
  const { container } = makeMultiRepoContainer('product', ['frontend', 'backend'])
  const app = await launch({ userData: tempDir('klarit-ud-'), importDirs: [container] })
  const win = await app.firstWindow()

  await win.getByRole('button', { name: /导入新项目/ }).click()
  // 应用内确认条出现
  await expect(win.getByText(/发现 2 个 git 子仓/)).toBeVisible()
  await win.getByRole('button', { name: '组成多仓项目' }).click()

  // 切换器显示容器名，侧边栏出现两个成员仓分组
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
  // 项目不丢、另一个成员照常、缺失成员标记缺失
  await expect(win.getByRole('button', { name: /with-missing/ })).toBeVisible()
  await expect(win.getByText('keep')).toBeVisible()
  await expect(win.getByText('缺失')).toBeVisible()
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
  await win.getByRole('button', { name: '需求卡类型' }).click()

  // 默认类型开箱在册（首启种入 epic/feature/bug）
  await expect(win.getByText('Epic')).toBeVisible()
  await expect(win.getByText('Feature')).toBeVisible()
  await expect(win.getByText('Bug')).toBeVisible()

  // 新增一个自定义子叶类型并保存
  await win.getByRole('button', { name: '新建需求卡类型' }).click()
  await win.getByLabel('类型名称').fill('探路')
  await win.getByLabel('类型描述').fill('不确定性高、先探路不交付')
  await win.getByRole('button', { name: '保存' }).click()

  // 回到列表，新类型出现（持久化经真实 main 进程 IPC + userData 落盘）
  await expect(win.getByText('探路')).toBeVisible()

  // 自动生成的分解 skill 预览含新类型的描述（注册表是单一来源）
  await win.getByRole('button', { name: /预览：自动生成的分解 skill/ }).click()
  await expect(win.getByLabel('自动生成的分解 skill 文本')).toContainText('不确定性高、先探路不交付')

  await app.close()
})

test('解绑成员仓后分组减少（不删磁盘）', async () => {
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

  const app = await launch({ userData })
  const win = await app.firstWindow()
  await expect(win.getByText('drop')).toBeVisible()

  // 解绑 drop（按钮 hover 才显示）→ 该分组消失；只剩单成员，项目仍在（退回单仓直接展示文件树）
  await win.getByText('drop').hover()
  await win.getByRole('button', { name: /解绑 drop/ }).click()
  await expect(win.getByText('drop')).toHaveCount(0)
  await expect(win.getByRole('button', { name: /unlink-me/ })).toBeVisible()
  await app.close()
})
