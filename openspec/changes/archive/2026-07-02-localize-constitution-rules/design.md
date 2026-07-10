## Context

规则包(`src/shared/rule-pack.ts`)是 main 与 renderer 共享的纯模型：`RulePackItem` 三类条目(`constitution-rule`/`output-template`/`objective-check`)的文本字段都是**单一字符串**，持久化为 `userData/rule-packs/<id>/rule-pack.yaml`，可编辑、可经 `importPackage`/`exportPackage` 导入导出。宪法经 `deriveEffectiveConstitution(packs, governance)` 派生为 `EffectiveConstitutionRule[]`，再由 `agent-prompt.ts` 的 `assembleAgentPrompt` 拼进 AI prompt(`- ${name}：${text}`)。`assembleAgentPrompt` 已收 `language` 并按它生成"回复语言"指令(`REPLY_LANGUAGE_INSTRUCTION`)。

语言契约就绪：`src/shared/language.ts` 定义 `SupportedLanguage='zh'|'en'`、`coerceLanguage`、`DEFAULT_LANGUAGE`(将来改 `en`)；`settings.language` 在主进程已初始化。i18next(renderer 的 `i18n/locales/{zh,en}.ts`)承载 app 外壳静态文案。

约束沿用 CLAUDE.md：测试先行、只用语义令牌、动态内容只记现状。产品未上线、无老数据。

## Goals / Non-Goals

**Goals:**
- 规则包可翻字段支持多语言(逐字段语言表 `Localized`)，按 `settings.language` 解析、带回退链。
- 可翻 vs 结构字段硬边界：文本可翻，标识符/命令/路径/ref 单值且跨语言逐字相同。
- 消费面(宪法设置列表、生效宪法注入)解析为单语言；编辑面按语言下拉、单栏编辑所选语言。
- 外部导入的包原生携带多语言、并被解析；语言键开放。
- 默认规则包种子重写为 zh/en 双语。

**Non-Goals:**
- 工作流**显示文本**(名/描述/阶段名/节点名)本轮已纳入(复用同一 `Localized` 信封)；工作流的 inline 提示词/命令/路径仍单值、不翻。
- 不引入运行时 AI 翻译(确定、离线、零额外依赖)。
- 不做老数据迁移(无老数据)。
- 不强制"整版完整"、不禁止同条混排。
- 不改 IPC 包管理契约语义、不动 i18next 承载的 app 外壳文案。

## Decisions

### 决策 1：`Localized` = 逐字段语言表，而非"整包分语言版本"

`type Localized = Record<string, string>`(语言码→文本，键开放)。可翻字段(包 `name`/`description`、条目 `name`、`constitution-rule.text`、`output-template.content`)由 `string` 改为 `Localized`；结构字段(`id`/`kind`/`command`/`ref`/路径)不变。

理由：作者可能只翻部分字段，"逐字段"能**尊重任何已存在的翻译**(翻了哪个字段哪个生效)，并让导入的部分翻译包自然可用。

考虑过的替代：**整包分语言版本表**(`i18n: {zh:{...}, en:{...}}` + 完整性校验、整包按一种语言渲染)。它能保证"不混排"，但会因某字段未翻就把整版判残缺、丢弃已翻字段，与"尊重已有翻译"冲突，排除。代价是逐字段回退可能出现同条 name/text 混排——可接受。

### 决策 2：确定性回退解析 `resolveLocalized(field, language)`

纯函数，按序取第一个存在且非空：`field[language]` → `field['en']` → 按确定顺序的第一个非空条目。逐字段独立。`language` 入参先经 `coerceLanguage` 归一(非法回退默认)。

理由：直接表达用户定的"当前语言→英语→有啥用啥"；离线确定、可测。`en` 作为中间回退与"默认语言将来改 en"一致。

### 决策 3：消费面在派生/拼装时解析为单语言

`deriveEffectiveConstitution` 增加 `language` 入参：派生时对每条规则的 `name`/`text` 调 `resolveLocalized` 解析成单语言再放进 `EffectiveConstitutionRule`(其形状仍是单字符串 `{name,text}`)。于是 `agent-prompt.ts` **无需改动**(它消费的已是解析后的字符串)。主进程派生/拼装处透传 `settings.language`。`ConstitutionSettings.tsx` 渲染勾选列表时用 `resolveLocalized` 按 `i18n.language` 解析包名/规则名。

理由：把"解析成单语言"收敛在派生与渲染两处边界，下游(prompt 拼装、列表项)无须懂多语言，改动面最小。

### 决策 4：编辑面按语言下拉、单栏编辑（`LocalizedTextInput` 共享组件）

编辑器顶栏放一个**语言下拉**(列出软件受支持语言 ∪ 包已带的开放语言键)，选中哪个语言，每个可翻字段就以**单一输入框**编辑该语言的值；切下拉即把所有可翻字段切到对应语言。语言再多也只占一个下拉、不横向膨胀。真值＝`field[当前语言]`(可能空)，为空时才把其它语言的回退值作**灰色占位**(仅提示、不预填、不写入)；某语言留空 ⇒ 写回时**剔除该语言键**(不写空串)。结构字段(命令/路径)仍单框、不随语言变化。这套输入行为抽成**共享组件 `ui/LocalizedTextInput`**，规则库与工作流编辑器共用(单一来源，避免两处实现漂移)。

理由：并排多栏在语言数增多时横向/竖向膨胀，不 scale；下拉是恒定占位。"真值为空即显灰色占位、不预填"避免把回退语言复制进当前语言、污染数据。"留空即删键"让校验"至少一种非空语言"语义干净。

考虑过的替代：**各语言并排多输入框**——能同屏对照，但语言一多就膨胀，且早期实现里工作流编辑器误把回退值当真值预填、导致保存污染，已弃用。

### 决策 5：序列化与导入适配新字段形状

`serializeRulePack`/`parseRulePack` 按新形状(可翻字段为 map)往返。`validateRulePack`：可翻字段"至少一种非空语言"、结构字段非空。`importPackage` 仍走 `validateRulePack`，故部分翻译/含开放语言键的外部包自然被接受；无任何非空语言的字段被拒。

理由：导入校验复用同一 `validateRulePack`，无需为导入另立规则；开放语言键无需登记即可携带。

## Risks / Trade-offs

- [逐字段回退导致同条 name/text 混排] → 这是"尊重已有翻译、宁可显英文不显空"的有意取舍；对注入 AI 的文本，语言不一致无害(AI 通吃、回复语言另由 prompt 规定)。
- [`RulePackItem` 字段形状是 BREAKING 改动] → 产品未上线、无老数据，不做迁移；默认种子按新形状重写；既有按单字符串断言种子内容的测试同步改为按语言解析或只断言结构/id。
- [renderer 与 main 两处都要解析] → `resolveLocalized` 放 `src/shared`，两端共享同一纯函数，避免实现漂移。
- [编辑器随语言数膨胀] → 用语言下拉、每字段单栏，语言再多也只占一个下拉、不膨胀。
- [开放语言键与界面可切语言不一致] → 数据键开放、UI 切换集仍 `zh`/`en`；界面不支持的语言只读地参与回退，编辑器语言下拉也列出包已带的开放键供编辑。

## Migration Plan

1. 先写测试(先红)：`resolveLocalized` 回退三档 + 逐字段独立；`validateRulePack` 对 `Localized`/结构字段；`deriveEffectiveConstitution` 按语言解析；默认种子 zh/en 合法且标识符跨语言逐字相同；编辑器语言下拉切换、单栏、"留空不写入"。
2. `src/shared/rule-pack.ts`：加 `Localized` + `resolveLocalized`；改字段类型、`validateRulePack`、`deriveEffectiveConstitution(+language)`、`createDefaultRulePack` 双语种子。
3. 序列化/解析(`rule-pack-store.ts`)适配；主进程派生/种子调用透传 `settings.language`。
4. renderer：`ConstitutionSettings.tsx` 解析显示；`RuleLibrary.tsx` 改语言下拉 + 单栏编辑(共享 `LocalizedTextInput`)；i18n locales 加编辑器新 chrome 文案。
5. 测试转绿；`npm run typecheck` + `npm run test:run`；dogfood：清/换 `userData`，zh/en 下首启确认默认包按语言显示，编辑器可对照译、留空回退正确。
- 回滚：无破坏性数据迁移；读旧的单语言规则包/工作流时防御性 upcast 为 `{zh:值}`(`migrateRulePackShape`/`migrateWorkflowShape`)，不改写用户文件。

## Open Questions

（均已定）
- 回退值呈现：定为**灰色占位**(真值为空才显示、仅提示、不预填)，避免把回退语言复制进当前语言污染数据；抽成共享组件 `ui/LocalizedTextInput`。
- `project-constitution` 的"生效宪法"未单独补 delta：消费面按语言解析写在 `rule-pack-localization` 新能力里覆盖，`openspec validate` 通过。
