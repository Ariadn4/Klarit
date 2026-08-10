import { describe, it, expect } from 'vitest'
import { headlessInvocation, buildDecomposeMessage, parseCandidateCards } from './agent-runner'

describe('headlessInvocation', () => {
  it('claude-code：-p（带/不带 model）', () => {
    expect(headlessInvocation('claude-code')).toEqual({ agentId: 'claude-code', args: ['-p'] })
    expect(headlessInvocation('claude-code', 'opus')).toEqual({
      agentId: 'claude-code',
      args: ['-p', '--model', 'opus']
    })
  })

  it('调用式只带外壳 id 与 argv，不含命令名（起哪个可执行文件由探测出的绝对路径决定）', () => {
    for (const id of ['claude-code', 'codex', 'cursor'] as const) {
      const inv = headlessInvocation(id)
      expect(inv.agentId).toBe(id)
      expect(inv).not.toHaveProperty('command')
    }
    expect(headlessInvocation('codex').args).toContain('exec')
    expect(headlessInvocation('cursor').args).toContain('-p')
  })
})

describe('buildDecomposeMessage', () => {
  it('含 skill、用户描述与「只输出 JSON」收尾', () => {
    const msg = buildDecomposeMessage('SKILL', '一大段想法')
    expect(msg).toContain('SKILL')
    expect(msg).toContain('一大段想法')
    expect(msg).toContain('JSON')
  })
})

describe('parseCandidateCards', () => {
  it('解析裸 JSON 数组（typeId 透传）', () => {
    const out = '[{"proposedName":"add-dark-mode","title":"暗色","description":"d","typeId":"feature","relations":[]}]'
    expect(parseCandidateCards(out)).toEqual([
      { proposedName: 'add-dark-mode', title: '暗色', description: 'd', typeId: 'feature', relations: [] }
    ])
  })

  it('容忍 ```json 围栏与前后噪声文字', () => {
    const out = '这是候选：\n```json\n[{"title":"修登录","typeId":"bug"}]\n```\n完成。'
    const cards = parseCandidateCards(out)
    expect(cards).toHaveLength(1)
    expect(cards[0].title).toBe('修登录')
    expect(cards[0].typeId).toBe('bug')
  })

  it('兼容旧 category 字段；未知 typeId 原样透传（不静默回落）；关系容错', () => {
    const out = '[{"title":"增加暗色模式 (Dark Mode)","category":"spike","relations":[{"kind":"x","target":"y"},{"kind":"parent","target":"epic-1"}]}]'
    const [c] = parseCandidateCards(out)
    expect(c.proposedName).toBe('dark-mode')
    expect(c.typeId).toBe('spike')
    expect(c.relations).toEqual([{ kind: 'parent', target: 'epic-1' }])
  })

  it('缺 typeId → 空串（留待注册表校验判不在册）', () => {
    const [c] = parseCandidateCards('[{"title":"无类型卡"}]')
    expect(c.typeId).toBe('')
  })

  it('无标题条目丢弃；非数组/解析失败返回空', () => {
    expect(parseCandidateCards('[{"title":""},{"title":"ok"}]')).toHaveLength(1)
    expect(parseCandidateCards('not json')).toEqual([])
    expect(parseCandidateCards('')).toEqual([])
  })
})
