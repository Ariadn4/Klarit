import { describe, it, expect, afterEach, vi } from 'vitest'
import { rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { runCommand } from './command-run'
import { testTmpDir } from './test-tmp'

/** node 可执行（含空格路径时加引号），供 shell 解析。 */
const NODE = `"${process.execPath}"`

const trash: string[] = []
afterEach(() => {
  for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** 建一个临时工作目录并写入若干 .js 脚本，返回目录路径。 */
function workdir(scripts: Record<string, string>): string {
  const dir = testTmpDir('klarit-cmd-')
  trash.push(dir)
  for (const [name, body] of Object.entries(scripts)) writeFileSync(join(dir, name), body)
  return dir
}

/** 自旋等待条件成立（或超时）。 */
async function until(pred: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('until: 超时')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** 进程是否存活（kill 0 不抛即活）。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('command-run：可取消命令运行器', () => {
  it('成功命令返回 code=0 与 stdout，killed 为假', async () => {
    const dir = workdir({ 'ok.js': "console.log('hi')" })
    const r = await runCommand(`${NODE} ok.js`, { cwd: dir })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('hi')
    expect(r.killed).toBe(false)
  })

  it('非零退出以结构化结果返回而非抛错', async () => {
    const dir = workdir({ 'fail.js': 'console.error("boom"); process.exit(3)' })
    const r = await runCommand(`${NODE} fail.js`, { cwd: dir })
    expect(r.code).toBe(3)
    expect(r.stderr).toContain('boom')
    expect(r.killed).toBe(false)
  })

  it('流式增量回调 onChunk，且累积全量', async () => {
    const dir = workdir({
      'stream.js': "process.stdout.write('a');setTimeout(()=>{process.stdout.write('b');process.exit(0)},60)"
    })
    const chunks: Array<{ stream: string; chunk: string }> = []
    const r = await runCommand(`${NODE} stream.js`, {
      cwd: dir,
      onChunk: (stream, chunk) => chunks.push({ stream, chunk })
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('a')
    expect(r.stdout).toContain('b')
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.every((c) => c.stream === 'stdout')).toBe(true)
  })

  it(
    '取消即杀整棵进程树（子孙进程一并终止），killed 为真',
    async () => {
      const dir = workdir({
        'parent.js':
          "const{spawn}=require('child_process');const fs=require('fs');const c=spawn(process.execPath,['grand.js'],{stdio:'ignore'});fs.writeFileSync('gpid.txt',String(c.pid));setInterval(()=>{},1000)",
        'grand.js': 'setInterval(()=>{},1000)'
      })
      const ctrl = new AbortController()
      const done = runCommand(`${NODE} parent.js`, { cwd: dir, signal: ctrl.signal })
      const pidFile = join(dir, 'gpid.txt')
      await until(() => existsSync(pidFile))
      const gpid = Number(readFileSync(pidFile, 'utf8').trim())
      expect(alive(gpid)).toBe(true)
      ctrl.abort()
      const r = await done
      expect(r.killed).toBe(true)
      await until(() => !alive(gpid))
      expect(alive(gpid)).toBe(false)
    },
    15000
  )

  it(
    '永不退出的命令可被取消',
    async () => {
      const dir = workdir({ 'sleep.js': 'setInterval(()=>{},1000)' })
      const ctrl = new AbortController()
      const done = runCommand(`${NODE} sleep.js`, { cwd: dir, signal: ctrl.signal })
      await new Promise((r) => setTimeout(r, 100))
      ctrl.abort()
      const r = await done
      expect(r.killed).toBe(true)
    },
    15000
  )
})

/** 临时改写 process.platform（`isWin` 在模块加载期求值，故须配合 resetModules 重新 import）。 */
function withPlatform(p: NodeJS.Platform): () => void {
  const orig = process.platform
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
  return () => Object.defineProperty(process, 'platform', { value: orig, configurable: true })
}

describe('command-run：杀进程树失败不冒泡到进程级', () => {
  it('杀进程树的手段拉不起来也不崩进程', async () => {
    const restore = withPlatform('win32')
    // EventEmitter 的契约：'error' 事件无监听者即抛。捕到抛出＝错误逃逸成了未捕获异常。
    let escaped: unknown = null
    vi.resetModules()
    vi.doMock('node:child_process', () => ({
      spawn: () => {
        const fake = new EventEmitter()
        process.nextTick(() => {
          try {
            fake.emit('error', Object.assign(new Error('spawn taskkill ENOENT'), { code: 'ENOENT' }))
          } catch (e) {
            escaped = e
          }
        })
        return fake
      }
    }))
    try {
      const { killTree } = await import('./command-run')
      expect(() => killTree(4242)).not.toThrow()
      await new Promise((r) => setTimeout(r, 0))
    } finally {
      restore()
      vi.doUnmock('node:child_process')
      vi.resetModules()
    }
    expect(escaped).toBeNull()
  })

  it('延后的兜底强杀失败也不崩进程', async () => {
    const restore = withPlatform('linux')
    vi.useFakeTimers()
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
    })
    vi.resetModules()
    try {
      const { killTree } = await import('./command-run')
      expect(() => killTree(4242)).not.toThrow()
      // 宽限期后的兜底 SIGKILL 在事件循环后续轮次里跑，抛出即未捕获异常。
      expect(() => vi.advanceTimersByTime(2000)).not.toThrow()
      expect(killSpy).toHaveBeenCalledTimes(2)
    } finally {
      killSpy.mockRestore()
      vi.useRealTimers()
      restore()
      vi.resetModules()
    }
  })
})
