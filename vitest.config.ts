import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          // 引擎/git 写侧用例跑真实 git 子进程，并行负载下单条链路可达数秒——放宽超时。
          testTimeout: 30000,
          include: [
            'src/main/**/*.test.ts',
            'src/shared/**/*.test.ts',
            'src/preload/**/*.test.ts'
          ]
        }
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@renderer': resolve('src/renderer/src'),
            '@shared': resolve('src/shared')
          }
        },
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/renderer/**/*.test.{ts,tsx}']
        }
      }
    ]
  }
})
