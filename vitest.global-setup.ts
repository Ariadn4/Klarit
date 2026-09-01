/**
 * 全局搭台/拆台：为本次 run 开一个临时目录根，跑完整体删掉。
 *
 * 各用例经 `src/main/test-tmp.ts` 的 `testTmpDir()` 把临时目录建在这个根下（含引擎在
 * 「仓的兄弟位置」建出的 worktree），所以这里一把删干净，不依赖各用例自己记得清理。
 * 根路径经 `KLARIT_TEST_TMP_ROOT` 传给各 worker 进程（它们在 setup 之后才 fork）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TEST_TMP_ROOT_ENV, TEST_TMP_ROOT_PREFIX } from './src/main/test-tmp'

let root: string | null = null

export function setup(): void {
  root = mkdtempSync(join(tmpdir(), TEST_TMP_ROOT_PREFIX))
  process.env[TEST_TMP_ROOT_ENV] = root
}

export function teardown(): void {
  // 清不掉不该让整轮测试失败（Windows 上偶有句柄未释放）——留给系统 TEMP 回收兜底。
  const drop = (dir: string): void => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 忽略 */
    }
  }
  if (root) drop(root)
  // 引擎的握手目录是**固定名**、不走 testTmpDir：生产在 index.ts 注入 userData 下的路径，
  // 只有不注入 `deps.handshakeDir` 的调用方（即测试）才会落到 `<TEMP>/klarit-handshakes`。
  // 故这里删它对真实应用无影响。
  drop(join(tmpdir(), 'klarit-handshakes'))
}
