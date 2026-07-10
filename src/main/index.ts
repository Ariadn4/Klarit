import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AppSettings,
  ApplyOpsResult,
  CandidateCard,
  CandidateIssue,
  CardOp,
  CardTypeDef,
  CardValidation,
  Conversation,
  OrchestrationOutcome,
  StoredCard,
  DecisionResponse,
  DecomposeInput,
  CardBranch,
  DecomposeOutcome,
  DecomposePromptOutcome,
  DetectedAgent,
  ImportOutcome,
  Project,
  RegistryData,
  RunBreakpoint,
  RunRequest,
  SessionState,
  SidebarViewState,
  WindowState,
  WorkflowDefinition,
  WorkflowImportResult,
  WorkflowNode,
  WorkflowSummary,
  WorkflowValidation
} from '../shared/types'
import { IPC } from '../shared/ipc'
import { DEFAULT_LANGUAGE } from '../shared/language'
import { DEFAULT_APPEARANCE } from '../shared/appearance'
import { resolveEffectiveTheme, type EffectiveTheme } from '../shared/theme'
import { DEFAULT_SIDEBAR_WIDTH } from '../shared/sidebar'
import {
  initSettings,
  setLanguage as applyLanguage,
  setAppearance as applyAppearance,
  setDefaultAgent as applyDefaultAgent,
  setDefaultModel as applyDefaultModel
} from './settings'
import { makeAgentProbe, scanAgents } from './agents'
import {
  clearActiveWorkflow,
  findProjectById,
  getActiveWorkflow as getActiveWorkflowCore,
  getConstitutionGovernance,
  getProjectCardTypes,
  normalizeRegistry,
  removeProject as removeProjectCore,
  seedProjectCardTypes,
  setActiveWorkflow as setActiveWorkflowCore,
  setConstitutionGovernance,
  setProjectCardTypes,
  unlinkMember as unlinkMemberCore
} from './registry-core'
import { createWorkflowStore } from './workflow-store'
import { createAcceptanceSampleWorkflow, createDefaultWorkflow, createDefaultWorkflowPr, createRollbackSampleWorkflow } from '../shared/workflow'
import { createEngine, type AgentPrep, type AgentPrepContext, type HealPrepContext } from './engine/engine'
import { createRunStore } from './engine/run-store'
import { createGlobalSkillStore } from './global-skill-store'
import { buildDecomposeSkill } from '../shared/decomposition'
import {
  DEFAULT_CARD_TYPES,
  removeCardType,
  seedCardTypes,
  typeArchetypeMap,
  upsertCardType,
  validateCardTypeDef,
  type TypeArchetypeMap
} from '../shared/card-type'
import { createCardStore } from './card-store'
import { deriveRunRequest } from './card-run'
import { cardBranchesView } from './card-branches'
import { createOutputBuffer } from './engine/output-buffer'
import { createDecomposeSeam } from './global-agent'
import type { CandidateProducer, ResolveDeps } from './decompose-service'
import { buildDecomposeMessage, headlessInvocation, parseCandidateCards, runAgentHeadless } from './agent-runner'
import { createOrchestrateSeam, type OrchestrateDeps } from './orchestrate-service'
import type { WorkflowChoice } from '../shared/board-context'
import { resolveLocalized } from '../shared/localized'
import { createOpsProducer, type SessionBridge } from './orchestrate-producer'
import { applyOps as applyOpsToStore, createOpsFromCandidates } from './apply-ops'
import { createConversationStore } from './conversation-store'
import { realAgentRunner } from './agent/runner'
import { validateOps } from '../shared/card-ops'
import { createRulePackStore } from './rule-pack-store'
import { deriveEffectiveConstitution } from '../shared/rule-pack'
import { assembleAgentPrompt, resolveOutputs, healMergeTask, healCommandTask, healDispositionTask, rollbackJudgmentTask } from '../shared/agent-prompt'
import type {
  ConstitutionGovernance,
  EffectiveConstitutionRule,
  RulePack,
  RulePackSummary,
  RulePackValidation
} from '../shared/rule-pack'
import {
  importProject,
  linkMemberByDir,
  relocateMemberToDir,
  type ProjectServiceDeps
} from './project-service'
import { listBranches, listWorktrees, makeGitRunner, probeGit } from './git'
import { ensureProjectId, readProjectId } from './identity'
import { listDir } from './filetree'
import { readFileForPreview } from './readfile'
import { scanNestedRepos } from './nested'
import { readJson, writeJson } from './store'
import { WindowManager } from './windows'

const REGISTRY_FILE = join(app.getPath('userData'), 'registry.json')
const SESSION_FILE = join(app.getPath('userData'), 'session.json')
const SETTINGS_FILE = join(app.getPath('userData'), 'settings.json')

const registry: RegistryData = normalizeRegistry(readJson<unknown>(REGISTRY_FILE, null))

function saveRegistry(): void {
  writeJson(REGISTRY_FILE, registry)
}

// 工作流库：包目录存于 userData/workflows/<id>/（含 workflow.yaml + skill 文件）。
const workflows = createWorkflowStore(join(app.getPath('userData'), 'workflows'))

// 运行引擎：断点存于 userData/engine-runs/<runId>.json；进度事件广播给所有窗口观察。
const engine = createEngine({
  getWorkflow: (id) => workflows.get(id),
  store: createRunStore(join(app.getPath('userData'), 'engine-runs')),
  outputBuffer: createOutputBuffer(join(app.getPath('userData'), 'engine-runs')),
  emit: (evt) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.engineProgress, evt)
    }
    // 运行状态变化 → 跟随更新其绑定卡的生命周期状态（按 activeRunId 反查所属卡）。
    if (evt.kind === 'state') reconcileCardForRun(evt.runId, evt.state)
  },
  // 客观门 ref 形态:把 {packId,itemId} 解析为 objective-check 条目的命令(缺失返回 null,引擎按缺失处理)。
  getObjectiveCheck: (ref) => {
    const item = rulePacks.get(ref.packId)?.items.find((i) => i.id === ref.itemId)
    return item && item.kind === 'objective-check' ? item.command : null
  },
  // 当前界面语言：把节点显示名解析成单语言标签（运行决策/命令 label）。
  language: () => settings.language ?? DEFAULT_LANGUAGE,
  // agent 执行器：解析节点工具/模型（级联：节点声明 < 全局默认）+ 拼含真实卡/多仓布局/握手路径的完整 prompt。
  // 返回 null＝该节点 agent 不可用（未选默认 agent 且节点未声明）→ 引擎按技术失败抛决策。
  prepareAgent: (node, bp, ctx) => prepareAgentForRun(node, bp, ctx),
  // 临时 heal / 处置 agent 的 prompt：复用同一公共输入拼装，仅任务段换成 heal/处置文本。未选默认 agent → null（heal 不可用，回落人工）。
  prepareHealAgent: (bp, ctx) => prepareHealAgentForRun(bp, ctx),
  // 握手文件根目录：userData/engine-runs/handshakes/<runId>/<nodeId>.json（worktree 之外、不入 git）。
  handshakeDir: join(app.getPath('userData'), 'engine-runs', 'handshakes')
})

// 规则包库：包目录存于 userData/rule-packs/<id>/（rule-pack.yaml）。
const rulePacks = createRulePackStore(join(app.getPath('userData'), 'rule-packs'))

// 需求卡库：一卡一文件存于 userData/cards/<projectId>/<slug>.json（不入 git，按项目身份关联）。
const cardStore = createCardStore(join(app.getPath('userData'), 'cards'))

/** 运行态 → 卡生命周期状态：按 activeRunId 反查所属卡并跟随更新（done→已完成等）。 */
function reconcileCardForRun(runId: string, state: string): void {
  const map: Record<string, StoredCard['status']> = {
    running: '进行中',
    'waiting-decision': '等待决策',
    paused: '已暂停',
    done: '已完成'
  }
  const status = map[state]
  if (!status) return // aborted 等不强行改卡状态
  for (const p of registry.projects) {
    const card = cardStore.list(p.id).find((c) => c.activeRunId === runId)
    if (card) {
      cardStore.update(p.id, card.proposedName, { status, updatedAt: Date.now() })
      return
    }
  }
}

/**
 * agent 执行器的注入实现（`function` 声明、提升，故可在 createEngine 处前引用）：解析节点工具/模型
 * （级联：节点声明 < 全局默认）+ 定位运行所绑卡注入真实字段与生效宪法 + 拼完整 prompt（与预览同源）。
 * 未选默认 agent 且节点未声明 → 返回 null（引擎按技术失败抛决策）。
 */
function prepareAgentForRun(node: WorkflowNode, bp: RunBreakpoint, ctx: AgentPrepContext): AgentPrep | null {
  if (node.executor.kind !== 'agent') return null
  const exec = node.executor.exec
  const toolId = exec?.toolId ?? settings.defaultAgent
  if (!toolId) return null
  const model = exec?.model ?? settings.defaultModel
  const language = settings.language ?? DEFAULT_LANGUAGE

  // 定位运行所绑卡（跨项目按 slug 反查）→ 真实字段 + 该项目生效宪法 + 成员仓名/标签
  let project: RegistryData['projects'][number] | undefined
  let card: StoredCard | undefined
  if (bp.request.cardId) {
    for (const p of registry.projects) {
      const c = cardStore.list(p.id).find((x) => x.proposedName === bp.request.cardId)
      if (c) {
        project = p
        card = c
        break
      }
    }
  }
  const constitution = project
    ? deriveEffectiveConstitution(rulePacks.all(), getConstitutionGovernance(registry, project.id), language)
    : []
  const promptText =
    node.executor.instruction.kind === 'inline'
      ? node.executor.instruction.text
      : workflows.readSkillFile(bp.request.workflowId, node.executor.instruction.path)
  // 多仓布局：把本节点目标仓解析成「名/标签/路径/主-额外」交给拼装器注入（不写死在节点 prompt）
  const repos = ctx.targetRepos.map((t) => {
    const m = project?.members.find((mm) => mm.id === t.memberId)
    return { name: m?.derivedName ?? t.memberId, tag: m?.tag, path: t.path, primary: t.primary }
  })
  const prompt = assembleAgentPrompt({
    language,
    promptText,
    constitution,
    writableScope: node.writableScope ?? [],
    outputs: resolveOutputs(node.outputs ?? [], rulePacks.all(), language),
    handshakePath: ctx.handshakePath,
    repos,
    card: card
      ? {
          title: card.title,
          type: card.typeId,
          description: card.description,
          relations: (card.relations ?? []).map((r) => `${r.kind} → ${r.target}`).join('\n') || undefined
        }
      : undefined
  })
  return { prompt, toolId, model: model ?? undefined, extraArgs: exec?.extraArgs }
}

/**
 * 临时 heal / 处置 agent 的 prompt 拼装（复用公共输入：生效宪法 + 需求卡 + 引擎交互协议），仅任务段换成
 * 合并冲突 / 命令失败 / 处置三版之一；作用域为整条分支（heal 不逐路径收窄）。未选默认 agent → null（heal 不可用）。
 */
function prepareHealAgentForRun(bp: RunBreakpoint, ctx: HealPrepContext): AgentPrep | null {
  const toolId = settings.defaultAgent
  if (!toolId) return null
  const model = settings.defaultModel
  const language = settings.language ?? DEFAULT_LANGUAGE
  let project: RegistryData['projects'][number] | undefined
  let card: StoredCard | undefined
  if (bp.request.cardId) {
    for (const p of registry.projects) {
      const c = cardStore.list(p.id).find((x) => x.proposedName === bp.request.cardId)
      if (c) {
        project = p
        card = c
        break
      }
    }
  }
  const constitution = project
    ? deriveEffectiveConstitution(rulePacks.all(), getConstitutionGovernance(registry, project.id), language)
    : []
  const repoName = project?.members.find((m) => m.id === ctx.repo.memberId)?.derivedName ?? ctx.repo.memberId
  const promptText =
    ctx.kind === 'merge-conflict'
      ? healMergeTask({ repo: repoName, branch: ctx.branch, base: ctx.base, conflictFiles: ctx.conflictFiles ?? [] })
      : ctx.kind === 'command-failure'
        ? healCommandTask({ repo: repoName, branch: ctx.branch, command: ctx.command ?? '', output: ctx.output ?? '' })
        : ctx.kind === 'rollback-judge'
          ? rollbackJudgmentTask({ node: ctx.nodeName ?? ctx.branch, userInput: ctx.userInput ?? '', lineage: ctx.lineage ?? '' })
          : healDispositionTask({ repo: repoName, branch: ctx.branch, background: ctx.background ?? '', userInput: ctx.userInput ?? '' })
  // 只读回退判定 agent：只读——不给可写范围/产出（省略两节，强调不改文件）。
  const readOnly = ctx.kind === 'rollback-judge'
  const prompt = assembleAgentPrompt({
    language,
    promptText,
    constitution,
    writableScope: [],
    outputs: [],
    readOnly,
    handshakePath: ctx.handshakePath,
    repos: [{ name: repoName, path: ctx.repo.path, primary: true }],
    card: card
      ? {
          title: card.title,
          type: card.typeId,
          description: card.description,
          relations: (card.relations ?? []).map((r) => `${r.kind} → ${r.target}`).join('\n') || undefined
        }
      : undefined
  })
  return { prompt, toolId, model: model ?? undefined }
}

// 全局覆盖分解 skill：存于 userData/skills/decompose-default.md，可选高级覆盖（优先于自动生成 skill）。
const globalSkills = createGlobalSkillStore(join(app.getPath('userData'), 'skills'))

// 需求卡类型注册表为「项目级」：存在各项目的 registry 记录里（project.cardTypes），按 registry-core 读写。

// 候选卡 producer：无头调用用户配置的默认 agent CLI 跑分解 skill，解析其回复为候选卡。
// 复用用户的编程 AI、不自建模型通道（project-goals）。未配置 agent 或调用失败 → 优雅返空（审阅显空态）。
const decomposeProducer: CandidateProducer = async (prompt, input) => {
  const agentId = settings.defaultAgent
  if (!agentId) return []
  const inv = headlessInvocation(agentId, settings.defaultModel)
  const message = buildDecomposeMessage(prompt, input.description)
  try {
    const out = await runAgentHeadless(inv, message, { timeoutMs: 180_000 })
    return parseCandidateCards(out)
  } catch {
    return []
  }
}
// 按项目解析生效分解 prompt 的依赖（激活工作流新建需求指令 → 全局默认分解 skill 兜底）。
const makeResolveDeps = (projectId: string | null): ResolveDeps => ({
  getActiveWorkflowId: () => (projectId ? getActiveWorkflowCore(registry, projectId) : null),
  getWorkflow: (id) => workflows.get(id),
  readWorkflowSkill: (wfId, rel) => workflows.readSkillFile(wfId, rel),
  getTypes: () => (projectId ? getProjectCardTypes(registry, projectId) : [...DEFAULT_CARD_TYPES]),
  readOverride: () => globalSkills.readOverride()
})

// 全局对话持久化（一会话一文件、不入 git；随云同步走）。会话是**应用级全局**——不挂某个项目，
// 会话**按项目分开**：作用域 = 窗口当前绑定的项目 id；未绑定用独立的 `__unbound__` 作用域。
const conversationStore = createConversationStore(join(app.getPath('userData'), 'conversations'))
const UNBOUND_SCOPE = '__unbound__'
/** 某窗口的会话作用域：当前项目 id，未绑定回落 `__unbound__`。 */
const convScope = (e: Electron.IpcMainInvokeEvent): string => currentProjectId(e) ?? UNBOUND_SCOPE

// 可选工作流清单（供新项目挑一个）：每个工作流的类型集 = 默认类型 + 其建议类型（同 seedProjectCardTypes 语义）。
const workflowChoices = (): WorkflowChoice[] =>
  workflows.list().map((s) => ({
    id: s.id,
    name: resolveLocalized(s.name, settings.language ?? DEFAULT_LANGUAGE),
    types: seedCardTypes([...DEFAULT_CARD_TYPES], workflows.get(s.id)?.suggestedTypes ?? [])
  }))

// 编排核依赖（限当前项目；未绑定给空全盘视野，agent 可对话/提议新建项目）。
const orchestrateDepsFor = (projectId: string | null): OrchestrateDeps => ({
  getCards: () => (projectId ? cardStore.list(projectId) : []),
  getTypes: () => (projectId ? getProjectCardTypes(registry, projectId) : [...DEFAULT_CARD_TYPES]),
  getGoals: () => '',
  getConstitution: () =>
    projectId
      ? deriveEffectiveConstitution(
          rulePacks.all(),
          getConstitutionGovernance(registry, projectId),
          settings.language ?? DEFAULT_LANGUAGE
        ).map((r) => `${r.name}：${r.text}`)
      : [],
  getWorkflows: workflowChoices,
  // 历史从本项目作用域取（scope = projectId ?? __unbound__）。
  getHistory: (conversationId) =>
    conversationId ? (conversationStore.get(projectId ?? UNBOUND_SCOPE, conversationId)?.messages ?? []) : []
})

// 真实 ops producer：只读姿态、脱 worktree（cwd 用 userData scratch，agent 写代码我们也不消费）。
// 会话 sessionId 桥接到**本作用域**会话库，供多轮原生续接。agent/模型按会话选型覆盖全局默认（未选回落默认）。
const orchestrateProducer = (scope: string, agentId?: string, model?: string): ReturnType<typeof createOpsProducer> => {
  const sessions: SessionBridge = {
    get: (cid) => (cid ? conversationStore.get(scope, cid)?.sessionId : undefined),
    set: (cid, sessionId) => {
      if (cid) conversationStore.setSessionId(scope, cid, sessionId)
    }
  }
  return createOpsProducer({
    runner: realAgentRunner,
    toolId: agentId ?? settings.defaultAgent ?? null,
    cwd: app.getPath('userData'),
    model: model ?? settings.defaultModel,
    sessions
  })
}

// app.getLocale() 需在 whenReady 后才可靠，故首启初始化推迟到 whenReady（见下）。
let settings: AppSettings = { language: DEFAULT_LANGUAGE }

// 本机已检测到的 agent（每次启动重扫，反映新装/卸载，不持久化）；whenReady 内填充。
let detectedAgents: DetectedAgent[] = []

/** 生效主题对应的窗口底色（防深色启动白闪）——取自深色令牌 canvas / 浅色 paper。 */
const THEME_BG: Record<EffectiveTheme, string> = { dark: '#14141c', light: '#f5f1e8' }

/** 当前生效主题 = 外观偏好 + 系统明暗（nativeTheme 为单一真值源）。 */
function effectiveTheme(): EffectiveTheme {
  return resolveEffectiveTheme(settings.appearance ?? DEFAULT_APPEARANCE, nativeTheme.shouldUseDarkColors)
}

/** 把生效主题同步到所有窗口：广播给渲染层翻令牌，并即时改窗口底色。 */
function broadcastTheme(): void {
  const theme = effectiveTheme()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.setBackgroundColor(THEME_BG[theme])
    win.webContents.send(IPC.themeChanged, theme)
  }
}

// e2e 测试用接缝：用分号分隔的目录队列按调用顺序顶替原生目录选择框（仅测试设置该变量）。
const e2eDirQueue = (process.env.KLARIT_E2E_IMPORT_DIRS ?? '').split(';').filter(Boolean)
let e2eDirIdx = 0

const serviceDeps: ProjectServiceDeps = {
  probe: (dir) => probeGit(dir, makeGitRunner(dir)),
  readProjectId,
  ensureProjectId,
  scanNested: scanNestedRepos,
  newGroupId: () => randomUUID(),
  now: () => new Date().toISOString()
}

function createBrowserWindow(state: WindowState | null, view?: 'manage'): BrowserWindow {
  const isManage = view === 'manage'
  const win = new BrowserWindow({
    width: state?.bounds?.width ?? (isManage ? 720 : 1280),
    height: state?.bounds?.height ?? (isManage ? 460 : 800),
    x: state?.bounds?.x,
    y: state?.bounds?.y,
    minWidth: isManage ? 560 : 720,
    minHeight: isManage ? 380 : 480,
    backgroundColor: THEME_BG[effectiveTheme()],
    show: false,
    autoHideMenuBar: true,
    // 去掉原生标题栏；窗口控制按钮改为渲染层自绘（见 WindowControls），
    // 这样设置面板等 DOM 浮层能完整盖住它们（原生 overlay 合成在网页之上、无法被覆盖）。
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 管理项目窗口与项目窗口共用同一渲染入口，用 #manage hash 区分（渲染层据此分流）。
  const hash = view === 'manage' ? 'manage' : undefined
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(hash ? `${process.env.ELECTRON_RENDERER_URL}#${hash}` : process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(import.meta.dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
  return win
}

/** 「管理项目」窗口单例引用（不进 WindowManager.ctxs：不绑项目、不参与会话/监听）。 */
let manageWindow: BrowserWindow | null = null

/** 打开或聚焦管理项目窗口。 */
function openManageWindow(): void {
  if (manageWindow && !manageWindow.isDestroyed()) {
    manageWindow.focus()
    return
  }
  const win = createBrowserWindow(null, 'manage')
  manageWindow = win
  win.on('closed', () => {
    if (manageWindow === win) manageWindow = null
  })
}

/** 关闭管理项目窗口（打开项目/导入完成后）。 */
function closeManageWindow(): void {
  if (manageWindow && !manageWindow.isDestroyed()) manageWindow.close()
}

const manager = new WindowManager({
  registry,
  saveRegistry,
  newWindow: createBrowserWindow,
  serviceDeps
})

function senderWindow(e: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender)
}

/** 选目录（e2e 走队列接缝，否则弹原生框）；取消返回 null。 */
async function pickDirectory(win: BrowserWindow | null, title: string): Promise<string | null> {
  if (e2eDirQueue.length > 0) {
    return e2eDirIdx < e2eDirQueue.length ? e2eDirQueue[e2eDirIdx++] : null
  }
  const options: Electron.OpenDialogOptions = { title, properties: ['openDirectory'] }
  const picked = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]
}

/** 选单个文件（导入 skill 用）；取消返回 null。 */
async function pickFile(win: BrowserWindow | null, title: string): Promise<string | null> {
  const options: Electron.OpenDialogOptions = { title, properties: ['openFile'] }
  const picked = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0]
}

/** 当前窗口绑定项目的 id；无则 null。 */
function currentProjectId(e: Electron.IpcMainInvokeEvent): string | null {
  const win = senderWindow(e)
  return win ? (manager.current(win)?.id ?? null) : null
}

/** 把刚建/扩的项目落到窗口：空状态窗口直接绑定，已绑定窗口另开新窗口。 */
function bindOrOpen(win: BrowserWindow | null, projectId: string): void {
  if (!win) return
  if (!manager.current(win)) manager.bindWindow(win, projectId)
  else manager.openProject(projectId)
}

function registerIpc(): void {
  ipcMain.handle(IPC.listProjects, (): Project[] => registry.projects)

  ipcMain.handle(IPC.currentProject, (e): Project | null => {
    const win = senderWindow(e)
    return win ? manager.current(win) : null
  })

  ipcMain.handle(IPC.importProject, async (e): Promise<ImportOutcome | null> => {
    const win = senderWindow(e)
    const chosen = await pickDirectory(win, '导入新项目')
    if (!chosen) return null
    const outcome = importProject(registry, chosen, serviceDeps)
    saveRegistry()
    bindOrOpen(win, outcome.project.id)
    return outcome
  })

  ipcMain.handle(IPC.openProject, (_e, projectId: string) => {
    // 统一落点：已开则聚焦 / 有空窗口则就地打开 / 否则新窗口。
    manager.openOrFocus(projectId)
  })

  ipcMain.handle(IPC.manageOpen, () => openManageWindow())

  ipcMain.handle(IPC.manageClose, () => closeManageWindow())

  // 管理项目窗口里点项目：走统一落点后关闭管理窗口（不以管理窗口为落点）。
  ipcMain.handle(IPC.openProjectFromManage, (_e, projectId: string) => {
    manager.openOrFocus(projectId)
    closeManageWindow()
  })

  // 管理项目窗口的「打开本地项目」：选目录导入；成功建/扩项目则打开并关管理窗口。
  ipcMain.handle(IPC.manageImportProject, async (e): Promise<ImportOutcome | null> => {
    const win = senderWindow(e)
    const chosen = await pickDirectory(win, '打开本地项目')
    if (!chosen) return null
    const outcome = importProject(registry, chosen, serviceDeps)
    saveRegistry()
    manager.openOrFocus(outcome.project.id)
    closeManageWindow()
    return outcome
  })

  ipcMain.handle(IPC.removeProject, (_e, projectId: string): Project[] => {
    removeProjectCore(registry, projectId)
    saveRegistry()
    return registry.projects
  })

  ipcMain.handle(IPC.showItemInFolder, (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle(IPC.getAppVersion, (): string => app.getVersion())

  ipcMain.handle(IPC.linkMember, async (e, projectId: string): Promise<Project | null> => {
    const win = senderWindow(e)
    const chosen = await pickDirectory(win, '关联成员仓')
    if (!chosen) return null
    const project = linkMemberByDir(registry, projectId, chosen, serviceDeps)
    saveRegistry()
    manager.refreshWindowsFor(projectId)
    return project
  })

  ipcMain.handle(
    IPC.unlinkMember,
    (_e, projectId: string, memberId: string): Project | null => {
      const project = unlinkMemberCore(registry, projectId, memberId, new Date().toISOString())
      saveRegistry()
      manager.refreshWindowsFor(projectId)
      return project
    }
  )

  ipcMain.handle(
    IPC.relocateMember,
    async (e, projectId: string, memberId: string): Promise<Project | null> => {
      const win = senderWindow(e)
      const chosen = await pickDirectory(win, '重新定位成员仓')
      if (!chosen) return null
      const project = relocateMemberToDir(registry, projectId, memberId, chosen, serviceDeps)
      saveRegistry()
      manager.refreshWindowsFor(projectId)
      return project
    }
  )

  ipcMain.handle(IPC.listDir, (_e, dirPath: string) => listDir(dirPath))
  ipcMain.handle(IPC.readFile, (_e, path: string) => readFileForPreview(path))

  // 只读 git 查询：在成员仓 rootPath 下跑系统 git；非 git 目录由 runner 返回 null → 空态。
  ipcMain.handle(IPC.gitBranches, (_e, rootPath: string) =>
    listBranches(rootPath, makeGitRunner(rootPath))
  )

  ipcMain.handle(IPC.gitWorktrees, (_e, rootPath: string) =>
    listWorktrees(rootPath, makeGitRunner(rootPath))
  )

  ipcMain.handle(IPC.setGitWatchPath, (e, path: string | null) => {
    const win = senderWindow(e)
    if (win) manager.setGitWatchPath(win, path)
  })

  ipcMain.handle(IPC.getSidebarCollapsed, (e): boolean => {
    const win = senderWindow(e)
    return win ? manager.getSidebarCollapsed(win) : false
  })

  ipcMain.handle(IPC.setSidebarCollapsed, (e, collapsed: boolean) => {
    const win = senderWindow(e)
    if (win) manager.setSidebarCollapsed(win, collapsed)
  })

  ipcMain.handle(IPC.getSidebarWidth, (e): number => {
    const win = senderWindow(e)
    return win ? manager.getSidebarWidth(win) : DEFAULT_SIDEBAR_WIDTH
  })

  ipcMain.handle(IPC.setSidebarWidth, (e, width: number) => {
    const win = senderWindow(e)
    if (win) manager.setSidebarWidth(win, width)
  })

  ipcMain.handle(IPC.getSidebarView, (e): SidebarViewState => {
    const win = senderWindow(e)
    return win
      ? manager.getSidebarView(win)
      : { view: 'files', gitMemberId: null, gitBranch: null }
  })

  ipcMain.handle(IPC.setSidebarView, (e, state: SidebarViewState) => {
    const win = senderWindow(e)
    if (win) manager.setSidebarView(win, state)
  })

  // 自绘窗口控制：操作发起窗口。
  ipcMain.handle(IPC.windowMinimize, (e) => senderWindow(e)?.minimize())
  ipcMain.handle(IPC.windowMaximizeToggle, (e) => {
    const win = senderWindow(e)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(IPC.windowClose, (e) => senderWindow(e)?.close())

  ipcMain.handle(IPC.getSystemLocale, (): string => app.getLocale())

  ipcMain.handle(IPC.getLanguage, () => settings.language)

  ipcMain.handle(IPC.setLanguage, (_e, value: unknown) => {
    settings = applyLanguage(settings, value, { write: (s) => writeJson(SETTINGS_FILE, s) })
    return settings.language
  })

  ipcMain.handle(IPC.getAppearance, () => settings.appearance)

  ipcMain.handle(IPC.setAppearance, (_e, value: unknown) => {
    settings = applyAppearance(settings, value, { write: (s) => writeJson(SETTINGS_FILE, s) })
    // nativeTheme 跟随外观（'system' 则跟随 OS）；随后广播生效主题给所有窗口。
    nativeTheme.themeSource = settings.appearance ?? DEFAULT_APPEARANCE
    broadcastTheme()
    return settings.appearance
  })

  ipcMain.handle(IPC.getEffectiveTheme, (): EffectiveTheme => effectiveTheme())

  // ── 本地 agent 扫描与默认 agent/模型偏好 ──
  ipcMain.handle(IPC.agentsScan, (): DetectedAgent[] => detectedAgents)

  ipcMain.handle(IPC.getDefaultAgent, () => settings.defaultAgent ?? null)

  ipcMain.handle(IPC.setDefaultAgent, (_e, value: unknown) => {
    // 仅允许写入已检测到的受支持 agent；切换时自动清除不匹配的旧模型。
    settings = applyDefaultAgent(settings, value, detectedAgents.map((a) => a.id), {
      write: (s) => writeJson(SETTINGS_FILE, s)
    })
    return settings.defaultAgent ?? null
  })

  ipcMain.handle(IPC.getDefaultModel, () => settings.defaultModel ?? null)

  ipcMain.handle(IPC.setDefaultModel, (_e, value: unknown) => {
    settings = applyDefaultModel(settings, value, { write: (s) => writeJson(SETTINGS_FILE, s) })
    return settings.defaultModel ?? null
  })

  // ── 工作流库 ──
  // ── 引擎执行：一次性触发 + 观察 + 可取消可恢复 ──
  // start/resume/decide 触发后台运行,只回当前断点(不 await settled——长命令不挂渲染层、关窗不孤儿)。
  ipcMain.handle(IPC.engineStart, (_e, req: RunRequest) => {
    const { runId } = engine.start(req)
    return engine.getRunState(runId)
  })
  ipcMain.handle(IPC.enginePause, (_e, runId: string) => engine.pause(runId))
  ipcMain.handle(IPC.engineResume, (_e, runId: string) => {
    engine.resume(runId)
    return engine.getRunState(runId)
  })
  ipcMain.handle(IPC.engineDecide, (_e, runId: string, response: DecisionResponse) => {
    engine.decide(runId, response)
    return engine.getRunState(runId)
  })
  ipcMain.handle(IPC.engineGetRunState, (_e, runId: string) => engine.getRunState(runId))
  ipcMain.handle(IPC.engineRunGateAction, (_e, runId: string, actionIndex: number) =>
    engine.runGateAction(runId, actionIndex)
  )
  ipcMain.handle(IPC.engineStopGateAction, (_e, runId: string) => engine.stopGateAction(runId))
  ipcMain.handle(IPC.engineAdvanceCommand, (_e, runId: string, mode: 'abort' | 'detach') =>
    engine.advanceCommand(runId, mode)
  )
  ipcMain.handle(IPC.engineListBackground, (_e, runId: string) => engine.listBackground(runId))
  ipcMain.handle(IPC.engineStopBackground, (_e, runId: string, bgId: string) =>
    engine.stopBackground(runId, bgId)
  )
  ipcMain.handle(IPC.engineReadOutput, (_e, runId: string, bucket: string): string =>
    engine.readOutput(runId, bucket)
  )
  ipcMain.handle(IPC.engineListOutputBuckets, (_e, runId: string): string[] =>
    engine.listOutputBuckets(runId)
  )

  // ── 需求卡持久化与运行集成 ──
  ipcMain.handle(IPC.cardsList, (e): StoredCard[] => {
    const pid = currentProjectId(e)
    return pid ? cardStore.list(pid) : []
  })
  ipcMain.handle(
    IPC.cardsCreate,
    (e, candidates: CandidateCard[]): { created: StoredCard[]; issues: CandidateIssue[] } => {
      const pid = currentProjectId(e)
      if (!pid) return { created: [], issues: [] }
      const project = findProjectById(registry, pid)
      // 落到新卡的涉及仓默认 = 项目全部成员仓身份（单仓项目即唯一成员；运行只取首仓）。
      const repos = project ? project.members.map((m) => m.id) : []
      // 「描述想法」纯 create 落库收敛为 applyOps 的特例（全 create），与编排落库共用同一套逻辑。
      const res = applyOpsToStore(cardStore, {
        projectId: pid,
        ops: createOpsFromCandidates(candidates),
        now: Date.now(),
        registry: typeArchetypeMap(getProjectCardTypes(registry, pid)),
        repos
      })
      const issues: CandidateIssue[] = res.issues.map((i) => ({
        index: i.index,
        proposedName: candidates[i.index]?.proposedName ?? '',
        reason: i.reason
      }))
      return { created: res.created, issues }
    }
  )
  ipcMain.handle(IPC.cardsUpdate, (e, slug: string, patch: Partial<StoredCard>): StoredCard | null => {
    const pid = currentProjectId(e)
    return pid ? cardStore.update(pid, slug, { ...patch, updatedAt: Date.now() }) : null
  })
  ipcMain.handle(IPC.cardsRemove, (e, slug: string): void => {
    const pid = currentProjectId(e)
    if (pid) cardStore.remove(pid, slug)
  })
  ipcMain.handle(IPC.cardsRun, (e, slug: string): { runId: string } | { error: string } => {
    const pid = currentProjectId(e)
    if (!pid) return { error: '未绑定项目' }
    const card = cardStore.get(pid, slug)
    if (!card) return { error: '需求卡不存在' }
    const project = findProjectById(registry, pid)
    if (!project) return { error: '项目不存在' }
    const derived = deriveRunRequest(card, project)
    if (!derived.ok) return { error: derived.reason }
    const launched = engine.start(derived.request)
    // 建立卡→运行反向链 + 进行中（运行→卡正向链为 request.cardId；后续状态由 reconcileCardForRun 跟随）。
    cardStore.update(pid, slug, { activeRunId: launched.runId, status: '进行中', updatedAt: Date.now() })
    return { runId: launched.runId }
  })
  ipcMain.handle(IPC.cardsBranches, (e, slug: string): CardBranch[] => {
    const pid = currentProjectId(e)
    if (!pid) return []
    const card = cardStore.get(pid, slug)
    if (!card?.activeRunId) return []
    const members = engine.getRunState(card.activeRunId)?.members
    if (!members) return []
    const project = findProjectById(registry, pid)
    const nameOf = (memberId: string): string =>
      project?.members.find((m) => m.id === memberId)?.derivedName ?? memberId
    // 门控=该成员仓本地分支已真正建出（worktree 有无交给 git 视图）。
    const branchExists = (repoPath: string, branch: string): boolean =>
      listBranches(repoPath, makeGitRunner(repoPath)).branches.includes(branch)
    return cardBranchesView(members, nameOf, branchExists)
  })
  ipcMain.handle(IPC.gitViewFocus, (e, slug: string, memberId?: string): void => {
    const pid = currentProjectId(e)
    if (!pid) return
    const card = cardStore.get(pid, slug)
    if (!card) return
    // 聚焦到点中的成员仓（缺省首仓）；分支取该成员实际派生分支（统一递增避撞后可能与预取名不同），
    // 无运行/无该成员派生时回落预取名。
    const repoId = memberId ?? card.repos[0]
    if (!repoId) return
    const members = card.activeRunId ? engine.getRunState(card.activeRunId)?.members : undefined
    const branch = members?.[repoId]?.branch ?? card.proposedName
    senderWindow(e)?.webContents.send(IPC.gitViewFocusRequest, { repoId, branch })
  })

  ipcMain.handle(IPC.listWorkflows, (): WorkflowSummary[] => workflows.list())

  ipcMain.handle(IPC.getWorkflow, (_e, id: string): WorkflowDefinition | null => workflows.get(id))

  ipcMain.handle(IPC.createWorkflow, (): WorkflowDefinition => workflows.create(randomUUID()))

  ipcMain.handle(IPC.cloneWorkflow, (_e, id: string): WorkflowDefinition | null =>
    workflows.clone(id, randomUUID())
  )

  ipcMain.handle(IPC.saveWorkflow, (_e, def: WorkflowDefinition): WorkflowValidation =>
    workflows.save(def)
  )

  ipcMain.handle(IPC.deleteWorkflow, (_e, id: string): WorkflowSummary[] => {
    // 先清理所有项目对该工作流的激活引用，再删整个包目录——删除后无悬挂引用。
    clearActiveWorkflow(registry, id)
    saveRegistry()
    workflows.remove(id)
    return workflows.list()
  })

  ipcMain.handle(IPC.importWorkflow, async (e): Promise<WorkflowImportResult | null> => {
    const win = senderWindow(e)
    const dir = await pickDirectory(win, '导入工作流包')
    if (!dir) return null
    try {
      const def = workflows.importPackage(dir, randomUUID())
      return { ok: true, summary: { id: def.id, name: def.name } }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : '导入失败：包不合法' }
    }
  })

  ipcMain.handle(IPC.exportWorkflow, async (e, id: string): Promise<void> => {
    const win = senderWindow(e)
    const dir = await pickDirectory(win, '导出工作流包到…')
    if (!dir) return
    workflows.exportPackage(id, join(dir, id))
  })

  ipcMain.handle(
    IPC.createSkillFile,
    (_e, workflowId: string, fileName: string, content: string): string =>
      workflows.writeSkillFile(workflowId, fileName, content)
  )

  ipcMain.handle(IPC.importSkillFile, async (e, workflowId: string): Promise<string | null> => {
    const win = senderWindow(e)
    const file = await pickFile(win, '选择 skill 文件')
    if (!file) return null
    return workflows.importSkillFile(workflowId, file)
  })

  ipcMain.handle(IPC.readSkillFile, (_e, workflowId: string, relPath: string): string | null =>
    workflows.readSkillFile(workflowId, relPath)
  )

  // 拼装某 agent 节点的完整 prompt（只读预览，单一来源：与将来执行器共用 assembleAgentPrompt）。
  // 传入当前（含未保存）节点；此处解析生效宪法 + 读 skill 文件 + 解析模板/校验引用，纯拼装委托给 shared。
  ipcMain.handle(IPC.previewAgentNodePrompt, (e, workflowId: string, node: WorkflowNode): string => {
    const projectId = currentProjectId(e)
    const language = settings.language ?? DEFAULT_LANGUAGE
    const constitution = projectId
      ? deriveEffectiveConstitution(rulePacks.all(), getConstitutionGovernance(registry, projectId), language)
      : []
    const exec = node.executor
    // 非 agent 节点没有可拼的 prompt 指令；promptText 留空（任务节给「未填写」提示）。
    const promptText =
      exec.kind === 'agent'
        ? exec.instruction.kind === 'inline'
          ? exec.instruction.text
          : workflows.readSkillFile(workflowId, exec.instruction.path)
        : ''
    return assembleAgentPrompt({
      language,
      promptText,
      constitution,
      writableScope: node.writableScope ?? [],
      outputs: resolveOutputs(node.outputs ?? [], rulePacks.all(), language)
    })
  })

  ipcMain.handle(IPC.getActiveWorkflow, (e): string | null => {
    const projectId = currentProjectId(e)
    return projectId ? getActiveWorkflowCore(registry, projectId) : null
  })

  ipcMain.handle(IPC.setActiveWorkflow, (e, workflowId: string | null) => {
    const projectId = currentProjectId(e)
    if (!projectId) return
    const now = new Date().toISOString()
    setActiveWorkflowCore(registry, projectId, workflowId, now)
    // 激活工作流时把其建议 leaf 类型幂等播种进**该项目**的类型集（已存在跳过、不覆盖；停用不删类型）。
    if (workflowId) seedProjectCardTypes(registry, projectId, workflows.get(workflowId)?.suggestedTypes, now)
    saveRegistry()
  })

  // ── 新建需求：分解能力（全局 agent 接缝；止于产出候选卡，落库归下一个 change）──
  const seamFor = (projectId: string | null): ReturnType<typeof createDecomposeSeam> =>
    createDecomposeSeam(makeResolveDeps(projectId), decomposeProducer)

  ipcMain.handle(IPC.getDecomposePrompt, (e): DecomposePromptOutcome => {
    const projectId = currentProjectId(e)
    return seamFor(projectId).resolvePrompt(projectId)
  })
  ipcMain.handle(IPC.decomposeRequirement, (e, input: DecomposeInput): Promise<DecomposeOutcome> => {
    const projectId = currentProjectId(e)
    return seamFor(projectId).decompose(input, projectId)
  })
  ipcMain.handle(
    IPC.submitDecomposedCandidates,
    (e, candidates: CandidateCard[]): Promise<DecomposeOutcome> => {
      const projectId = currentProjectId(e)
      return seamFor(projectId).submit(candidates, projectId)
    }
  )

  // ── 需求编排（全局 agent：意图→卡操作提案 / apply-ops / 全局对话）──
  const applyRegistryFor = (pid: string): TypeArchetypeMap => typeArchetypeMap(getProjectCardTypes(registry, pid))
  const reposFor = (pid: string): string[] => findProjectById(registry, pid)?.members.map((m) => m.id) ?? []

  // 跑一轮编排：可选先落用户消息 → 按会话选型跑 → 落 agent 回复/提案（空回复不再塞占位）。
  const runOrchestrateTurn = async (
    e: Electron.IpcMainInvokeEvent,
    conversationId: string | undefined,
    intent: string,
    appendUser: boolean
  ): Promise<OrchestrationOutcome> => {
    const pid = currentProjectId(e) // 可为 null——未绑定也跑（空全盘视野 + 可提议新建项目）。
    const scope = pid ?? UNBOUND_SCOPE // 会话按项目分开的作用域。
    if (appendUser && conversationId) {
      conversationStore.appendMessage(scope, conversationId, { role: 'user', text: intent, at: Date.now() })
    }
    const conv = conversationId ? conversationStore.get(scope, conversationId) : null
    const seam = createOrchestrateSeam(orchestrateDepsFor(pid), orchestrateProducer(scope, conv?.agentId, conv?.model))
    const outcome = await seam.orchestrate({ intent, conversationId }, pid)
    if (conversationId && !('unbound' in outcome)) {
      // 空回复不塞占位（历史里没输出的轮次不留占位；用户可重试）。
      conversationStore.appendMessage(scope, conversationId, {
        role: 'agent',
        text: outcome.reply?.trim() ? outcome.reply : '',
        proposal: outcome,
        at: Date.now()
      })
    }
    return outcome
  }

  ipcMain.handle(
    IPC.orchestrate,
    (e, input: { intent: string; conversationId?: string }): Promise<OrchestrationOutcome> =>
      runOrchestrateTurn(e, input.conversationId, input.intent, true)
  )

  // 重试：丢弃末尾 agent 回复 → 按会话选型重跑上一条用户意图 → 追加新回复（替换而非追加多一轮）。
  ipcMain.handle(IPC.conversationRetryLast, async (e, id: string): Promise<Conversation | null> => {
    const scope = convScope(e)
    const conv = conversationStore.get(scope, id)
    if (!conv) return null
    const lastUser = [...conv.messages].map((m) => m.role).lastIndexOf('user')
    if (lastUser < 0) return conv
    const text = conv.messages[lastUser].text
    conversationStore.truncateMessages(scope, id, lastUser + 1) // 保留到该用户消息、丢弃其后 agent 回复
    await runOrchestrateTurn(e, id, text, false)
    return conversationStore.get(scope, id)
  })

  // 编辑：移除最新一轮（末条用户消息及其后 agent 回复），返回被移除的用户文字供回填输入。
  ipcMain.handle(IPC.conversationDropLastTurn, (e, id: string): { text: string } | null => {
    const scope = convScope(e)
    const conv = conversationStore.get(scope, id)
    if (!conv) return null
    const lastUser = [...conv.messages].map((m) => m.role).lastIndexOf('user')
    if (lastUser < 0) return { text: '' }
    const text = conv.messages[lastUser].text
    conversationStore.truncateMessages(scope, id, lastUser) // 丢弃从该用户消息起的这一轮
    return { text }
  })

  ipcMain.handle(IPC.submitOrchestrationOps, (e, ops: CardOp[]): OrchestrationOutcome => {
    const pid = currentProjectId(e)
    const cards = pid ? cardStore.list(pid) : []
    const registryMap = pid ? applyRegistryFor(pid) : typeArchetypeMap([...DEFAULT_CARD_TYPES])
    const { issues } = validateOps(ops ?? [], { cards, registry: registryMap })
    return { ops: ops ?? [], issues }
  })

  ipcMain.handle(
    IPC.applyOps,
    (e, ops: CardOp[], confirmedDestructive?: boolean): ApplyOpsResult => {
      const pid = currentProjectId(e)
      if (!pid) return { created: [], updated: [], removed: [], issues: [] }
      return applyOpsToStore(cardStore, {
        projectId: pid,
        ops: ops ?? [],
        now: Date.now(),
        registry: applyRegistryFor(pid),
        repos: reposFor(pid),
        confirmedDestructive
      })
    }
  )

  // 新项目提议落地：选目录 → importProject（建/导入并绑当前窗口）→ 激活所选工作流（播种其类型）→ 种入 create ops。
  // 取消选目录即优雅中止、不建半截项目、不落卡。
  ipcMain.handle(
    IPC.orchestrateCreateProject,
    async (e, ops: CardOp[], workflowId?: string): Promise<{ projectId: string; applied: ApplyOpsResult } | null> => {
      const win = senderWindow(e)
      const chosen = await pickDirectory(win, '为新项目选择目录')
      if (!chosen) return null
      const outcome = importProject(registry, chosen, serviceDeps)
      const pid = outcome.project.id
      // 激活 agent 选定的工作流并播种其建议类型——新项目由此拿到对应类型集（卡的 typeId 据此校验）。
      if (workflowId && workflows.get(workflowId)) {
        const now = new Date().toISOString()
        setActiveWorkflowCore(registry, pid, workflowId, now)
        seedProjectCardTypes(registry, pid, workflows.get(workflowId)?.suggestedTypes, now)
      }
      saveRegistry()
      bindOrOpen(win, pid)
      const applied = applyOpsToStore(cardStore, {
        projectId: pid,
        ops: (ops ?? []).filter((o) => o.kind === 'create'),
        now: Date.now(),
        registry: applyRegistryFor(pid),
        repos: reposFor(pid)
      })
      return { projectId: pid, applied }
    }
  )

  ipcMain.handle(IPC.conversationsList, (e): Conversation[] => conversationStore.list(convScope(e)))
  ipcMain.handle(IPC.conversationGet, (e, id: string): Conversation | null =>
    conversationStore.get(convScope(e), id)
  )
  ipcMain.handle(IPC.conversationCreate, (e, title?: string): string | null =>
    conversationStore.create(convScope(e), randomUUID(), Date.now(), title).id
  )
  ipcMain.handle(IPC.conversationRemove, (e, id: string): void =>
    conversationStore.remove(convScope(e), id)
  )
  ipcMain.handle(
    IPC.setConversationAgentModel,
    (e, id: string, agentId?: string, model?: string): void =>
      conversationStore.setAgentModel(convScope(e), id, agentId, model)
  )

  // ── 全局覆盖分解 skill：手写/导入/读取（可选高级覆盖；优先于自动生成 skill）──
  ipcMain.handle(IPC.readDefaultDecomposeSkill, (): string => globalSkills.readOverride() ?? '')
  ipcMain.handle(IPC.writeDefaultDecomposeSkill, (_e, content: string): void =>
    globalSkills.writeOverride(content)
  )
  ipcMain.handle(IPC.importDefaultDecomposeSkill, async (e): Promise<boolean> => {
    const file = await pickFile(senderWindow(e), '选择分解 skill 文件')
    if (!file) return false
    globalSkills.importOverride(file)
    return true
  })
  // 由当前项目类型集自动生成的分解 skill（只读预览）——单一来源同 runDecompose 的兜底 prompt。
  ipcMain.handle(IPC.readGeneratedDecomposeSkill, (e): string => {
    const pid = currentProjectId(e)
    return buildDecomposeSkill(pid ? getProjectCardTypes(registry, pid) : [...DEFAULT_CARD_TYPES])
  })

  // ── 需求卡类型注册表：增删改查（项目级，存 project.cardTypes）──
  ipcMain.handle(IPC.listCardTypes, (e): CardTypeDef[] => {
    const pid = currentProjectId(e)
    return pid ? getProjectCardTypes(registry, pid) : [...DEFAULT_CARD_TYPES]
  })
  ipcMain.handle(IPC.saveCardType, (e, def: CardTypeDef): CardValidation => {
    const pid = currentProjectId(e)
    if (!pid) return { ok: false, reason: '未绑定项目——打开一个项目后再管理其需求卡类型' }
    const v = validateCardTypeDef(def)
    if (!v.ok) return v
    setProjectCardTypes(registry, pid, upsertCardType(getProjectCardTypes(registry, pid), def), new Date().toISOString())
    saveRegistry()
    return { ok: true }
  })
  ipcMain.handle(IPC.deleteCardType, (e, id: string): CardValidation => {
    const pid = currentProjectId(e)
    if (!pid) return { ok: false, reason: '未绑定项目' }
    setProjectCardTypes(registry, pid, removeCardType(getProjectCardTypes(registry, pid), id), new Date().toISOString())
    saveRegistry()
    return { ok: true }
  })

  // ── 描述想法窗：附件选择 / 粘贴图片落盘（返回路径供插入正文）──
  ipcMain.handle(IPC.pickAttachments, async (e): Promise<string[]> => {
    const win = senderWindow(e)
    const options: Electron.OpenDialogOptions = {
      title: '选择附件',
      properties: ['openFile', 'multiSelections']
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return picked.canceled ? [] : picked.filePaths
  })

  ipcMain.handle(IPC.saveClipboardImage, (): string | null => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const dir = join(app.getPath('userData'), 'attachments')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `paste-${randomUUID()}.png`)
    writeFileSync(file, image.toPNG())
    return file
  })

  ipcMain.handle(IPC.copyText, (_e, text: string): void => {
    clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''))
  })

  // ── 规则包库 ──
  ipcMain.handle(IPC.listRulePacks, (): RulePackSummary[] => rulePacks.list())
  ipcMain.handle(IPC.allRulePacks, (): RulePack[] => rulePacks.all())
  ipcMain.handle(IPC.getRulePack, (_e, id: string): RulePack | null => rulePacks.get(id))
  ipcMain.handle(IPC.createRulePack, (): RulePack => rulePacks.create(randomUUID()))
  ipcMain.handle(IPC.cloneRulePack, (_e, id: string): RulePack | null =>
    rulePacks.clone(id, randomUUID())
  )
  ipcMain.handle(IPC.saveRulePack, (_e, pack: RulePack): RulePackValidation => rulePacks.save(pack))
  ipcMain.handle(IPC.deleteRulePack, (_e, id: string): RulePackSummary[] => {
    rulePacks.remove(id)
    return rulePacks.list()
  })
  ipcMain.handle(IPC.importRulePack, async (e): Promise<RulePackValidation | null> => {
    const win = senderWindow(e)
    const dir = await pickDirectory(win, '导入规则包')
    if (!dir) return null
    try {
      rulePacks.importPackage(dir, randomUUID())
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : '导入失败：包不合法' }
    }
  })
  ipcMain.handle(IPC.exportRulePack, async (e, id: string): Promise<void> => {
    const win = senderWindow(e)
    const dir = await pickDirectory(win, '导出规则包到…')
    if (!dir) return
    rulePacks.exportPackage(id, join(dir, id))
  })

  // ── 项目宪法治理 ──
  ipcMain.handle(IPC.getConstitution, (e): ConstitutionGovernance => {
    const projectId = currentProjectId(e)
    return projectId
      ? getConstitutionGovernance(registry, projectId)
      : { activePackIds: [], disabledRules: [] }
  })
  ipcMain.handle(IPC.setConstitution, (e, governance: ConstitutionGovernance) => {
    const projectId = currentProjectId(e)
    if (!projectId) return
    setConstitutionGovernance(registry, projectId, governance, new Date().toISOString())
    saveRegistry()
  })
  ipcMain.handle(IPC.effectiveConstitution, (e): EffectiveConstitutionRule[] => {
    const projectId = currentProjectId(e)
    if (!projectId) return []
    return deriveEffectiveConstitution(
      rulePacks.all(),
      getConstitutionGovernance(registry, projectId),
      settings.language ?? DEFAULT_LANGUAGE
    )
  })
}

function restoreOrStart(): void {
  const session = readJson<SessionState>(SESSION_FILE, { windows: [] })
  const restorable = session.windows.filter((w) => findProjectById(registry, w.projectId))
  if (restorable.length > 0) {
    for (const w of restorable) manager.openProject(w.projectId, w)
  } else {
    manager.createEmptyWindow()
  }
}

app.whenReady().then(() => {
  // 首启检测：无已存 language 时按系统语言初始化并持久化（仅一次）。
  settings = initSettings({
    read: () => readJson<AppSettings | null>(SETTINGS_FILE, null),
    write: (s) => writeJson(SETTINGS_FILE, s),
    systemLocale: () => app.getLocale()
  })
  // 扫描本机已安装 agent（每次启动重扫；探测健壮、永不抛出，扫不到即空列表）。
  detectedAgents = scanAgents(makeAgentProbe())
  // 让 nativeTheme 跟随已存外观（'system' 则跟随 OS），使窗口首帧底色与生效主题一致、无白闪。
  nativeTheme.themeSource = settings.appearance ?? DEFAULT_APPEARANCE
  // 系统明暗变化时（仅「跟随系统」会改变 shouldUseDarkColors）广播新生效主题。
  nativeTheme.on('updated', broadcastTheme)
  // 库为空时种入两个内置默认工作流（本地直合 + PR 模式）。
  if (workflows.list().length === 0) {
    workflows.save(createDefaultWorkflow(randomUUID()))
    workflows.save(createDefaultWorkflowPr(randomUUID()))
  }
  // 「验收样例」按稳定 id 幂等种入（库非空也补，便于随时验收）。
  const ACCEPTANCE_WF_ID = 'acceptance-sample-multicmd'
  if (!workflows.get(ACCEPTANCE_WF_ID)) workflows.save(createAcceptanceSampleWorkflow(ACCEPTANCE_WF_ID))
  const ROLLBACK_WF_ID = 'acceptance-sample-rollback'
  if (!workflows.get(ROLLBACK_WF_ID)) workflows.save(createRollbackSampleWorkflow(ROLLBACK_WF_ID))
  // 库为空时种入内置默认规则包（含「测试先行」等宪法规则）。
  rulePacks.seedIfEmpty(randomUUID())
  registerIpc()
  // 开机自动恢复:续跑上次关软件时仍处于 running 的运行（断点续，不重做上游）。
  void engine.resumeAll()
  restoreOrStart()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) restoreOrStart()
  })
})

app.on('before-quit', () => {
  writeJson(SESSION_FILE, manager.snapshotSession())
  engine.killAllBackground() // 杀掉所有转后台的命令,不留孤儿
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
