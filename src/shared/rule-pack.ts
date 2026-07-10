/**
 * 规则包（rule pack）：project-goals 四层结构里「规则包」层的实体——命名包持有一组带类型条目
 * （宪法规则 / 产出模板 / 客观门校验）。纯模型/校验/默认种子/宪法派生，main 与 renderer 共享，无 fs / yaml 依赖。
 *
 * 面向用户的文本字段（包名/描述、条目名、宪法正文、模板内容）承载**多语言**（`Localized` 逐字段语言表）；
 * 标识符/命令/引用（id/kind/command/ref）为**单值**、跨语言逐字相同。消费时按当前语言用 `resolveLocalized`
 * 解析为单语言（回退：当前语言→英语→仅有的语言）。
 */

import { DEFAULT_LANGUAGE } from './language'
import { hasAnyLanguage, resolveLocalized } from './localized'
import type { Localized } from './localized'

// 多语言原语住在 ./localized（避免与 types.ts 循环依赖）；此处再导出，历史 `@shared/rule-pack` 引用不变。
export type { Localized }
export { hasAnyLanguage, resolveLocalized }

/** 一个规则包条目（判别联合，三类）。条目 id 在包内唯一且稳定（被工作流引用、被项目开关记录）。 */
export type RulePackItem =
  | { kind: 'constitution-rule'; id: string; name: Localized; text: Localized }
  | { kind: 'output-template'; id: string; name: Localized; content: Localized }
  | { kind: 'objective-check'; id: string; name: Localized; command: string }

export type RulePackItemKind = RulePackItem['kind']

/** 对某规则包条目的全限定引用（`{packId, itemId}`，避免跨包同 id 歧义）。供工作流模板/校验 ref 形态用。 */
export interface RulePackItemRef {
  packId: string
  itemId: string
}

/** 一个规则包定义，持久化为规则包内的 `rule-pack.yaml`。 */
export interface RulePack {
  id: string
  name: Localized
  description?: Localized
  items: RulePackItem[]
}

/** 规则包轻量摘要（列表/选择器用）；name 仍为多语言，由渲染方按当前语言解析。 */
export interface RulePackSummary {
  id: string
  name: Localized
}

/** 校验/保存结果（失败带可读原因）。 */
export type RulePackValidation = { ok: true } | { ok: false; reason: string }

/** 某项目的宪法治理状态（项目管理数据：激活哪些包 + 逐条规则开关）。 */
export interface ConstitutionGovernance {
  /** 激活的规则包 id（该项目套用这些包的宪法规则）。 */
  activePackIds: string[]
  /** 被关掉的宪法规则（按 `{packId, itemId}` 全限定，避免跨包同 id 歧义）。 */
  disabledRules: Array<{ packId: string; itemId: string }>
}

/** 一条派生出的生效宪法规则（全限定来源 + 已按语言解析出的单语言内容）。 */
export interface EffectiveConstitutionRule {
  packId: string
  itemId: string
  name: string
  text: string
}

const RULE_ITEM_KINDS: ReadonlyArray<RulePackItemKind> = [
  'constitution-rule',
  'output-template',
  'objective-check'
]

function nonEmpty(s: unknown): s is string {
  return typeof s === 'string' && s.trim() !== ''
}

function validateItem(item: RulePackItem, where: string): string | null {
  if (!item || !RULE_ITEM_KINDS.includes(item.kind)) {
    return `${where}：条目类型非法（应为 constitution-rule / output-template / objective-check 之一）`
  }
  if (!nonEmpty(item.id)) return `${where}：条目 id 不能为空`
  if (!hasAnyLanguage(item.name)) return `${where}：条目「${item.id}」显示名不能为空（至少一种语言）`
  const label = resolveLocalized(item.name, DEFAULT_LANGUAGE) || item.id
  switch (item.kind) {
    case 'constitution-rule':
      if (!hasAnyLanguage(item.text)) return `${where}：条目「${label}」正文为空（至少一种语言）`
      break
    case 'output-template':
      if (!hasAnyLanguage(item.content)) return `${where}：条目「${label}」模板内容为空（至少一种语言）`
      break
    case 'objective-check':
      if (!nonEmpty(item.command)) return `${where}：条目「${label}」校验命令为空`
      break
  }
  return null
}

/**
 * 校验规则包结构：id 非空、包名至少一种语言、条目 id 在包内唯一、每个条目类型合法。
 * 可翻字段（名称/正文/模板内容）至少含一种非空语言；结构字段（命令）非空。
 * 不校验 id 在库内唯一（由库服务在保存/导入时另行判定）。
 */
export function validateRulePack(pack: RulePack): RulePackValidation {
  if (!pack || typeof pack !== 'object') return { ok: false, reason: '规则包定义为空或非对象' }
  if (!nonEmpty(pack.id)) return { ok: false, reason: '规则包 id 不能为空' }
  if (!hasAnyLanguage(pack.name)) return { ok: false, reason: '规则包显示名不能为空（至少一种语言）' }
  if (!Array.isArray(pack.items)) return { ok: false, reason: '规则包缺少条目列表' }
  const packLabel = resolveLocalized(pack.name, DEFAULT_LANGUAGE) || pack.id
  const seen = new Set<string>()
  for (let i = 0; i < pack.items.length; i++) {
    const item = pack.items[i]
    const reason = validateItem(item, `规则包「${packLabel}」第 ${i + 1} 个条目`)
    if (reason) return { ok: false, reason }
    if (seen.has(item.id)) return { ok: false, reason: `规则包「${packLabel}」条目 id 重复：${item.id}` }
    seen.add(item.id)
  }
  return { ok: true }
}

/** 提取轻量摘要（列表/选择器用）。name 保持多语言，渲染方按语言解析。 */
export function rulePackSummary(pack: RulePack): RulePackSummary {
  return { id: pack.id, name: pack.name }
}

/** 跨多个包按类型列出条目（工作流编辑器引用选择器用）。 */
export function listItemsByKind(
  packs: RulePack[],
  kind: RulePackItemKind
): Array<{ packId: string; item: RulePackItem }> {
  const out: Array<{ packId: string; item: RulePackItem }> = []
  for (const pack of packs) {
    for (const item of pack.items) {
      if (item.kind === kind) out.push({ packId: pack.id, item })
    }
  }
  return out
}

/**
 * 派生某项目的「生效宪法」：激活包内的 `constitution-rule` 条目之并集，减去在该项目被关掉的条目。
 * 条目按 `{packId, itemId}` 标识；顺序＝激活包顺序再条目顺序。名称/正文按 `language` 解析为单语言。纯函数。
 */
export function deriveEffectiveConstitution(
  packs: RulePack[],
  governance: ConstitutionGovernance,
  language: string
): EffectiveConstitutionRule[] {
  const byId = new Map(packs.map((p) => [p.id, p]))
  const disabled = new Set((governance.disabledRules ?? []).map((d) => `${d.packId} ${d.itemId}`))
  const out: EffectiveConstitutionRule[] = []
  for (const packId of governance.activePackIds ?? []) {
    const pack = byId.get(packId)
    if (!pack) continue
    for (const item of pack.items) {
      if (item.kind !== 'constitution-rule') continue
      if (disabled.has(`${packId} ${item.id}`)) continue
      out.push({
        packId,
        itemId: item.id,
        name: resolveLocalized(item.name, language),
        text: resolveLocalized(item.text, language)
      })
    }
  }
  return out
}

/** 归一一个可翻字段：旧的裸字符串 → `{zh: 值}`；已是语言表则保留；其余 → 空表。读旧包（单语言）不崩。 */
function toLocalizedField(v: unknown): Localized {
  if (typeof v === 'string') return v.trim() === '' ? {} : { [DEFAULT_LANGUAGE]: v }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out: Localized = {}
    for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val
    return out
  }
  return {}
}

function migrateItemShape(it: unknown): unknown {
  if (!it || typeof it !== 'object') return it
  const i = it as Record<string, unknown>
  const next: Record<string, unknown> = { ...i, name: toLocalizedField(i.name) }
  if (i.kind === 'constitution-rule') next.text = toLocalizedField(i.text)
  else if (i.kind === 'output-template') next.content = toLocalizedField(i.content)
  // objective-check.command 为结构字段，保持单值（不迁移）。
  return next
}

/**
 * 把解析自 `rule-pack.yaml` 的原始对象归一为当前数据模型（在反序列化处调用，读旧包不崩）：
 * 旧的裸字符串可翻字段（包名/描述、条目名、宪法正文、模板内容）upcast 为 `{zh: 值}`；命令等结构字段保持单值。对新形状幂等。
 */
export function migrateRulePackShape(raw: unknown): RulePack {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw as RulePack
  const r = raw as Record<string, unknown>
  const next: Record<string, unknown> = { ...r, name: toLocalizedField(r.name) }
  if (r.description !== undefined) next.description = toLocalizedField(r.description)
  if (Array.isArray(r.items)) next.items = r.items.map(migrateItemShape)
  return next as unknown as RulePack
}

/**
 * 内置默认规则包种子：至少含 project-goals 列举的几条宪法规则（抽象 / 解耦 / 使用者语言 / 测试先行），
 * 另含一份示例产出模板与一条示例客观门校验，作为起点与样例。id 由调用方注入。
 * 可翻字段内置 zh + en 双语；id/kind/命令等结构字段跨语言逐字相同（单一来源）。
 */
export function createDefaultRulePack(id: string): RulePack {
  return {
    id,
    name: { zh: 'Klarit 默认规则包', en: 'Klarit Default Pack' },
    description: {
      zh: '内置默认规则包：宪法规则 + 示例产出模板 + 示例客观门校验。可编辑、可导出、可逐项被项目开关。',
      en: 'Built-in default rule pack: constitution rules + a sample output template + a sample objective check. Editable, exportable, and each item can be toggled per project.'
    },
    items: [
      {
        kind: 'constitution-rule',
        id: 'test-first',
        name: { zh: '测试先行', en: 'Test-First' },
        text: {
          zh: '写实现前先写测试并确认先红后绿；测试针对公共 API 完整覆盖行为，不为可测性导出私有或拆函数。',
          en: 'Write tests before implementation and confirm red-then-green; tests cover behavior through the public API, without exporting privates or splitting functions just for testability.'
        }
      },
      {
        kind: 'constitution-rule',
        id: 'abstraction',
        name: { zh: '抽象', en: 'Abstraction' },
        text: {
          zh: '按合适的抽象层级表达，隐藏实现细节，对外暴露稳定意图而非内部机制。',
          en: 'Express at the right level of abstraction; hide implementation details and expose stable intent rather than internal mechanics.'
        }
      },
      {
        kind: 'constitution-rule',
        id: 'decoupling',
        name: { zh: '解耦', en: 'Decoupling' },
        text: {
          zh: '模块间低耦合、高内聚；依赖经清晰边界传递，避免跨层直连与隐式全局状态。',
          en: 'Keep modules loosely coupled and highly cohesive; pass dependencies through clear boundaries, avoiding cross-layer direct calls and implicit global state.'
        }
      },
      {
        kind: 'constitution-rule',
        id: 'user-language',
        name: { zh: '使用者语言', en: 'Ubiquitous Language' },
        text: {
          zh: '命名与文档用使用者的领域语言，不直译英文 jargon，让阅读者按其心智模型理解。',
          en: "Name things and write docs in the user's domain language; don't transliterate jargon, so readers understand via their own mental model."
        }
      },
      {
        kind: 'output-template',
        id: 'spec-template',
        name: { zh: '规格模板', en: 'Spec template' },
        content: {
          zh: '## 背景\n\n## 方案\n\n## 影响\n',
          en: '## Background\n\n## Approach\n\n## Impact\n'
        }
      },
      {
        kind: 'objective-check',
        id: 'run-tests',
        name: { zh: '跑测试', en: 'Run tests' },
        command: 'npm test'
      }
    ]
  }
}
