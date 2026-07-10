import { describe, it, expect } from 'vitest'
import type { Project, RepoMember } from './types'
import { projectRootPath } from './project'

function member(id: string, rootPath: string): RepoMember {
  return {
    id,
    idKind: 'uuid',
    derivedName: id,
    rootPath,
    worktreePaths: [rootPath],
    git: null,
    gitless: true
  }
}

function project(members: RepoMember[]): Project {
  return { id: 'p', displayName: 'p', derivedName: 'p', members, createdAt: '', updatedAt: '' }
}

describe('projectRootPath', () => {
  it('单仓取该成员路径', () => {
    expect(projectRootPath(project([member('a', '/work/repo')]))).toBe('/work/repo')
  })

  it('多仓取成员公共父目录（posix）', () => {
    const p = project([member('fe', '/work/product/frontend'), member('be', '/work/product/backend')])
    expect(projectRootPath(p)).toBe('/work/product')
  })

  it('多仓取成员公共父目录（windows 反斜杠）', () => {
    const p = project([
      member('fe', 'F:\\product\\frontend'),
      member('be', 'F:\\product\\backend')
    ])
    expect(projectRootPath(p)).toBe('F:\\product')
  })

  it('windows 盘符根补回分隔符', () => {
    const p = project([member('fe', 'F:\\frontend'), member('be', 'F:\\backend')])
    expect(projectRootPath(p)).toBe('F:\\')
  })

  it('成员散落不同父目录时退化为最近公共祖先', () => {
    const p = project([member('fe', '/a/x/fe'), member('be', '/a/y/be')])
    expect(projectRootPath(p)).toBe('/a')
  })

  it('无成员返回空串', () => {
    expect(projectRootPath(project([]))).toBe('')
  })
})
