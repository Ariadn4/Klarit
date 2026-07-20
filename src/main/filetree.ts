import { readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import type { FileNode, FileTreeChange } from '../shared/types'
import { IGNORED_DIRS } from '../shared/ignored-dirs'

export { IGNORED_DIRS }

/** 列出目录直接子项（懒加载：目录子项按需再取）。目录在前、按名排序。 */
export function listDir(dirPath: string): FileNode[] {
  const entries = readdirSync(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const e of entries) {
    if (e.isDirectory() && IGNORED_DIRS.has(e.name)) continue
    nodes.push({
      name: e.name,
      path: join(dirPath, e.name),
      kind: e.isDirectory() ? 'directory' : 'file'
    })
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return nodes
}

/**
 * 监听项目目录，把增删事件以增量推给 onChange（带 memberId 供渲染层定位）。忽略 IGNORED_DIRS。
 *
 * **浅监听（只看根级直接子项）**：文件树是懒加载的——`FileTree` 仅在变更时重新拉取**根级**列表，
 * 展开的子文件夹各自缓存、不随 refreshKey 刷新。因此深度递归监听（depth 99）只会对大目录/慢盘
 * （如多仓容器、外部恢复盘）做一次昂贵的全树扫描、阻塞主进程事件循环却毫无 UI 收益。
 * 用 depth 0 只监听根级直接子项，开销恒定、不下钻进各子仓与其重目录。
 *
 * 返回 FSWatcher，调用方负责 close。
 */
export function watchProject(
  root: string,
  memberId: string,
  onChange: (change: FileTreeChange) => void
): FSWatcher {
  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    ignored: (p: string) => {
      const name = basename(p)
      return IGNORED_DIRS.has(name)
    },
    depth: 0
  })
  const emit = (type: FileTreeChange['type']) => (path: string) => {
    onChange({ type, path, parentDir: dirname(path), memberId })
  }
  watcher
    .on('add', emit('add'))
    .on('addDir', emit('addDir'))
    .on('unlink', emit('unlink'))
    .on('unlinkDir', emit('unlinkDir'))
  return watcher
}
