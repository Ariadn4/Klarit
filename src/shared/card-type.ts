/**
 * 需求卡「类型」的纯逻辑：流动原型封闭词表、默认类型种子、typeId→archetype 视图、类型定义与
 * 工作流建议类型的校验。无 fs / 无 IPC，main 与 renderer 共享（同 shared/requirement-card.ts 的定位）。
 * 持久化（注册表存储、播种）归 main 侧 card-type-store。
 */

import type { CardArchetype, CardColorKey, CardTypeDef, CardValidation } from './types'

/** 流动原型封闭词表——引擎内置、不开放扩展，是流动与关系合法性的唯一机制来源。 */
export const CARD_ARCHETYPES: ReadonlyArray<CardArchetype> = ['container', 'leaf']

/**
 * 类型徽章可选颜色封闭盘（key 列表，校验与 UI 选色的单一来源）。具体 Tailwind 类住在渲染层
 * （`renderer/.../cardTypeColors.ts`）——因 Tailwind 只扫描 renderer 源，类字符串放 shared 不会被生成。
 */
export const CARD_COLOR_KEYS: ReadonlyArray<CardColorKey> = [
  'red',
  'amber',
  'yellow',
  'green',
  'cyan',
  'blue',
  'violet',
  'pink'
]

/**
 * 默认类型种子：注册表为空时种入，保证既有 epic/feature/bug 行为开箱即用，也是老数据
 * `category→typeId` 映射的落点。`epic` 为内置通用容器类型，不依赖工作流。描述即分解分类依据。
 */
export const DEFAULT_CARD_TYPES: ReadonlyArray<CardTypeDef> = [
  {
    id: 'epic',
    name: 'Epic',
    description: '大目标 / 分组容器：需要拆成多张子卡才能交付的较大目标。不直接流动，作为子卡的入口与汇总。',
    archetype: 'container',
    color: 'violet'
  },
  {
    id: 'feature',
    name: 'Feat',
    description: '功能需求：一个聚焦、可独立交付的功能或改动，是看板的流通单位。',
    archetype: 'leaf',
    color: 'blue'
  },
  {
    id: 'bug',
    name: 'Bug',
    description: '缺陷修复：修复一个或一组缺陷；不宜并入某个 feature 时单独成卡。',
    archetype: 'leaf',
    color: 'red'
  }
]

/** 项目在册类型：未设置(undefined)回落默认种子；空数组([])尊重用户已清空。 */
export function projectCardTypes(stored: CardTypeDef[] | undefined): CardTypeDef[] {
  return stored ?? [...DEFAULT_CARD_TYPES]
}

/** 按 id upsert（同 id 替换、否则追加）；返回新数组，不改原数组。 */
export function upsertCardType(types: CardTypeDef[], def: CardTypeDef): CardTypeDef[] {
  const idx = types.findIndex((t) => t.id === def.id)
  if (idx < 0) return [...types, def]
  const next = types.slice()
  next[idx] = def
  return next
}

/** 移除某 id 的类型；返回新数组。 */
export function removeCardType(types: CardTypeDef[], id: string): CardTypeDef[] {
  return types.filter((t) => t.id !== id)
}

/** 幂等播种：把 suggested 里 id 尚不存在且自身合法的类型追加进去（已存在跳过、不覆盖）。 */
export function seedCardTypes(types: CardTypeDef[], suggested: CardTypeDef[]): CardTypeDef[] {
  if (!Array.isArray(suggested) || suggested.length === 0) return types
  const have = new Set(types.map((t) => t.id))
  const out = types.slice()
  for (const t of suggested) {
    if (!t || have.has(t.id) || !validateCardTypeDef(t).ok) continue
    out.push(t)
    have.add(t.id)
  }
  return out
}

/**
 * 把 agent 给的 typeId 纠正到**在册**类型 id：在册直接用；否则按 id / 显示名**不区分大小写**匹配；
 * 再不行兜底到第一个 leaf 类型（没有 leaf 则第一个类型）。用于编排产出的容错——避免 agent 用了
 * 「Feat」/「feature」这类近似名或跨项目类型 id 导致卡被误判非法丢弃。types 为空时原样返回。
 */
export function coerceToRegisteredType(typeId: string, types: CardTypeDef[]): string {
  if (!Array.isArray(types) || types.length === 0) return typeId
  const id = typeof typeId === 'string' ? typeId.trim() : ''
  if (types.some((t) => t.id === id)) return id
  const lower = id.toLowerCase()
  const byName = types.find((t) => t.name.toLowerCase() === lower)
  if (byName) return byName.id
  const byId = types.find((t) => t.id.toLowerCase() === lower)
  if (byId) return byId.id
  return (types.find((t) => t.archetype === 'leaf') ?? types[0]).id
}

/** 在册类型视图：typeId → archetype。卡校验与关系合法性的纯输入（调用方从注册表读出后注入）。 */
export type TypeArchetypeMap = ReadonlyMap<string, CardArchetype>

/** 由一组类型定义构造 typeId→archetype 映射。 */
export function typeArchetypeMap(types: Iterable<CardTypeDef>): Map<string, CardArchetype> {
  const m = new Map<string, CardArchetype>()
  for (const t of types) if (t && typeof t.id === 'string') m.set(t.id, t.archetype)
  return m
}

function nonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s.trim() !== ''
}

/** 校验一个类型定义自身：id / name 非空、archetype 取值合法（仅 container/leaf）。description 允许为空字符串。 */
export function validateCardTypeDef(def: CardTypeDef): CardValidation {
  if (!def || typeof def !== 'object') return { ok: false, reason: '类型定义为空或非对象' }
  if (!nonEmpty(def.id)) return { ok: false, reason: '类型 id 不能为空' }
  if (!nonEmpty(def.name)) return { ok: false, reason: `类型「${def.id}」：显示名不能为空` }
  if (typeof def.description !== 'string') return { ok: false, reason: `类型「${def.id}」：描述必须是文本` }
  if (!CARD_ARCHETYPES.includes(def.archetype)) {
    return { ok: false, reason: `类型「${def.id}」：原型非法（应为 ${CARD_ARCHETYPES.join('/')} 之一）` }
  }
  if (def.color !== undefined && !CARD_COLOR_KEYS.includes(def.color)) {
    return { ok: false, reason: `类型「${def.id}」：颜色非法（应为预置盘之一）` }
  }
  return { ok: true }
}

/**
 * 把旧形态需求卡（带 `category`、无 `typeId`）归一到新形态：`typeId` 缺失时取 `category` 原样填入
 * （默认种子保证 epic/feature/bug 在册、不孤儿）。对已是新形态（有 typeId）的对象幂等。供未来需求卡
 * 持久化读旧数据时调用（本 change 暂无卡持久化、无调用点，仅锁定迁移契约）。
 */
export function migrateCardTypeId<T extends Record<string, unknown>>(raw: T): T & { typeId: string } {
  const typeId =
    typeof raw.typeId === 'string' && raw.typeId.trim() !== ''
      ? raw.typeId
      : typeof raw.category === 'string'
        ? raw.category
        : ''
  return { ...raw, typeId }
}

/**
 * 校验工作流声明的「建议类型」：必须是数组、每项为合法类型定义（container / leaf 均可——
 * 工作流可带自己的容器与流通类型，激活时一并播种进项目）。
 */
export function validateSuggestedTypes(types: CardTypeDef[]): CardValidation {
  if (!Array.isArray(types)) return { ok: false, reason: '建议类型必须是数组' }
  for (const t of types) {
    const v = validateCardTypeDef(t)
    if (!v.ok) return v
  }
  return { ok: true }
}
