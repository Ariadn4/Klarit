import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ID_DIR = '.klarit'
const ID_FILE = 'project-id'

/** 项目身份文件相对仓库根的路径。 */
export function projectIdPath(toplevel: string): string {
  return join(toplevel, ID_DIR, ID_FILE)
}

/** 读取 .klarit/project-id；不存在或为空返回 null。 */
export function readProjectId(toplevel: string): string | null {
  const p = projectIdPath(toplevel)
  if (!existsSync(p)) return null
  const v = readFileSync(p, 'utf8').trim()
  return v.length > 0 ? v : null
}

/** 写入 .klarit/project-id（覆盖）。 */
export function writeProjectId(toplevel: string, id: string): void {
  mkdirSync(join(toplevel, ID_DIR), { recursive: true })
  writeFileSync(projectIdPath(toplevel), id + '\n', 'utf8')
}

/**
 * 确保仓库根有持久身份：已存在则原样返回；否则用 preferred（多 worktree 复用既有 id 时传入）
 * 或新生成的 UUID 写入并返回。
 */
export function ensureProjectId(toplevel: string, preferred?: string): string {
  const existing = readProjectId(toplevel)
  if (existing) return existing
  const id = preferred ?? randomUUID()
  writeProjectId(toplevel, id)
  return id
}
