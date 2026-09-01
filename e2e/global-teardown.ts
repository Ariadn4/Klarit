/**
 * e2e 拆台：把本轮跑出来的临时目录整体删掉。
 *
 * `helpers.ts` 的 `tempDir()` 把所有临时目录（项目仓、userData、门脚本、以及引擎在「仓的
 * 兄弟位置」建出的 worktree）都建在同一个 run 根下（`<TEMP>/klarit-e2erun-<id>/`），
 * 这里一把删干净——单测那边同样的做法见 `vitest.global-setup.ts`。
 */
import { rmSync } from 'node:fs'
import { E2E_TMP_ROOT_ENV } from './helpers'

export default function globalTeardown(): void {
  // 只删 setup 建的那个；读不到就什么都不做——回落自建会新建一个空目录再删掉，
  // 反而把「setup 没跑」这件事盖过去。
  const root = process.env[E2E_TMP_ROOT_ENV]
  if (!root) return
  // 清不掉不该让整轮 e2e 失败（Windows 上偶有句柄未释放）——留给系统 TEMP 回收兜底。
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
}
