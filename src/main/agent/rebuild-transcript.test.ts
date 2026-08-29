/**
 * 续接兜底「喂回历史」的转写：输入是**原始流记录**（agent stdout 逐行原样），输出是给 agent 读的文本。
 * 它与展示转写（`displayFromStreamLine`）**解耦、取舍相反**：展示丢工具结果、截工具目标；重建反过来——
 * 工具动作的完整目标与工具结果要点，正是 agent 判断「我做过什么、看到过什么」的依据。
 */
import { describe, it, expect } from 'vitest'
import { transcriptForRebuild } from './rebuild-transcript'

const LONG_PATH = 'src/main/engine/engine-with-a-really-long-file-name-that-blows-past-eighty-characters.ts'

function ndjson(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n'
}

const toolUse = (id: string, name: string, input: Record<string, unknown>): unknown => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input }] }
})
const toolResult = (id: string, content: unknown, isError = false): unknown => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] }
})
const say = (text: string): unknown => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })

describe('重建用转写 — 保真度（与展示转写取舍相反）', () => {
  it('保留工具动作的完整目标，不做展示那样的 80 字截断', () => {
    const out = transcriptForRebuild(ndjson(toolUse('t1', 'Edit', { file_path: LONG_PATH })))
    expect(out).toContain(LONG_PATH)
    expect(out).toContain('Edit')
  })

  it('保留工具结果要点 —— 展示转写整类丢弃的 tool_result 在这里必须有', () => {
    const out = transcriptForRebuild(
      ndjson(toolUse('t1', 'Read', { file_path: 'src/a.ts' }), toolResult('t1', '第 42 行：export function createEngine'))
    )
    expect(out).toContain('export function createEngine')
    expect(out).toContain('Read') // 结果挂回它属于哪次工具调用
  })

  it('工具结果的失败态可辨认（agent 得知道哪一步没成）', () => {
    const out = transcriptForRebuild(
      ndjson(toolUse('t1', 'Bash', { command: 'npm test' }), toolResult('t1', 'FAIL 3 tests', true))
    )
    expect(out).toContain('npm test')
    expect(out).toContain('FAIL 3 tests')
    expect(out).toMatch(/失败/)
  })

  it('结果内容为分块数组时同样取到文本要点', () => {
    const out = transcriptForRebuild(
      ndjson(toolUse('t1', 'Grep', { pattern: 'createEngine' }), toolResult('t1', [{ type: 'text', text: '命中 7 处' }]))
    )
    expect(out).toContain('命中 7 处')
  })

  it('助手文本与最终结论照旧带上；session 初始化这类系统噪音不进重建历史', () => {
    const out = transcriptForRebuild(
      ndjson(
        { type: 'system', subtype: 'init', session_id: 'sid-1', tools: ['Read'] },
        say('我先读一下引擎。'),
        { type: 'result', result: '改完了' }
      )
    )
    expect(out).toContain('我先读一下引擎。')
    expect(out).toContain('改完了')
    expect(out).not.toContain('sid-1')
  })

  it('非 JSON 行（非结构化外壳的普通 stdout）原样保留，不被丢掉', () => {
    expect(transcriptForRebuild('普通一行输出\n还有一行\n')).toContain('普通一行输出')
  })

  it('空记录 → 空串（调用方据此不拼历史段）', () => {
    expect(transcriptForRebuild('')).toBe('')
    expect(transcriptForRebuild('\n\n')).toBe('')
  })
})

describe('重建用转写 — 超预算按事件边界截断', () => {
  /** 一段「大量闲聊 + 少量关键工具动作与结果」的记录：预算不够时该保住后者。 */
  const raw = ndjson(
    say('闲聊'.repeat(400)),
    toolUse('t1', 'Edit', { file_path: LONG_PATH }),
    toolResult('t1', '写入成功'),
    say('再闲聊'.repeat(400)),
    toolUse('t2', 'Bash', { command: 'npm run typecheck' }),
    toolResult('t2', '0 errors'),
    say('还是闲聊'.repeat(400)),
    { type: 'result', result: '干完了' }
  )

  it('优先保留工具动作与其结果，先丢的是助手闲聊', () => {
    const out = transcriptForRebuild(raw, { budget: 1200 })
    expect(out.length).toBeLessThanOrEqual(1400) // 预算内（截断标记另计）
    expect(out).toContain(LONG_PATH)
    expect(out).toContain('写入成功')
    expect(out).toContain('npm run typecheck')
    expect(out).toContain('0 errors')
    expect(out).toContain('干完了')
    expect(out).not.toContain('闲聊'.repeat(400))
  })

  it('截断按事件边界进行，不按字符数截尾 —— 留下的每条都是完整事件', () => {
    const out = transcriptForRebuild(raw, { budget: 1200 })
    const lines = out.split('\n').filter((l) => l.trim() && !l.startsWith('…'))
    // 无半截 JSON、无被腰斩的路径
    expect(out).not.toContain('{"type"')
    for (const l of lines) {
      if (l.includes(LONG_PATH.slice(0, 20))) expect(l).toContain(LONG_PATH)
    }
  })

  it('确实丢过事件时给出可辨认的省略标记（不假装历史完整）', () => {
    expect(transcriptForRebuild(raw, { budget: 1200 })).toMatch(/已省略较早的 \d+ 条记录/)
    expect(transcriptForRebuild(raw)).not.toMatch(/已省略较早的/) // 缺省预算装得下就不标
  })

  it('单条超长工具结果按要点收敛，不把整条记录挤爆', () => {
    const out = transcriptForRebuild(
      ndjson(toolUse('t1', 'Read', { file_path: 'src/big.ts' }), toolResult('t1', 'x'.repeat(50000)))
    )
    expect(out.length).toBeLessThan(5000)
    expect(out).toContain('src/big.ts')
    expect(out).toContain('xxx')
  })
})
