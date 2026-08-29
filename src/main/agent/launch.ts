/**
 * agent 子进程的**唯一**启动实现——全部调用点（引擎节点 agent、续接、heal、分解、全局对话）都走这里，
 * 别在别处再写一份。它承载「进的方向」的全部约束：
 *
 * 1. **以探测出的可执行绝对路径启动**（`agent-detection` 的产物），绝不把裸命令名交给 shell 解析：
 *    子进程的 cwd 是需求卡 worktree（内容由外部 agent 写入、可能源自导入的第三方项目），而 Windows
 *    的命令解析**先搜当前目录**——交裸名等于让被管理的仓库决定起哪个可执行文件。
 * 2. **argv 不经 shell 字符串拼接**：`.exe` 直起（参数走数组，结构上没有拼接面）；`.cmd` / `.bat`
 *    必须过 cmd.exe，则由**我们自己**逐项加引号——Node 在 `shell: true` 时把 command 与 args 用空格
 *    直接 join 且不加引号，那正是注入面的根因。
 * 3. **环境净化**：显式关掉着色、剔除会让 CLI 误判终端能力的键，使输出与「用户怎么启动本应用」无关。
 *
 * 解析不到可信绝对路径 → 归技术失败（`{ ok: false, reason }`），**绝不回落裸命令名**：起一个身份不确定
 * 的东西比不起更糟。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { killTree } from '../command-run'
import type { DetectedAgent } from '../../shared/types'

const isWin = process.platform === 'win32'

/** 本机已检测到的 agent（含可执行绝对路径）——启动的唯一可信来源，由主进程扫描后灌进来。 */
let detected: DetectedAgent[] = []

/** 灌入本次扫描的结果（应用启动时扫一次）。传空＝一个都没检测到，随后任何启动都会归技术失败。 */
export function setDetectedAgents(list: DetectedAgent[]): void {
  detected = [...list]
}

/** 按外壳 id 取已检测到的 agent；未检测到返回 null（调用方按技术失败处理）。 */
export function detectedAgent(toolId: string): DetectedAgent | null {
  return detected.find((a) => a.id === toolId) ?? null
}

/** 启动结果：成功给子进程与「杀整棵进程树」的句柄；失败给可辨认原因（供归技术失败时展示）。 */
export type AgentSpawnOutcome =
  | { ok: true; child: ChildProcess; kill: () => void }
  | { ok: false; reason: string }

/**
 * 会让 CLI 误判「我在富终端里」的环境键——取值取决于用户**怎么启动本应用**（桌面图标 vs 终端内命令），
 * 留着会造成同一版本下 agent 输出的转义序列有无不同，且在开发者机器上复现不了。
 */
const DROP_ENV = new Set(['wt_session', 'wt_profile_id', 'colorterm', 'clicolor_force', 'term_program', 'term_program_version'])

/** 子进程环境：继承父进程但剔除终端能力声明，并显式关掉 ANSI 着色（输出要进纯文本展示与原始记录）。 */
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!DROP_ENV.has(k.toLowerCase())) env[k] = v
  }
  env.NO_COLOR = '1'
  env.FORCE_COLOR = '0'
  return env
}

/** 必须经 cmd.exe 才能起的形态（CreateProcess 起不了批处理文件）。 */
function needsCmdShell(exe: string): boolean {
  return /\.(cmd|bat)$/i.test(exe)
}

/** cmd 命令行里无法安全表达的字符：`%` 会被变量展开、CR/LF 会截断命令行、NUL 非法。 */
const UNSAFE_IN_CMD_LINE = /[%\r\n\0]/

/**
 * 把一项参数转成 cmd.exe 命令行里的一个 token：**整项用真引号包住**（引号内的 `& | < >` 对 cmd 不再是
 * 元字符），项内的 `"` 加倍为 `""`（cmd 与 MSVCRT 的解析在这一点上一致），引号前与结尾的反斜杠加倍
 * （否则 `C:\dir\` 结尾的反斜杠会把闭引号吃掉）。已撞真 cmd.exe + npm 风格 `.cmd` 垫片（`%*` 再解析
 * 一轮）验证：含空格 / `&` / `|` / `"` / 结尾反斜杠 / 空串的参数均以字面值抵达，且不产生第二条命令。
 */
function quoteForCmdLine(arg: string): string {
  let body = ''
  let backslashes = 0
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++
      continue
    }
    if (ch === '"') {
      body += '\\'.repeat(backslashes * 2) + '""'
      backslashes = 0
      continue
    }
    body += '\\'.repeat(backslashes)
    backslashes = 0
    body += ch
  }
  return `"${body}${'\\'.repeat(backslashes * 2)}"`
}

/** 拼 `cmd /d /s /c "<整行>"` 的整行；含无法安全表达的字符时返回 null（宁可不起，不静默改写）。 */
function buildCmdLine(exe: string, args: string[]): string | null {
  if (UNSAFE_IN_CMD_LINE.test(exe) || args.some((a) => UNSAFE_IN_CMD_LINE.test(a))) return null
  // 可执行路径用真引号（Windows 文件名不含 `"`）；其余逐项转义。外层再包一层引号配合 `/s` 原样交付。
  const line = [`"${exe}"`, ...args.map(quoteForCmdLine)].join(' ')
  return `"${line}"`
}

/** 按外壳 id + argv 起一个 agent 子进程（stdin/stdout/stderr 全 pipe）。永不抛：失败以 `ok:false` 表达。 */
export function spawnAgent(opts: { toolId: string; args: string[]; cwd?: string }): AgentSpawnOutcome {
  const agent = detectedAgent(opts.toolId)
  if (!agent) {
    return { ok: false, reason: `未检测到外壳 ${opts.toolId} 的可执行文件：解析不到可信绝对路径，拒绝以裸命令名启动` }
  }
  const exe = agent.executablePath
  if (!exe || !isAbsolute(exe)) {
    return { ok: false, reason: `外壳 ${opts.toolId} 的可执行路径不可信（非绝对路径）：${exe}` }
  }

  const base = {
    cwd: opts.cwd,
    env: childEnv(),
    detached: !isWin, // POSIX：独立进程组以便整组 kill；win 由 taskkill /T 处理
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  }

  let child: ChildProcess
  try {
    if (needsCmdShell(exe)) {
      const line = buildCmdLine(exe, opts.args)
      if (line === null) {
        return { ok: false, reason: '参数含 cmd.exe 无法安全表达的字符（% 或换行），拒绝启动' }
      }
      // 自己加引号 + windowsVerbatimArguments：不让 Node 再拼一层（它 shell:true 时按空格 join 且不加引号）。
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
        ...base,
        windowsVerbatimArguments: true
      })
    } else {
      // 参数以数组传递、不经 shell —— 没有字符串拼接面。
      child = spawn(exe, opts.args, base)
    }
  } catch (e) {
    return { ok: false, reason: `拉起 ${exe} 失败：${e instanceof Error ? e.message : String(e)}` }
  }

  return { ok: true, child, kill: () => (child.pid ? killTree(child.pid) : undefined) }
}
