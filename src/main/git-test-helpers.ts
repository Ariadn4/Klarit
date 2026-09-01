/** 真实 git 仓库的测试搭台工具(非 *.test.ts,不作为用例集,仅供测试 import)。 */

import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { testTmpDir } from './test-tmp'

/** 在 dir 下同步跑 git,失败抛出;返回 trim 的 stdout。 */
export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
}

/** 建带初始提交的真实仓库,返回路径。 */
export function initRepo(prefix = 'klarit-eng-'): string {
  const dir = testTmpDir(prefix)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@klarit.dev')
  git(dir, 'config', 'user.name', 'Klarit Test')
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

/** 建裸仓库当远端,返回路径。 */
export function initBare(prefix = 'klarit-bare-'): string {
  const dir = testTmpDir(prefix)
  git(dir, 'init', '-q', '--bare', '-b', 'main')
  return dir
}

/** 一个可登记/统一清理临时目录的回收站。 */
export function makeTrash(): { track: (d: string) => string; cleanup: () => void } {
  const bin: string[] = []
  return {
    track(d) {
      bin.push(d)
      return d
    },
    cleanup() {
      while (bin.length) {
        try {
          rmSync(bin.pop()!, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    }
  }
}
