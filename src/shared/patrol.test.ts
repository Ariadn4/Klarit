import { describe, it, expect } from 'vitest'
import {
  coercePatrols,
  describeTrigger,
  findingsToCandidates,
  isDue,
  type Patrol,
  type PatrolTrigger
} from './patrol'

/** 本地时刻构造（isDue 按本地时区解释 HH:mm，测试同用本地构造，跨时区稳定）。 */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

const HOUR = 3600_000

describe('isDue —— 每 n 小时', () => {
  it('距上次已满 n 小时 → 到期', () => {
    const now = at(2026, 8, 10, 12, 0)
    expect(isDue({ trigger: { kind: 'everyHours', hours: 6 }, lastRunAt: now - 6 * HOUR, now })).toBe(true)
  })

  it('距上次只过了 2 小时 → 未到期', () => {
    const now = at(2026, 8, 10, 12, 0)
    expect(isDue({ trigger: { kind: 'everyHours', hours: 6 }, lastRunAt: now - 2 * HOUR, now })).toBe(false)
  })

  it('n 非法（0 / 负 / 非数）→ 恒不到期（脏配置不乱发）', () => {
    const now = at(2026, 8, 10, 12, 0)
    for (const hours of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isDue({ trigger: { kind: 'everyHours', hours }, lastRunAt: now - 99 * HOUR, now })).toBe(false)
    }
  })
})

describe('isDue —— 每天某时刻', () => {
  const trigger: PatrolTrigger = { kind: 'daily', time: '03:00' }

  it('lastRunAt 是昨天、现在已过今天 03:00 → 到期', () => {
    expect(isDue({ trigger, lastRunAt: at(2026, 8, 9, 3, 0), now: at(2026, 8, 10, 3, 5) })).toBe(true)
  })

  it('现在还没到今天 03:00（上次就是昨天那一档）→ 未到期', () => {
    expect(isDue({ trigger, lastRunAt: at(2026, 8, 9, 3, 0), now: at(2026, 8, 10, 2, 0) })).toBe(false)
  })

  it('今天这一档已跑过 → 未到期', () => {
    expect(isDue({ trigger, lastRunAt: at(2026, 8, 10, 3, 1), now: at(2026, 8, 10, 20, 0) })).toBe(false)
  })

  it('时刻串非法 → 恒不到期', () => {
    for (const time of ['', '25:00', '3:0', 'abc', '03:60']) {
      expect(isDue({ trigger: { kind: 'daily', time }, now: at(2026, 8, 10, 12, 0) })).toBe(false)
    }
  })
})

describe('isDue —— 每周某天某时刻', () => {
  // 2026-08-10 是周一。
  const trigger: PatrolTrigger = { kind: 'weekly', weekday: 1, time: '09:00' }

  it('本周一 09:00 已过、上次是上周 → 到期', () => {
    expect(isDue({ trigger, lastRunAt: at(2026, 8, 3, 9, 0), now: at(2026, 8, 10, 9, 30) })).toBe(true)
  })

  it('本周这一档已跑过 → 未到期（周三再评估也不重复）', () => {
    expect(isDue({ trigger, lastRunAt: at(2026, 8, 10, 9, 1), now: at(2026, 8, 12, 10, 0) })).toBe(false)
  })

  it('本周一还没到（周日评估）→ 未到期', () => {
    expect(isDue({ trigger, lastRunAt: at(2026, 8, 3, 9, 0), now: at(2026, 8, 9, 23, 0) })).toBe(false)
  })

  it('weekday 越界 → 恒不到期', () => {
    expect(isDue({ trigger: { kind: 'weekly', weekday: 9, time: '09:00' }, now: at(2026, 8, 10, 12, 0) })).toBe(false)
  })
})

describe('isDue —— 缺省与开关', () => {
  it('lastRunAt 缺省 → 到期（首次立即跑）', () => {
    const now = at(2026, 8, 10, 12, 0)
    expect(isDue({ trigger: { kind: 'everyHours', hours: 6 }, now })).toBe(true)
    expect(isDue({ trigger: { kind: 'daily', time: '03:00' }, now })).toBe(true)
    expect(isDue({ trigger: { kind: 'weekly', weekday: 1, time: '09:00' }, now })).toBe(true)
  })

  it('停用 → 恒不到期（哪怕早已过期）', () => {
    const now = at(2026, 8, 10, 12, 0)
    expect(
      isDue({ trigger: { kind: 'everyHours', hours: 1 }, lastRunAt: now - 999 * HOUR, enabled: false, now })
    ).toBe(false)
  })
})

describe('isDue —— 确定性纯函数', () => {
  it('不读真实时钟：「现在」只由入参给，同输入恒同输出', () => {
    const input = {
      trigger: { kind: 'everyHours', hours: 6 } as PatrolTrigger,
      lastRunAt: at(2020, 1, 1, 0, 0),
      // 「现在」取一个远早于真实时钟的时刻，只比 lastRunAt 晚 1 小时 → 必须答未到期。
      now: at(2020, 1, 1, 1, 0)
    }
    expect(isDue(input)).toBe(false)
    expect(isDue(input)).toBe(false)
  })

  it('错过 12 个窗口 → 仍只答一个「到期」（补几次由回路决定，不由判定函数表达）', () => {
    const now = at(2026, 8, 10, 12, 0)
    expect(isDue({ trigger: { kind: 'everyHours', hours: 6 }, lastRunAt: now - 72 * HOUR, now })).toBe(true)
  })
})

describe('describeTrigger —— 人话描述（i18n key + 参数，不在 shared 里拼文案）', () => {
  it('三种触发各给稳定的 key 与参数', () => {
    expect(describeTrigger({ kind: 'everyHours', hours: 6 })).toEqual({
      key: 'patrol.triggerEveryHours',
      params: { hours: 6 }
    })
    expect(describeTrigger({ kind: 'daily', time: '03:00' })).toEqual({
      key: 'patrol.triggerDaily',
      params: { time: '03:00' }
    })
    expect(describeTrigger({ kind: 'weekly', weekday: 1, time: '09:00' })).toEqual({
      key: 'patrol.triggerWeekly',
      params: { weekday: 1, time: '09:00' }
    })
  })
})

describe('coercePatrols —— 读入收敛', () => {
  const ok: Patrol = {
    id: 'p1',
    name: '每天扫文档',
    trigger: { kind: 'daily', time: '03:00' },
    action: { kind: 'docScan' },
    enabled: true
  }

  it('老项目没有巡检字段 → 空列表、不报错', () => {
    expect(coercePatrols(undefined)).toEqual([])
    expect(coercePatrols(null)).toEqual([])
    expect(coercePatrols('nonsense')).toEqual([])
    expect(coercePatrols({})).toEqual([])
  })

  it('合法条目原样保留，含 lastRunAt', () => {
    expect(coercePatrols([{ ...ok, lastRunAt: 123 }])).toEqual([{ ...ok, lastRunAt: 123 }])
  })

  it('enabled 缺省视为开（升级不静默停掉巡检）；只有显式 false 才是停用', () => {
    const { enabled: _drop, ...noFlag } = ok
    expect(coercePatrols([noFlag])[0].enabled).toBe(true)
    expect(coercePatrols([{ ...ok, enabled: false }])[0].enabled).toBe(false)
  })

  it('脏条目（缺 id / 触发非法 / 动作非法）被丢弃，不出闸', () => {
    expect(
      coercePatrols([
        { ...ok, id: '' },
        { ...ok, trigger: { kind: 'cron', expr: '0 3 * * 1' } },
        { ...ok, action: { kind: 'deploy' } },
        { ...ok, action: { kind: 'command', command: '   ' } },
        { ...ok, action: { kind: 'workflow', workflowId: '' } },
        null,
        42
      ])
    ).toEqual([])
  })

  it('lastRunAt 非数字 → 丢掉该字段（视为从未跑过），条目仍保留', () => {
    expect(coercePatrols([{ ...ok, lastRunAt: 'yesterday' }])).toEqual([ok])
  })
})

describe('findingsToCandidates —— 发现转候选卡（止于审阅的唯一去处）', () => {
  it('每条发现一张候选卡：标题/描述照搬、typeId 用在册类型、预取名为合法 slug', () => {
    const cards = findingsToCandidates(
      [
        { title: '文档与代码漂移：web', description: '- docs/a.md 已不存在' },
        { title: '文档与代码漂移：api', description: '- docs/b.md 未登记' }
      ],
      'feature'
    )
    expect(cards).toHaveLength(2)
    expect(cards[0]).toMatchObject({ title: '文档与代码漂移：web', typeId: 'feature', relations: [] })
    expect(cards[0].description).toContain('docs/a.md')
    for (const c of cards) expect(c.proposedName).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('同名发现的预取名去重（批内唯一）', () => {
    const cards = findingsToCandidates(
      [
        { title: 'doc drift', description: 'x' },
        { title: 'doc drift', description: 'y' }
      ],
      'feature'
    )
    expect(cards[0].proposedName).not.toBe(cards[1].proposedName)
  })

  it('空发现 → 空候选（无事发生，不推空卡）', () => {
    expect(findingsToCandidates([], 'feature')).toEqual([])
  })
})
