/**
 * 全局「覆盖」分解 skill 的文件存储：存于 `<baseDir>/decompose-default.md`（baseDir = userData/skills），不入 git。
 * 这是**可选的高级覆盖**——存在时优先于「由类型注册表自动生成的分解 skill」（见 decompose-service 解析顺序）；
 * 不存在时返回 null，由自动生成 skill 兜底。支持手写/导入（拷入受管目录），导入约束与工作流节点 prompt 一致。
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 受管目录内的全局覆盖分解 skill 文件名。 */
export const DECOMPOSE_SKILL_FILE = 'decompose-default.md'

export interface GlobalSkillStore {
  /** 读全局覆盖分解 skill 内容；未设置（文件不存在）返回 null（由自动生成 skill 兜底，不再种入内置文本）。 */
  readOverride: () => string | null
  /** 手写设置全局覆盖分解 skill。 */
  writeOverride: (content: string) => void
  /** 把外部文件内容拷入受管的全局覆盖分解 skill 文件。 */
  importOverride: (srcAbsPath: string) => void
  /** 按受管目录内相对路径读取内容；越界（绝对/含 ..）或缺失返回 null（供查看）。 */
  read: (relPath: string) => string | null
}

export function createGlobalSkillStore(baseDir: string): GlobalSkillStore {
  const overridePath = join(baseDir, DECOMPOSE_SKILL_FILE)
  const ensureDir = (): void => {
    mkdirSync(baseDir, { recursive: true })
  }

  const store: GlobalSkillStore = {
    readOverride() {
      try {
        return existsSync(overridePath) ? readFileSync(overridePath, 'utf8') : null
      } catch {
        return null
      }
    },

    writeOverride(content) {
      ensureDir()
      writeFileSync(overridePath, content, 'utf8')
    },

    importOverride(srcAbsPath) {
      ensureDir()
      copyFileSync(srcAbsPath, overridePath)
    },

    read(relPath) {
      // 防越界：拒绝绝对路径与 .. 段，只允许读受管目录内文件。
      if (relPath.startsWith('/') || relPath.startsWith('\\') || /^[A-Za-z]:/.test(relPath)) return null
      if (relPath.split(/[\\/]+/).some((s) => s === '..')) return null
      const file = join(baseDir, relPath)
      try {
        return existsSync(file) ? readFileSync(file, 'utf8') : null
      } catch {
        return null
      }
    }
  }
  return store
}
