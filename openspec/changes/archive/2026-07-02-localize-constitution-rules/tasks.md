## 1. 测试先行（先红）

- [x] 1.1 `resolveLocalized` 测试：命中当前语言 / 回退 `en` / 回退仅有的语言 / 逐字段独立（同条 name 命中、text 回退）/ 空表与非法 language 行为
- [x] 1.2 `validateRulePack` 测试：可翻字段至少一种非空语言（无任何语言→拒）、结构字段非空（命令空→拒）、合法包通过
- [x] 1.3 `deriveEffectiveConstitution(packs, governance, language)` 测试：按语言解析出单语言 `{name,text}`、激活并集减关闭项、回退链生效
- [x] 1.4 默认种子测试：`createDefaultRulePack` 产出的可翻字段同含 `zh`/`en`；`zh` 与 `en` 解析下条目数量/顺序/`id`/`kind`/命令逐字相同，仅名称与正文不同
- [x] 1.5 序列化往返测试：含多语言与开放语言键的包 `serialize`→`parse` 等价、无丢失
- [x] 1.6 编辑器测试（renderer）：可翻字段并排渲染各显示语言输入框；某语言留空保存→不写入该语言键；结构字段单输入框

## 2. 共享模型：Localized + resolver

- [x] 2.1 `src/shared/rule-pack.ts`：新增 `type Localized = Record<string,string>` 与纯函数 `resolveLocalized(field, language)`（回退链，`coerceLanguage` 归一）
- [x] 2.2 `RulePackItem`/`RulePack` 可翻字段（包 `name`/`description`、条目 `name`、`constitution-rule.text`、`output-template.content`）由 `string` 改为 `Localized`；结构字段（`id`/`kind`/`objective-check.command`/`ref`/路径）保持单值
- [x] 2.3 `validateRulePack` 改为：可翻字段校验"至少一种非空语言"、结构字段校验非空
- [x] 2.4 `deriveEffectiveConstitution` 增加 `language` 入参，派生时用 `resolveLocalized` 解析出单语言 `EffectiveConstitutionRule{name,text}`
- [x] 2.5 跑 1.1–1.3 转绿

## 3. 默认种子双语化

- [x] 3.1 `createDefaultRulePack` 把宪法规则等可翻字段重写为 `zh`+`en` 双语；`id`/`kind`/命令等结构字段跨语言逐字相同（单一来源）
- [x] 3.2 跑 1.4 转绿

## 4. 持久化与种子透传语言

- [x] 4.1 `src/main/rule-pack-store.ts`：`serializeRulePack`/`parseRulePack` 适配可翻字段为 map 的新形状（YAML 天然往返）；`clone` 逐语言加副本后缀；`importPackage` 仍走 `validateRulePack`（部分翻译/开放语言键的外部包被接受）
- [x] 4.2 `src/main/index.ts`：宪法派生/拼装处 `deriveEffectiveConstitution` 调用透传 `settings.language`（与 `assembleAgentPrompt` 的 `language` 同源）
- [x] 4.3 跑 1.5 转绿；`agent-prompt.ts` 的 `resolveOutputs` 增加 `language` 解析模板内容（`assembleAgentPrompt` 本身消费解析后 `{name,text}`，不变）

## 5. 消费面（设置列表）

- [x] 5.1 `ConstitutionSettings.tsx`：勾选列表用 `resolveLocalized` 按当前 `i18n.language` 解析显示 `pack.name`/`rule.name`

## 6. 编辑面（并排多语言对照）

- [x] 6.1 `RuleLibrary.tsx`：顶栏语言下拉（`EditLanguageSelect`）+ 每个可翻字段**单栏编辑所选语言**（`LocalizedInput`）；语言再多也只占一个下拉、不横向膨胀；结构字段保持单框
- [x] 6.2 语言下拉选项＝软件受支持语言（`SUPPORTED_LANGUAGES`）∪ 包已带的开放语言键；默认按界面语言编辑
- [x] 6.3 写回逻辑：所选语言输入框留空 ⇒ 剔除该语言键（`setLang` 不写空串）；留空时以其它语言回退值作灰色占位（不预填污染）
- [x] 6.4 `i18n/locales/{zh,en}.ts`：新增编辑器自身 chrome 文案（显示语言 / 添加语言等标签）
- [x] 6.5 只用语义令牌（`bg-paper`/`text-ink`/`text-stone-*` 等），深色下不翻车；跑 1.6 转绿

## 7. 校验与收尾

- [x] 7.1 更新因按单字符串断言种子内容而变脆的既有测试（rule-pack / store / agent-prompt / ConstitutionSettings / RuleLibrary / WorkflowEditor 各测试改按语言解析或多语言形状）
- [x] 7.2 `npm run typecheck`（web + node）与 `npm run test:run`（67 文件 708 用例）全绿
- [x] 7.3 dogfood：`npm start` 在 zh / en 下确认默认包/宪法按语言显示、编辑器切语言正确、留空回退正确（多轮 dogfood 已通过验收）

## 9. 编辑体验与健壮性收尾（dogfood 反馈）

- [x] 9.1 编辑器从"并排多栏"改为**顶栏语言下拉 + 单栏**（语言多也不膨胀），抽共享组件 `ui/LocalizedTextInput`；规则库与工作流编辑器共用、去重
- [x] 9.2 修复工作流编辑器把回退值当真值预填的 bug：真值为空时显**灰色占位**、编辑从空开始、不写空串、不污染其它语言
- [x] 9.3 规则包旧格式向后兼容：`migrateRulePackShape` 读入时把旧裸字符串可翻字段 upcast 为 `{zh:值}`（含测试）；与工作流 `migrateWorkflowShape` 对称
- [x] 9.4 顺带：外观下拉选项（深色/浅色/跟随系统）从硬编码改走 i18next（`settingsPanel.appearanceOption.*`），移除 `APPEARANCE_LABELS`
- [x] 9.5 `npm run typecheck` + `npm run test:run` 全绿（67 文件 709 用例）

## 8. 工作流多语言（同一 Localized 机制扩到工作流；范围＝显示文本：工作流名/描述/阶段名/节点名）

- [x] 8.1 抽出中立 `src/shared/localized.ts`（`Localized`/`resolveLocalized`/`hasAnyLanguage`/`setLocalized`），`rule-pack.ts` 改为再导出（避免 types↔rule-pack 循环依赖）
- [x] 8.2 `types.ts`：`WorkflowDefinition.name/description`、`WorkflowStage.name`、`WorkflowNode.name`、`WorkflowSummary.name` 由 `string` 改 `Localized`（inline 提示词/命令/路径/ref/operation 保持单值）
- [x] 8.3 `workflow.ts`：`validateWorkflow` 用 `hasAnyLanguage(def.name)`；两个默认工作流种子 + 阶段/节点名重写为 zh/en 双语；`migrateWorkflowShape` 加防御 upcast（旧裸字符串名 → `{zh:值}`）
- [x] 8.4 `workflow-store.ts` clone 逐语言加副本后缀；引擎 `engine.ts` 加 `language` 依赖、节点显示名 `resolveLocalized` 成单语言标签；`index.ts` 透传 `settings.language`
- [x] 8.5 `board.ts`（阶段列名/runDot 节点名按语言解析）、`WorkflowLibrary`/`WorkflowPicker`（列表名解析）
- [x] 8.6 `WorkflowEditor.tsx`：顶栏语言下拉（复用同款）+ 工作流名/描述/阶段名/节点名单栏编辑所选语言；引用/阶段下拉等只读名按界面语言解析；i18n 加编辑器 chrome 文案
- [x] 8.7 更新工作流相关既有测试为 `Localized` 形状；`npm run typecheck` + `npm run test:run` 全绿（67 文件 708 用例）
