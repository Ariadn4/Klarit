import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function tempDir(prefix = 'klarit-e2e-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** 在临时位置建一个名为 name 的目录（其文件夹名即派生项目名），含若干文件。 */
export function makePlainProject(name: string): string {
  const dir = join(tempDir(), name)
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'hello.txt'), 'hi')
  writeFileSync(join(dir, 'src', 'index.ts'), 'export {}\n')
  return dir
}

function initGitRepo(dir: string): void {
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'e2e@klarit.test'])
  git(['config', 'user.name', 'klarit-e2e'])
  git(['add', '.'])
  git(['commit', '-m', 'init'])
}

/** 同上，并初始化为带一次提交的 git 仓库（主分支 main）。 */
export function makeGitProject(name: string): string {
  const dir = makePlainProject(name)
  initGitRepo(dir)
  return dir
}

/** 建一个「自身非 git」的容器目录，其下含若干 git 子仓。返回 { container, repoDirs }。 */
export function makeMultiRepoContainer(
  containerName: string,
  repoNames: string[]
): { container: string; repoDirs: Record<string, string> } {
  const container = join(tempDir(), containerName)
  const repoDirs: Record<string, string> = {}
  for (const r of repoNames) {
    const dir = join(container, r)
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(join(dir, 'hello.txt'), 'hi')
    writeFileSync(join(dir, 'src', 'index.ts'), 'export {}\n')
    initGitRepo(dir)
    repoDirs[r] = dir
  }
  return { container, repoDirs }
}

interface SeedMember {
  id: string
  rootPath: string
  derivedName: string
}

function registryProjectJson(project: {
  id: string
  displayName: string
  members: SeedMember[]
}): unknown {
  const now = new Date().toISOString()
  return {
    id: project.id,
    displayName: project.displayName,
    derivedName: project.displayName,
    members: project.members.map((m) => ({
      id: m.id,
      idKind: 'uuid',
      derivedName: m.derivedName,
      rootPath: m.rootPath,
      worktreePaths: [m.rootPath],
      git: { branch: 'main', remote: null, commonDir: join(m.rootPath, '.git') },
      gitless: false
    })),
    createdAt: now,
    updatedAt: now
  }
}

/** 写一个项目进 registry，但 session 为空（启动时无可恢复窗口 → 空窗口 + 可选列表）。 */
export function seedProjectNoSession(
  userData: string,
  project: { id: string; displayName: string; members: SeedMember[] }
): void {
  mkdirSync(userData, { recursive: true })
  writeFileSync(
    join(userData, 'registry.json'),
    JSON.stringify({ projects: [registryProjectJson(project)] }, null, 2)
  )
  writeFileSync(join(userData, 'session.json'), JSON.stringify({ windows: [] }, null, 2))
}

/** 以新格式（projects）写 registry.json + session.json，预置一个多仓项目并恢复其窗口。 */
export function seedMultiRepoProject(
  userData: string,
  project: { id: string; displayName: string; members: SeedMember[] }
): void {
  mkdirSync(userData, { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(userData, 'registry.json'),
    JSON.stringify(
      {
        projects: [
          {
            id: project.id,
            displayName: project.displayName,
            derivedName: project.displayName,
            members: project.members.map((m) => ({
              id: m.id,
              idKind: 'uuid',
              derivedName: m.derivedName,
              rootPath: m.rootPath,
              worktreePaths: [m.rootPath],
              git: { branch: 'main', remote: null, commonDir: join(m.rootPath, '.git') },
              gitless: false
            })),
            createdAt: now,
            updatedAt: now
          }
        ]
      },
      null,
      2
    )
  )
  writeFileSync(
    join(userData, 'session.json'),
    JSON.stringify({ windows: [{ projectId: project.id, sidebarCollapsed: false }] }, null, 2)
  )
}

export function gitInit(dir: string): void {
  const git = (args: string[]): void => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  git(['init', '-b', 'main'])
}

interface SeedEntry {
  id: string
  rootPath: string
  displayName: string
  gitless?: boolean
}

/** 直接写 registry.json / session.json 到 userData，预置已导入项目与上次会话。 */
export function seedUserData(
  userData: string,
  entries: SeedEntry[],
  sessionProjectIds: string[]
): void {
  mkdirSync(userData, { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(userData, 'registry.json'),
    JSON.stringify(
      {
        entries: entries.map((e) => ({
          id: e.id,
          idKind: e.gitless ? 'path' : 'uuid',
          displayName: e.displayName,
          derivedName: e.displayName,
          rootPath: e.rootPath,
          worktreePaths: [e.rootPath],
          git: e.gitless ? null : { branch: 'main', remote: null, commonDir: join(e.rootPath, '.git') },
          gitless: e.gitless ?? false,
          createdAt: now,
          updatedAt: now
        }))
      },
      null,
      2
    )
  )
  writeFileSync(
    join(userData, 'session.json'),
    JSON.stringify(
      { windows: sessionProjectIds.map((id) => ({ projectId: id, sidebarCollapsed: false })) },
      null,
      2
    )
  )
}
