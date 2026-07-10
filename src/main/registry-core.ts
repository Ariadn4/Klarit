import type {
  CardTypeDef,
  GitInfo,
  LegacyRegistryData,
  Project,
  RegistryData,
  RepoMember
} from '../shared/types'
import type { ConstitutionGovernance } from '../shared/rule-pack'
import { projectCardTypes, seedCardTypes } from '../shared/card-type'

export function createRegistry(): RegistryData {
  return { projects: [] }
}

/** 把旧版单仓注册表迁移为新格式：每个旧条目 = 成员数为 1 的项目（分组 id 复用其 id）。 */
export function migrateLegacy(legacy: LegacyRegistryData): RegistryData {
  return {
    projects: legacy.entries.map((e) => ({
      id: e.id,
      displayName: e.displayName,
      derivedName: e.derivedName,
      members: [
        {
          id: e.id,
          idKind: e.idKind,
          derivedName: e.derivedName,
          rootPath: e.rootPath,
          worktreePaths: e.worktreePaths,
          git: e.git,
          gitless: e.gitless
        }
      ],
      createdAt: e.createdAt,
      updatedAt: e.updatedAt
    }))
  }
}

/** 容错读取：新格式原样、旧格式迁移、其它返回空注册表。 */
export function normalizeRegistry(raw: unknown): RegistryData {
  const r = raw as { projects?: unknown; entries?: unknown } | null
  if (r && Array.isArray(r.projects)) return r as RegistryData
  if (r && Array.isArray(r.entries)) return migrateLegacy(r as LegacyRegistryData)
  return createRegistry()
}

export function findProjectById(data: RegistryData, id: string): Project | undefined {
  return data.projects.find((p) => p.id === id)
}

export function findProjectByMemberId(data: RegistryData, memberId: string): Project | undefined {
  return data.projects.find((p) => p.members.some((m) => m.id === memberId))
}

function findMember(
  data: RegistryData,
  pred: (m: RepoMember) => boolean
): { project: Project; member: RepoMember } | undefined {
  for (const project of data.projects) {
    const member = project.members.find(pred)
    if (member) return { project, member }
  }
  return undefined
}

/** 注册表里已有该 commonDir 的 git 成员仓时返回其 UUID（多 worktree 归并用）。 */
export function resolveUuidForCommonDir(data: RegistryData, commonDir: string): string | undefined {
  return findMember(data, (m) => m.idKind === 'uuid' && m.git?.commonDir === commonDir)?.member.id
}

function pruneEmpty(data: RegistryData): void {
  data.projects = data.projects.filter((p) => p.members.length > 0)
}

function addWorktreePath(member: RepoMember, path: string): void {
  if (!member.worktreePaths.includes(path)) member.worktreePaths.push(path)
}

// ── 导入（单仓 / gitless） ──────────────────────────────────────────────

export interface ImportInput {
  /** 规范化的主工作树路径。 */
  rootPath: string
  /** 派生名（文件夹名）。 */
  derivedName: string
  /** 已解析的持久身份 UUID；gitless 时为 null。 */
  projectId: string | null
  /** git 信息；gitless 时为 null。 */
  git: GitInfo | null
  /** 注入的时间戳（ISO）。 */
  now: string
}

export interface UpsertOutcome {
  project: Project
  /** 是否复用既有项目（重复导入 / 多 worktree / 移动目录）。 */
  reused: boolean
}

export function memberFromImport(input: ImportInput): RepoMember {
  return {
    id: input.projectId ?? input.rootPath,
    idKind: input.projectId ? 'uuid' : 'path',
    derivedName: input.derivedName,
    rootPath: input.rootPath,
    worktreePaths: [input.rootPath],
    git: input.git,
    gitless: input.git === null
  }
}

function applyImportToMember(member: RepoMember, input: ImportInput): void {
  member.rootPath = input.rootPath
  member.git = input.git
  member.gitless = input.git === null
  member.missing = false
  addWorktreePath(member, input.rootPath)
}

function locateMemberForImport(
  data: RegistryData,
  input: ImportInput
): { project: Project; member: RepoMember } | undefined {
  if (input.projectId) {
    const byUuid = findMember(data, (m) => m.idKind === 'uuid' && m.id === input.projectId)
    if (byUuid) return byUuid
    if (input.git) {
      return findMember(data, (m) => m.idKind === 'uuid' && m.git?.commonDir === input.git!.commonDir)
    }
    return undefined
  }
  return findMember(data, (m) => m.idKind === 'path' && m.id === input.rootPath)
}

/**
 * 导入单个仓 / gitless 目录：命中既有成员则就地更新（视为复用其所属项目）；
 * 否则新建一个成员数为 1 的项目。
 */
export function upsertImport(data: RegistryData, input: ImportInput): UpsertOutcome {
  const hit = locateMemberForImport(data, input)
  if (hit) {
    applyImportToMember(hit.member, input)
    hit.project.updatedAt = input.now
    return { project: hit.project, reused: true }
  }
  const member = memberFromImport(input)
  const project: Project = {
    id: member.id,
    displayName: input.derivedName,
    derivedName: input.derivedName,
    members: [member],
    createdAt: input.now,
    updatedAt: input.now
  }
  data.projects.push(project)
  return { project, reused: false }
}

// ── 多仓建组与成员管理 ─────────────────────────────────────────────────

/** 把同 id 成员从别的项目移走（一仓至多属一个项目）。 */
function detachFromOthers(data: RegistryData, memberId: string, keepProjectId: string): void {
  for (const p of data.projects) {
    if (p.id === keepProjectId) continue
    p.members = p.members.filter((m) => m.id !== memberId)
  }
  pruneEmpty(data)
}

export interface CreateProjectInput {
  groupId: string
  displayName: string
  derivedName: string
  members: RepoMember[]
  now: string
}

/** 用给定成员建一个（多仓）项目；成员若已属别的项目则移过来。 */
export function createProject(data: RegistryData, input: CreateProjectInput): Project {
  // 先把这些成员从所有现有项目移走，再建新项目（避免空项目被 prune 误删）。
  const ids = new Set(input.members.map((m) => m.id))
  for (const p of data.projects) p.members = p.members.filter((m) => !ids.has(m.id))
  pruneEmpty(data)
  const members: RepoMember[] = []
  for (const m of input.members) if (!members.some((x) => x.id === m.id)) members.push(m)
  const project: Project = {
    id: input.groupId,
    displayName: input.displayName,
    derivedName: input.derivedName,
    members,
    createdAt: input.now,
    updatedAt: input.now
  }
  data.projects.push(project)
  return project
}

/** 把一个成员仓关联进项目（去重；若属别的项目则移过来）。返回项目，找不到项目返回 null。 */
export function linkMember(
  data: RegistryData,
  projectId: string,
  member: RepoMember,
  now: string
): Project | null {
  const project = findProjectById(data, projectId)
  if (!project) return null
  detachFromOthers(data, member.id, projectId)
  const existing = project.members.find((m) => m.id === member.id)
  if (existing) {
    existing.rootPath = member.rootPath
    existing.git = member.git
    existing.gitless = member.gitless
    existing.missing = false
    addWorktreePath(existing, member.rootPath)
  } else {
    project.members.push(member)
  }
  project.updatedAt = now
  return project
}

/** 解绑某成员仓（只解分组，不动磁盘）。成员降到 0 则删除项目并返回 null。 */
export function unlinkMember(
  data: RegistryData,
  projectId: string,
  memberId: string,
  now: string
): Project | null {
  const project = findProjectById(data, projectId)
  if (!project) return null
  project.members = project.members.filter((m) => m.id !== memberId)
  project.updatedAt = now
  if (project.members.length === 0) {
    data.projects = data.projects.filter((p) => p.id !== projectId)
    return null
  }
  return project
}

/** 整体移除一个项目（从注册表删除该 group，不动磁盘）。返回是否确实删除了某项目。 */
export function removeProject(data: RegistryData, projectId: string): boolean {
  const before = data.projects.length
  data.projects = data.projects.filter((p) => p.id !== projectId)
  return data.projects.length < before
}

/** 为缺失成员重新定位到新路径（git 信息由调用方在 probe 后另行更新）。 */
export function relocateMember(
  data: RegistryData,
  projectId: string,
  memberId: string,
  newRootPath: string,
  now: string
): Project | null {
  const project = findProjectById(data, projectId)
  if (!project) return null
  const member = project.members.find((m) => m.id === memberId)
  if (!member) return null
  member.rootPath = newRootPath
  member.missing = false
  addWorktreePath(member, newRootPath)
  project.updatedAt = now
  return project
}

/**
 * 设置某成员仓的标签（供工作流节点 target=tag 解析，见 repo-targeting）。
 * 用户手动打标与后续 agent 辅助共用此写入口；空串/undefined 视为清除标注。标签属项目管理数据、
 * 随 registry.json 持久化（normalizeRegistry 原样保留）、不入 git。命中成员返回其项目、否则 null。
 */
export function setMemberTag(
  data: RegistryData,
  memberId: string,
  tag: string | undefined,
  now: string
): Project | null {
  const hit = findMember(data, (m) => m.id === memberId)
  if (!hit) return null
  const trimmed = tag?.trim()
  if (trimmed) hit.member.tag = trimmed
  else delete hit.member.tag
  hit.project.updatedAt = now
  return hit.project
}

/** 对账磁盘：按 exists 谓词标记每个成员的 missing 状态（不清除任何成员）。 */
export function reconcileMissing(data: RegistryData, exists: (path: string) => boolean): void {
  for (const project of data.projects) {
    for (const member of project.members) {
      member.missing = !exists(member.rootPath)
    }
  }
}

// ── 项目激活工作流 ─────────────────────────────────────────────────────

/** 读取某项目激活的工作流 id；未设置或项目不存在返回 null。 */
export function getActiveWorkflow(data: RegistryData, projectId: string): string | null {
  return findProjectById(data, projectId)?.activeWorkflowId ?? null
}

/** 设置某项目激活的工作流 id（传 null 清除）。项目不存在返回 null。 */
export function setActiveWorkflow(
  data: RegistryData,
  projectId: string,
  workflowId: string | null,
  now: string
): Project | null {
  const project = findProjectById(data, projectId)
  if (!project) return null
  project.activeWorkflowId = workflowId
  project.updatedAt = now
  return project
}

/** 删除工作流时调用：清除所有指向它的项目激活指针，避免悬挂引用。 */
export function clearActiveWorkflow(data: RegistryData, workflowId: string): void {
  for (const p of data.projects) {
    if (p.activeWorkflowId === workflowId) p.activeWorkflowId = null
  }
}

/** 读某项目的宪法治理状态（缺省＝未激活任何包）。 */
export function getConstitutionGovernance(
  data: RegistryData,
  projectId: string
): ConstitutionGovernance {
  return findProjectById(data, projectId)?.constitution ?? { activePackIds: [], disabledRules: [] }
}

/** 设置某项目的宪法治理状态（激活包 + 逐条开关）。项目不存在返回 null。 */
export function setConstitutionGovernance(
  data: RegistryData,
  projectId: string,
  governance: ConstitutionGovernance,
  now: string
): Project | null {
  const project = findProjectById(data, projectId)
  if (!project) return null
  project.constitution = governance
  project.updatedAt = now
  return project
}

// ── 项目需求卡类型注册表 ───────────────────────────────────────────────

/** 读某项目的需求卡类型集；未设置回落默认种子（项目不存在亦给默认，供未绑定上下文）。 */
export function getProjectCardTypes(data: RegistryData, projectId: string): CardTypeDef[] {
  return projectCardTypes(findProjectById(data, projectId)?.cardTypes)
}

/** 整体设置某项目的需求卡类型集。项目不存在返回 null。 */
export function setProjectCardTypes(
  data: RegistryData,
  projectId: string,
  types: CardTypeDef[],
  now: string
): Project | null {
  const project = findProjectById(data, projectId)
  if (!project) return null
  project.cardTypes = types
  project.updatedAt = now
  return project
}

/**
 * 工作流激活时把建议类型幂等播种进该项目：以项目现有类型（未设置则默认种子）为基底追加缺失项。
 * 项目不存在返回 null。无建议类型时不写入（保持未设置以继续回落默认）。
 */
export function seedProjectCardTypes(
  data: RegistryData,
  projectId: string,
  suggested: CardTypeDef[] | undefined,
  now: string
): Project | null {
  const project = findProjectById(data, projectId)
  if (!project) return null
  if (!Array.isArray(suggested) || suggested.length === 0) return project
  project.cardTypes = seedCardTypes(projectCardTypes(project.cardTypes), suggested)
  project.updatedAt = now
  return project
}

/**
 * gitless 成员在查到 git 后补绑：把分组里该成员的标识由路径升级为 UUID，记录 git 信息。
 * 找不到该路径成员返回 null。
 */
export function upgradeGitlessMember(
  data: RegistryData,
  pathId: string,
  upgrade: { projectId: string; git: GitInfo; rootPath: string; now: string }
): RepoMember | null {
  const hit = findMember(data, (m) => m.idKind === 'path' && m.id === pathId)
  if (!hit) return null
  hit.member.id = upgrade.projectId
  hit.member.idKind = 'uuid'
  hit.member.git = upgrade.git
  hit.member.gitless = false
  hit.member.rootPath = upgrade.rootPath
  hit.member.missing = false
  addWorktreePath(hit.member, upgrade.rootPath)
  hit.project.updatedAt = upgrade.now
  return hit.member
}
