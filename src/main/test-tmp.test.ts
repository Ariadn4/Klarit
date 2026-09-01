/**
 * 测试临时目录的统一出口：所有用例的临时目录都建在**同一个 run 级根目录**下，
 * 跑完由 vitest 的 globalTeardown 整体删掉——不依赖各个用例记不记得自己清理。
 *
 * 背景：此前 29 处各自往系统 TEMP 根建目录，三个月攒了 6218 个残留
 * （其中 1062 个还是引擎在测试里 `git worktree add` 出的兄弟目录，父仓清了它们还在）。
 */
import { describe, it, expect } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { testTmpDir, testTmpRoot } from './test-tmp'

describe('测试临时目录', () => {
  it('建出来的目录在 run 级根目录下，不直接落在系统 TEMP 根', () => {
    const dir = testTmpDir('klarit-unit-')
    expect(existsSync(dir)).toBe(true)
    expect(statSync(dir).isDirectory()).toBe(true)
    // 父目录必须是 run 根，而不是系统 TEMP —— 否则 teardown 一把删不掉
    expect(resolve(dirname(dir))).toBe(resolve(testTmpRoot()))
    expect(resolve(dirname(dir))).not.toBe(resolve(tmpdir()))
  })

  it('run 根本身在系统 TEMP 下，且带可辨认的前缀', () => {
    const root = testTmpRoot()
    expect(resolve(dirname(root))).toBe(resolve(tmpdir()))
    expect(root.includes('klarit-testrun-')).toBe(true)
  })

  it('前缀保留在目录名里（排查时还能看出是谁建的），且每次唯一', () => {
    const a = testTmpDir('klarit-alpha-')
    const b = testTmpDir('klarit-alpha-')
    expect(a).not.toBe(b)
    for (const d of [a, b]) expect(d.slice(root().length + 1).startsWith('klarit-alpha-')).toBe(true)
    function root(): string {
      return testTmpRoot()
    }
  })

  it('worktree 类兄弟目录也收在 run 根下：给出的路径可直接作 worktree 落点', () => {
    // 引擎测试会在「仓的兄弟位置」建 worktree（`<repo>/../<name>--wt--<card>`）。
    // 只要仓本身在 run 根下，其兄弟位置自然也在 run 根下，一并被 teardown 收走。
    const repo = testTmpDir('klarit-repo-')
    const sibling = join(dirname(repo), 'klarit-repo--wt--card-x')
    expect(resolve(dirname(sibling))).toBe(resolve(testTmpRoot()))
  })
})
