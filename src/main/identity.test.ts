import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureProjectId, readProjectId, writeProjectId } from './identity'
import { testTmpDir } from './test-tmp'

let dir: string

beforeEach(() => {
  dir = testTmpDir('klarit-id-')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('project identity', () => {
  it('缺失时 readProjectId 返回 null', () => {
    expect(readProjectId(dir)).toBeNull()
  })

  it('ensureProjectId 生成 UUID 并写入 .klarit/project-id', () => {
    const id = ensureProjectId(dir)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(readProjectId(dir)).toBe(id)
    expect(readFileSync(join(dir, '.klarit', 'project-id'), 'utf8').trim()).toBe(id)
  })

  it('已存在时 ensureProjectId 原样返回，不覆盖', () => {
    writeProjectId(dir, 'existing-id')
    expect(ensureProjectId(dir)).toBe('existing-id')
  })

  it('preferred 仅在缺失时生效（多 worktree 复用既有 id）', () => {
    expect(ensureProjectId(dir, 'shared-uuid')).toBe('shared-uuid')
    // 再次调用即便给不同 preferred 也不覆盖
    expect(ensureProjectId(dir, 'other')).toBe('shared-uuid')
  })

  it('生成的 UUID 各不相同', () => {
    const a = ensureProjectId(testTmpDir('klarit-id-'))
    const b = ensureProjectId(testTmpDir('klarit-id-'))
    expect(a).not.toBe(b)
  })
})
