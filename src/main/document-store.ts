/**
 * 文档登记表持久化（document-store）：per-成员仓一份 JSON（userData 下 baseDir/<编码后 memberId>.json，
 * 不入 git），比照 card-store 的文件后端。读写两侧都过 normalizeRegistry——损坏/外来数据不出闸。
 * memberId 可能是路径型（gitless 成员退化主键），经 encodeURIComponent 编码成安全文件名、不逃逸 baseDir。
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DocRegistry } from '../shared/types'
import { emptyRegistry, normalizeRegistry } from '../shared/document-registry'

export interface DocumentStore {
  /** 读某成员仓的登记表；无表/损坏返回空壳。 */
  get(memberId: string): DocRegistry
  /** 该成员仓是否已建立登记表（落盘文件存在）；供归档区分「从未建表→挂起」与「空表→noop」。 */
  has(memberId: string): boolean
  /** 规整后落盘（整表覆写）。 */
  save(registry: DocRegistry): void
  /** 删除某成员仓的登记表（项目移除时连带清理；重导入即白纸重扫）。无表 no-op。 */
  remove(memberId: string): void
}

export function createDocumentStore(baseDir: string): DocumentStore {
  const file = (memberId: string): string => join(baseDir, `${encodeURIComponent(memberId)}.json`)
  return {
    get(memberId) {
      try {
        const f = file(memberId)
        if (!existsSync(f)) return emptyRegistry(memberId)
        return normalizeRegistry(JSON.parse(readFileSync(f, 'utf8')), memberId)
      } catch {
        return emptyRegistry(memberId)
      }
    },
    has(memberId) {
      return existsSync(file(memberId))
    },
    save(registry) {
      mkdirSync(baseDir, { recursive: true })
      const normalized = normalizeRegistry(registry, registry.memberId)
      writeFileSync(file(registry.memberId), JSON.stringify(normalized, null, 2), 'utf8')
    },
    remove(memberId) {
      rmSync(file(memberId), { force: true })
    }
  }
}
