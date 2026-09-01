/**
 * e2e 搭台：在**主进程**开出本轮的临时目录根，经 `KLARIT_E2E_TMP_ROOT` 传给各 worker。
 *
 * 必须在这里建：worker 是独立进程，它自己建的根写进 `process.env` 传不回主进程，
 * `global-teardown.ts` 就读不到、删不掉（实测会剩一个 `klarit-e2erun-*`）。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { E2E_TMP_ROOT_ENV } from './helpers'

export default function globalSetup(): void {
  process.env[E2E_TMP_ROOT_ENV] = mkdtempSync(join(tmpdir(), 'klarit-e2erun-'))
}
