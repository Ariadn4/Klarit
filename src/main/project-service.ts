import { basename, resolve } from 'node:path'
import type {
  GitInfo,
  GitProbeResult,
  ImportOutcome,
  NestedRepoCandidate,
  Project,
  RegistryData,
  RepoMember
} from '../shared/types'
import {
  createProject,
  findProjectById,
  findProjectByMemberId,
  linkMember,
  relocateMember,
  resolveUuidForCommonDir,
  upgradeGitlessMember,
  upsertImport,
  memberFromImport
} from './registry-core'

/** 注入依赖，便于测试（真实实现见 git.ts / identity.ts / filetree.ts）。 */
export interface ProjectServiceDeps {
  probe: (dir: string) => GitProbeResult
  readProjectId: (toplevel: string) => string | null
  ensureProjectId: (toplevel: string, preferred?: string) => string
  /** 扫描容器目录的直接子目录，返回其中是 git 仓的候选。 */
  scanNested: (containerDir: string) => NestedRepoCandidate[]
  /** 生成多仓项目的分组 id。 */
  newGroupId: () => string
  now: () => string
}

function normalizePath(p: string): string {
  return resolve(p)
}

function resolveIdentity(
  data: RegistryData,
  toplevel: string,
  probe: GitProbeResult,
  deps: ProjectServiceDeps
): { uuid: string; git: GitInfo } {
  let uuid = deps.readProjectId(toplevel)
  if (!uuid) {
    const adopt = probe.commonDir ? resolveUuidForCommonDir(data, probe.commonDir) : undefined
    uuid = deps.ensureProjectId(toplevel, adopt)
  }
  return {
    uuid,
    git: { branch: probe.branch, remote: probe.remote, commonDir: probe.commonDir as string }
  }
}

/** 探测一个目录并产出对应的成员仓（有 git 解析身份，无 git 走路径标识）。 */
function memberFromDir(data: RegistryData, dir: string, deps: ProjectServiceDeps): RepoMember {
  const norm = normalizePath(dir)
  const probe = deps.probe(norm)
  if (!probe.isGit) {
    return memberFromImport({
      rootPath: norm,
      derivedName: basename(norm),
      projectId: null,
      git: null,
      now: deps.now()
    })
  }
  const toplevel = normalizePath(probe.toplevel as string)
  const { uuid, git } = resolveIdentity(data, toplevel, probe, deps)
  return memberFromImport({
    rootPath: toplevel,
    derivedName: basename(toplevel),
    projectId: uuid,
    git,
    now: deps.now()
  })
}

/**
 * 导入目录：
 * - 目录自身是 git（或 gitless 单目录）→ 直接建/扩成员数为 1 的项目。
 * - 目录自身非 git 且其下含 ≥2 个子仓 → 直接组成多仓项目（无需确认）。
 */
export function importProject(
  data: RegistryData,
  dir: string,
  deps: ProjectServiceDeps
): ImportOutcome {
  const norm = normalizePath(dir)
  const probe = deps.probe(norm)

  if (!probe.isGit) {
    const candidates = deps.scanNested(norm)
    if (candidates.length >= 2) {
      return buildMultiRepoProject(data, norm, candidates.map((c) => c.rootPath), deps)
    }
    // 0 或 1 个子仓：按既有 gitless 单目录行为登记。
    const { project, reused } = upsertImport(data, {
      rootPath: norm,
      derivedName: basename(norm),
      projectId: null,
      git: null,
      now: deps.now()
    })
    return { project, reused }
  }

  const toplevel = normalizePath(probe.toplevel as string)
  const { uuid, git } = resolveIdentity(data, toplevel, probe, deps)
  const { project, reused } = upsertImport(data, {
    rootPath: toplevel,
    derivedName: basename(toplevel),
    projectId: uuid,
    git,
    now: deps.now()
  })
  return { project, reused }
}

/**
 * 把容器目录下的子仓直接组成一个多仓项目（导入时无需确认）。
 * 凭**成员身份**（`.klarit/project-id`）复用既有项目而非新建——这同时实现换机器/同步后凭身份复原分组：
 * 探测出的某成员若已属某既有项目，则复用该项目并刷新各成员路径；都不属于时才新建分组。
 */
function buildMultiRepoProject(
  data: RegistryData,
  containerPath: string,
  memberPaths: string[],
  deps: ProjectServiceDeps
): ImportOutcome {
  const container = normalizePath(containerPath)
  const members = memberPaths.map((p) => memberFromDir(data, p, deps))
  const existing = members.map((m) => findProjectByMemberId(data, m.id)).find((p) => p)
  if (existing) {
    let project = existing
    for (const m of members) project = linkMember(data, existing.id, m, deps.now()) ?? project
    return { project, reused: true }
  }
  const project = createProject(data, {
    groupId: deps.newGroupId(),
    displayName: basename(container),
    derivedName: basename(container),
    members,
    now: deps.now()
  })
  return { project, reused: false }
}

/** 把一个独立仓关联进项目。 */
export function linkMemberByDir(
  data: RegistryData,
  projectId: string,
  dir: string,
  deps: ProjectServiceDeps
): Project | null {
  const member = memberFromDir(data, dir, deps)
  return linkMember(data, projectId, member, deps.now())
}

/** 为缺失成员重新定位：探测新目录、更新路径与（若有）git 信息。 */
export function relocateMemberToDir(
  data: RegistryData,
  projectId: string,
  memberId: string,
  dir: string,
  deps: ProjectServiceDeps
): Project | null {
  const project = relocateMember(data, projectId, memberId, normalizePath(dir), deps.now())
  if (!project) return null
  // 重新探测一遍 git，顺手把新位置的 git 信息更新到该成员。
  const member = project.members.find((m) => m.id === memberId)
  if (member) {
    const probe = deps.probe(member.rootPath)
    if (probe.isGit) {
      member.git = {
        branch: probe.branch,
        remote: probe.remote,
        commonDir: probe.commonDir as string
      }
      member.gitless = false
    }
  }
  return project
}

/**
 * 打开/刷新某 gitless 成员时调用：若其目录已变为 git 仓库，立即补绑并返回升级后的成员；
 * 否则返回 null（无变化）。
 */
export function rebindMemberIfGitAppeared(
  data: RegistryData,
  member: RepoMember,
  deps: ProjectServiceDeps
): RepoMember | null {
  if (!member.gitless) return null
  const probe = deps.probe(member.rootPath)
  if (!probe.isGit) return null
  const toplevel = normalizePath(probe.toplevel as string)
  const { uuid, git } = resolveIdentity(data, toplevel, probe, deps)
  return upgradeGitlessMember(data, member.id, {
    projectId: uuid,
    git,
    rootPath: toplevel,
    now: deps.now()
  })
}

/** 供 WindowManager 使用：找出项目对象。 */
export { findProjectById }
