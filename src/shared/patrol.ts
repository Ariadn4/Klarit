/**
 * 定时巡检的模型与纯逻辑（无 fs / 无 IPC，main 与 renderer 共享，定位同 `shared/auto-schedule.ts`）：
 * 巡检类型、到期判定 `isDue`、触发的人话描述、读入收敛、以及「发现 → 候选需求卡」的转换。
 *
 * **触发只有三种固定周期，没有 cron 表达式**——面向的是不读代码的用户，三种形态都能用下拉 + 时刻选择器表达完。
 * `isDue` 是**确定性纯函数**：「现在」由入参给、绝不读真实时钟；错过多少个窗口它都只答一个「到期」
 * （补跑几次是回路的事，判定函数不表达次数，见 `main/patrol-scheduler.ts`）。
 */

import type { CandidateCard } from './types'
import { dedupeProposedName, toProposedName } from './requirement-card'

/** 触发：每 n 小时 / 每天某时刻 / 每周某天某时刻。时刻串为本地时区的 `HH:mm`。 */
export type PatrolTrigger =
  | { kind: 'everyHours'; hours: number }
  | { kind: 'daily'; time: string }
  /** `weekday` 同 `Date.getDay()`：0=周日 … 6=周六。 */
  | { kind: 'weekly'; weekday: number; time: string }

/** 动作三选一，全部映射到既有执行接缝（跑工作流 / 跑命令 / 文档腐烂扫描），无新执行器。 */
export type PatrolAction =
  | { kind: 'workflow'; workflowId: string }
  | { kind: 'command'; command: string }
  | { kind: 'docScan' }

export interface Patrol {
  id: string
  /** 显示名。 */
  name: string
  trigger: PatrolTrigger
  action: PatrolAction
  /** 停用的巡检恒不触发，但配置与 `lastRunAt` 保留。 */
  enabled: boolean
  /** 上次**发起动作**的时刻（毫秒）；从未跑过时缺省。发起即记，不等动作成功。 */
  lastRunAt?: number
}

/** 巡检扫出来的一条问题（人话），由回路转成候选需求卡推给用户审阅。 */
export interface PatrolFinding {
  title: string
  /** markdown 文本。 */
  description: string
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** 解析 `HH:mm`；非法给 null。 */
function parseTime(time: unknown): { h: number; m: number } | null {
  if (typeof time !== 'string') return null
  const hit = TIME_RE.exec(time)
  return hit ? { h: Number(hit[1]), m: Number(hit[2]) } : null
}

/** 「现在」之前（含）最近一次 `HH:mm` 的时刻；按本地时区、按日历天回退（不做 ±24h 算术，避开夏令时）。 */
function lastDailyOccurrence(now: number, h: number, m: number): number {
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  if (d.getTime() > now) d.setDate(d.getDate() - 1)
  return d.getTime()
}

/** 「现在」之前（含）最近一次「周 weekday 的 HH:mm」。 */
function lastWeeklyOccurrence(now: number, weekday: number, h: number, m: number): number {
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  let back = d.getDay() - weekday
  if (back < 0) back += 7
  d.setDate(d.getDate() - back)
  if (d.getTime() > now) d.setDate(d.getDate() - 7)
  return d.getTime()
}

/**
 * 一条巡检**现在是否到期**。停用恒不到期；`lastRunAt` 缺省视为到期（首次立即跑）；
 * 触发配置非法（小时数非正、时刻串不合法、周几越界）一律不到期——脏配置绝不乱发动作。
 */
export function isDue(input: {
  trigger: PatrolTrigger
  /** 上次发起时刻；缺省＝从未跑过。 */
  lastRunAt?: number
  /** 缺省视为启用。 */
  enabled?: boolean
  /** 「现在」（毫秒），由调用方给——本函数不读真实时钟。 */
  now: number
}): boolean {
  if (input.enabled === false) return false
  const { trigger, lastRunAt, now } = input
  const never = typeof lastRunAt !== 'number' || !Number.isFinite(lastRunAt)

  if (trigger?.kind === 'everyHours') {
    if (!Number.isFinite(trigger.hours) || trigger.hours <= 0) return false
    return never || now - (lastRunAt as number) >= trigger.hours * 3600_000
  }
  if (trigger?.kind === 'daily') {
    const t = parseTime(trigger.time)
    if (!t) return false
    return never || (lastRunAt as number) < lastDailyOccurrence(now, t.h, t.m)
  }
  if (trigger?.kind === 'weekly') {
    const t = parseTime(trigger.time)
    if (!t) return false
    if (!Number.isInteger(trigger.weekday) || trigger.weekday < 0 || trigger.weekday > 6) return false
    return never || (lastRunAt as number) < lastWeeklyOccurrence(now, trigger.weekday, t.h, t.m)
  }
  return false
}

/** 触发的人话描述：给 i18n key + 参数（文案归各语言包，shared 不拼中文/英文）。 */
export function describeTrigger(trigger: PatrolTrigger): {
  key: string
  params: Record<string, string | number>
} {
  if (trigger.kind === 'everyHours') return { key: 'patrol.triggerEveryHours', params: { hours: trigger.hours } }
  if (trigger.kind === 'daily') return { key: 'patrol.triggerDaily', params: { time: trigger.time } }
  return { key: 'patrol.triggerWeekly', params: { weekday: trigger.weekday, time: trigger.time } }
}

function coerceTrigger(raw: unknown): PatrolTrigger | null {
  const o = raw as { kind?: unknown; hours?: unknown; time?: unknown; weekday?: unknown } | null
  if (!o || typeof o !== 'object') return null
  if (o.kind === 'everyHours') {
    return typeof o.hours === 'number' && Number.isFinite(o.hours) && o.hours > 0
      ? { kind: 'everyHours', hours: o.hours }
      : null
  }
  if (o.kind === 'daily') {
    return parseTime(o.time) ? { kind: 'daily', time: o.time as string } : null
  }
  if (o.kind === 'weekly') {
    const okDay = Number.isInteger(o.weekday) && (o.weekday as number) >= 0 && (o.weekday as number) <= 6
    return parseTime(o.time) && okDay
      ? { kind: 'weekly', weekday: o.weekday as number, time: o.time as string }
      : null
  }
  return null
}

function coerceAction(raw: unknown): PatrolAction | null {
  const o = raw as { kind?: unknown; workflowId?: unknown; command?: unknown } | null
  if (!o || typeof o !== 'object') return null
  if (o.kind === 'docScan') return { kind: 'docScan' }
  if (o.kind === 'workflow') {
    return typeof o.workflowId === 'string' && o.workflowId !== '' ? { kind: 'workflow', workflowId: o.workflowId } : null
  }
  if (o.kind === 'command') {
    return typeof o.command === 'string' && o.command.trim() !== '' ? { kind: 'command', command: o.command } : null
  }
  return null
}

/**
 * 读入收敛：非数组（含老项目的缺省字段）→ 空列表；脏条目丢弃、不出闸。
 * `enabled` 缺省视为**开**（只有显式 `false` 才是停用，升级不静默停掉用户的巡检）。
 */
export function coercePatrols(raw: unknown): Patrol[] {
  if (!Array.isArray(raw)) return []
  const out: Patrol[] = []
  for (const item of raw) {
    const o = item as Partial<Patrol> | null
    if (!o || typeof o !== 'object') continue
    if (typeof o.id !== 'string' || o.id === '') continue
    const trigger = coerceTrigger(o.trigger)
    const action = coerceAction(o.action)
    if (!trigger || !action) continue
    const patrol: Patrol = {
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      trigger,
      action,
      enabled: o.enabled !== false
    }
    if (typeof o.lastRunAt === 'number' && Number.isFinite(o.lastRunAt)) patrol.lastRunAt = o.lastRunAt
    out.push(patrol)
  }
  return out
}

/**
 * 把巡检发现转成候选需求卡——巡检主动产出的**唯一**形态：止于审阅，由用户决定要不要落库。
 * 预取名由标题 slug 化并在批内去重；关系边一律空（巡检不替用户编排依赖）。
 */
export function findingsToCandidates(findings: readonly PatrolFinding[], typeId: string): CandidateCard[] {
  const taken = new Set<string>()
  return findings.map((f) => {
    const proposedName = dedupeProposedName(toProposedName(f.title), taken)
    taken.add(proposedName)
    return { proposedName, title: f.title, description: f.description, typeId, relations: [] }
  })
}
