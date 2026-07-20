/** 文件树/扫描共用的默认忽略重目录（性能 + 噪声）。shared 放置供 main 与纯函数两侧使用。 */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'out', 'dist', 'coverage'])
