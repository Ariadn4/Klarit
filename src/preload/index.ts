import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc'
import type { EngineProgressEvent, FileTreeChange, KlaritApi } from '../shared/types'
import type { EffectiveTheme } from '../shared/theme'

const api: KlaritApi = {
  importProject: () => ipcRenderer.invoke(IPC.importProject),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  getCurrentProject: () => ipcRenderer.invoke(IPC.currentProject),
  openProject: (projectId) => ipcRenderer.invoke(IPC.openProject, projectId),
  linkMember: (projectId) => ipcRenderer.invoke(IPC.linkMember, projectId),
  unlinkMember: (projectId, memberId) => ipcRenderer.invoke(IPC.unlinkMember, projectId, memberId),
  removeProject: (projectId) => ipcRenderer.invoke(IPC.removeProject, projectId),
  openManageWindow: () => ipcRenderer.invoke(IPC.manageOpen),
  closeManageWindow: () => ipcRenderer.invoke(IPC.manageClose),
  openProjectFromManage: (projectId) => ipcRenderer.invoke(IPC.openProjectFromManage, projectId),
  importProjectFromManage: () => ipcRenderer.invoke(IPC.manageImportProject),
  showItemInFolder: (path) => ipcRenderer.invoke(IPC.showItemInFolder, path),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  getAppVersion: () => ipcRenderer.invoke(IPC.getAppVersion),
  relocateMember: (projectId, memberId) =>
    ipcRenderer.invoke(IPC.relocateMember, projectId, memberId),
  listDir: (dirPath) => ipcRenderer.invoke(IPC.listDir, dirPath),
  readFile: (path) => ipcRenderer.invoke(IPC.readFile, path),
  listBranches: (rootPath) => ipcRenderer.invoke(IPC.gitBranches, rootPath),
  listWorktrees: (rootPath) => ipcRenderer.invoke(IPC.gitWorktrees, rootPath),
  setGitWatchPath: (path) => ipcRenderer.invoke(IPC.setGitWatchPath, path),
  onFileTreeChange: (handler) => {
    const listener = (_e: unknown, change: FileTreeChange): void => handler(change)
    ipcRenderer.on(IPC.fileTreeChange, listener)
    return () => ipcRenderer.removeListener(IPC.fileTreeChange, listener)
  },
  startRun: (req) => ipcRenderer.invoke(IPC.engineStart, req),
  pauseRun: (runId) => ipcRenderer.invoke(IPC.enginePause, runId),
  resumeRun: (runId) => ipcRenderer.invoke(IPC.engineResume, runId),
  decideRun: (runId, response) => ipcRenderer.invoke(IPC.engineDecide, runId, response),
  reenterRun: (runId, targetNodeId, instruction) =>
    ipcRenderer.invoke(IPC.engineReenter, runId, targetNodeId, instruction),
  injectRun: (runId, instruction) => ipcRenderer.invoke(IPC.engineInject, runId, instruction),
  getRunState: (runId) => ipcRenderer.invoke(IPC.engineGetRunState, runId),
  runGateAction: (runId, actionIndex) => ipcRenderer.invoke(IPC.engineRunGateAction, runId, actionIndex),
  stopGateAction: (runId) => ipcRenderer.invoke(IPC.engineStopGateAction, runId),
  advanceCommand: (runId, mode) => ipcRenderer.invoke(IPC.engineAdvanceCommand, runId, mode),
  listBackground: (runId) => ipcRenderer.invoke(IPC.engineListBackground, runId),
  stopBackground: (runId, bgId) => ipcRenderer.invoke(IPC.engineStopBackground, runId, bgId),
  onEngineProgress: (handler) => {
    const listener = (_e: unknown, evt: EngineProgressEvent): void => handler(evt)
    ipcRenderer.on(IPC.engineProgress, listener)
    return () => ipcRenderer.removeListener(IPC.engineProgress, listener)
  },
  readRunOutput: (runId, bucket) => ipcRenderer.invoke(IPC.engineReadOutput, runId, bucket),
  listRunOutputBuckets: (runId) => ipcRenderer.invoke(IPC.engineListOutputBuckets, runId),
  listCards: () => ipcRenderer.invoke(IPC.cardsList),
  createCards: (candidates) => ipcRenderer.invoke(IPC.cardsCreate, candidates),
  updateCard: (slug, patch) => ipcRenderer.invoke(IPC.cardsUpdate, slug, patch),
  removeCard: (slug, opts) => ipcRenderer.invoke(IPC.cardsRemove, slug, opts),
  cardBranchCleanupInfo: (slug) => ipcRenderer.invoke(IPC.cardsBranchCleanupInfo, slug),
  runCard: (slug) => ipcRenderer.invoke(IPC.cardsRun, slug),
  cardBranches: (slug) => ipcRenderer.invoke(IPC.cardsBranches, slug),
  focusCardGitView: (slug, memberId) => ipcRenderer.invoke(IPC.gitViewFocus, slug, memberId),
  onGitViewFocus: (handler) => {
    const listener = (_e: unknown, req: { repoId: string; branch: string }): void => handler(req)
    ipcRenderer.on(IPC.gitViewFocusRequest, listener)
    return () => ipcRenderer.removeListener(IPC.gitViewFocusRequest, listener)
  },
  getSidebarCollapsed: () => ipcRenderer.invoke(IPC.getSidebarCollapsed),
  setSidebarCollapsed: (collapsed) => ipcRenderer.invoke(IPC.setSidebarCollapsed, collapsed),
  getSidebarWidth: () => ipcRenderer.invoke(IPC.getSidebarWidth),
  setSidebarWidth: (width) => ipcRenderer.invoke(IPC.setSidebarWidth, width),
  getSidebarView: () => ipcRenderer.invoke(IPC.getSidebarView),
  setSidebarView: (state) => ipcRenderer.invoke(IPC.setSidebarView, state),
  getSystemLocale: () => ipcRenderer.invoke(IPC.getSystemLocale),
  getLanguage: () => ipcRenderer.invoke(IPC.getLanguage),
  setLanguage: (language) => ipcRenderer.invoke(IPC.setLanguage, language),
  getAppearance: () => ipcRenderer.invoke(IPC.getAppearance),
  setAppearance: (appearance) => ipcRenderer.invoke(IPC.setAppearance, appearance),
  getEffectiveTheme: () => ipcRenderer.invoke(IPC.getEffectiveTheme),
  onThemeChange: (handler) => {
    const listener = (_e: unknown, theme: EffectiveTheme): void => handler(theme)
    ipcRenderer.on(IPC.themeChanged, listener)
    return () => ipcRenderer.removeListener(IPC.themeChanged, listener)
  },
  onProjectBound: (handler) => {
    const listener = (): void => handler()
    ipcRenderer.on(IPC.projectBound, listener)
    return () => ipcRenderer.removeListener(IPC.projectBound, listener)
  },
  onCardsChanged: (handler) => {
    const listener = (): void => handler()
    ipcRenderer.on(IPC.cardsChanged, listener)
    return () => ipcRenderer.removeListener(IPC.cardsChanged, listener)
  },
  minimizeWindow: () => ipcRenderer.invoke(IPC.windowMinimize),
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC.windowMaximizeToggle),
  closeWindow: () => ipcRenderer.invoke(IPC.windowClose),
  listWorkflows: () => ipcRenderer.invoke(IPC.listWorkflows),
  getWorkflow: (id) => ipcRenderer.invoke(IPC.getWorkflow, id),
  createWorkflow: () => ipcRenderer.invoke(IPC.createWorkflow),
  cloneWorkflow: (id) => ipcRenderer.invoke(IPC.cloneWorkflow, id),
  saveWorkflow: (def) => ipcRenderer.invoke(IPC.saveWorkflow, def),
  deleteWorkflow: (id) => ipcRenderer.invoke(IPC.deleteWorkflow, id),
  importWorkflow: () => ipcRenderer.invoke(IPC.importWorkflow),
  exportWorkflow: (id) => ipcRenderer.invoke(IPC.exportWorkflow, id),
  createSkillFile: (workflowId, fileName, content) =>
    ipcRenderer.invoke(IPC.createSkillFile, workflowId, fileName, content),
  importSkillFile: (workflowId) => ipcRenderer.invoke(IPC.importSkillFile, workflowId),
  readSkillFile: (workflowId, relPath) => ipcRenderer.invoke(IPC.readSkillFile, workflowId, relPath),
  previewAgentNodePrompt: (workflowId, node) =>
    ipcRenderer.invoke(IPC.previewAgentNodePrompt, workflowId, node),
  getActiveWorkflow: () => ipcRenderer.invoke(IPC.getActiveWorkflow),
  setActiveWorkflow: (workflowId) => ipcRenderer.invoke(IPC.setActiveWorkflow, workflowId),
  scanAgents: () => ipcRenderer.invoke(IPC.agentsScan),
  getDefaultAgent: () => ipcRenderer.invoke(IPC.getDefaultAgent),
  setDefaultAgent: (agentId) => ipcRenderer.invoke(IPC.setDefaultAgent, agentId),
  getDefaultModel: () => ipcRenderer.invoke(IPC.getDefaultModel),
  setDefaultModel: (modelId) => ipcRenderer.invoke(IPC.setDefaultModel, modelId),
  listRulePacks: () => ipcRenderer.invoke(IPC.listRulePacks),
  allRulePacks: () => ipcRenderer.invoke(IPC.allRulePacks),
  getRulePack: (id) => ipcRenderer.invoke(IPC.getRulePack, id),
  createRulePack: () => ipcRenderer.invoke(IPC.createRulePack),
  cloneRulePack: (id) => ipcRenderer.invoke(IPC.cloneRulePack, id),
  saveRulePack: (pack) => ipcRenderer.invoke(IPC.saveRulePack, pack),
  deleteRulePack: (id) => ipcRenderer.invoke(IPC.deleteRulePack, id),
  importRulePack: () => ipcRenderer.invoke(IPC.importRulePack),
  exportRulePack: (id) => ipcRenderer.invoke(IPC.exportRulePack, id),
  getConstitution: () => ipcRenderer.invoke(IPC.getConstitution),
  setConstitution: (governance) => ipcRenderer.invoke(IPC.setConstitution, governance),
  effectiveConstitution: () => ipcRenderer.invoke(IPC.effectiveConstitution),
  getDecomposePrompt: () => ipcRenderer.invoke(IPC.getDecomposePrompt),
  decomposeRequirement: (input) => ipcRenderer.invoke(IPC.decomposeRequirement, input),
  submitDecomposedCandidates: (candidates) =>
    ipcRenderer.invoke(IPC.submitDecomposedCandidates, candidates),
  readDefaultDecomposeSkill: () => ipcRenderer.invoke(IPC.readDefaultDecomposeSkill),
  writeDefaultDecomposeSkill: (content) =>
    ipcRenderer.invoke(IPC.writeDefaultDecomposeSkill, content),
  importDefaultDecomposeSkill: () => ipcRenderer.invoke(IPC.importDefaultDecomposeSkill),
  readGeneratedDecomposeSkill: () => ipcRenderer.invoke(IPC.readGeneratedDecomposeSkill),
  orchestrate: (input) => ipcRenderer.invoke(IPC.orchestrate, input),
  submitOrchestrationOps: (ops) => ipcRenderer.invoke(IPC.submitOrchestrationOps, ops),
  applyOps: (ops, confirmedDestructive) =>
    ipcRenderer.invoke(IPC.applyOps, ops, confirmedDestructive),
  orchestrateCreateProject: (ops, workflowId) =>
    ipcRenderer.invoke(IPC.orchestrateCreateProject, ops, workflowId),
  listConversations: () => ipcRenderer.invoke(IPC.conversationsList),
  getConversation: (id) => ipcRenderer.invoke(IPC.conversationGet, id),
  createConversation: (title) => ipcRenderer.invoke(IPC.conversationCreate, title),
  removeConversation: (id) => ipcRenderer.invoke(IPC.conversationRemove, id),
  setConversationAgentModel: (id, agentId, model) =>
    ipcRenderer.invoke(IPC.setConversationAgentModel, id, agentId, model),
  retryLastTurn: (id) => ipcRenderer.invoke(IPC.conversationRetryLast, id),
  dropLastTurn: (id) => ipcRenderer.invoke(IPC.conversationDropLastTurn, id),
  getCardConversation: (cardId) => ipcRenderer.invoke(IPC.cardConsultGet, cardId),
  sendCardConsult: (cardId, intent) => ipcRenderer.invoke(IPC.cardConsultSend, cardId, intent),
  retryLastCardConsult: (cardId) => ipcRenderer.invoke(IPC.cardConsultRetryLast, cardId),
  dropLastCardConsultTurn: (cardId) => ipcRenderer.invoke(IPC.cardConsultDropLastTurn, cardId),
  setCardConsultAgentModel: (cardId, agentId, model) =>
    ipcRenderer.invoke(IPC.cardConsultSetAgentModel, cardId, agentId, model),
  classifyCardGateInput: (cardId, text) => ipcRenderer.invoke(IPC.cardGateClassify, cardId, text),
  markCardInterventionApplied: (cardId, messageAt, index) =>
    ipcRenderer.invoke(IPC.cardConsultMarkApplied, cardId, messageAt, index),
  clearCardConversation: (cardId) => ipcRenderer.invoke(IPC.cardConsultClear, cardId),
  abortCardConsult: (cardId) => ipcRenderer.invoke(IPC.cardConsultAbort, cardId),
  listCardTypes: () => ipcRenderer.invoke(IPC.listCardTypes),
  saveCardType: (def) => ipcRenderer.invoke(IPC.saveCardType, def),
  deleteCardType: (id) => ipcRenderer.invoke(IPC.deleteCardType, id),
  pickAttachments: () => ipcRenderer.invoke(IPC.pickAttachments),
  saveClipboardImage: () => ipcRenderer.invoke(IPC.saveClipboardImage),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  analyzeDocuments: (memberId) => ipcRenderer.invoke(IPC.documentsAnalyze, memberId),
  getDocuments: (memberId) => ipcRenderer.invoke(IPC.documentsGet, memberId),
  saveDocuments: (registry) => ipcRenderer.invoke(IPC.documentsSave, registry),
  onDocumentsOnboard: (handler) => {
    const listener = (_e: unknown, memberId: string): void => handler(memberId)
    ipcRenderer.on(IPC.documentsOnboard, listener)
    return () => ipcRenderer.removeListener(IPC.documentsOnboard, listener)
  },
  onProjectsChanged: (handler) => {
    const listener = (): void => handler()
    ipcRenderer.on(IPC.projectsChanged, listener)
    return () => ipcRenderer.removeListener(IPC.projectsChanged, listener)
  },
  // Electron 42 起 File.path 已移除，拖入文件的本地路径用 webUtils 取（同步、在 preload 上下文执行）。
  getDroppedFilePath: (file: File) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('klarit', api)
