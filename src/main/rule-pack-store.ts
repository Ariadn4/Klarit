/**
 * 规则包「包目录」的文件存储层：每个规则包 = `<baseDir>/<id>/`，含 `rule-pack.yaml`。
 * 包是存储/克隆/删除/导入/导出的整体单位，与工作流包并列、机制类比。校验复用 shared/rule-pack。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import { createDefaultRulePack, migrateRulePackShape, rulePackSummary, validateRulePack } from '../shared/rule-pack'
import type { RulePack, RulePackSummary, RulePackValidation } from '../shared/rule-pack'

const DEF_FILE = 'rule-pack.yaml'

/** 把规则包定义序列化为 YAML 文本。 */
export function serializeRulePack(pack: RulePack): string {
  return YAML.stringify(pack)
}

/** 解析 rule-pack.yaml 文本为定义；非对象或语法错误时抛出（调用方捕获以跳过损坏包）。 */
export function parseRulePack(text: string): RulePack {
  const parsed = YAML.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('rule-pack.yaml 不是对象')
  }
  // 归一旧形状（裸字符串可翻字段 → 语言表），读旧包不崩；对新形状幂等。
  return migrateRulePackShape(parsed)
}

export interface RulePackStore {
  /** 列出库内全部合法规则包（跳过损坏包），轻量摘要。 */
  list: () => RulePackSummary[]
  /** 读取全部合法规则包完整定义（编辑器/选择器/派生用）。 */
  all: () => RulePack[]
  /** 读取某规则包完整定义；不存在/损坏/非法返回 null。 */
  get: (id: string) => RulePack | null
  /** 校验后写回包；非法返回原因、不写盘。 */
  save: (pack: RulePack) => RulePackValidation
  /** 新建：以注入 id 建包 + 默认模板，返回定义。 */
  create: (id: string) => RulePack
  /** 克隆：复制整包，新 id、名称带后缀；源不存在返回 null。 */
  clone: (srcId: string, newId: string) => RulePack | null
  /** 删除整个包目录。 */
  remove: (id: string) => void
  /** 库为空时用注入 id 种入默认规则包。 */
  seedIfEmpty: (id: string) => void
  /** 导出整个包目录到 destDir。 */
  exportPackage: (id: string, destDir: string) => void
  /** 从外部包目录整包导入并分配新 id；损坏/非法包抛错。 */
  importPackage: (srcDir: string, newId: string) => RulePack
  /** 某规则包包目录的绝对路径。 */
  packageDir: (id: string) => string
}

export function createRulePackStore(baseDir: string): RulePackStore {
  const pkgDir = (id: string): string => join(baseDir, id)
  const defPath = (id: string): string => join(pkgDir(id), DEF_FILE)

  function readDef(file: string): RulePack | null {
    try {
      if (!existsSync(file)) return null
      const def = parseRulePack(readFileSync(file, 'utf8'))
      return validateRulePack(def).ok ? def : null
    } catch {
      return null
    }
  }

  function writeDef(pack: RulePack): void {
    mkdirSync(pkgDir(pack.id), { recursive: true })
    writeFileSync(defPath(pack.id), serializeRulePack(pack), 'utf8')
  }

  const store: RulePackStore = {
    packageDir: pkgDir,

    all() {
      if (!existsSync(baseDir)) return []
      const out: RulePack[] = []
      for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const def = readDef(join(baseDir, entry.name, DEF_FILE))
        if (def) out.push(def)
      }
      return out
    },

    list() {
      return store.all().map(rulePackSummary)
    },

    get(id) {
      return readDef(defPath(id))
    },

    save(pack) {
      const v = validateRulePack(pack)
      if (!v.ok) return v
      writeDef(pack)
      return { ok: true }
    },

    create(id) {
      const def = createDefaultRulePack(id)
      writeDef(def)
      return def
    },

    clone(srcId, newId) {
      const src = store.get(srcId)
      if (!src) return null
      cpSync(pkgDir(srcId), pkgDir(newId), { recursive: true })
      // 克隆名逐语言加「副本」后缀（多语言包名保持各语言）。
      const clonedName = Object.fromEntries(Object.entries(src.name).map(([k, v]) => [k, `${v} 副本`]))
      const cloned: RulePack = { ...src, id: newId, name: clonedName }
      writeDef(cloned)
      return cloned
    },

    remove(id) {
      rmSync(pkgDir(id), { recursive: true, force: true })
    },

    seedIfEmpty(id) {
      if (store.list().length === 0) store.create(id)
    },

    exportPackage(id, destDir) {
      if (!existsSync(pkgDir(id))) return
      mkdirSync(destDir, { recursive: true })
      cpSync(pkgDir(id), destDir, { recursive: true })
    },

    importPackage(srcDir, newId) {
      const def = parseRulePack(readFileSync(join(srcDir, DEF_FILE), 'utf8'))
      const v = validateRulePack(def)
      if (!v.ok) throw new Error(v.reason)
      cpSync(srcDir, pkgDir(newId), { recursive: true })
      const imported: RulePack = { ...def, id: newId }
      writeDef(imported)
      return imported
    }
  }
  return store
}
