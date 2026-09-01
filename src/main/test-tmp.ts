/**
 * 测试临时目录的统一出口（非 *.test.ts，不作为用例集，仅供测试 import）。
 *
 * 所有用例的临时目录都建在**同一个 run 级根目录**下（`<TEMP>/klarit-testrun-<id>/`），
 * 跑完由 vitest 的 globalTeardown 整体删掉。这样不依赖各个用例记不记得自己清理——
 * 此前 29 处各自往系统 TEMP 根建目录，三个月攒了 6218 个残留，其中 1062 个还是引擎在
 * 测试里 `git worktree add` 出的**兄弟目录**：父仓被 afterEach 清掉了，兄弟位置的
 * worktree 没人管。收进同一个根就一并解决。
 *
 * run 根由 globalSetup 经 `KLARIT_TEST_TMP_ROOT` 传进各 worker 进程；直接跑单个测试文件
 * （不经 globalSetup）时按需自建一个，行为一致、只是不会被 teardown 收走。
 */

import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 环境变量名：globalSetup 写、各 worker 读。 */
export const TEST_TMP_ROOT_ENV = 'KLARIT_TEST_TMP_ROOT'

/** run 根目录前缀（globalTeardown 与人工排查都按它认）。 */
export const TEST_TMP_ROOT_PREFIX = 'klarit-testrun-'

let fallbackRoot: string | null = null

/**
 * 本次 run 的临时目录根。优先用 globalSetup 传下来的；没有（单跑某个文件、或别的 runner）
 * 就自建一个并在本进程内复用。
 */
export function testTmpRoot(): string {
  const fromEnv = process.env[TEST_TMP_ROOT_ENV]
  if (fromEnv) {
    mkdirSync(fromEnv, { recursive: true })
    return fromEnv
  }
  if (!fallbackRoot) fallbackRoot = mkdtempSync(join(tmpdir(), TEST_TMP_ROOT_PREFIX))
  return fallbackRoot
}

/**
 * 建一个测试用临时目录，返回绝对路径。`prefix` 原样保留在目录名里（排查时还能看出是谁建的）。
 * 各处原先直接往系统 TEMP 根建，差别只在落点改成了 run 根。
 */
export function testTmpDir(prefix: string): string {
  return mkdtempSync(join(testTmpRoot(), prefix))
}
