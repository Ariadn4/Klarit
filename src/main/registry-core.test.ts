import { describe, it, expect } from 'vitest'
import type { GitInfo, LegacyRegistryData, RepoMember } from '../shared/types'
import {
  createRegistry,
  createProject,
  linkMember,
  unlinkMember,
  removeProject,
  reconcileMissing,
  relocateMember,
  setMemberTag,
  migrateLegacy,
  normalizeRegistry,
  upsertImport,
  upgradeGitlessMember,
  resolveUuidForCommonDir,
  findProjectByMemberId,
  getActiveWorkflow,
  setActiveWorkflow,
  clearActiveWorkflow,
  getConstitutionGovernance,
  setConstitutionGovernance,
  getProjectCardTypes,
  setProjectCardTypes,
  seedProjectCardTypes,
  type ImportInput
} from './registry-core'
import type { CardTypeDef } from '../shared/types'

const NOW = '2026-06-17T00:00:00.000Z'

function gitInfo(over: Partial<GitInfo> = {}): GitInfo {
  return { branch: 'main', remote: 'git@github.com:me/repo.git', commonDir: '/repo/.git', ...over }
}

function gitImport(over: Partial<ImportInput> = {}): ImportInput {
  return { rootPath: '/repo', derivedName: 'repo', projectId: 'uuid-1', git: gitInfo(), now: NOW, ...over }
}

function member(id: string, over: Partial<RepoMember> = {}): RepoMember {
  return {
    id,
    idKind: 'uuid',
    derivedName: id,
    rootPath: `/${id}`,
    worktreePaths: [`/${id}`],
    git: gitInfo({ commonDir: `/${id}/.git` }),
    gitless: false,
    ...over
  }
}

describe('迁移与容错读取', () => {
  const legacy: LegacyRegistryData = {
    entries: [
      {
        id: 'old-1',
        idKind: 'uuid',
        displayName: '旧项目',
        derivedName: 'old',
        rootPath: '/old',
        worktreePaths: ['/old'],
        git: gitInfo({ commonDir: '/old/.git' }),
        gitless: false,
        createdAt: NOW,
        updatedAt: NOW
      }
    ]
  }

  it('旧单仓条目迁移为成员数 1 的项目，分组 id 复用原 id', () => {
    const data = migrateLegacy(legacy)
    expect(data.projects).toHaveLength(1)
    const p = data.projects[0]
    expect(p.id).toBe('old-1')
    expect(p.displayName).toBe('旧项目')
    expect(p.members).toHaveLength(1)
    expect(p.members[0].id).toBe('old-1')
    expect(p.members[0].rootPath).toBe('/old')
  })

  it('normalizeRegistry 识别新/旧格式与垃圾输入', () => {
    expect(normalizeRegistry({ projects: [] })).toEqual({ projects: [] })
    expect(normalizeRegistry(legacy).projects).toHaveLength(1)
    expect(normalizeRegistry(null)).toEqual({ projects: [] })
    expect(normalizeRegistry({ junk: 1 })).toEqual({ projects: [] })
  })
})

describe('upsertImport — 单仓 / gitless', () => {
  it('新 git 项目建成员数 1 的项目', () => {
    const data = createRegistry()
    const { project, reused } = upsertImport(data, gitImport())
    expect(reused).toBe(false)
    expect(project.id).toBe('uuid-1')
    expect(project.members).toHaveLength(1)
    expect(project.members[0].idKind).toBe('uuid')
    expect(project.derivedName).toBe('repo')
  })

  it('同 UUID 重复导入复用项目并更新路径与 worktree', () => {
    const data = createRegistry()
    upsertImport(data, gitImport())
    const { project, reused } = upsertImport(data, gitImport({ rootPath: '/moved/repo' }))
    expect(reused).toBe(true)
    expect(data.projects).toHaveLength(1)
    expect(project.members[0].rootPath).toBe('/moved/repo')
    expect(project.members[0].worktreePaths).toEqual(['/repo', '/moved/repo'])
  })

  it('同 commonDir 的不同 worktree 归并（即便 UUID 不同）', () => {
    const data = createRegistry()
    upsertImport(data, gitImport())
    const { project, reused } = upsertImport(
      data,
      gitImport({ projectId: 'uuid-2', rootPath: '/repo-wt', git: gitInfo({ branch: 'feature' }) })
    )
    expect(reused).toBe(true)
    expect(data.projects).toHaveLength(1)
    expect(project.members[0].id).toBe('uuid-1')
    expect(project.members[0].worktreePaths).toContain('/repo-wt')
  })

  it('gitless 以路径登记', () => {
    const data = createRegistry()
    const { project } = upsertImport(
      data,
      gitImport({ projectId: null, git: null, rootPath: '/plain', derivedName: 'plain' })
    )
    expect(project.members[0].idKind).toBe('path')
    expect(project.members[0].gitless).toBe(true)
  })

  it('resolveUuidForCommonDir 跨项目查成员', () => {
    const data = createRegistry()
    upsertImport(data, gitImport())
    expect(resolveUuidForCommonDir(data, '/repo/.git')).toBe('uuid-1')
    expect(resolveUuidForCommonDir(data, '/x/.git')).toBeUndefined()
  })
})

describe('setMemberTag — 成员仓标签', () => {
  it('设置标签后随 normalizeRegistry round-trip 持久化', () => {
    const data = createRegistry()
    createProject(data, {
      groupId: 'grp-1',
      displayName: '产品',
      derivedName: '产品',
      members: [member('fe'), member('be')],
      now: NOW
    })
    const p = setMemberTag(data, 'be', '后端', NOW)
    expect(p?.members.find((m) => m.id === 'be')?.tag).toBe('后端')
    // JSON round-trip(模拟写读 registry.json)后标签仍在
    const reloaded = normalizeRegistry(JSON.parse(JSON.stringify(data)))
    const be = reloaded.projects[0].members.find((m) => m.id === 'be')
    expect(be?.tag).toBe('后端')
  })

  it('空串/undefined 清除标注；trim 归一', () => {
    const data = createRegistry()
    createProject(data, { groupId: 'g', displayName: 'x', derivedName: 'x', members: [member('fe', { tag: '前端' })], now: NOW })
    setMemberTag(data, 'fe', '  ', NOW)
    expect(data.projects[0].members[0].tag).toBeUndefined()
    setMemberTag(data, 'fe', '  共享 SDK  ', NOW)
    expect(data.projects[0].members[0].tag).toBe('共享 SDK')
  })

  it('未知成员返回 null', () => {
    const data = createRegistry()
    expect(setMemberTag(data, 'ghost', '后端', NOW)).toBeNull()
  })
})

describe('多仓建组与成员管理', () => {
  it('createProject 用多个成员建多仓项目', () => {
    const data = createRegistry()
    const p = createProject(data, {
      groupId: 'grp-1',
      displayName: '产品',
      derivedName: '产品',
      members: [member('fe'), member('be')],
      now: NOW
    })
    expect(p.id).toBe('grp-1')
    expect(p.members.map((m) => m.id)).toEqual(['fe', 'be'])
  })

  it('建组时把已属别处的成员移过来（一仓至多一个项目）', () => {
    const data = createRegistry()
    upsertImport(data, gitImport({ projectId: 'fe', rootPath: '/fe', git: gitInfo({ commonDir: '/fe/.git' }) }))
    expect(data.projects).toHaveLength(1)
    createProject(data, {
      groupId: 'grp',
      displayName: 'g',
      derivedName: 'g',
      members: [member('fe'), member('be')],
      now: NOW
    })
    // fe 从原单仓项目移走，原项目空被清除，只剩多仓项目
    expect(data.projects).toHaveLength(1)
    expect(findProjectByMemberId(data, 'fe')?.id).toBe('grp')
  })

  it('linkMember 去重添加；unlinkMember 只解分组、空则删项目', () => {
    const data = createRegistry()
    createProject(data, { groupId: 'g', displayName: 'g', derivedName: 'g', members: [member('a')], now: NOW })
    linkMember(data, 'g', member('b'), NOW)
    linkMember(data, 'g', member('b'), NOW) // 重复
    expect(findProjectByMemberId(data, 'b')?.members).toHaveLength(2)

    const after = unlinkMember(data, 'g', 'b', NOW)
    expect(after?.members.map((m) => m.id)).toEqual(['a'])
    const gone = unlinkMember(data, 'g', 'a', NOW)
    expect(gone).toBeNull()
    expect(data.projects).toHaveLength(0)
  })

  it('reconcileMissing 按谓词标记缺失，不清除成员', () => {
    const data = createRegistry()
    createProject(data, {
      groupId: 'g',
      displayName: 'g',
      derivedName: 'g',
      members: [member('a', { rootPath: '/a' }), member('b', { rootPath: '/b' })],
      now: NOW
    })
    reconcileMissing(data, (p) => p === '/a')
    const p = data.projects[0]
    expect(p.members.find((m) => m.id === 'a')?.missing).toBe(false)
    expect(p.members.find((m) => m.id === 'b')?.missing).toBe(true)
    expect(p.members).toHaveLength(2) // 不清除
  })

  it('relocateMember 改路径并清缺失标记', () => {
    const data = createRegistry()
    createProject(data, {
      groupId: 'g',
      displayName: 'g',
      derivedName: 'g',
      members: [member('a', { rootPath: '/a', missing: true })],
      now: NOW
    })
    const p = relocateMember(data, 'g', 'a', '/new/a', NOW)
    expect(p?.members[0].rootPath).toBe('/new/a')
    expect(p?.members[0].missing).toBe(false)
  })
})

describe('removeProject — 整体移除项目', () => {
  it('移除存在的项目并返回 true', () => {
    const data = createRegistry()
    createProject(data, { groupId: 'g1', displayName: 'g1', derivedName: 'g1', members: [member('a')], now: NOW })
    createProject(data, { groupId: 'g2', displayName: 'g2', derivedName: 'g2', members: [member('b')], now: NOW })
    expect(removeProject(data, 'g1')).toBe(true)
    expect(data.projects.map((p) => p.id)).toEqual(['g2'])
  })

  it('移除不存在的项目返回 false 且不改动注册表', () => {
    const data = createRegistry()
    createProject(data, { groupId: 'g1', displayName: 'g1', derivedName: 'g1', members: [member('a')], now: NOW })
    expect(removeProject(data, 'nope')).toBe(false)
    expect(data.projects).toHaveLength(1)
  })
})

describe('项目激活工作流', () => {
  function withProject(): ReturnType<typeof createRegistry> {
    const data = createRegistry()
    createProject(data, { groupId: 'p', displayName: 'p', derivedName: 'p', members: [member('a')], now: NOW })
    return data
  }

  it('未设置时 getActiveWorkflow 返回 null', () => {
    expect(getActiveWorkflow(withProject(), 'p')).toBeNull()
  })

  it('宪法治理：未设置返回空、设置后读回、不存在项目返回 null', () => {
    const data = withProject()
    expect(getConstitutionGovernance(data, 'p')).toEqual({ activePackIds: [], disabledRules: [] })
    const gov = { activePackIds: ['rp-1'], disabledRules: [{ packId: 'rp-1', itemId: 'test-first' }] }
    const updated = setConstitutionGovernance(data, 'p', gov, NOW)
    expect(updated?.constitution).toEqual(gov)
    expect(getConstitutionGovernance(data, 'p')).toEqual(gov)
    expect(setConstitutionGovernance(data, 'nope', gov, NOW)).toBeNull()
  })

  it('设置后读回一致', () => {
    const data = withProject()
    const p = setActiveWorkflow(data, 'p', 'wf-1', NOW)
    expect(p?.activeWorkflowId).toBe('wf-1')
    expect(getActiveWorkflow(data, 'p')).toBe('wf-1')
  })

  it('设置 null 清除激活', () => {
    const data = withProject()
    setActiveWorkflow(data, 'p', 'wf-1', NOW)
    setActiveWorkflow(data, 'p', null, NOW)
    expect(getActiveWorkflow(data, 'p')).toBeNull()
  })

  it('对不存在的项目设置返回 null', () => {
    expect(setActiveWorkflow(withProject(), 'nope', 'wf', NOW)).toBeNull()
  })

  it('激活指针随身份保留：同 UUID 重复导入不丢失激活', () => {
    const data = createRegistry()
    upsertImport(data, gitImport())
    setActiveWorkflow(data, 'uuid-1', 'wf-keep', NOW)
    upsertImport(data, gitImport({ rootPath: '/moved/repo' })) // 复用同项目
    expect(getActiveWorkflow(data, 'uuid-1')).toBe('wf-keep')
  })

  it('clearActiveWorkflow 清除所有指向某工作流的激活，留其它不动', () => {
    const data = createRegistry()
    createProject(data, { groupId: 'p1', displayName: 'p1', derivedName: 'p1', members: [member('a')], now: NOW })
    createProject(data, { groupId: 'p2', displayName: 'p2', derivedName: 'p2', members: [member('b')], now: NOW })
    createProject(data, { groupId: 'p3', displayName: 'p3', derivedName: 'p3', members: [member('c')], now: NOW })
    setActiveWorkflow(data, 'p1', 'wf-del', NOW)
    setActiveWorkflow(data, 'p2', 'wf-del', NOW)
    setActiveWorkflow(data, 'p3', 'wf-other', NOW)
    clearActiveWorkflow(data, 'wf-del')
    expect(getActiveWorkflow(data, 'p1')).toBeNull()
    expect(getActiveWorkflow(data, 'p2')).toBeNull()
    expect(getActiveWorkflow(data, 'p3')).toBe('wf-other')
  })
})

describe('项目需求卡类型', () => {
  const leaf = (id: string, name = id): CardTypeDef => ({ id, name, description: '', archetype: 'leaf' })
  function withProject(): ReturnType<typeof createRegistry> {
    const data = createRegistry()
    createProject(data, { groupId: 'p', displayName: 'p', derivedName: 'p', members: [member('a')], now: NOW })
    return data
  }

  it('未设置时回落默认种子（含 epic/feature/bug）', () => {
    const ids = getProjectCardTypes(withProject(), 'p').map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining(['epic', 'feature', 'bug']))
  })

  it('设置后读回一致；不存在项目设置返回 null', () => {
    const data = withProject()
    const set = [leaf('spike', '探路')]
    expect(setProjectCardTypes(data, 'p', set, NOW)?.cardTypes).toEqual(set)
    expect(getProjectCardTypes(data, 'p')).toEqual(set)
    expect(setProjectCardTypes(data, 'nope', set, NOW)).toBeNull()
  })

  it('播种：在默认种子基础上幂等追加建议类型，已存在跳过', () => {
    const data = withProject()
    seedProjectCardTypes(data, 'p', [leaf('spike', '探路'), leaf('feature', '不该覆盖')], NOW)
    const byId = new Map(getProjectCardTypes(data, 'p').map((t) => [t.id, t.name]))
    expect(byId.get('spike')).toBe('探路') // 新 id 加入
    expect(byId.get('feature')).toBe('Feat') // 默认已存在，不被覆盖
  })

  it('播种到不同项目互不影响（项目级隔离）', () => {
    const data = createRegistry()
    createProject(data, { groupId: 'p1', displayName: 'p1', derivedName: 'p1', members: [member('a')], now: NOW })
    createProject(data, { groupId: 'p2', displayName: 'p2', derivedName: 'p2', members: [member('b')], now: NOW })
    seedProjectCardTypes(data, 'p1', [leaf('spike')], NOW)
    expect(getProjectCardTypes(data, 'p1').some((t) => t.id === 'spike')).toBe(true)
    expect(getProjectCardTypes(data, 'p2').some((t) => t.id === 'spike')).toBe(false)
  })
})

describe('upgradeGitlessMember — 补绑', () => {
  it('成员主键由路径升级为 UUID', () => {
    const data = createRegistry()
    upsertImport(data, gitImport({ projectId: null, git: null, rootPath: '/plain' }))
    const upgraded = upgradeGitlessMember(data, '/plain', {
      projectId: 'uuid-new',
      git: gitInfo({ commonDir: '/plain/.git' }),
      rootPath: '/plain',
      now: NOW
    })
    expect(upgraded?.idKind).toBe('uuid')
    expect(upgraded?.gitless).toBe(false)
    expect(findProjectByMemberId(data, 'uuid-new')).toBeDefined()
  })

  it('找不到路径成员返回 null', () => {
    const data = createRegistry()
    expect(
      upgradeGitlessMember(data, '/nope', { projectId: 'x', git: gitInfo(), rootPath: '/nope', now: NOW })
    ).toBeNull()
  })
})
