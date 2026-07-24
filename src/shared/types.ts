/** main 与 renderer 共享的数据模型与 IPC 契约。 */

import type { SupportedLanguage } from './language'
import type { Localized } from './localized'
import type { Appearance } from './appearance'
import type { EffectiveTheme } from './theme'
import type { AgentId, AgentModel, EffortLevel } from './agents'
import type {
  ConstitutionGovernance,
  EffectiveConstitutionRule,
  RulePack,
  RulePackItemRef,
  RulePackSummary,
  RulePackValidation
} from './rule-pack'

/** 应用级设置（settings.json @ userData）。language 缺省表示尚未初始化（首启信号）。 */
export interface AppSettings {
  language?: SupportedLanguage
  /** 外观偏好；缺省视为默认「跟随系统」。仅存储读写，不含主题渲染。 */
  appearance?: Appearance
  /** 默认 agent；缺省表示用户尚未选择（首启 agent 引导信号）。 */
  defaultAgent?: AgentId
  /** 默认模型（任意非空模型 id / 别名，建议清单仅供 UI 参考）；缺省表示未选择。 */
  defaultModel?: string
  /** 默认 effort（推理力度，low/medium/high）；缺省表示跟随各 agent CLI 自身默认，不注入参数。 */
  defaultEffort?: EffortLevel
}

/** 一个本地已检测到的 agent：标识、展示名、其可选模型清单。 */
export interface DetectedAgent {
  id: AgentId
  name: string
  models: AgentModel[]
}

/** 项目的 git 信息——一旦查到 git 即记录。 */
export interface GitInfo {
  /** 导入时的当前/主分支名；空仓库等情况可能为 null。 */
  branch: string | null
  /** origin 远程地址；未配置远程时为 null（不因此拒绝绑定）。 */
  remote: string | null
  /** 规范化的 `git rev-parse --git-common-dir`——同一仓库的多 worktree 共享同一值，用作归并键。 */
  commonDir: string
}

/** 一个成员仓（项目的组成单位，仓级身份）。 */
export interface RepoMember {
  /** 主键：git 仓用 .klarit/project-id 的 UUID；无 git 仓退化为规范化绝对路径。 */
  id: string
  /** 主键类型：'uuid'（持久身份）或 'path'（gitless 临时标识）。 */
  idKind: 'uuid' | 'path'
  /** 派生名：主工作树文件夹名（用作多仓分组标题）。 */
  derivedName: string
  /** 最近已知的主工作树路径。 */
  rootPath: string
  /** 已知的全部工作树路径（含主工作树），同一身份的多 worktree 都登记于此。 */
  worktreePaths: string[]
  /** git 信息；gitless 时为 null。 */
  git: GitInfo | null
  /**
   * 成员标签（前端/后端/配置/共享 SDK…，受控可扩展词表）：由用户手动打标、后续可由 agent 辅助。
   * 供工作流节点 `target=tag` 解析（见 repo-targeting）。属项目管理数据、存 registry.json、不入 git。缺省未标注。
   */
  tag?: string
  /** 是否尚无 git（等待 git 出现后补绑）。 */
  gitless: boolean
  /** 磁盘缺失状态：记录路径不存在时为 true（对账时计算，不依赖持久化）。 */
  missing?: boolean
}

/**
 * 一个项目——由 1..N 个成员仓组成。单仓项目是成员数为 1 的退化情形。
 * 成员分组属 Klarit 管理数据，存 userData、不入 git。
 */
export interface Project {
  /** 分组 id（旧单仓数据迁移时复用其唯一成员的 id）。 */
  id: string
  /** 可编辑显示名，默认取派生名。 */
  displayName: string
  /** 派生名（单仓=仓文件夹名；多仓=容器目录名）。 */
  derivedName: string
  /** 成员仓列表（至少 1 个；降到 0 不再作为有效项目）。 */
  members: RepoMember[]
  /** 该项目激活的工作流 id；未激活（如新导入）为缺省/null。属项目管理数据，按身份关联、不入 git。 */
  activeWorkflowId?: string | null
  /** 该项目的宪法治理状态（激活规则包 + 逐条规则开关）；缺省视为未激活任何包。属项目管理数据、不入 git。 */
  constitution?: ConstitutionGovernance
  /** 该项目的需求卡类型集；缺省（未设置）视为默认种子。激活带建议类型的工作流时幂等播种进来。属项目管理数据、不入 git。 */
  cardTypes?: CardTypeDef[]
  createdAt: string
  updatedAt: string
}

/** 注册表持久化结构（registry.json @ userData）。新格式以 projects 为准。 */
export interface RegistryData {
  projects: Project[]
}

/** 旧版（add-project-sidebar）单仓注册表格式，仅用于载入迁移。 */
export interface LegacyRegistryData {
  entries: Array<{
    id: string
    idKind: 'uuid' | 'path'
    displayName: string
    derivedName: string
    rootPath: string
    worktreePaths: string[]
    git: GitInfo | null
    gitless: boolean
    createdAt: string
    updatedAt: string
  }>
}

/** 探测某目录的 git 结果。 */
export interface GitProbeResult {
  isGit: boolean
  /** `git rev-parse --show-toplevel`（规范化）。 */
  toplevel: string | null
  /** `git rev-parse --git-common-dir`（规范化绝对路径）。 */
  commonDir: string | null
  /** 当前分支名（detached 或空仓库为 null）。 */
  branch: string | null
  /** origin 远程地址（无则 null）。 */
  remote: string | null
}

/** 某成员仓的本地分支列表（git 视图分支选择器用）。 */
export interface GitBranches {
  /** 当前 HEAD 分支名；detached / 空仓库为 null。 */
  current: string | null
  /** 本地分支名（不含远端跟踪分支与 tag）。 */
  branches: string[]
}

/** 一个 git worktree：目录路径 + 其检出的分支（detached 时为 null）。 */
export interface GitWorktree {
  /** worktree 目录绝对路径。 */
  path: string
  /** 该 worktree 检出的本地分支名；detached 为 null。 */
  branch: string | null
}

/** 某成员仓的 worktree 列表（git 视图据此把分支映射到要预览的目录）。 */
export interface GitWorktrees {
  worktrees: GitWorktree[]
}

/** 文件树节点（懒加载：目录的子项按需再取）。 */
export interface FileNode {
  name: string
  /** 绝对路径。 */
  path: string
  kind: 'file' | 'directory'
}

/**
 * 只读读取文件内容的结果（判别联合）：渲染层据 kind 直接决定渲染分支，
 * 不在渲染层做字节判断、也不会把乱码喂给 monaco。
 */
export type ReadFileResult =
  | { kind: 'text'; content: string }
  | { kind: 'binary' }
  | { kind: 'too-large'; size: number }
  | { kind: 'error'; message: string }

/** 文件树变更事件（chokidar 推送给渲染层的增量）。 */
export interface FileTreeChange {
  type: 'add' | 'addDir' | 'unlink' | 'unlinkDir'
  path: string
  /** 父目录绝对路径——渲染层据此定位要更新的节点。 */
  parentDir: string
  /** 触发变更的成员仓 id——渲染层据此定位要刷新的成员分组子树。 */
  memberId: string
}

/** 导入时在容器目录下检测到的子仓候选。 */
export interface NestedRepoCandidate {
  /** 子仓主工作树路径。 */
  rootPath: string
  /** 文件夹名（默认成员名）。 */
  name: string
}

/** 侧边栏视图模式：文件树 or git 视图。 */
export type SidebarView = 'files' | 'git'

/** 侧边栏视图选择（按窗口持久化）：视图模式 + git 视图下选中的成员仓与分支。 */
export interface SidebarViewState {
  view: SidebarView
  /** git 视图当前成员仓 id；未选时 null。 */
  gitMemberId: string | null
  /** git 视图当前预览的分支名；未选时 null。 */
  gitBranch: string | null
}

/** 一个窗口的会话状态。 */
export interface WindowState {
  projectId: string
  sidebarCollapsed: boolean
  /** 侧边栏宽度（px）。缺省（老会话/新窗口）时回退 DEFAULT_SIDEBAR_WIDTH。 */
  sidebarWidth?: number
  /** 侧边栏视图模式。缺省（老会话）回退 'files'。 */
  sidebarView?: SidebarView
  /** git 视图选中的成员仓 id。 */
  gitMemberId?: string | null
  /** git 视图预览的分支名。 */
  gitBranch?: string | null
  bounds?: { x: number; y: number; width: number; height: number }
}

/** 上次会话——启动时据此恢复窗口集合。 */
export interface SessionState {
  windows: WindowState[]
}

/** 导入结果。 */
export interface ImportResult {
  /** 建立或扩充后的项目。 */
  project: Project
  /** 是否复用了既有项目（重复导入 / 多 worktree / 移动目录）。 */
  reused: boolean
  /**
   * 当选中目录自身非 git、其下含多个子仓时，返回候选供用户确认组建多仓项目；
   * 此时 project 为 null 占位由调用方处理（见下 importProject 返回）。
   */
  nestedCandidates?: NestedRepoCandidate[]
}

/** 导入结果：建立或扩充一个项目（含子仓目录直接组建多仓项目，不再有确认步骤）。 */
export type ImportOutcome = { project: Project; reused: boolean }

// ── 工作流（workflow-definition / library / editor） ───────────────────────

/** 节点执行者类型（四选一）。 */
export type ExecutorKind = 'agent' | 'engine' | 'command' | 'subworkflow'

/**
 * agent 执行者的驱动指令，三种形态（见 workflow-definition spec）：
 * - `inline`：内联 prompt 文本（自包含、可移植）。
 * - `file`：引用工作流包内的一份 skill 文件（`path` 相对包目录，物理在包内）——用户设进包的外部技能文件。
 * - `installed`：引用用户 CLI 里**已安装**的技能，按调用名 `name`（如 `opsx:explore`）——不嵌入内容、不指路径，运行时由 CLI 自己调。
 */
export type AgentInstruction =
  | { kind: 'inline'; text: string }
  | { kind: 'file'; path: string }
  | { kind: 'installed'; name: string }

/**
 * agent 执行配置：声明本节点用哪个编程工具（adapter）、哪个模型、额外参数。各字段可空。
 * 缺省即跟随全局设置（级联两层：全局设置 < 节点声明，无「工作流默认」层）。声明式，不写裸启动命令。
 */
export interface AgentExecConfig {
  /** adapter id，如 claude-code / codex / cursor；空＝跟随全局。 */
  toolId?: string
  /** 模型标识（任意非空 id / 别名，不限于建议清单）；空＝跟随全局。 */
  model?: string
  /** 推理力度（low/medium/high）；空＝跟随全局默认；adapter 按家翻译，不支持的家忽略。 */
  effort?: EffortLevel
  /** 额外参数（透传给适配层）。 */
  extraArgs?: string
}

/**
 * agent 节点的结构化输出声明——除 markdown 产出（`outputs`）外，声明本节点还产出的结构化数据，
 * 供下游 `target=fromUpstream` 收窄与卡级「分诊」（写 `card.repos`）消费。v1：涉及成员仓判定。
 */
export interface AgentStructuredOutput {
  /** 产出「本卡涉及哪些成员仓」判定。 */
  repos: boolean
}

/**
 * command 节点里的一条命令：独立命令行、可选展示标签、可选前置检查与超时。
 * 同一节点的多条命令并发跑、各自分桶、各自可 detach 到后台/中止（见 engine-execution）。
 */
export interface CommandSpec {
  /** 可选展示标签：缺省回落命令行文本。用于卡详情各命令输出分格标题与 detach 后台 label。 */
  label?: string
  /** 待执行的 CLI 命令字符串。 */
  command: string
  /**
   * 可选「前置检查命令」（reconcile-by-probe）：执行本条主命令前先跑它，退出 0=已完成则跳过、
   * 不重复执行；非零才跑。让不幂等命令（如数据库迁移、版本号自增）中断恢复时不重复执行。
   * 缺省=每次重跑（适合测试/构建等幂等命令）。声明则非空（见 workflow-definition 校验）。
   */
  check?: string
  /** 可选超时秒数（约束本条命令）；缺省=无超时。声明则须为正数。到点杀进程树并抛「命令超时」决策。 */
  timeoutSec?: number
}

/** 节点执行者（判别联合，每个节点恰一种）。 */
export type NodeExecutor =
  | { kind: 'agent'; instruction: AgentInstruction; exec?: AgentExecConfig; structuredOutput?: AgentStructuredOutput }
  | { kind: 'engine'; operation: string }
  | {
      kind: 'command'
      /** 一条或多条命令；引擎并发跑全部，各自分桶/检查/超时/detach/中止。至少一条（见校验）。 */
      commands: CommandSpec[]
    }
  | { kind: 'subworkflow'; workflowId: string }

/**
 * 产出模板：声明产出文件的结构规范（必需标题/章节）。判别联合两态：
 * `none` 不声明；`ref` 引用规则库里的一个 `output-template` 条目（见 rule-pack `RulePackItemRef`）。
 * 模板内容统一住在规则库（单一来源）；编辑器的「手写/导入」是把内容写进规则库再引用，工作流本身不再嵌入模板。
 */
export type OutputTemplate =
  | { kind: 'none' }
  | { kind: 'ref'; ref: RulePackItemRef }

/**
 * 产出目的地（判别联合）。v1 仅 `file`：path 为相对分支目录路径（禁绝对/..）且以 `.md` 结尾——
 * 文件名即产出标识、扩展名即文件类型，故无需另设名称/格式字段。卡片数据形态 `card` 待需求卡数据模型落地再增。
 */
export type OutputDestination = { kind: 'file'; path: string }

/** 一个声明式产出。标识与文件类型由 `destination` 路径承载。 */
export interface WorkflowOutput {
  destination: OutputDestination
  /** 结构规范；缺省视为 `{ kind: 'none' }`。 */
  template: OutputTemplate
  required: boolean
}

/** 人工评审检查项的一个动作按钮：抛决策时渲染、点击触发其命令。 */
export interface GateAction {
  label: string
  command: string
  /** 可选超时秒数；缺省=无超时（如 `npm start` 长驻留空）。声明则须为正数。到点终止并回显「已超时」。 */
  timeoutSec?: number
}

/**
 * 自动校验检查项的「校验」（判别联合）：
 * - `inline` 命令行字符串（退出码即通过/失败、嵌入形态）；
 * - `ref` 引用规则库里的一个 `objective-check` 条目（引用形态、单一来源；见 rule-pack `RulePackItemRef`）。
 */
export type GateCheck =
  | { kind: 'inline'; command: string }
  | { kind: 'ref'; ref: RulePackItemRef }

/** 外部门等待的**外部核查种类**（v1 仅「PR 已在平台合并」；未来可扩展别的外部状态）。 */
export type ExternalVerify = 'pr-merged'

/**
 * 一道检查项（判别联合）：
 * - `auto` 客观自动校验：一个校验（命令行或引用条目）+ 可选校验目标（指向本节点产出路径，空＝整体检查）。
 * - `manual` 人工评审：可选零或多个动作按钮（每个含文案 + 命令）。
 * - `external` 外部门：等一个 Klarit 控制不了的外部状态（`verify`，v1=`pr-merged`）达成才过门；未达成挂起等待
 *   （现由用户点「开始收尾」触发再核查、将来可接平台 webhook），打回复用人工评审门的内容驱动回退。不带命令/按钮。
 * 三类均不带「说明」——命令/按钮/核查本身即自描述。
 */
export type WorkflowGateItem =
  | {
      kind: 'auto'
      check: GateCheck
      targets?: string[]
      /** 可选超时秒数（约束本门把命令，inline/ref 一视同仁）；缺省=无超时。声明则须为正数。到点抛「检查超时」决策。 */
      timeoutSec?: number
    }
  | { kind: 'manual'; actions?: GateAction[] }
  | { kind: 'external'; verify: ExternalVerify }

/**
 * 节点的目标仓选择（判别联合）——该节点的引擎操作作用于哪些成员仓。解析基准是运行所绑卡的涉及仓
 * `card.repos`（见 requirement-card-store）：`all`=全集；`tag`=按成员标签筛（见 multi-repo-project）；
 * `repo`=写死单个成员；`fromUpstream`=由上游 agent 节点结构化输出在 repos 内收窄。缺省（未声明）等价 `all`。
 */
export type NodeTarget =
  | { kind: 'all' }
  | { kind: 'tag'; tag: string }
  | { kind: 'repo'; memberId: string }
  | { kind: 'fromUpstream'; nodeId: string }

/** 一个工作流节点（v1 线性，`nodes` 列表顺序即执行顺序；`stageId` 指明归属的阶段/看板列）。 */
export interface WorkflowNode {
  id: string
  /** 节点显示名（多语言）；标识符是 id，name 仅供人看。 */
  name: Localized
  /** 所属阶段 id（引用 `WorkflowDefinition.stages` 之一）。 */
  stageId: string
  executor: NodeExecutor
  outputs: WorkflowOutput[]
  /** 可写范围（相对分支目录子路径）；缺省/空表示整条工作分支可写。禁绝对路径、禁 `..`。 */
  writableScope?: string[]
  /** 检查项有序序列；缺省表示无自定义检查。 */
  gate?: WorkflowGateItem[]
  /** 目标仓选择（多仓扇出）；缺省=作用于卡涉及仓全集（单仓即唯一成员，行为同今日）。见 repo-targeting。 */
  target?: NodeTarget
}

/** 一个阶段（对应看板列）——只是有序的列定义，节点通过 `stageId` 归属于它。 */
export interface WorkflowStage {
  id: string
  /** 阶段（看板列）显示名（多语言）。 */
  name: Localized
}

/** 一个工作流定义，持久化为工作流包内的 `workflow.yaml`。 */
export interface WorkflowDefinition {
  id: string
  /** 工作流显示名（多语言）。 */
  name: Localized
  /** 工作流描述（多语言，可选）。 */
  description?: Localized
  /** 有序阶段（看板列）。 */
  stages: WorkflowStage[]
  /** 有序节点列表（执行顺序）；每个节点以 stageId 归属某阶段。 */
  nodes: WorkflowNode[]
  /**
   * 可选的「新建需求」分解驱动指令：把用户对该工作流提交的一大段自由描述分解成多张需求卡。
   * 沿用 agent 节点驱动指令的 inline/file 两态；file 形态引用工作流包内 skill 文件（相对包路径）。
   * 缺省＝该工作流无专属分解 prompt（分解回落全局默认分解 skill）。
   */
  newRequirementInstruction?: AgentInstruction
  /**
   * 可选的「建议 leaf 类型」：用这条工作流的项目通常需要哪些流通类型。激活该工作流时由引擎
   * 幂等播种进项目类型注册表（已存在跳过、不覆盖）。每项 archetype MUST 为 `leaf`——
   * `container` 的 `epic` 为内置通用类型、不经工作流播种。缺省＝不播种任何类型。
   */
  suggestedTypes?: CardTypeDef[]
}

/** 工作流列表项（轻量，供选择器/列表用）。 */
export interface WorkflowSummary {
  id: string
  /** 工作流显示名（多语言）；渲染方按当前语言解析。 */
  name: Localized
  /** 分支配对等语义校验未过时的原因；缺省＝有效。UI 据此标「（无效）」并禁用选择。 */
  invalidReason?: string
  /**
   * 软校验（结构可判反模式）的非阻断告警，缺省/空＝无隐患。与 `invalidReason` 严重度不同：
   * 后者是「可载入但不可用」、拦选择；warnings 只是「可用但有隐患」，供 UI 提示而不阻断存库/加载。
   */
  warnings?: string[]
}

/** 校验/保存结果（失败带可读原因）。 */
export type WorkflowValidation = { ok: true } | { ok: false; reason: string }

/** 导入结果：成功带摘要，失败带可读原因。 */
export type WorkflowImportResult =
  | { ok: true; summary: WorkflowSummary }
  | { ok: false; reason: string }

// ── 需求卡模型 ───────────────────────────────────────────────────────────────

/**
 * 流动原型（封闭词表，引擎内置、不开放扩展）：决定一张卡怎么流动与关系合法性。
 * - `container`：不逐列流动，停「待办」列作子卡入口，子卡全归档后直达「归档」；可挂子卡（含嵌套容器）。
 * - `leaf`：逐列流动，按项目激活工作流的阶段（看板列）推进；是叶子、不挂子卡。
 */
export type CardArchetype = 'container' | 'leaf'

/**
 * 类型徽章可选颜色（封闭预置盘 key——装饰性标签色，独立于品牌/语义色；
 * 见 shared/card-type.ts 的 CARD_COLOR_KEYS、渲染层 cardTypeColors.ts 与 index.css 的 `--color-tag-*`）。
 */
export type CardColorKey =
  | 'red'
  | 'amber'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'violet'
  | 'pink'

/**
 * 需求卡类型定义：用户可自定义的命名类型，挂在某个流动原型上。**不含工作流引用**——
 * 项目流动由激活的单一工作流统一承载，类型只表达语义与原型。`description` 是给分解 skill 的
 * AI 分类依据（写给 LLM 的分类指令，非 UI 提示）。
 */
export interface CardTypeDef {
  /** 稳定标识（卡片以此引用类型），非空。 */
  id: string
  /** 显示名（看板/审阅徽章用），非空。 */
  name: string
  /** 语义说明，作为分解 skill 的分类依据。 */
  description: string
  archetype: CardArchetype
  /** 徽章颜色（预置盘之一）；缺省回落中性色。 */
  color?: CardColorKey
}

/**
 * 旧需求卡分类枚举——已被 `CardTypeDef`/`typeId` 取代，仅保留作默认类型种子的 id 与老数据
 * `category→typeId` 迁移的落点（见 `shared/card-type.ts` 的 `DEFAULT_CARD_TYPES`）。
 */
export type CardCategory = 'epic' | 'feature' | 'bug'

/** 需求卡生命周期状态（封闭词表）；新建默认「未开始」。当前节点不由状态承载（属运行断点）。 */
export type CardStatus = '未开始' | '进行中' | '已完成' | '已暂停' | '等待决策'

/** 卡关系边类型（对齐「关系图：带类型的三种边」）。 */
export type CardRelationKind = 'parent' | 'child' | 'blocked_by' | 'blocks' | 'coupled_with'

/** 一条带类型的卡关系边；target 为另一张卡的预取名/ id。 */
export interface CardRelation {
  kind: CardRelationKind
  target: string
}

/**
 * 候选需求卡：全局 agent 分解产出的未落库中间产物，承载卡的全部「agent 生成字段」。
 * 预取名为 git 友好 slug，既作将来卡 id、也作各涉及成员仓的分支名。
 */
export interface CandidateCard {
  /** git 友好 slug（小写字母/数字/连字符、不以连字符起止）；作 id 与分支名。 */
  proposedName: string
  title: string
  /** markdown 文本（呈现时渲染、非源码）。 */
  description: string
  /** 类型：引用项目类型注册表中某个 `CardTypeDef` 的 id（取代旧的 `category` 枚举）。 */
  typeId: string
  /** 零或多条带类型关系边；候选阶段 target 引用本批某张候选卡的预取名。 */
  relations: CardRelation[]
}

/**
 * 需求卡（最小持久化形态）：候选卡 + 系统字段。由 `shared/requirement-card.ts` 的纯校验担保。
 * 落库时由 store 层扩为 `StoredCard`（带项目/仓/运行关联），纯校验契约不变。
 */
export interface RequirementCard extends CandidateCard {
  status: CardStatus
  /** 创建/更新时间戳（毫秒）。 */
  createdAt: number
  updatedAt: number
}

/**
 * 落库形态：在最小模型上补一组**管理态字段**（归 store 层，见 requirement-card-store）。
 * 对最小模型前向兼容、不改纯校验契约——`RequirementCard` 部分仍走原纯校验。
 */
export interface StoredCard extends RequirementCard {
  /** 所属项目身份（卡片数据挂在项目下，按成员仓身份关联，不入 git）。 */
  projectId: string
  /** 该卡涉及的成员仓（需求与成员仓多对多）；运行集成本期只取首仓，数组为多仓留数据口。 */
  repos: string[]
  /** 当前关联的引擎运行 id（卡→运行反向链；运行→卡正向链为 RunRequest.cardId）。未运行时缺省。 */
  activeRunId?: string
}

/** 卡模型校验结果（失败带可读原因），同 WorkflowValidation 的判别联合形态。 */
export type CardValidation = { ok: true } | { ok: false; reason: string }

/** 一张候选卡的校验问题（供审阅界面定位与提示）。 */
export interface CandidateIssue {
  index: number
  proposedName: string
  reason: string
}

/** 一次分解的输入：用户的一大段自由描述（可夹带粘贴的截图说明/文件路径文本）。 */
export interface DecomposeInput {
  description: string
  /**
   * 可选**全盘视野**文本（本项目现有卡活现状 + 关系图，由主进程装配注入）：喂给分解 agent，
   * 让它能引用现有卡建立跨卡依赖（尤其 `blocked_by` 在跑/未完成卡）。缺省即退化为纯描述分解。
   */
  boardContext?: string
}

/** 分解结果：结构化候选卡 + 校验问题（不合卡模型/重名/悬挂关系），止于产出（不落库）。 */
export interface DecomposeResult {
  candidates: CandidateCard[]
  issues: CandidateIssue[]
}

/** 全局 agent 接缝产物：分解结果，或当前窗口未绑定项目的空态（无处归属需求）。 */
export type DecomposeOutcome = DecomposeResult | { unbound: true }

/** 生效分解 prompt 解析产物：prompt 文本，或未绑定项目空态。 */
export type DecomposePromptOutcome = { prompt: string } | { unbound: true }

// ── 需求编排（requirement-orchestration） ──────────────────────────────────

/** `adjust` 可改字段子集：不含 proposedName（= id/分支名）、status、运行关联（那些非编排职责）。 */
export interface CardAdjustPatch {
  title?: string
  description?: string
  typeId?: string
}

/** `split` 的边继承策略：`all`=所有子卡继承源卡外部边（默认，保守）；`none`=子卡不继承。 */
export type SplitEdgeInherit = 'all' | 'none'

/**
 * 一个卡操作（判别联合）：全局 agent over 全盘视野把自由意图解读成的成套编排动作。
 * 结构性 op（adjust/split/merge/relate/delete）只作用「待办」列的卡（见 requirement-orchestration 破坏性收边）。
 */
export type CardOp =
  | { kind: 'create'; card: CandidateCard }
  | { kind: 'adjust'; target: string; patch: CardAdjustPatch }
  | { kind: 'split'; source: string; into: CandidateCard[]; edgeInherit?: SplitEdgeInherit }
  | { kind: 'merge'; sources: string[]; into: string | CandidateCard; mergedDescription?: string }
  | { kind: 'relate'; op: 'add' | 'remove'; from: string; edge: CardRelation }
  | { kind: 'delete'; target: string }

/** 卡操作类别标签（判别联合的 tag）。 */
export type CardOpKind = CardOp['kind']

/** 破坏性 op（应用前需二次确认）：merge、split、以及删卡（delete）。 */
export const DESTRUCTIVE_OP_KINDS: ReadonlyArray<CardOpKind> = ['split', 'merge', 'delete']

/** 一个 op 的校验/应用问题（供审阅界面定位与提示）；仿 CandidateIssue。 */
export interface OpIssue {
  index: number
  kind: CardOpKind
  reason: string
}

/** 新项目提议：意图属于一个新项目时，agent 提议的项目名/描述 + 选定工作流（其建议类型决定新项目卡类型）。 */
export interface SuggestedProject {
  name: string
  description?: string
  /** 为新项目选定的工作流 id（其建议类型 + 默认类型 = 新项目可用类型）；缺省用默认类型。 */
  workflowId?: string
}

/**
 * 工作流提案：agent 产出的**完整**工作流定义 + （改写时）被覆盖工作流 id + 校验问题。
 * 校验失败**修好再报**（不驳回重问）：未过 `validateWorkflow`/`checkBranchPairing` 的可读原因收进 `issues`，
 * 半成品的 `workflow` 仍带出，供人在只读预览里补齐后再存库。见 workflow-authoring。
 */
export interface WorkflowProposal {
  /** agent 产出的完整工作流定义（可能带瑕疵——瑕疵在 issues 里列出，定义仍呈现）。 */
  workflow: WorkflowDefinition
  /** 改写现有工作流时 = 被覆盖工作流的 id（落库时以此为准覆盖对应包）；创建新工作流时省略。 */
  baseId?: string
  /** 未过校验的可读原因（空 = 合规可直接存库）。 */
  issues: string[]
}

/**
 * 导入后自动派工作流的后台生成进度相位（main → renderer 底栏状态用）：
 * `generating` 开始（author 起跑）→ `done`/`failed` 结束（清掉底栏指示）。
 */
export type WorkflowGenPhase = 'generating' | 'done' | 'failed'

/** 编排核产物：成套卡操作 + 逐 op 校验问题 + 自然语言答复 + （可选）新项目提议 + （可选）工作流提案。 */
export interface OrchestrationProposal {
  ops: CardOp[]
  issues: OpIssue[]
  reply?: string
  /** 意图属新项目时给出：审阅界面渲染「创建项目并加入这些需求」，ops 即该新项目的初始卡。 */
  suggestedProject?: SuggestedProject
  /** 意图属写/改工作流时给出：审阅界面渲染工作流只读预览 + 存库；与 ops 互斥（工作流轮 ops 为空）。 */
  workflow?: WorkflowProposal
  /**
   * producer（agent 调用）抛错时置真：供无头 author 区分「agent 调用失败/未配置」与「跑通但无产出」两类
   * 失败（否则二者都塌成 workflow=undefined，无从分辨）。可选、加性——聊天路径不设、渲染层不看。
   */
  producerFailed?: boolean
}

/** 编排接缝产物：编排提案，或当前窗口未绑定项目的空态（无处归属需求）。 */
export type OrchestrationOutcome = OrchestrationProposal | { unbound: true }

/** applyOps 应用结果：实际落库变更 + 逐 op 问题（合法者应用、非法者回报，不静默丢弃）。 */
export interface ApplyOpsResult {
  created: StoredCard[]
  updated: StoredCard[]
  removed: string[]
  issues: OpIssue[]
}

// ── 全局对话（global-agent-chat） ──────────────────────────────────────────

/** 会话消息角色。 */
export type ConversationRole = 'user' | 'agent'

/** 一条会话消息：用户意图或 agent 答复；agent 消息可携带其产出提案（供审阅重放）。 */
export interface ConversationMessage {
  role: ConversationRole
  text: string
  /** 编排提案（含卡操作，及工作流轮的 `proposal.workflow` 工作流提案）；供历史重放审阅/预览。 */
  proposal?: OrchestrationProposal
  /** 单需求 agent 的本卡干预提议（仅卡咨询会话用；供历史重放确认按钮）。 */
  interventions?: CardIntervention[]
  /** 已执行的干预下标（持久化：重开卡后仍显「已执行」、不再可重复触发）。 */
  appliedInterventions?: number[]
  at: number
}

/** 一条全局对话：持久化到 userData、应用级全局、可多开（稳定 id）、多轮经 sessionId 续接。 */
export interface Conversation {
  id: string
  projectId: string
  title: string
  messages: ConversationMessage[]
  /** 最近一次 agent 会话 id（供原生 `--resume` 续接）；无则回落历史重建。 */
  sessionId?: string
  /** 本会话选用的编程 agent（外壳 id）；未选回落 `settings.defaultAgent`。 */
  agentId?: string
  /** 本会话选用的模型；未选回落 `settings.defaultModel`。 */
  model?: string
  createdAt: number
  updatedAt: number
}

// ── 单需求 agent（single-card-agent） ──────────────────────────────────────

/**
 * 单需求 agent 的一次本卡执行干预（agent 只**提议**，引擎/store 执行）。节点以 id 引用（读上下文已含节点断点）。
 * - `pause`/`resume`：无损，可直接执行；
 * - `reenter`：倒回到节点 K 前向修复（可带注入指令），复用内容驱动回退「重入不重置」，破坏性·须确认；
 * - `inject`：就地向当前执行节点注入新指令，须确认；
 * - `adjustCard`：改本卡字段（title/description/typeId），经 cardsUpdate。
 */
export type CardIntervention =
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'reenter'; nodeId: string; instruction?: string }
  | { kind: 'inject'; instruction: string }
  | { kind: 'adjustCard'; patch: CardAdjustPatch }

/** 干预类别标签。 */
export type CardInterventionKind = CardIntervention['kind']

/** 破坏性干预（执行前须二次确认）：倒回/就地注入/改卡字段。暂停/恢复为无损、可直接执行。 */
export const DESTRUCTIVE_INTERVENTION_KINDS: ReadonlyArray<CardInterventionKind> = ['reenter', 'inject', 'adjustCard']

/**
 * 单需求 agent 一轮的输出（自由对话·技能内联的**三岔**收敛为一个对象）：
 * - 只 `reply`（`interventions` 空、无 `upshift`）＝ 查进度/答疑/讨论；
 * - `reply` + `interventions[]` ＝ 识别到「本卡怎么执行」的意图；
 * - `reply` + `upshift{intent}` ＝ 识别到「塑造需求」，交系统转调 `orchestrate`。
 * `interventions` 与 `upshift` 互斥（塑造需求优先上抛，不在单卡内产干预）。
 */
export interface CardAgentTurn {
  reply: string
  interventions?: CardIntervention[]
  upshift?: { intent: string }
}

/** 咨询核产物（跨 IPC）：自然语言回复 + （本卡干预提议 或 上抛得到的 ops 提案）。干预与提案互斥。 */
export interface CardConsultOutcome {
  reply: string
  /** 本卡干预提议（破坏性由 `isDestructiveIntervention` 派生，确认在渲染层）。 */
  interventions?: CardIntervention[]
  /** 上抛塑造需求经 orchestrate 得到的 ops 提案（供卡对话内审阅 applyOps）。 */
  proposal?: OrchestrationProposal
}

// ── 引擎执行（engine-execution） ───────────────────────────────────────────

/** 多仓运行里一个成员仓的运行上下文（由 card.repos 解析而来）。 */
export interface RunRepoTarget {
  /** 成员仓身份（对齐 RepoMember.id）。 */
  memberId: string
  /** 该成员仓工作目录。 */
  repoPath: string
  /** 该成员标签（供 target=tag 解析）；缺省未标注。 */
  tag?: string
}

/**
 * 触发一次运行的请求。`branch`/`worktreePath`/`baseBranch` 不传则由引擎按 `repoPath` 与 runId 确定性派生。
 * `cardId` 可选地把运行关联到一张需求卡（运行→卡正向链，随断点持久化）；不带即无卡关联（向后兼容旧数据）。
 * `repos` 为多仓涉及仓上下文（取自 card.repos 解析）；缺省/单元素即单仓退化，以 `repoPath` 为唯一成员。
 */
export interface RunRequest {
  workflowId: string
  /** 目标主仓工作目录。 */
  repoPath: string
  /** 关联的需求卡 id（可选）；带则运行属该卡，卡侧以 activeRunId 记反向链。 */
  cardId?: string
  /**
   * 多仓涉及仓上下文（取自所绑卡的 `card.repos` 解析）。缺省或单元素即单仓退化——以 `repoPath` 为唯一成员；
   * 带多元素时引擎在一个运行内对各成员仓扇出（见 engine-execution）。
   */
  repos?: RunRepoTarget[]
  /** 工作分支名；不传则派生。 */
  branch?: string
  /** worktree 目录绝对路径；不传则派生（主仓同级）。 */
  worktreePath?: string
  /** 合并目标分支（交付时合回它）；不传则取运行起始时主仓当前分支。 */
  baseBranch?: string
  /** 远端名；默认 origin。 */
  remote?: string
  /** 关联环境要链接的目标：target 目录 → worktree 内相对挂载路径。 */
  links?: Array<{ target: string; mountPath: string }>
  /**
   * 建分支**统一递增避撞**开关：为真时,引擎在 `start` 一次性把 `branch` 解析为一个在**所有涉及仓**
   * 分支与 worktree 路径两维都空闲的名字(撞名则全仓统一递增尾号,见 engine-execution)。卡派生的运行请求
   * 默认开启(新卡 slug 撞到遗留/人工分支时自动另起);直接触发的运行缺省关闭,沿用既有幂等认领语义。
   */
  avoidBranchConflict?: boolean
}

/** 运行态。`waiting-decision`/`paused` 均为可见可操作的停点——绝不存在不可见的卡死。 */
export type RunState = 'running' | 'waiting-decision' | 'paused' | 'done' | 'aborted'

/** 节点执行的阶段（断点粒度）。 */
export type NodePhase =
  | { kind: 'executing' }
  | { kind: 'gate'; index: number }
  | { kind: 'done' }

/**
 * 一个前进式选项——每个都让流程继续（继续/跳过本节点/重做/换法），不含「中止」死结。
 * 文案以 **i18n key** 表达（不写死语言），由渲染层按当前语言翻译。
 */
export interface EngineDecisionOption {
  /** 选项标识，引擎据此决定续跑动作（skip/force/retry/pull-rebase/merge-then-delete/recreate/suffix/pass…）。 */
  id: string
  /** 一句话概括的 i18n key（引擎来源决策用）。`sourceKind='agent'` 时可缺省、改用 `label`。 */
  labelKey?: string
  /** 详细说明的 i18n key（可选，引擎来源）。 */
  detailKey?: string
  /**
   * 原始文案（`sourceKind='agent'` 决策用）：选项来自 agent 自填、非 i18n key。
   * 渲染层优先用 `label`/`detail`，缺省再翻译 `labelKey`/`detailKey`。
   */
  label?: string
  detail?: string
  /** 是否推荐。 */
  recommended?: boolean
}

/**
 * 统一决策结构——失败决策、人工门、future 的 agent 提问共用。选项一律**前进式**，无「中止」死结。
 * 文案全部以 **i18n key + 参数** 表达，**引擎不写死语言**，渲染层按当前选中语言翻译（切语言实时跟随）。
 * `sourceKind` 是接 agent 的口子：UI 据它派生「自填选项」（仅 `agent` 来源给，引擎处理不了开放答案）。
 */
export interface EngineDecision {
  /** 抛出来源：`<nodeId>:<outcome>` 或 `<nodeId>:manual-gate`。 */
  source: string
  /** 来源类型；本能力恒 `engine`。 */
  sourceKind: 'engine' | 'agent'
  /** 背景说明的 i18n key。 */
  titleKey: string
  /** 背景说明的插值参数（如 `{ address }` / `{ node }`）。 */
  titleParams?: Record<string, string | number>
  options: EngineDecisionOption[]
  /** 单选（默认）/ 多选。 */
  multi?: boolean
  /** 可选填空（label/placeholder 亦为 i18n key）。 */
  input?: { labelKey: string; placeholderKey?: string }
  /**
   * 人工评审门把的动作按钮（仅 manual gate 给）：经 `runGateAction(runId, index)` 触发其命令、流式回显、
   * **不推进运行**（与前进式 `options` 正交，不破坏「选项一律前进式」）。`label` 为用户自定义文案（非 i18n）。
   */
  actions?: Array<{ label: string; index: number }>
  /**
   * 人工评审门附带的**可打开产出物**（名称 + 绝对路径）：渲染层把它们列成链接，点击用文件查看器打开，
   * 供用户审阅该节点的产出（如 PLAN.md）再决定通过。仅 manual gate 给。
   */
  outputs?: Array<{ name: string; path: string }>
  /**
   * 决策附带的**可点击外部链接**（label + url）：渲染层列成链接，点击用系统浏览器打开（经 IPC `shell:openExternal`）。
   * 如外部门决策带 `open-pr` 回报的 PR/MR 链接，供用户在确认合并前点开查看。
   */
  links?: Array<{ label: string; url: string }>
  /**
   * 客观门重试升级时携带的历史（每次失败的原因与重跑粒度），供渲染层按 i18n 展示，让用户据情判断。
   */
  gateHistory?: GateAttempt[]
  /**
   * 用户可读的失败**原因**（如客观门检查命令、失败命令自身打印的输出）——区别于 `raw`（开发用、不渲染）：
   * `reason` 是给用户看的「为什么没过」。退出码等开发信息不进此字段。AI 原因解读属未来。
   */
  reason?: string
  /**
   * 原始底层输出（如 git stderr）——**仅供开发/测试排查**，正式 UI MUST NOT 渲染它。
   * 用户只看 `titleKey` 翻出的干净说明。
   */
  raw?: string
}

/**
 * 一次客观门失败的重试记录：失败原因（错误=非零退出 / 超时）与重跑粒度（重跑整个节点 / 只重跑门）。
 * 错误→重跑节点、超时→重跑门（见 engine-execution「客观门失败的自动重试与升级」）。
 */
export interface GateAttempt {
  cause: 'error' | 'timeout'
  rerun: 'node' | 'gate'
  /** 失败退出码（超时无意义时省略）。 */
  code?: number
}

/** 对一个待决策的回应：选项 id（单选）/ 选项 id 列表（多选）/ 填入文本。 */
export interface DecisionResponse {
  optionId?: string
  optionIds?: string[]
  text?: string
}

/** 卡面「逐成员仓已建分支条目」：以「成员仓名/分支名」标识；仅当该成员仓本地分支已建出才产出。 */
export interface CardBranch {
  /** 成员仓 id（点击聚焦时据此定位 git 视图成员仓）。 */
  memberId: string
  /** 成员仓显示名（条目标签的仓名部分）。 */
  name: string
  /** 该成员仓在本运行的实际分支名（统一递增避撞后可能非预取名）。 */
  branch: string
}

/** 删卡前一条成员分支的回收信息（供确认框展示「已合并/未合并」）。 */
export interface BranchCleanupItem {
  memberId: string
  /** 「成员仓名/分支名」里的仓名部分。 */
  name: string
  branch: string
  worktreePath: string
  /** 该分支本地是否仍存在。 */
  branchExists: boolean
  /** 该分支的 worktree 目录是否仍在盘上。 */
  worktreeExists: boolean
  /** 分支是否已合并进其基分支（未建出/查不到基分支时保守判 false）。 */
  merged: boolean
}

/** 删卡选项：是否一并回收 worktree+分支，以及是否允许强删未合并分支。 */
export interface RemoveCardOptions {
  /** 勾选后：删卡时一并删 worktree + 删分支。缺省只删卡+停运行、不碰 git。 */
  recycleBranches?: boolean
  /** 配合 recycleBranches：允许强删未合并分支（`-D`）。false 时未合并分支保留。 */
  allowUnmerged?: boolean
}

/** 一个成员仓在某运行里的派生上下文（分支/worktree/基分支）。 */
export interface MemberDerived {
  memberId: string
  repoPath: string
  branch: string
  worktreePath: string
  baseBranch: string
}

/** 节点结构化输出（v1：涉及成员仓判定）。持久化于断点供 fromUpstream 收窄 / 恢复稳定。 */
export interface NodeStructuredOutput {
  /** 判定涉及的成员仓 id 列表。 */
  repos?: string[]
}

/** agent 在握手里自填的一个决策选项（原始文案，非 i18n——来自 agent，转交原 agent 解读）。 */
export interface AgentHandshakeOption {
  id: string
  label: string
  detail?: string
  recommended?: boolean
}

/**
 * agent↔引擎握手文件结构：agent 写在本节点**主目标仓 worktree** 的 `.klarit/handshake.json`，
 * 引擎在 agent 进程退出时读取。结构化控制状态的**唯一真相源**（stdout 只作展示，不解析控制状态）。
 * 文件缺失/解析失败按乐观 `done` 处理（容忍第三方 CLI 不完美遵守协议）。
 */
export interface AgentHandshake {
  /** 完成 / 需要决策 / 失败。 */
  status: 'need-decision' | 'done' | 'failed'
  /** 供 `need-decision`：背景 + agent 自填选项 + 单/多选 + 是否允许自由输入（开放答案）。 */
  decision?: { title?: string; options?: AgentHandshakeOption[]; multi?: boolean; freeInput?: boolean }
  /** 本节点涉及的成员仓判定（填 `upstreamOutputs[nodeId].repos` 供下游 fromUpstream 收窄）。 */
  repos?: string[]
  /** `open-pr` 回报的 PR/MR 链接（逐涉及仓，`repo` 为仓名/id、`url` 为可跳转网址）。引擎持久化并在外部门决策上呈现。 */
  prs?: Array<{ repo?: string; url: string }>
  /** 给人看的小结（写入需求卡活现状）。 */
  note?: string
  /** 失败详情（供 `failed` 自愈回喂）。 */
  detail?: string
}

/**
 * 一个 agent 节点在某运行里的执行态：续接 token、自愈计数、每目标仓的起始/提交 SHA。持久化于断点，
 * 使续接（自愈/答决策/崩溃恢复）与越界基线在关闭重开后稳定。一个 agent 节点一个 agent（跨其全部目标仓），
 * 故 `session`/`attempts` 单值；`startSha`/`commitSha` 按目标仓（memberId）分别记（越界检测/提交逐仓成立）。
 */
export interface AgentNodeRun {
  /** 原生续接会话 token（如 claude session id）；缺省时用「续 cwd 最近一次」策略。 */
  session?: string
  /** 本节点已自愈重试次数（限次用）。 */
  attempts?: number
  /** 上一次失败详情（自愈续接时注入原 agent 的失败上下文）。 */
  lastFailure?: string
  /** 待注入的用户决策答复（agent 提问被回答后，续接时注入原 agent）。 */
  pendingAnswer?: string
  /**
   * 内容驱动回退「修复前向」续接注入（一次性，消费即清）：把「之前推进到最远节点 + 用户驳回意见」交代给
   * 被退回节点的执行者，让它在现有进展上前向修复、不推倒重来。见 content-driven-rollback。
   */
  forwardFix?: { furthestNode?: string; feedback: string }
  /** 每目标仓节点起始 commit SHA（越界还原/提交基线）：键为 memberId。 */
  startSha?: Record<string, string>
  /** 每目标仓本节点提交后的 commit SHA（代码隐式产出锚点 + 下一节点基线）：键为 memberId。 */
  commitSha?: Record<string, string>
  /** 最近一次喂给该 agent 的完整 prompt（观测：随记录持久化、供输出框展示核对）。 */
  prompt?: string
}

/** 运行断点（按 runId 持久化到 userData/engine-runs/<runId>.json）。 */
export interface RunBreakpoint {
  runId: string
  request: RunRequest
  state: RunState
  /** 当前节点 id；null 表示尚未进入第一个节点。 */
  currentNodeId: string | null
  /**
   * 本运行推进到过的**最远节点** id（前向推进时更新；内容驱动回退到更早节点后**保留不被覆盖**）。
   * 供回退重入时的「修复前向」续接注入告知「你之前已推进到哪」。见 content-driven-rollback。
   */
  furthestNodeId?: string
  phase: NodePhase
  /**
   * 当前实际执行节点的路径（顶层→最内层）。子工作流穿透留口：本期 subworkflow 被跳过,故恒只含
   * 顶层当前节点一项（或缺省，等价 `[currentNodeId]`）；消费方读末项作当前节点名。仅供展示、不改恢复行为。
   */
  nodePath?: string[]
  /** 等待中的决策；非 null 时 state 为 waiting-decision。 */
  pendingDecision: EngineDecision | null
  /**
   * 客观门重试日志：键为 `<nodeId>:<gateIndex>`，值为该门历次失败的重试记录。持久化使关闭重开后计数不丢；
   * 门通过即清空该键（见 engine-execution「客观门失败的自动重试与升级」）。
   */
  gateLog?: Record<string, GateAttempt[]>
  /**
   * 后台命令的**可重启记录**（转后台仍在跑的命令）。持久化使暂停/关软件后能据此**重新拉起**——
   * 暂停杀活进程但保留记录、恢复按记录重启；完成/手动中止/退出时杀进程并清记录。
   */
  background?: Array<{ bgId: string; nodeId: string; label: string; command: string; timeoutSec?: number }>
  /**
   * 每成员仓的派生上下文（多仓扇出稳定恢复用）：键为 memberId。单仓运行可缺省（等价按 request 派生）。
   */
  members?: Record<string, MemberDerived>
  /**
   * 上游节点的结构化输出（供 `target=fromUpstream` 收窄 / 卡级分诊）：键为节点 id。持久化使恢复稳定。
   */
  upstreamOutputs?: Record<string, NodeStructuredOutput>
  /**
   * `open-pr` 节点回报的 PR/MR 链接：键为节点 id，值为逐涉及仓的 `{ repo?, url }`。持久化使恢复后仍可见；
   * 外部门决策据此呈现可点击链接（见 engine-execution）。
   */
  prLinks?: Record<string, Array<{ repo?: string; url: string }>>
  /**
   * 每个 agent 节点的执行态（续接 token / 自愈计数 / 每目标仓起始与提交 SHA）：键为节点 id。
   * 持久化使续接与崩溃恢复稳定。见 agent-execution。
   */
  agentRuns?: Record<string, AgentNodeRun>
  /**
   * 引擎/命令节点技术失败的 **heal / 处置 agent** 执行态：键为 `<nodeId>:<memberId>`
   * （命令节点非多仓扇出，退化为 `<nodeId>`）。复用 `AgentNodeRun` 形态（session/attempts/lastFailure/
   * startSha/commitSha/prompt）与 agent 自愈上限；持久化使关软件重开计数不丢、续接稳定；该失败收敛后清除其键。
   * 见 node-failure-heal。
   */
  healRuns?: Record<string, AgentNodeRun>
}

/** 进度事件（经 engine:progress 推给渲染层观察）。 */
export type EngineProgressEvent =
  | { kind: 'node-enter'; runId: string; nodeId: string }
  | { kind: 'node-exit'; runId: string; nodeId: string }
  | { kind: 'phase'; runId: string; nodeId: string; phase: NodePhase }
  | { kind: 'op-output'; runId: string; nodeId: string; outcome: string; detail: string; code?: number }
  /**
   * 命令的流式增量输出（命令节点 / 客观门 / 门把动作共用）。分桶：`bgId` 存在→后台桶 `bg:<bgId>`；
   * 否则 `cmdIndex` 存在→前台命令桶 `node:<nodeId>:<cmdIndex>`；都无→前台节点桶 `node:<nodeId>`。
   */
  | { kind: 'op-chunk'; runId: string; nodeId: string; stream: 'stdout' | 'stderr'; chunk: string; bgId?: string; cmdIndex?: number }
  | { kind: 'skip'; runId: string; nodeId: string; reason: string }
  /** 客观门自动重试（未达上限）一次：让观察方看到「重跑中」与原因/粒度。 */
  | { kind: 'gate-retry'; runId: string; nodeId: string; gateIndex: number; attempt: GateAttempt; count: number }
  /** 后台命令登记变化（转后台 started / 用户中止 stopped / 自行退出 exited / 超时被杀 timeout）。 */
  | { kind: 'background'; runId: string; nodeId: string; bgId: string; label: string; status: 'started' | 'stopped' | 'exited' | 'timeout' }
  | { kind: 'decision'; runId: string; decision: EngineDecision }
  | { kind: 'state'; runId: string; state: RunState }

// ── 文档登记表（document-registry）：per-成员仓的文档现状单一事实源 ──

/** 文档脾性——仅此两值；「不纳管」不是一个 kind，它表达为该文档不在登记表内。 */
export type DocKind = 'dynamic' | 'snapshot'

/** 登记表一条：三件套（位置 + 脾性 + 文档规定 habitPrompt）+ 审批闸；文件夹坍缩条目额外圈 coversFiles。 */
export interface ManagedDoc {
  /** 条目 id（取 location，登记表内唯一）。 */
  id: string
  /** 相对成员仓根的路径（POSIX 分隔）。 */
  location: string
  kind: DocKind
  /** 文档规定（界面用词；格式/模板/命名/时态 + 用户补的频率/意图）；未起草为空串。 */
  habitPrompt: string
  /** 审批闸：false 时 habitPrompt 是草稿，下游文档操作不得依赖它行使习惯。 */
  approved: boolean
  /** 文件夹级坍缩条目标记。 */
  isFolder?: boolean
  /** 仅文件夹条目：该夹下全部纳管叶子的相对路径。 */
  coversFiles?: string[]
}

/** per-成员仓的文档登记表：docs + 项目级「文档公约」前言（跨文件通则）。 */
export interface DocRegistry {
  memberId: string
  docs: ManagedDoc[]
  /** 项目级文档公约（跨文件通则）；未起草为空串。 */
  conventionPreamble: string
  /** 公约审批闸：false 时公约是草稿、不生效。 */
  conventionApproved: boolean
}

/** preload 经 contextBridge 暴露给渲染层的 API。 */
export interface KlaritApi {
  /** 弹目录选择并导入；用户取消返回 null。含多子仓的目录直接组建多仓项目（无需确认）。 */
  importProject: () => Promise<ImportOutcome | null>
  /** 列出注册表全部项目。 */
  listProjects: () => Promise<Project[]>
  /** 当前窗口绑定的项目（无则 null）。 */
  getCurrentProject: () => Promise<Project | null>
  /** 打开某项目：非当前则开新窗口，当前则聚焦。 */
  openProject: (projectId: string) => Promise<void>
  /** 弹目录选择，把一个独立仓关联进指定项目。 */
  linkMember: (projectId: string) => Promise<Project | null>
  /** 把某成员仓从项目解绑（不删磁盘）。 */
  unlinkMember: (projectId: string, memberId: string) => Promise<Project | null>
  /** 整体移除一个项目（管理项目窗口用）；返回移除后的项目列表。 */
  removeProject: (projectId: string) => Promise<Project[]>
  /** 打开/聚焦「管理项目」窗口。 */
  openManageWindow: () => Promise<void>
  /** 关闭「管理项目」窗口。 */
  closeManageWindow: () => Promise<void>
  /** 管理项目窗口里打开某项目：统一落点后关闭管理窗口。 */
  openProjectFromManage: (projectId: string) => Promise<void>
  /** 管理项目窗口里「打开本地项目」：选目录导入并打开。可能返回待确认的多仓候选。 */
  importProjectFromManage: () => Promise<ImportOutcome | null>
  /** 在系统文件管理器中定位某路径。 */
  showItemInFolder: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  /** 读取应用版本号。 */
  getAppVersion: () => Promise<string>
  /** 弹目录选择，为缺失成员重新定位到新路径。 */
  relocateMember: (projectId: string, memberId: string) => Promise<Project | null>
  /** 列出目录直接子项（懒加载文件树）。 */
  listDir: (dirPath: string) => Promise<FileNode[]>
  /** 只读读取文件内容供预览；按大小/二进制判定返回判别联合。 */
  readFile: (path: string) => Promise<ReadFileResult>
  /** 只读：列某成员仓（rootPath）的本地分支。非 git 返回空。 */
  listBranches: (rootPath: string) => Promise<GitBranches>
  /** 只读：列某成员仓（rootPath）的 worktree。非 git 返回空。 */
  listWorktrees: (rootPath: string) => Promise<GitWorktrees>
  /** 设置 git 视图当前预览 worktree 路径并监听其磁盘变更（传 null 取消）。 */
  setGitWatchPath: (path: string | null) => Promise<void>
  /** 订阅当前项目文件树变更；返回取消订阅函数。 */
  onFileTreeChange: (handler: (change: FileTreeChange) => void) => () => void
  // ── 引擎执行 ──
  /** 触发一次运行（一次性触发，立即返回 runId 与首个断点）。 */
  startRun: (req: RunRequest) => Promise<RunBreakpoint>
  /** 暂停一个运行。 */
  pauseRun: (runId: string) => Promise<RunBreakpoint>
  /** 恢复一个运行。 */
  resumeRun: (runId: string) => Promise<RunBreakpoint>
  /** 回应一个待决策（选项/多选/填空）。 */
  decideRun: (runId: string, response: DecisionResponse) => Promise<RunBreakpoint>
  /** 查询某运行的当前断点；未知返回 null。 */
  getRunState: (runId: string) => Promise<RunBreakpoint | null>
  /**
   * 触发一个运行的某人工评审门把动作按钮（按其在决策 `actions` 中的索引）：把该命令登记为一条**后台命令**
   * （各自 `bgId`/桶/中止/后台生命周期）并**立即返回其 `bgId`**（不 await 长驻进程），经 `onEngineProgress`
   * 流式回显到 `bg:<bgId>` 桶，**不推进运行**。同一动作已在跑时先停旧再起新（按 `(nodeId, index)` 单例）。
   * 经既有 `stopBackground(runId, bgId)` 中止该动作进程。
   */
  runGateAction: (runId: string, actionIndex: number) => Promise<{ bgId: string }>
  /** 停止某运行当前所有门把动作进程（薄封装；细粒度中止用 `stopBackground`）。 */
  stopGateAction: (runId: string) => Promise<void>
  /**
   * 命令节点执行中手动推进：`abort`=杀掉命令后进下一节点；`detach`=转后台后进下一节点。均跳过本节点剩余门把。
   */
  advanceCommand: (runId: string, mode: 'abort' | 'detach') => Promise<void>
  /** 列出某运行的后台命令（转后台后仍在跑的命令）。 */
  listBackground: (runId: string) => Promise<Array<{ bgId: string; nodeId: string; label: string }>>
  /** 中止某后台命令（杀进程树）。 */
  stopBackground: (runId: string, bgId: string) => Promise<void>
  /** 订阅引擎运行进度；返回取消订阅函数。 */
  onEngineProgress: (handler: (evt: EngineProgressEvent) => void) => () => void
  /** 读某运行某桶（`node:<nodeId>` / `bg:<bgId>`）累积命令输出（可回看）。 */
  readRunOutput: (runId: string, bucket: string) => Promise<string>
  /** 列某运行的全部输出桶键。 */
  listRunOutputBuckets: (runId: string) => Promise<string[]>
  // ── 需求卡持久化与运行集成 ──
  /** 列当前绑定项目的全部需求卡；未绑定给空数组。 */
  listCards: () => Promise<StoredCard[]>
  /** 统一创建接缝：把审阅通过的候选卡落库到当前项目（手动新建 + 外部分解共用）。 */
  createCards: (candidates: CandidateCard[]) => Promise<{ created: StoredCard[]; issues: CandidateIssue[] }>
  /** 更新一张卡（状态/涉及仓等）。 */
  updateCard: (slug: string, patch: Partial<StoredCard>) => Promise<StoredCard | null>
  /** 删除一张卡（清理其它卡指向它的悬挂边）；有未完成运行则先级联中止。opts 可要求一并回收 worktree+分支。 */
  removeCard: (slug: string, opts?: RemoveCardOptions) => Promise<void>
  /** 删卡前算每条成员分支的合并状态与 worktree 存在（供确认框展示）；无运行/无分支给空数组。 */
  cardBranchCleanupInfo: (slug: string) => Promise<BranchCleanupItem[]>
  /** 从卡派生运行请求并触发引擎、建立卡↔运行双向链；缺前置条件返回 { error }。 */
  runCard: (slug: string) => Promise<{ runId: string } | { error: string }>
  /** 列某卡各成员仓**已建出分支**的条目（成员仓名 + 实际分支）；无运行/无已建分支给空数组。 */
  cardBranches: (slug: string) => Promise<CardBranch[]>
  /** 程序化聚焦：把侧边栏切到 git 视图并定位到某卡指定成员仓（缺省首仓）的分支 worktree（无则空态）。 */
  focusCardGitView: (slug: string, memberId?: string) => Promise<void>
  /** 订阅「请求把 git 视图聚焦到某（成员仓, 分支）」事件；返回取消订阅函数。 */
  onGitViewFocus: (handler: (req: { repoId: string; branch: string }) => void) => () => void
  /** 读取当前窗口侧边栏折叠态。 */
  getSidebarCollapsed: () => Promise<boolean>
  /** 写入当前窗口侧边栏折叠态。 */
  setSidebarCollapsed: (collapsed: boolean) => Promise<void>
  /** 读取当前窗口侧边栏宽度（px）。 */
  getSidebarWidth: () => Promise<number>
  /** 写入当前窗口侧边栏宽度（px）。 */
  setSidebarWidth: (width: number) => Promise<void>
  /** 读取当前窗口侧边栏视图选择（视图模式 + git 成员仓/分支）。 */
  getSidebarView: () => Promise<SidebarViewState>
  /** 写入当前窗口侧边栏视图选择。 */
  setSidebarView: (state: SidebarViewState) => Promise<void>
  /** 操作系统语言（原始 locale，如 zh-CN）。 */
  getSystemLocale: () => Promise<string>
  /** 当前生效的语言设置。 */
  getLanguage: () => Promise<SupportedLanguage>
  /** 更新语言设置（非法值回退默认）；返回写入后的语言。 */
  setLanguage: (language: SupportedLanguage) => Promise<SupportedLanguage>
  /** 当前生效的外观设置（dark/light/system）。 */
  getAppearance: () => Promise<Appearance>
  /** 更新外观设置（非法值回退默认 system）；返回写入后的外观。 */
  setAppearance: (appearance: Appearance) => Promise<Appearance>
  /** 当前生效主题（dark/light），由外观偏好 + 系统明暗解析。 */
  getEffectiveTheme: () => Promise<EffectiveTheme>
  /** 订阅生效主题变更（切外观或系统明暗变化时触发）；返回取消订阅函数。 */
  onThemeChange: (handler: (theme: EffectiveTheme) => void) => () => void
  /** 本窗口被主进程绑定到（新）项目时触发：渲染层据此离开空状态、重拉当前项目/卡/工作流。 */
  onProjectBound: (handler: () => void) => () => void
  /** 主进程侧卡片链变化（尤其自动排程异步启动卡后）时触发：渲染层据此重载卡片，使看板实时反映。 */
  onCardsChanged: (handler: () => void) => () => void
  /** 最小化当前窗口。 */
  minimizeWindow: () => Promise<void>
  /** 最大化/还原当前窗口。 */
  toggleMaximizeWindow: () => Promise<void>
  /** 关闭当前窗口。 */
  closeWindow: () => Promise<void>
  /** 列出工作流库（轻量摘要，跳过损坏包）。 */
  listWorkflows: () => Promise<WorkflowSummary[]>
  /** 读取某工作流完整定义；不存在或损坏返回 null。 */
  getWorkflow: (id: string) => Promise<WorkflowDefinition | null>
  /** 新建工作流（基于默认模板，唯一 id），返回新建定义。 */
  createWorkflow: () => Promise<WorkflowDefinition>
  /** 克隆某工作流（复制整包），返回副本定义；源不存在返回 null。 */
  cloneWorkflow: (id: string) => Promise<WorkflowDefinition | null>
  /** 保存（校验后写回包）；校验失败返回原因、不写盘。 */
  saveWorkflow: (def: WorkflowDefinition) => Promise<WorkflowValidation>
  /** 删除工作流（先清理项目激活引用、再删整个包目录）；返回最新列表。 */
  deleteWorkflow: (id: string) => Promise<WorkflowSummary[]>
  /** 弹选择导入一个外部工作流包；取消返回 null，非法返回失败原因。 */
  importWorkflow: () => Promise<WorkflowImportResult | null>
  /** 导出某工作流包到用户选定位置；取消或源缺失为无副作用。 */
  exportWorkflow: (id: string) => Promise<void>
  /** 为某工作流新建一份 skill 文件（写入包），返回相对包路径。 */
  createSkillFile: (workflowId: string, fileName: string, content: string) => Promise<string>
  /** 弹选择一个外部文件作为 skill 拷入包，返回相对包路径；取消返回 null。 */
  importSkillFile: (workflowId: string) => Promise<string | null>
  /** 读取包内 skill 文件内容（按相对包路径）；不存在返回 null。 */
  readSkillFile: (workflowId: string, relPath: string) => Promise<string | null>
  /**
   * 拼装并返回某 agent 节点提交给 AI 的**完整 prompt**（宪法 + 节点 prompt + 需求卡占位 + 可写范围 + 产出 + 客观门），
   * 供编辑器只读预览。传入当前（含未保存）节点；主进程解析生效宪法 + 读 skill 文件 + 解析模板/校验引用后拼装。
   */
  previewAgentNodePrompt: (workflowId: string, node: WorkflowNode) => Promise<string>
  /** 读取当前窗口项目的激活工作流 id（未绑定项目或未激活为 null）。 */
  getActiveWorkflow: () => Promise<string | null>
  /** 设置当前窗口项目的激活工作流 id（传 null 清除激活）。 */
  setActiveWorkflow: (workflowId: string | null) => Promise<void>
  /** 扫描本机已安装的受支持 agent（含各自模型清单）；未装则不出现，永不抛出。 */
  scanAgents: () => Promise<DetectedAgent[]>
  /** 当前默认 agent；未选择返回 null。 */
  getDefaultAgent: () => Promise<AgentId | null>
  /** 更新默认 agent（须为已检测到的受支持 agent，否则无副作用）；返回写入后的值（未选择为 null）。切换后不匹配的默认模型会被清除。 */
  setDefaultAgent: (agentId: AgentId) => Promise<AgentId | null>
  /** 当前默认模型；未选择返回 null。 */
  getDefaultModel: () => Promise<string | null>
  /** 更新默认模型（agent 已选 + 任意非空字符串即放行，空白收敛为未选择）；返回写入后的值（未选择为 null）。 */
  setDefaultModel: (modelId: string) => Promise<string | null>
  /** 当前默认 effort；未设置返回 null（跟随各 agent 默认）。 */
  getDefaultEffort: () => Promise<EffortLevel | null>
  /** 更新默认 effort（枚举外收敛为未设置）；返回写入后的值（未设置为 null）。 */
  setDefaultEffort: (effort: string | null) => Promise<EffortLevel | null>
  // ── 规则包库 ──
  /** 列出规则包库（轻量摘要，跳过损坏包）。 */
  listRulePacks: () => Promise<RulePackSummary[]>
  /** 读全部规则包完整定义（工作流引用选择器/宪法界面用）。 */
  allRulePacks: () => Promise<RulePack[]>
  /** 读取某规则包完整定义；不存在/损坏返回 null。 */
  getRulePack: (id: string) => Promise<RulePack | null>
  /** 新建规则包（默认种子，唯一 id），返回新建定义。 */
  createRulePack: () => Promise<RulePack>
  /** 克隆某规则包，返回副本；源不存在返回 null。 */
  cloneRulePack: (id: string) => Promise<RulePack | null>
  /** 保存（校验后写回包）；校验失败返回原因、不写盘。 */
  saveRulePack: (pack: RulePack) => Promise<RulePackValidation>
  /** 删除规则包（删整个包目录）；返回最新列表。 */
  deleteRulePack: (id: string) => Promise<RulePackSummary[]>
  /** 弹选择导入一个外部规则包；取消返回 null，非法返回失败原因。 */
  importRulePack: () => Promise<RulePackValidation | null>
  /** 导出某规则包到用户选定位置；取消或源缺失为无副作用。 */
  exportRulePack: (id: string) => Promise<void>
  // ── 项目宪法治理 ──
  /** 读当前项目的宪法治理状态（激活包 + 逐条开关）。 */
  getConstitution: () => Promise<ConstitutionGovernance>
  /** 写当前项目的宪法治理状态。 */
  setConstitution: (governance: ConstitutionGovernance) => Promise<void>
  /** 读当前项目的生效宪法（派生：激活并集减去关闭项）。 */
  effectiveConstitution: () => Promise<EffectiveConstitutionRule[]>
  // ── 新建需求：分解能力（全局 agent 接缝；止于产出候选卡，落库归下一个 change）──
  /** 读当前项目的生效分解 prompt（供外部 AI 读取 skill）；未绑定项目返回 { unbound: true }。 */
  getDecomposePrompt: () => Promise<DecomposePromptOutcome>
  /** 提交一段自由描述，经全局 agent 接缝产出结构化候选卡；未绑定项目返回 { unbound: true }。 */
  decomposeRequirement: (input: DecomposeInput) => Promise<DecomposeOutcome>
  /** 外部 AI 路径：提交外部产出的候选卡，规整+校验后回传供人审；未绑定返回 { unbound: true }。 */
  submitDecomposedCandidates: (candidates: CandidateCard[]) => Promise<DecomposeOutcome>
  // ── 全局覆盖分解 skill：手写/导入/读取（与工作流节点 prompt 导入一致；可选高级覆盖）──
  /** 读全局覆盖分解 skill 内容；未设置返回空串（由自动生成 skill 兜底）。 */
  readDefaultDecomposeSkill: () => Promise<string>
  /** 手写设置全局覆盖分解 skill。 */
  writeDefaultDecomposeSkill: (content: string) => Promise<void>
  /** 弹选择一个外部文件拷为全局覆盖分解 skill；取消返回 false、成功返回 true。 */
  importDefaultDecomposeSkill: () => Promise<boolean>
  /** 读由类型注册表自动生成的分解 skill 完整文本（供类型设置页只读预览）。 */
  readGeneratedDecomposeSkill: () => Promise<string>
  // ── 需求编排（全局 agent：意图→卡操作提案 / apply-ops / 全局对话）──
  /** 经编排核 over 全盘视野产出卡操作提案；带 conversationId 则记入该会话。未绑定项目给空态。 */
  orchestrate: (input: { intent: string; conversationId?: string }) => Promise<OrchestrationOutcome>
  /** 外部 AI 路径：提交外部产出的 ops，经同一校验后回传提案供人审；未绑定给空态。 */
  submitOrchestrationOps: (ops: CardOp[]) => Promise<OrchestrationOutcome>
  /** 审阅确认后把提案 ops 应用到当前项目 cardStore（破坏性 op 需 confirmedDestructive）。 */
  applyOps: (ops: CardOp[], confirmedDestructive?: boolean) => Promise<ApplyOpsResult>
  /** 新项目提议确认：选目录建/导入项目并绑窗口，激活所选工作流并把 create ops 种入；取消回 null。 */
  orchestrateCreateProject: (
    ops: CardOp[],
    workflowId?: string
  ) => Promise<{ projectId: string; applied: ApplyOpsResult } | null>
  /** 列当前项目全部全局对话（按最近更新倒序）；未绑定给空数组。 */
  listConversations: () => Promise<Conversation[]>
  /** 取一条全局对话（含历史）。 */
  getConversation: (id: string) => Promise<Conversation | null>
  /** 新建一条全局对话，返回其 id（未绑定项目返回 null）。 */
  createConversation: (title?: string) => Promise<string | null>
  /** 删除一条全局对话。 */
  removeConversation: (id: string) => Promise<void>
  /** 设某会话选用的 agent/模型（覆盖全局默认；传 undefined 清除回落默认）。 */
  setConversationAgentModel: (id: string, agentId?: string, model?: string) => Promise<void>
  /** 重试：丢弃末尾 agent 回复、重跑上一条用户意图；返回更新后会话。 */
  retryLastTurn: (id: string) => Promise<Conversation | null>
  /** 编辑：移除最新一轮，返回被移除的用户文字供回填输入。 */
  dropLastTurn: (id: string) => Promise<{ text: string } | null>
  // ── 单需求 agent（single-card-agent：每卡只读咨询 + 本卡干预 + 门自由输入上抛）──
  /** 取（或惰性新建）某卡的单需求 agent 会话（id=cardId，一卡一个）；未绑定给 null。 */
  getCardConversation: (cardId: string) => Promise<Conversation | null>
  /** 跑一轮咨询：三岔（查进度回复/本卡干预提议/上抛 ops 提案）；记入该卡会话。 */
  sendCardConsult: (cardId: string, intent: string) => Promise<CardConsultOutcome | null>
  /** 重试：丢弃末尾 agent 回复、重跑上一条用户意图；返回更新后会话。 */
  retryLastCardConsult: (cardId: string) => Promise<Conversation | null>
  /** 编辑：移除最新一轮，返回被移除的用户文字供回填输入。 */
  dropLastCardConsultTurn: (cardId: string) => Promise<{ text: string } | null>
  /** 设某卡会话选用的 agent/模型（覆盖全局默认；传 undefined 清除回落默认）。 */
  setCardConsultAgentModel: (cardId: string, agentId?: string, model?: string) => Promise<void>
  /** 门自由输入分类前置：反偏置跑一轮；塑造需求→出 ops 提案（不消费门），否则只回复。 */
  classifyCardGateInput: (cardId: string, text: string) => Promise<CardConsultOutcome | null>
  /** 标记某消息第 index 个干预已执行（持久化，供重开卡后显「已执行」）。 */
  markCardInterventionApplied: (cardId: string, messageAt: number, index: number) => Promise<void>
  /** 清空某卡会话：清消息 + 断续接，保留会话与 agent/模型；回到空态。 */
  clearCardConversation: (cardId: string) => Promise<void>
  /** 打断某卡进行中的咨询轮（杀当前咨询 agent）；无进行中轮为 no-op。 */
  abortCardConsult: (cardId: string) => Promise<void>
  /** 用户发起本卡干预——倒回到目标节点前向修复（可带注入指令）；回运行断点。 */
  reenterRun: (runId: string, targetNodeId: string, instruction?: string) => Promise<RunBreakpoint | null>
  /** 用户发起本卡干预——就地向当前执行节点注入新指令；回运行断点。 */
  injectRun: (runId: string, instruction: string) => Promise<RunBreakpoint | null>
  // ── 需求卡类型注册表：增删改查（全局类型库）──
  /** 列出在册需求卡类型（首启种入默认类型）。 */
  listCardTypes: () => Promise<CardTypeDef[]>
  /** 校验后按 id 新增/更新一个类型；非法返回原因。 */
  saveCardType: (def: CardTypeDef) => Promise<CardValidation>
  /** 删除一个类型；被卡引用则拒绝、返回原因。 */
  deleteCardType: (id: string) => Promise<CardValidation>
  /** 弹系统文件选择器（多选），返回所选文件绝对路径数组（取消为空数组）。 */
  pickAttachments: () => Promise<string[]>
  /** 把剪贴板图片落盘到 userData/attachments/，返回其绝对路径；无图片返回 null。 */
  saveClipboardImage: () => Promise<string | null>
  /** 把一段纯文本写入系统剪贴板（供输出/prompt「一键复制」）。 */
  copyText: (text: string) => Promise<void>
  /** 取拖入文件的本地绝对路径（Electron webUtils；同步）。 */
  getDroppedFilePath: (file: File) => string
  // ── 文档登记表（per-成员仓）──
  /**
   * agent 语义分析某成员仓（分组+分类+起草一体，读清单+内容样本），并入既有表后返回（不落盘）；
   * 成员不存在返回 null。`error`：null=成功；'no-agent'=确未配置默认 agent（回落启发式结果）；
   * 其它=agent 调用/解析的具体错误摘要（同样回落启发式结果）。
   */
  analyzeDocuments: (
    memberId: string
  ) => Promise<{ registry: DocRegistry; error: string | null } | null>
  /** 读某成员仓的登记表；无表给空壳。 */
  getDocuments: (memberId: string) => Promise<DocRegistry>
  /** 规整后整表落盘（编辑/审批/跳过保存当前态共用）。 */
  saveDocuments: (registry: DocRegistry) => Promise<void>
  /** 订阅「新导入项目 → 进文档确认步」推送（管理窗导入等窗口外入口）；返回取消订阅函数。 */
  onDocumentsOnboard: (handler: (memberId: string) => void) => () => void
  /**
   * 订阅「导入后自动派工作流」的提案就绪推送——提案已作 agent 消息追加进本项目全局对话，收到即
   * 打开/聚焦对话面板、选中并重取承载它的会话（后台追加消息无自动刷新）；返回取消订阅函数。
   */
  onWorkflowProposalReady: (
    handler: (payload: { projectId: string; conversationId: string }) => void
  ) => () => void
  /** 订阅「导入后自动派工作流」的后台生成进度——底栏据此显/隐生成指示；返回取消订阅函数。 */
  onWorkflowGenStatus: (handler: (phase: WorkflowGenPhase) => void) => () => void
  /** 订阅项目注册表变更广播（管理窗移除/导入等）——收到即刷新项目列表与绑定状态；返回取消订阅函数。 */
  onProjectsChanged: (handler: () => void) => () => void
}
