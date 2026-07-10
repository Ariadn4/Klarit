import { useEffect, useState, useCallback } from 'react'
import { ChevronRight } from 'lucide-react'
import type { FileNode } from '@shared/types'
import { useFileViewerStore } from '../stores/fileViewer'

interface FileTreeProps {
  rootPath: string
  /** 列目录的注入点（默认走 window.klarit.listDir，测试可替换）。 */
  listDir?: (dirPath: string) => Promise<FileNode[]>
  /** 变化时重新拉取根目录（文件树随磁盘变更刷新）。 */
  refreshKey?: number
  /** 点击文件项的回调（默认在文件查看器中打开，测试可替换）。 */
  onOpenFile?: (path: string) => void
}

function useListDir(injected?: FileTreeProps['listDir']): (p: string) => Promise<FileNode[]> {
  return useCallback(
    (p: string) => (injected ? injected(p) : window.klarit.listDir(p)),
    [injected]
  )
}

export function FileTree({
  rootPath,
  listDir,
  refreshKey = 0,
  onOpenFile
}: FileTreeProps): React.JSX.Element {
  const ls = useListDir(listDir)
  const [nodes, setNodes] = useState<FileNode[]>([])
  // 默认点击文件 → 在文件查看器中打开；测试可注入替身。
  const openFile = useCallback(
    (path: string) => (onOpenFile ? onOpenFile(path) : useFileViewerStore.getState().open(path)),
    [onOpenFile]
  )

  useEffect(() => {
    let alive = true
    ls(rootPath).then((n) => {
      if (alive) setNodes(n)
    })
    return () => {
      alive = false
    }
  }, [rootPath, refreshKey, ls])

  return (
    <ul role="tree" className="px-1 pb-1 text-[13px]">
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} ls={ls} onOpenFile={openFile} />
      ))}
    </ul>
  )
}

interface TreeNodeProps {
  node: FileNode
  depth: number
  ls: (p: string) => Promise<FileNode[]>
  onOpenFile: (path: string) => void
}

function TreeNode({ node, depth, ls, onOpenFile }: TreeNodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileNode[] | null>(null)

  // 文件夹：展开/折叠（懒加载子项）；文件：在查看器中打开。
  const onClick = async (): Promise<void> => {
    if (node.kind !== 'directory') {
      onOpenFile(node.path)
      return
    }
    const next = !expanded
    setExpanded(next)
    if (next && children === null) setChildren(await ls(node.path))
  }

  return (
    <li role="treeitem" aria-expanded={node.kind === 'directory' ? expanded : undefined}>
      <button
        type="button"
        onClick={onClick}
        style={{ paddingLeft: depth * 12 + 4 }}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-stone-100 ${
          node.kind === 'directory' ? 'text-ink' : 'text-stone-600'
        }`}
      >
        {node.kind === 'directory' ? (
          <ChevronRight
            size={13}
            className={`shrink-0 text-stone-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && children && children.length > 0 && (
        <ul role="group">
          {children.map((c) => (
            <TreeNode key={c.path} node={c} depth={depth + 1} ls={ls} onOpenFile={onOpenFile} />
          ))}
        </ul>
      )}
    </li>
  )
}
