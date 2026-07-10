import { describe, it, expect } from 'vitest'
import type { Project, RepoMember, StoredCard } from '../shared/types'
import { deriveRunRequest } from './card-run'

function member(id: string, rootPath: string): RepoMember {
  return {
    id,
    idKind: 'uuid',
    derivedName: id,
    rootPath,
    worktreePaths: [rootPath],
    git: null,
    gitless: false
  }
}

function project(over: Partial<Project>): Project {
  return {
    id: 'p1',
    displayName: 'P',
    derivedName: 'P',
    members: [member('repo-a', '/work/a'), member('repo-b', '/work/b')],
    activeWorkflowId: 'wf1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over
  }
}

function card(over: Partial<StoredCard>): StoredCard {
  return {
    proposedName: 'add-thing',
    title: 'Add thing',
    description: '',
    typeId: 'feat',
    relations: [],
    status: '未开始',
    createdAt: 0,
    updatedAt: 0,
    projectId: 'p1',
    repos: ['repo-a'],
    ...over
  }
}

describe('deriveRunRequest', () => {
  it('单仓卡派生：branch=slug、repoPath=首仓、repos 单元素、workflowId=激活工作流、cardId=卡 id', () => {
    const r = deriveRunRequest(card({}), project({}))
    expect(r).toEqual({
      ok: true,
      request: {
        workflowId: 'wf1',
        repoPath: '/work/a',
        repos: [{ memberId: 'repo-a', repoPath: '/work/a', tag: undefined }],
        branch: 'add-thing',
        cardId: 'add-thing',
        avoidBranchConflict: true
      }
    })
  })

  it('多仓卡派生一个扇出运行：repos 含全部涉及仓(按 card.repos 顺序)、repoPath=首仓', () => {
    const r = deriveRunRequest(card({ repos: ['repo-b', 'repo-a'] }), project({}))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.repoPath).toBe('/work/b')
    expect(r.request.repos).toEqual([
      { memberId: 'repo-b', repoPath: '/work/b', tag: undefined },
      { memberId: 'repo-a', repoPath: '/work/a', tag: undefined }
    ])
  })

  it('派生带上成员标签(供 target=tag 解析)', () => {
    const p = project({
      members: [
        { ...member('repo-a', '/work/a'), tag: '前端' },
        { ...member('repo-b', '/work/b'), tag: '后端' }
      ]
    })
    const r = deriveRunRequest(card({ repos: ['repo-a', 'repo-b'] }), p)
    expect(r.ok && r.request.repos).toEqual([
      { memberId: 'repo-a', repoPath: '/work/a', tag: '前端' },
      { memberId: 'repo-b', repoPath: '/work/b', tag: '后端' }
    ])
  })

  it('项目无激活工作流 → 不派生、回可读原因', () => {
    const r = deriveRunRequest(card({}), project({ activeWorkflowId: null }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/工作流/)
  })

  it('卡 repos 为空 → 不派生、回可读原因', () => {
    const r = deriveRunRequest(card({ repos: [] }), project({}))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/成员仓/)
  })

  it('卡首仓不在项目成员中 → 不派生、回可读原因', () => {
    const r = deriveRunRequest(card({ repos: ['ghost'] }), project({}))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/ghost/)
  })
})
