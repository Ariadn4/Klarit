import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from './command-run'

/** node 可执行（含空格路径时加引号），供 shell 解析。 */
const NODE = `"${process.execPath}"`

const trash: string[] = []
afterEach(() => {
  for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** 建一个临时工作目录并写入若干 .js 脚本，返回目录路径。 */
function workdir(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'klarit-cmd-'))
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
