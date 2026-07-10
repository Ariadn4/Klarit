/**
 * 目录链接（junction）的链接与**防御性解链**。用于「关联环境」——把成员仓 node_modules /
 * 兄弟成员仓链进 worktree,让分支上能完整跑验收。删 worktree 前必须先解掉其中所有 reparse point,
 * 否则递归删目录会顺着 junction 走进真实目标(如 node_modules)误删——本模块的解链**绝不递归进 reparse point**。
 */

import { lstat, readlink, symlink, unlink, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

/**
 * 在 linkPath 建一个指向 target 的目录链接。Windows 用目录 junction(不需管理员);
 * 其它平台 'junction' 被忽略、退化为符号链接。target 必须是已存在的目录。
 */
export async function linkJunction(target: string, linkPath: string): Promise<void> {
  await symlink(target, linkPath, 'junction')
}

/** 若 linkPath 是 reparse point(junction/符号链接)则返回其指向,否则返回 null(不抛)。 */
export async function readJunction(linkPath: string): Promise<string | null> {
  try {
    const st = await lstat(linkPath)
    if (!st.isSymbolicLink()) return null
    return await readlink(linkPath)
  } catch {
    return null
  }
}

/**
 * 浅扫 root 树,解掉其中每一个 reparse point(junction/符号链接)**本身**,返回被解掉的路径列表。
 * **绝不递归进任何 reparse point 内部**——这是安全不变量:保证永不顺着 junction 走进其目标而误删目标内容。
 * 不依赖「我们登记过链接什么」:即便链接是越过软件私自建立的,也照样被扫到解掉。
 */
export async function unlinkReparsePoints(root: string): Promise<string[]> {
  const unlinked: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[]
    try {
      // withFileTypes 用 lstat 语义:对链接条目返回 isSymbolicLink()=true,不跟随。
      entries = (await readdir(dir, { withFileTypes: true })) as Dirent[]
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        // 解链接本身;绝不进入其内部。
        try {
          await unlink(full)
          unlinked.push(full)
        } catch {
          /* 留给上层 remove 失败时抛决策 */
        }
      } else if (entry.isDirectory()) {
        await walk(full)
      }
    }
  }
  await walk(root)
  return unlinked
}
