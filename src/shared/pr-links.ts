/**
 * 从自由文本里捞 PR/MR 链接的兜底——LLM agent 不一定乖乖用结构化 `prs` 字段,常把链接塞进握手 `note`/`detail` 散文里。
 * 只认「像 PR/MR 的 URL」(GitHub `/pull/<n>`、GitLab `/merge_requests/<n>`、Bitbucket/Gitea `/pull-requests|pulls/<n>`),
 * 避免抓到无关 URL。纯函数、可测,main 与 renderer 共享。
 */
const PR_URL_RE = /https?:\/\/[^\s)<>"']+?\/(?:pull|pulls|merge_requests|pull-requests|-\/merge_requests)\/\d+/gi

/** 从一段文本里提取去重后的 PR/MR 链接(无则空数组)。 */
export function scrapePrUrls(text?: string | null): string[] {
  if (typeof text !== 'string' || text.trim() === '') return []
  return [...new Set(text.match(PR_URL_RE) ?? [])]
}

/**
 * 归一 open-pr 的 PR 链接:优先用结构化 `prs`(过滤空 url);再从散文(note/detail)里兜底捞、按 url 去重补入。
 * 返回 `[{ repo?, url }]`,供引擎持久化与外部门决策呈现。
 */
export function collectPrLinks(
  prs: Array<{ repo?: string; url?: string }> | undefined,
  ...proseTexts: Array<string | null | undefined>
): Array<{ repo?: string; url: string }> {
  const out: Array<{ repo?: string; url: string }> = []
  const seen = new Set<string>()
  for (const p of prs ?? []) {
    const url = typeof p?.url === 'string' ? p.url.trim() : ''
    if (url && !seen.has(url)) {
      seen.add(url)
      out.push({ ...(p.repo ? { repo: p.repo } : {}), url })
    }
  }
  for (const text of proseTexts) {
    for (const url of scrapePrUrls(text)) {
      if (!seen.has(url)) {
        seen.add(url)
        out.push({ url })
      }
    }
  }
  return out
}
