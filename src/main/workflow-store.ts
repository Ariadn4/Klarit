/**
 * 工作流「包目录」的文件存储层：每个工作流 = `<baseDir>/<id>/`，含 `workflow.yaml` 与包内 skill 文件。
 * 包是存储/克隆/删除/导入/导出的整体单位（见 workflow-definition spec）。校验复用 shared/workflow。
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import YAML from 'yaml'
import type { WorkflowDefinition, WorkflowSummary, WorkflowValidation } from '../shared/types'
import {
  createDefaultWorkflow,
  migrateWorkflowShape,
  validateWorkflow,
  workflowSummary
} from '../shared/workflow'

const DEF_FILE = 'workflow.yaml'
const SKILLS_DIR = 'skills'

/** 把工作流定义序列化为 YAML 文本。 */
export function serializeWorkflow(def: WorkflowDefinition): string {
  return YAML.stringify(def)
}

/** 解析 workflow.yaml 文本为定义；非对象或语法错误时抛出（调用方捕获以跳过损坏包）。 */
export function parseWorkflow(text: string): WorkflowDefinition {
  const parsed = YAML.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('workflow.yaml 不是对象')
  }
  // 反序列化处归一旧形状（产出/检查项字段重构、agent 无 exec 等），读旧包不崩。
  return migrateWorkflowShape(parsed)
}

export interface WorkflowStore {
  /** 列出库内全部合法工作流（跳过损坏包），轻量摘要。 */
  list: () => WorkflowSummary[]
  /** 读取某工作流完整定义；不存在/损坏/非法返回 null。 */
  get: (id: string) => WorkflowDefinition | null
  /** 校验后写回包；非法返回原因、不写盘。 */
  save: (def: WorkflowDefinition) => WorkflowValidation
  /** 新建：以注入 id 建包 + 默认模板，返回定义。 */
  create: (id: string) => WorkflowDefinition
  /** 克隆：复制整包（含 skill 文件），新 id、名称带后缀；源不存在返回 null。 */
  clone: (srcId: string, newId: string) => WorkflowDefinition | null
  /** 删除整个包目录。 */
  remove: (id: string) => void
  /** 库为空时用注入 id 种入默认工作流。 */
  seedIfEmpty: (id: string) => void
  /** 在包内写一份 skill 文件，返回相对包路径（`skills/<name>`）。 */
  writeSkillFile: (workflowId: string, fileName: string, content: string) => string
  /** 把外部文件拷入包内 skill 目录，返回相对包路径。 */
  importSkillFile: (workflowId: string, srcAbsPath: string) => string
  /** 读取包内 skill 文件内容（按相对包路径）；不存在/越界返回 null。 */
  readSkillFile: (workflowId: string, relPath: string) => string | null
  /** 导出整个包目录到 destDir。 */
  exportPackage: (id: string, destDir: string) => void
  /** 从外部包目录整包导入并分配新 id；损坏包抛错。 */
  importPackage: (srcDir: string, newId: string) => WorkflowDefinition
  /** 某工作流包目录的绝对路径。 */
  packageDir: (id: string) => string
}

export function createWorkflowStore(baseDir: string): WorkflowStore {
  const pkgDir = (id: string): string => join(baseDir, id)
  const defPath = (id: string): string => join(pkgDir(id), DEF_FILE)

  function readDef(file: string): WorkflowDefinition | null {
    try {
      if (!existsSync(file)) return null
      const def = parseWorkflow(readFileSync(file, 'utf8'))
      return validateWorkflow(def).ok ? def : null
    } catch {
      return null
    }
  }

  function writeDef(def: WorkflowDefinition): void {
    mkdirSync(pkgDir(def.id), { recursive: true })
    writeFileSync(defPath(def.id), serializeWorkflow(def), 'utf8')
  }

  const store: WorkflowStore = {
    packageDir: pkgDir,

    list() {
      if (!existsSync(baseDir)) return []
      const out: WorkflowSummary[] = []
      for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const def = readDef(join(baseDir, entry.name, DEF_FILE))
        if (def) out.push(workflowSummary(def))
      }
      return out
    },

    get(id) {
      return readDef(defPath(id))
    },

    save(def) {
      const v = validateWorkflow(def)
      if (!v.ok) return v
      writeDef(def)
      return { ok: true }
    },

    create(id) {
      const def = createDefaultWorkflow(id)
      writeDef(def)
      return def
    },

    clone(srcId, newId) {
      const src = store.get(srcId)
      if (!src) return null
      // 复制整包（含 skill 文件），再用新 id / 名称覆写 workflow.yaml。
      cpSync(pkgDir(srcId), pkgDir(newId), { recursive: true })
      // 克隆名逐语言加「副本」后缀（多语言名保持各语言）。
      const clonedName = Object.fromEntries(Object.entries(src.name).map(([k, v]) => [k, `${v} 副本`]))
      const cloned: WorkflowDefinition = { ...src, id: newId, name: clonedName }
      writeDef(cloned)
      return cloned
    },

    remove(id) {
      rmSync(pkgDir(id), { recursive: true, force: true })
    },

    seedIfEmpty(id) {
      if (store.list().length === 0) store.create(id)
    },

    writeSkillFile(workflowId, fileName, content) {
      const dir = join(pkgDir(workflowId), SKILLS_DIR)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, fileName), content, 'utf8')
      return `${SKILLS_DIR}/${fileName}`
    },

    importSkillFile(workflowId, srcAbsPath) {
      const dir = join(pkgDir(workflowId), SKILLS_DIR)
      mkdirSync(dir, { recursive: true })
      const name = basename(srcAbsPath)
      cpSync(srcAbsPath, join(dir, name))
      return `${SKILLS_DIR}/${name}`
    },

    readSkillFile(workflowId, relPath) {
      // 防越界：拒绝绝对路径与 .. 段，只允许读包内文件。
      if (relPath.startsWith('/') || relPath.startsWith('\\') || /^[A-Za-z]:/.test(relPath)) return null
      if (relPath.split(/[\\/]+/).some((s) => s === '..')) return null
      const file = join(pkgDir(workflowId), relPath)
      try {
        return existsSync(file) ? readFileSync(file, 'utf8') : null
      } catch {
        return null
      }
    },

    exportPackage(id, destDir) {
      if (!existsSync(pkgDir(id))) return
      mkdirSync(destDir, { recursive: true })
      cpSync(pkgDir(id), destDir, { recursive: true })
    },

    importPackage(srcDir, newId) {
      // 先校验源包定义（损坏即抛错），再整包拷入并以新 id 覆写。
      const def = parseWorkflow(readFileSync(join(srcDir, DEF_FILE), 'utf8'))
      const v = validateWorkflow(def)
      if (!v.ok) throw new Error(v.reason)
      cpSync(srcDir, pkgDir(newId), { recursive: true })
      const imported: WorkflowDefinition = { ...def, id: newId }
      writeDef(imported)
      return imported
    }
  }
  return store
}
