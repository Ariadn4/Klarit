/**
 * **习惯上下文包**（habit-context）：把 `agent-habits` 枚举到的痕迹路径**逐字物化**成一个 per-run 的小目录，
 * 作为自动 author 的唯一可访问目录（`--add-dir`）——取代「把成员仓根整个挂给 author」（大项目上 author 极慢、
 * CPU 累计上万秒）。
 *
 * **物化 ≠ 抽取**：Klarit 只决定「哪些文件值得给」（枚举），文件**整份逐字复制**——不解析、不摘要、不改写、
 * 不截断；超体积上限的文件**整个不收录**并在 manifest 标注（半截的规矩文件比没有更容易让 author 误判）。
 * 解读全部照旧归 author。
 *
 * manifest 只放**确定性、一次跑完、原样贴回**的东西：每个文件的真实绝对路径、成员仓清单、`git log --oneline`
 * 近若干条、各仓 `package.json` 的 `scripts`、深度受限的项目目录清单（只列路径、不读内容）。
 *
 * 包是 **per-run**：每次 author 调用新建，结束（正常/失败/超时）即清。**MUST NOT** 建在任何成员仓内或项目
 * 目录内——写进用户仓库会进 git、污染用户项目；故建在**应用临时区**（`tmpRoot` 由调用方注入，主进程给
 * `app.getPath('temp')`）。
 */

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, relative, sep } from 'node:path'
import { enumerateHabitPaths } from './agent-habits'
import { makeGitRunner, type GitRunner } from './git'

/** 一个成员仓在包内的身份：`name` 决定包内子目录（多仓同名 `CLAUDE.md` 不互相覆盖），`root` 是仓根真实路径。 */
export interface HabitContextMember {
  name: string
  root: string
}

/** 收录进包的一份文件：包内相对路径（posix 分隔）+ 原文件真实绝对路径。 */
export interface HabitPackedFile {
  packRelPath: string
  sourcePath: string
}

/** 未收录的文件：真实绝对路径 + 字节数 + 原因（`too-large` = 过大；`too-many` = 超数量上限）。 */
export interface HabitOmittedFile {
  sourcePath: string
  bytes: number
  reason: 'too-large' | 'too-many'
}

/** 一次物化的产物：包目录 + manifest 路径 + 收录/未收录清单。 */
export interface HabitContextPack {
  dir: string
  manifestPath: string
  files: HabitPackedFile[]
  omitted: HabitOmittedFile[]
}

/** manifest 文件名（包根下）。 */
export const HABIT_CONTEXT_MANIFEST_NAME = 'MANIFEST.md'
/** 单文件体积上限：超出**整个不收录**（绝不给半截）。 */
export const HABIT_CONTEXT_MAX_FILE_BYTES = 256 * 1024
/** 单个包的文件数上限（防某仓 `.github/` 之类异常膨胀拖慢物化）。 */
export const HABIT_CONTEXT_MAX_FILES = 300
/** 项目目录清单的深度上限（只列路径、不读内容）。 */
export const HABIT_CONTEXT_TREE_DEPTH = 2
/** manifest 收录的 `git log --oneline` 条数。 */
export const HABIT_CONTEXT_GIT_LOG_COUNT = 30
/** 目录清单里跳过的噪音目录（列了也没信息量，还很大）。 */
const TREE_SKIP = new Set(['.git', 'node_modules'])

export interface HabitContextDeps {
  /** 应用临时区根（主进程给 `app.getPath('temp')` 下的子目录）——包只建在这里。 */
  tmpRoot: string
  /** 逐仓 git runner（默认真实 git）；manifest 的 `git log` 取其**原样输出**。 */
  git?: (root: string) => GitRunner
  maxFileBytes?: number
  maxFiles?: number
  treeDepth?: number
  gitLogCount?: number
  /**
   * **回退路径**（design.md「会漏，这是明知的取舍」）：dogfood 若发现 author 漏得厉害，把成员仓根**也**挂给
   * author（「挂仓根 + manifest 引导」），代价是 CPU 可能治不好。默认 false = 只挂包。
   */
  mountMemberRoots?: boolean
}

/** 一次 author 调用可见的上下文：可访问目录（喂 `--add-dir`）+ 本次的包（无痕迹时为 null）。 */
export interface HabitContextRun {
  addDirs: string[]
  pack: HabitContextPack | null
}

/** 成员仓名 → 可作目录名的安全片段（撞名由调用处去重）。 */
function safeName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned === '' ? fallback : cleaned
}

/** 包内子目录名：按成员仓名去重（`app`、`app-2`…），保证多仓同名文件互不覆盖。 */
function packDirNames(members: HabitContextMember[]): string[] {
  const used = new Set<string>()
  return members.map((m, i) => {
    const base = safeName(m.name, `repo-${i + 1}`)
    let name = base
    let n = 1
    while (used.has(name)) name = `${base}-${++n}`
    used.add(name)
    return name
  })
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * 把一个痕迹路径（文件或目录）**逐字**复制进包：目录递归、文件整份 `copyFileSync`（不读不改）。
 * 超单文件上限或超包内文件数上限的**整个不收录**，登记进 `omitted` 供 manifest 标注。
 */
function copyVerbatim(
  sourcePath: string,
  packRelPath: string,
  packDir: string,
  limits: { maxFileBytes: number; maxFiles: number },
  files: HabitPackedFile[],
  omitted: HabitOmittedFile[]
): void {
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(sourcePath)
  } catch {
    return // 枚举与复制之间被删/无权限：跳过，不让备料拖垮 author。
  }
  if (stat.isDirectory()) {
    let entries: string[]
    try {
      entries = readdirSync(sourcePath)
    } catch {
      return
    }
    for (const name of entries.sort()) {
      copyVerbatim(join(sourcePath, name), `${packRelPath}/${name}`, packDir, limits, files, omitted)
    }
    return
  }
  if (!stat.isFile()) return
  if (stat.size > limits.maxFileBytes) {
    omitted.push({ sourcePath, bytes: stat.size, reason: 'too-large' })
    return
  }
  if (files.length >= limits.maxFiles) {
    omitted.push({ sourcePath, bytes: stat.size, reason: 'too-many' })
    return
  }
  const dest = join(packDir, ...packRelPath.split('/'))
  try {
    mkdirSync(join(dest, '..'), { recursive: true })
    copyFileSync(sourcePath, dest) // 逐字节：不经读-改-写，绝不摘要/截断/改写。
  } catch {
    return
  }
  files.push({ packRelPath, sourcePath })
}

/** 深度受限的目录清单：只列路径（目录带尾斜杠），**不打开任何文件**。 */
function listTree(root: string, maxDepth: number): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > maxDepth || out.length >= 400) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries.sort()) {
      if (TREE_SKIP.has(name)) continue
      if (out.length >= 400) return
      const abs = join(dir, name)
      const dirEntry = isDirectory(abs)
      out.push(dirEntry ? `${prefix}${name}/` : `${prefix}${name}`)
      if (dirEntry) walk(abs, `${prefix}${name}/`, depth + 1)
    }
  }
  walk(root, '', 1)
  return out
}

/** 取某仓 `package.json` 的 `scripts` 块（原样 JSON 文本）；无/读不动/无 scripts → null。 */
function readScripts(root: string): string | null {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const scripts = (pkg as { scripts?: unknown } | null)?.scripts
    if (!scripts || typeof scripts !== 'object') return null
    return JSON.stringify(scripts, null, 2)
  } catch {
    return null
  }
}

/** 一段带围栏的原样输出（manifest 里的摘要一律原样贴，不归纳）。 */
function fenced(body: string, lang = ''): string {
  return ['```' + lang, body, '```'].join('\n')
}

/** 组装 manifest 文本：真实路径 + 成员仓清单 + git log/scripts 原样输出 + 深度受限目录清单。 */
function buildManifest(
  members: { member: HabitContextMember; packName: string }[],
  files: HabitPackedFile[],
  omitted: HabitOmittedFile[],
  deps: Required<Pick<HabitContextDeps, 'gitLogCount' | 'treeDepth'>> & { git: (root: string) => GitRunner }
): string {
  const lines: string[] = [
    '# 习惯上下文包（Klarit 为本次自动 author 物化）',
    '',
    '这里的文件是本项目 agent 习惯痕迹的**逐字副本**（未做任何摘要、截断或改写），按 `<成员仓名>/<原相对路径>` 组织。',
    '下面的摘要是 Klarit 跑命令取回的**原始输出**，未做归纳——请你自己读、自己判断。',
    '本包是本次调用专用的临时目录，用完即删；项目其余文件不在你的可访问范围内，无需也无法遍历。',
    '',
    '## 成员仓清单',
    ''
  ]
  for (const { member, packName } of members) lines.push(`- \`${packName}/\` ← 成员仓「${member.name}」：${member.root}`)

  lines.push('', '## 包内文件（包内位置 ← 原项目中的真实路径）', '')
  if (files.length === 0) lines.push('（无）')
  for (const f of files) lines.push(`- \`${f.packRelPath}\` ← ${f.sourcePath}`)

  if (omitted.length > 0) {
    lines.push('', '## 未收录的痕迹文件', '')
    for (const o of omitted) {
      const why = o.reason === 'too-large' ? '过大未收录' : '数量超上限未收录'
      lines.push(`- ${o.sourcePath}（${o.bytes} 字节）：${why}——包内没有它，需要时请让用户自行提供`)
    }
  }

  lines.push('', `## git log --oneline -n ${deps.gitLogCount}（各成员仓，原样输出）`, '')
  for (const { member } of members) {
    const log = deps.git(member.root)(['log', '--oneline', '-n', String(deps.gitLogCount)])
    lines.push(`### ${member.name}`, '')
    lines.push(log && log.trim() !== '' ? fenced(log) : '（无 git 提交历史或非 git 仓）')
    lines.push('')
  }

  lines.push('## package.json 的 scripts（各成员仓，原样输出）', '')
  for (const { member } of members) {
    const scripts = readScripts(member.root)
    lines.push(`### ${member.name}`, '')
    lines.push(scripts ? fenced(scripts, 'json') : '（无 package.json 或无 scripts）')
    lines.push('')
  }

  lines.push(`## 项目目录清单（各成员仓，深度 ${deps.treeDepth} 以内，只列路径、未读内容）`, '')
  for (const { member } of members) {
    lines.push(`### ${member.name}`, '')
    const tree = listTree(member.root, deps.treeDepth)
    lines.push(tree.length > 0 ? fenced(tree.join('\n')) : '（空）')
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 物化一个习惯上下文包：枚举命中 → 逐字复制 → 写 manifest。**无任何痕迹命中 → 返回 null（不建包）**。
 * 包建在 `deps.tmpRoot` 下的新临时目录里，绝不落在成员仓/项目目录内。
 */
export function materializeHabitContext(
  members: HabitContextMember[],
  deps: HabitContextDeps
): HabitContextPack | null {
  const hits = enumerateHabitPaths(members.map((m) => m.root))
  if (hits.length === 0) return null

  const names = packDirNames(members)
  const paired = members.map((member, i) => ({ member, packName: names[i] }))
  const packNameOf = new Map(paired.map(({ member, packName }) => [member.root, packName]))

  mkdirSync(deps.tmpRoot, { recursive: true })
  const dir = mkdtempSync(join(deps.tmpRoot, 'habits-'))

  const limits = {
    maxFileBytes: deps.maxFileBytes ?? HABIT_CONTEXT_MAX_FILE_BYTES,
    maxFiles: deps.maxFiles ?? HABIT_CONTEXT_MAX_FILES
  }
  const files: HabitPackedFile[] = []
  const omitted: HabitOmittedFile[] = []
  for (const hit of hits) {
    const packName = packNameOf.get(hit.memberRoot)
    if (!packName) continue
    const rel = relative(hit.memberRoot, hit.path).split(sep).filter(Boolean).join('/')
    copyVerbatim(hit.path, `${packName}/${rel}`, dir, limits, files, omitted)
  }

  const manifestPath = join(dir, HABIT_CONTEXT_MANIFEST_NAME)
  writeFileSync(
    manifestPath,
    buildManifest(paired, files, omitted, {
      git: deps.git ?? makeGitRunner,
      gitLogCount: deps.gitLogCount ?? HABIT_CONTEXT_GIT_LOG_COUNT,
      treeDepth: deps.treeDepth ?? HABIT_CONTEXT_TREE_DEPTH
    }),
    'utf8'
  )
  return { dir, manifestPath, files, omitted }
}

/** 删掉整个包目录。清理失败**只吞不抛**——备料的收尾绝不影响主流程。 */
export function cleanupHabitContext(pack: HabitContextPack): void {
  try {
    rmSync(pack.dir, { recursive: true, force: true })
  } catch {
    // 清理失败（文件被占用等）不影响主流程：临时区由系统兜底回收。
  }
}

/**
 * per-run 生命周期收口：建包 → 把可访问目录交给 `run` → **try-finally 清包**（正常/失败/超时都清）。
 * 可访问目录默认**只有包**（不挂成员仓根）；`deps.mountMemberRoots` 打开回退路径「挂仓根 + manifest 引导」。
 * 无痕迹时不建包，`pack` 为 null、`addDirs` 为空（自动 author 本就不因习惯而触发）。
 */
export async function withHabitContextPack<T>(
  members: HabitContextMember[],
  deps: HabitContextDeps,
  run: (ctx: HabitContextRun) => Promise<T>
): Promise<T> {
  const pack = materializeHabitContext(members, deps)
  const addDirs = [
    ...(pack ? [pack.dir] : []),
    ...(deps.mountMemberRoots ? members.map((m) => m.root) : [])
  ]
  try {
    return await run({ addDirs, pack })
  } finally {
    if (pack) cleanupHabitContext(pack)
  }
}
