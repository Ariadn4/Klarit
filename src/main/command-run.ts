/**
 * 可取消的命令运行器:`spawn` + shell 跑任意 CLI 串,**流式**捕获 stdout/stderr,结束返回
 * 结构化结果 `{ code, stdout, stderr, killed }`。与 `git-write.ts` 并列(git 走专用运行器,
 * 自由命令走这里)。命令为工作流作者自填的可信输入,故经 shell 解析(同 `agent-runner` 信任级)。
 *
 * 取消(signal.abort)时**杀整棵进程树**——`shell:true` 下杀父 shell 在 Windows 会留下孙子(node)
 * 进程,故 Windows 走 `taskkill /T /F`、POSIX 用 `detached` 进程组 + `kill(-pid)`。被取消即 `killed`。
 * 杀进程树是**尽力而为**:其自身失败静默,且绝不冒泡到进程级(异步 `'error'` 事件与延后的兜底强杀
 * 都得接住),否则一次取消就能崩掉主进程。
 * 永不抛:失败以非零 `code` 表达(由调用方据 `code`/`killed` 判定)。
 */

import { spawn } from 'node:child_process'

export type CommandStream = 'stdout' | 'stderr'

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
  /** 是否被取消(signal.abort)而终止——用于区分「命令真失败」与「被主动打断」。 */
  killed: boolean
}

export interface RunCommandOptions {
  cwd: string
  /** 取消信号:触发即杀整棵进程树。 */
  signal?: AbortSignal
  /** 流式输出回调(边收边推增量)。 */
  onChunk?: (stream: CommandStream, chunk: string) => void
  /** 子进程拉起后回调,暴露杀进程树的句柄(供「转后台」后仍可中止)。 */
  onStart?: (handle: { kill: () => void }) => void
}

const isWin = process.platform === 'win32'

/**
 * 杀掉以 pid 为根的整棵进程树(绝不残留孤儿)。**尽力而为**:杀不掉就静默——不同步抛,
 * 也不让异步错误冒泡到进程级(调用方均为即发即忘,一次失败不该带走主进程)。
 */
export function killTree(pid: number): void {
  if (isWin) {
    // /T 连子孙、/F 强制。
    try {
      const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
      // spawn 拉起失败是**异步 'error' 事件**(不是 throw),无监听者时 Node 抛未捕获异常——必须接住。
      tk.on('error', () => {
        /* taskkill 缺失/句柄耗尽,忽略 */
      })
    } catch {
      /* 参数非法等同步失败,忽略 */
    }
    return
  }
  // POSIX:子进程以 detached 起,自成进程组(pgid===pid),负号杀整组。
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    /* 已退,忽略 */
  }
  // 宽限后兜底 SIGKILL。回调在事件循环后续轮次里跑,抛出即未捕获异常——try/catch 不可省。
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* 已死,忽略 */
    }
  }, 2000).unref?.()
}

/** 在 cwd 下经 shell 跑 command,流式捕获、可取消(杀进程树),永不抛。 */
export function runCommand(command: string, opts: RunCommandOptions): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      shell: true,
      // POSIX:独立进程组以便整组 kill;Windows 由 taskkill /T 处理。
      detached: !isWin,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    if (child.pid) opts.onStart?.({ kill: () => child.pid && killTree(child.pid) })

    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString()
      stdout += s
      opts.onChunk?.('stdout', s)
    })
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString()
      stderr += s
      opts.onChunk?.('stderr', s)
    })

    const onAbort = (): void => {
      killed = true
      if (child.pid) killTree(child.pid)
    }
    if (opts.signal) {
      if (opts.signal.aborted) onAbort()
      else opts.signal.addEventListener('abort', onAbort, { once: true })
    }

    const cleanup = (): void => {
      opts.signal?.removeEventListener('abort', onAbort)
    }

    child.on('error', (e) => {
      // 拉起失败(命令不存在等):以非零 code + stderr 表达,不抛。
      cleanup()
      resolve({ code: 1, stdout, stderr: stderr || String(e), killed })
    })
    child.on('close', (code) => {
      cleanup()
      resolve({ code: code ?? (killed ? -1 : 1), stdout: stdout.trim(), stderr: stderr.trim(), killed })
    })
  })
}
