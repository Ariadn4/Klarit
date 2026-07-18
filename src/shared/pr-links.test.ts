import { describe, it, expect } from 'vitest'
import { scrapePrUrls, collectPrLinks } from './pr-links'

describe('scrapePrUrls', () => {
  it('从散文里捞 GitHub PR 链接', () => {
    const note = 'app 仓已开 PR #1（try-real-pr-2 → main）：https://github.com/Ariadn4/klarit-dogfood-app/pull/1'
    expect(scrapePrUrls(note)).toEqual(['https://github.com/Ariadn4/klarit-dogfood-app/pull/1'])
  })

  it('认 GitLab MR 与 Gitea/Bitbucket 形态', () => {
    expect(scrapePrUrls('见 https://gitlab.com/g/p/-/merge_requests/42 谢谢')).toEqual([
      'https://gitlab.com/g/p/-/merge_requests/42'
    ])
    expect(scrapePrUrls('https://gitea.example.com/o/r/pulls/7')).toEqual(['https://gitea.example.com/o/r/pulls/7'])
  })

  it('去重、忽略无关 URL 与空文本', () => {
    const t = 'https://github.com/a/b/pull/3 又 https://github.com/a/b/pull/3 还有主页 https://github.com/a/b'
    expect(scrapePrUrls(t)).toEqual(['https://github.com/a/b/pull/3'])
    expect(scrapePrUrls('')).toEqual([])
    expect(scrapePrUrls(null)).toEqual([])
  })
})

describe('collectPrLinks', () => {
  it('优先结构化 prs、保留 repo', () => {
    expect(collectPrLinks([{ repo: 'app', url: 'https://github.com/o/app/pull/1' }])).toEqual([
      { repo: 'app', url: 'https://github.com/o/app/pull/1' }
    ])
  })

  it('prs 空时从 note 兜底捞', () => {
    expect(collectPrLinks(undefined, '开好了：https://github.com/o/app/pull/9')).toEqual([
      { url: 'https://github.com/o/app/pull/9' }
    ])
  })

  it('prs + note 合并去重（同 url 不重复）', () => {
    const prs = [{ repo: 'app', url: 'https://github.com/o/app/pull/1' }]
    const note = '链接 https://github.com/o/app/pull/1 和 https://github.com/o/api/pull/2'
    expect(collectPrLinks(prs, note)).toEqual([
      { repo: 'app', url: 'https://github.com/o/app/pull/1' },
      { url: 'https://github.com/o/api/pull/2' }
    ])
  })

  it('过滤空 url', () => {
    expect(collectPrLinks([{ url: '' }, { repo: 'x', url: '  ' }])).toEqual([])
  })
})
