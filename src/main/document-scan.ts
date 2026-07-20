/**
 * 文档扫描 + agent 语义分析（document-scan）：
 * - scanCandidates/scanDocuments：递归 walker（跳 IGNORED_DIRS/软链/点目录）+ 根 `.gitignore` 叠加
 *   （ignore 包）→ 候选叶子；scanDocuments 再走 classify+collapse 出启发式表（无 agent 兜底，离线纯跑）。
 * - analyzeDocuments：把候选清单 + 内容样本一次交给 agent，按「是否是一类」分组+分类+起草一体产出
 *   登记条目与公约；产出经规整校验（幻觉丢弃、前缀圈 coversFiles）。失败如实带 error（上层回落启发式）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ignore from 'ignore'
import type { DocKind, DocRegistry, ManagedDoc } from '../shared/types'
import { classify, collapse, filterDocCandidates } from '../shared/document-registry'
import { IGNORED_DIRS } from '../shared/ignored-dirs'

/** 起草 agent 接缝：喂完整 prompt、取文本回复（真实实现走无头 agent CLI；测试注入桩）。 */
export type DraftAgent = (prompt: string) => Promise<string>

/** 样本读取接缝：按相对路径读文档内容样本；读不到给 null。 */
export type SampleReader = (relPath: string) => string | null

/**
 * 递归收集相对路径叶子（POSIX 分隔）。跳过：IGNORED_DIRS、点开头目录（.claude/.vscode 等工具配置噪声）、
 * **符号链接/junction**（Klarit 项目里有 worktree junction——同步递归跟进会走进大目录或成环，冻住主进程）、
 * 读不了的目录（EPERM 等静默略过）。
 */
function walk(absDir: string, relPrefix: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(absDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const rel = relPrefix === '' ? e.name : `${relPrefix}/${e.name}`
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(absDir, e.name), rel, out)
    } else {
      out.push(rel)
    }
  }
}

/** 收集一个成员仓的候选文本文档叶子（IGNORED_DIRS + .gitignore 过滤）。目录缺失给空清单。 */
export function scanCandidates(dir: string): string[] {
  if (!existsSync(dir)) return []
  const all: string[] = []
  walk(dir, '', all)

  const ig = ignore()
  const gitignorePath = join(dir, '.gitignore')
  if (existsSync(gitignorePath)) {
    try {
      ig.add(readFileSync(gitignorePath, 'utf8'))
    } catch {
      /* .gitignore 读不了就只按 IGNORED_DIRS 兜底 */
    }
  }
  return filterDocCandidates(all, (rel) => ig.ignores(rel))
}

/** 启发式兜底：候选叶子 → 分类 → 坍缩（无 agent / agent 失败时组织登记表）。 */
export function scanDocuments(dir: string): ManagedDoc[] {
  const classified = scanCandidates(dir).map((path) => ({
    path,
    kind: classify(path) as DocKind | null
  }))
  return collapse(classified)
}

/**
 * 重扫并入：既有条目（用户改判/审批/编辑过的 prompt）原样保留——只用扫描结果刷新文件夹条目的
 * coversFiles（磁盘现状）；扫描新发现的位置并入表尾。公约不动。纯函数（重扫不覆盖已审批条的语义核）。
 */
export function mergeScan(existing: DocRegistry, scanned: ManagedDoc[]): DocRegistry {
  const known = new Map(existing.docs.map((d) => [d.location, d]))
  const byLocation = new Map(scanned.map((d) => [d.location, d]))
  const docs = existing.docs.map((d) => {
    const fresh = byLocation.get(d.location)
    return d.isFolder && fresh?.isFolder ? { ...d, coversFiles: fresh.coversFiles } : d
  })
  for (const s of scanned) {
    if (!known.has(s.location)) docs.push(s)
  }
  return { ...existing, docs }
}

/** 取样限流：每个直接父目录最多取样文件数 / 总取样上限 / 单样本截断。 */
const SAMPLES_PER_DIR = 2
const SAMPLE_TOTAL_CAP = 30
const SAMPLE_CAP = 3000

/** 选代表样本：每个直接父目录取头部若干、全局限量——清单全给、内容抽查。 */
function selectSamples(candidates: string[]): string[] {
  const byDir = new Map<string, string[]>()
  for (const p of candidates) {
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    const list = byDir.get(dir) ?? []
    if (list.length < SAMPLES_PER_DIR) list.push(p)
    byDir.set(dir, list)
  }
  const out: string[] = []
  for (const list of byDir.values()) {
    for (const p of list) {
      if (out.length >= SAMPLE_TOTAL_CAP) return out
      out.push(p)
    }
  }
  return out
}

/** 组装分析 prompt：全量候选清单 + 抽样内容 + 分组/分类/起草任务 + 严格 JSON 输出要求。 */
function buildAnalyzePrompt(candidates: string[], read: SampleReader): string {
  const samples = selectSamples(candidates)
    .map((p) => {
      const content = read(p)
      return content === null ? null : `--- 样本 ${p} ---
${content.slice(0, SAMPLE_CAP)}`
    })
    .filter((s): s is string => s !== null)
  return [
    '你是文档架构分析师。下面是一个代码仓里全部文本文档的路径清单与部分内容样本。',
    '任务：把这些文档按**「是否是一类」**组织成登记条目——同一类（同一种写作对象与习惯）的文件夹收成一条文件夹条目；',
    '跨类的文件夹必须拆开（只要其写作目的不同，即使同为「动态」也要分列两条）；',
    '互不相同的零散草稿逐文件单列；纯噪声（许可证、模板、锁文件说明等）不要列。',
    '**计划类文档不要列**：判断每个路径装的是不是计划类文档——任务作用域的计划/提案产物，写「接下来要做什么」的前瞻稿，',
    '做完就失效；它不是沉淀成果的归档目标。判定为计划类的路径与噪声同处理，整个略过不列入。',
    '每条判定脾性 kind：dynamic（只记最新现状、过时直接改写）或 snapshot（某时刻的冻结记录、只追加）。',
    '每条起草一段「文档规定」：只写从样本能读出的**格式类事实**（模板结构、字段、命名规则、时态语气），不要猜写作频率或意图。',
    '另起草一段「项目级文档公约」，**只写两件事**：文档用什么语言写、各类文档放在哪个目录（目录约定）。',
    '排版、语气、标点、标题层级、强调与引用写法等**风格类内容一律不写**（风格属于各条文档规定，公约里再写一遍既累赘又易冲突）。',
    '公约要简短，三两句话写完，越短越好。',
    '文档规定与项目级文档公约都**只写正向要求与示例**（要怎么写、举正确写法的例子），不用反例或禁止式表述。',
    '',
    '# 候选文档清单（相对仓根）',
    ...candidates,
    '',
    '# 内容样本（抽查）',
    ...samples,
    '',
    '# 输出要求',
    'location 必须取自上面清单里的真实路径（文件）或真实存在的文件夹前缀（文件夹条目）。',
    '严格只输出一个 JSON 对象：',
    '{"convention": "<项目级文档公约>", "entries": [{"location": "<路径>", "kind": "dynamic|snapshot", "habitPrompt": "<文档规定>"}]}，',
    '不要任何解释、前后缀或 markdown 代码围栏。'
  ].join('\n')
}

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '')
}

interface AnalyzeReplyEntry {
  location: string
  kind: string
  habitPrompt: string
}

/** 从回复抠最外层 JSON 对象并收敛 entries；失败 null。 */
function parseAnalyzeReply(
  stdout: string
): { convention: string; entries: AnalyzeReplyEntry[] } | null {
  const body = stripFences(stdout ?? '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const obj = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
    const entries: AnalyzeReplyEntry[] = []
    for (const item of Array.isArray(obj.entries) ? obj.entries : []) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      if (typeof o.location !== 'string' || o.location === '') continue
      entries.push({
        location: o.location.replace(/\\/g, '/').replace(/\/+$/, ''),
        kind: typeof o.kind === 'string' ? o.kind : '',
        habitPrompt: typeof o.habitPrompt === 'string' ? o.habitPrompt : ''
      })
    }
    return { convention: typeof obj.convention === 'string' ? obj.convention : '', entries }
  } catch {
    return null
  }
}

/**
 * agent 语义分析（主路径）：一次调用把候选清单 + 内容样本交给 agent，产出按「是否是一类」组织的
 * 条目（分组+分类+起草一体）与项目级公约。产出经规整校验：location 精确命中候选 → 文件条目；
 * 是候选前缀 → 文件夹条目（按前缀圈 coversFiles）；否则视为幻觉丢弃。kind 仅两值、重复 location
 * 取首条、全部 approved:false。agent 失败/输出不可解析 → docs 空 + error 如实（上层回落启发式）。
 */
export async function analyzeDocuments(
  candidates: string[],
  sampleReader: SampleReader,
  agent: DraftAgent | null
): Promise<{ docs: ManagedDoc[]; conventionPreamble: string; error: string | null }> {
  if (!agent || candidates.length === 0) return { docs: [], conventionPreamble: '', error: null }
  let reply: string
  try {
    reply = await agent(buildAnalyzePrompt(candidates, sampleReader))
  } catch (e) {
    return { docs: [], conventionPreamble: '', error: e instanceof Error ? e.message : String(e) }
  }
  const parsed = parseAnalyzeReply(reply)
  if (!parsed) return { docs: [], conventionPreamble: '', error: '分析输出不可解析（非预期 JSON）' }

  const candidateSet = new Set(candidates)
  const docs: ManagedDoc[] = []
  const seen = new Set<string>()
  for (const entry of parsed.entries) {
    if (entry.kind !== 'dynamic' && entry.kind !== 'snapshot') continue
    if (seen.has(entry.location)) continue
    const base: ManagedDoc = {
      id: entry.location,
      location: entry.location,
      kind: entry.kind,
      habitPrompt: entry.habitPrompt,
      approved: false
    }
    if (candidateSet.has(entry.location)) {
      seen.add(entry.location)
      docs.push(base)
      continue
    }
    const covers = candidates.filter((c) => c.startsWith(`${entry.location}/`)).sort()
    if (covers.length > 0) {
      seen.add(entry.location)
      docs.push({ ...base, isFolder: true, coversFiles: covers })
    }
    // 两边都不命中 → 幻觉条目，丢弃。
  }
  return { docs, conventionPreamble: parsed.convention, error: null }
}
