import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // 搭台/拆台：主进程开一个本轮的临时目录根，跑完整体删掉（见 e2e/global-setup.ts）。
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 }
})
