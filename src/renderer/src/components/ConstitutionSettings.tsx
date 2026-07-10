import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConstitutionGovernance, RulePack } from '@shared/rule-pack'
import { resolveLocalized } from '@shared/rule-pack'
import { ListEditor } from './ui/ListEditor'

/**
 * 项目设置·宪法：为当前项目激活规则包、并对激活包内的宪法规则逐条 on/off。
 * 应用层（规则库）编辑包内容；此处只管「这个项目用不用、哪几条用」。只用语义令牌。
 */
export function ConstitutionSettings(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [packs, setPacks] = useState<RulePack[]>([])
  const [gov, setGov] = useState<ConstitutionGovernance>({ activePackIds: [], disabledRules: [] })

  useEffect(() => {
    window.klarit.allRulePacks().then(setPacks)
    window.klarit.getConstitution().then(setGov)
  }, [])

  const persist = async (next: ConstitutionGovernance): Promise<void> => {
    setGov(next)
    await window.klarit.setConstitution(next)
  }

  const isActive = (packId: string): boolean => gov.activePackIds.includes(packId)
  const toggleActive = (packId: string): Promise<void> =>
    persist({
      ...gov,
      activePackIds: isActive(packId)
        ? gov.activePackIds.filter((x) => x !== packId)
        : [...gov.activePackIds, packId]
    })

  const isDisabled = (packId: string, itemId: string): boolean =>
    gov.disabledRules.some((d) => d.packId === packId && d.itemId === itemId)
  const toggleRule = (packId: string, itemId: string): Promise<void> =>
    persist({
      ...gov,
      disabledRules: isDisabled(packId, itemId)
        ? gov.disabledRules.filter((d) => !(d.packId === packId && d.itemId === itemId))
        : [...gov.disabledRules, { packId, itemId }]
    })

  return (
    <ListEditor title={t('constitution.title')} description={t('constitution.description')} count={packs.length}>
      {packs.length === 0 ? (
        <p className="px-1 py-2 text-[13px] text-stone-600">{t('constitution.emptyLibrary')}</p>
      ) : (
        packs.map((pack) => {
          const rules = pack.items.filter((it) => it.kind === 'constitution-rule')
          return (
            <div key={pack.id} className="border-b border-stone-100 px-1 py-2 hover:bg-stone-100/45">
              <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
                <input
                  type="checkbox"
                  checked={isActive(pack.id)}
                  aria-label={t('constitution.activatePackAriaLabel', { name: resolveLocalized(pack.name, lang) })}
                  onChange={() => toggleActive(pack.id)}
                />
                {resolveLocalized(pack.name, lang)}
              </label>
              {isActive(pack.id) && rules.length > 0 && (
                // 第二级：缩进 28px（pl-7），靠间距分组、不画块间线。
                <ul className="mt-2 space-y-1.5 pl-7">
                  {rules.map((rule) => (
                    <li key={rule.id}>
                      <label className="flex items-center gap-2 text-[13px] text-ink">
                        <input
                          type="checkbox"
                          checked={!isDisabled(pack.id, rule.id)}
                          aria-label={t('constitution.toggleRuleAriaLabel', { name: resolveLocalized(rule.name, lang) })}
                          onChange={() => toggleRule(pack.id, rule.id)}
                        />
                        {resolveLocalized(rule.name, lang)}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })
      )}
    </ListEditor>
  )
}
