import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import type { GitProbeResult, NestedRepoCandidate } from '../shared/types'
import { createRegistry, findProjectByMemberId } from './registry-core'
import {
  importProject,
  linkMemberByDir,
  relocateMemberToDir,
  rebindMemberIfGitAppeared,
  type ProjectServiceDeps
} from './project-service'

const NOW = '2026-06-17T00:00:00.000Z'

function makeDeps(
  probes: Record<string, GitProbeResult>,
  opts: { idFiles?: Record<string, string>; nested?: Record<string, NestedRepoCandidate[]> } = {}
): ProjectServiceDeps {
  const idFiles = opts.idFiles ?? {}
  const nested = opts.nested ?? {}
  let counter = 0
  let groupCounter = 0
  return {
    probe: (dir) =>
      probes[dir] ?? { isGit: false, toplevel: null, commonDir: null, branch: null, remote: null },
    readProjectId: (top) => idFiles[top] ?? null,
    ensureProjectId: (top, preferred) => {
      if (idFiles[top]) return idFiles[top]
      const id = preferred ?? `gen-${++counter}`
      idFiles[top] = id
      return id
    },
    scanNested: (dir) => nested[dir] ?? [],
    newGroupId: () => `grp-${++groupCounter}`,
    now: () => NOW
  }
}

const gitProbe = (top: string, over: Partial<GitProbeResult> = {}): GitProbeResult => ({
  isGit: true,
  toplevel: top,
  commonDir: `${top}/.git`,
  branch: 'main',
  remote: 'git@github.com:me/repo.git',
  ...over
})

describe('importProject — 单仓 / gitless', () => {
  it('有 git+远程：建项目，名取文件夹名', () => {
    const top = resolve('/work/myrepo')
    const deps = makeDeps({ [top]: gitProbe(top) })
    const data = createRegistry()
    const out = importProject(data, top, deps)
    expect(out.project.derivedName).toBe('myrepo')
    expect(out.project.members[0].git?.remote).toBe('git@github.com:me/repo.git')
  })

  it('有 git 无远程：仍绑定', () => {
    const top = resolve('/work/r2')
    const deps = makeDeps({ [top]: gitProbe(top, { remote: null }) })
    const data = createRegistry()
    const out = importProject(data, top, deps)
    expect(out.project.members[0].git?.remote).toBeNull()
  })

  it('无 git 且无子仓：gitless 单目录项目', () => {
    const dir = resolve('/work/plain')
    const deps = makeDeps({})
    const data = createRegistry()
    const out = importProject(data, dir, deps)
    expect(out.project.members[0].gitless).toBe(true)
  })

  it('已有 .klarit/project-id：复用其 UUID', () => {
    const top = resolve('/work/r3')
    const deps = makeDeps({ [top]: gitProbe(top) }, { idFiles: { [top]: 'committed' } })
    const data = createRegistry()
    const out = importProject(data, top, deps)
    expect(out.project.members[0].id).toBe('committed')
  })

  it('移动目录后再导入识别为同一项目', () => {
    const a = resolve('/work/r4')
    const b = resolve('/moved/r4')
    const deps = makeDeps({ [a]: gitProbe(a), [b]: gitProbe(b) }, { idFiles: { [a]: 'u', [b]: 'u' } })
    const data = createRegistry()
    importProject(data, a, deps)
    const out = importProject(data, b, deps)
    expect(out.reused).toBe(true)
    expect(data.projects).toHaveLength(1)
  })
})

describe('importProject — 含子仓目录直接组建多仓项目', () => {
  it('容器非 git、其下含 2 子仓：直接建多仓项目，无需确认', () => {
    const container = resolve('/work/product')
    const fe = resolve('/work/product/frontend')
    const be = resolve('/work/product/backend')
    const deps = makeDeps(
      { [fe]: gitProbe(fe), [be]: gitProbe(be) },
      {
        nested: {
          [container]: [
            { rootPath: fe, name: 'frontend' },
            { rootPath: be, name: 'backend' }
          ]
        }
      }
    )
    const data = createRegistry()
    const out = importProject(data, container, deps)
    expect(out.reused).toBe(false)
    expect(out.project.derivedName).toBe('product')
    expect(out.project.members).toHaveLength(2)
    expect(out.project.members.every((m) => m.idKind === 'uuid')).toBe(true)
    expect(out.project.members.map((m) => m.derivedName).sort()).toEqual(['backend', 'frontend'])
    expect(data.projects).toHaveLength(1)
  })

  it('同组成员换路径再导入：凭成员身份复用同一项目 id 并刷新路径', () => {
    const mk = (container: string, fe: string, be: string): ProjectServiceDeps =>
      makeDeps(
        { [fe]: gitProbe(fe), [be]: gitProbe(be) },
        {
          idFiles: { [fe]: 'uF', [be]: 'uB' },
          nested: {
            [container]: [
              { rootPath: fe, name: 'frontend' },
              { rootPath: be, name: 'backend' }
            ]
          }
        }
      )
    const data = createRegistry()
    const out1 = importProject(
      data,
      resolve('/work/product'),
      mk(resolve('/work/product'), resolve('/work/product/frontend'), resolve('/work/product/backend'))
    )
    expect(out1.reused).toBe(false)
    const pid = out1.project.id

    const fe2 = resolve('/moved/product/frontend')
    const out2 = importProject(
      data,
      resolve('/moved/product'),
      mk(resolve('/moved/product'), fe2, resolve('/moved/product/backend'))
    )
    expect(out2.reused).toBe(true)
    expect(out2.project.id).toBe(pid)
    expect(data.projects).toHaveLength(1)
    expect(out2.project.members.find((m) => m.id === 'uF')?.rootPath).toBe(fe2)
  })
})

describe('成员关联 / 重定位 / 补绑', () => {
  it('linkMemberByDir 把独立仓关联进项目', () => {
    const top = resolve('/work/main-repo')
    const extra = resolve('/elsewhere/lib')
    const deps = makeDeps({ [top]: gitProbe(top), [extra]: gitProbe(extra) })
    const data = createRegistry()
    const out = importProject(data, top, deps)
    const updated = linkMemberByDir(data, out.project.id, extra, deps)
    expect(updated?.members).toHaveLength(2)
  })

  it('relocateMemberToDir 探测新位置并更新 git', () => {
    const dir = resolve('/work/late')
    // 先 gitless 导入
    const data = createRegistry()
    const out = importProject(data, dir, makeDeps({}))
    const pid = out.project.id
    const memberId = out.project.members[0].id
    // 重新定位到一个有 git 的新路径
    const newDir = resolve('/work/late-moved')
    const updated = relocateMemberToDir(data, pid, memberId, newDir, makeDeps({ [newDir]: gitProbe(newDir) }))
    expect(updated?.members[0].rootPath).toBe(newDir)
    expect(updated?.members[0].git?.branch).toBe('main')
  })

  it('rebindMemberIfGitAppeared 对 gitless 成员补绑', () => {
    const dir = resolve('/work/willinit')
    const data = createRegistry()
    const out = importProject(data, dir, makeDeps({}))
    const member = out.project.members[0]
    expect(member.gitless).toBe(true)
    const rebound = rebindMemberIfGitAppeared(data, member, makeDeps({ [dir]: gitProbe(dir) }))
    expect(rebound?.idKind).toBe('uuid')
    expect(rebound?.gitless).toBe(false)
    expect(findProjectByMemberId(data, rebound!.id)).toBeDefined()
  })

  it('已绑定成员不重复补绑', () => {
    const top = resolve('/work/bound')
    const deps = makeDeps({ [top]: gitProbe(top) })
    const data = createRegistry()
    const out = importProject(data, top, deps)
    const member = out.project.members[0]
    expect(rebindMemberIfGitAppeared(data, member, deps)).toBeNull()
  })
})
