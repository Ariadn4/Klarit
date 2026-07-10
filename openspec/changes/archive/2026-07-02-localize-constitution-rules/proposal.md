## Why

规则包里"用户会读到的文本"(包名/描述、宪法规则名与正文等)现在是**硬编码单语言**(中文)，存在 userData 的 `rule-pack.yaml`、可编辑、可外部导入。界面语言偏好(`settings.language`)已就绪，但切到英文后，宪法设置面里看到的仍是一整套中文——内容没跟上界面。规则包又能被外部作者制作并导入，所以多语言必须**长在规则包数据里**，而不是塞进 app 的 i18n 文案表。

## What Changes

- 规则包里**面向用户的文本字段**从单一字符串改为**逐字段语言表**(`Localized` = `{语言码: 字符串}`)：可选、可只填一种、可部分翻译。**BREAKING**(持久化的 `rule-pack.yaml` 字段形状改变；无破坏性迁移——读旧的单语言包时防御性 upcast 为 `{zh:值}`，不改写用户文件)。
- 新增**回退解析**：按当前界面语言解析每个字段，命中不到回退英语、再回退到"仅有的那个语言"——只要某字段有任意一种语言就不会显示为空。
- **可翻 vs 不可翻**有硬边界：自由文本(名称/描述/正文/提示词/模板内容)可多语言；标识符/命令/路径/引用(`id`/`operation`/`command`/`path`/`ref` 等)**永远单值**，跨语言逐字相同。
- **消费面单语言**：宪法设置勾选列表与注入 AI prompt 的"生效宪法"按当前语言解析出一种语言。
- **编辑面语言下拉、单栏**：规则库/工作流编辑器顶栏一个语言下拉(软件受支持语言 ∪ 包已带的开放键)，选中哪个就单栏编辑哪个语言，语言再多也只占一个下拉、不膨胀；真值为空时显其它语言的**灰色占位**(仅提示、不预填)，某语言留空＝不写入该语言键。输入行为抽成共享组件 `ui/LocalizedTextInput`，两个编辑器共用。
- 默认规则包种子重写为 **zh + en 双语**。语言键**开放**(zh/en/fr… 任意)，但界面可切语言仍只 zh/en。
- **工作流也纳入**(同一 `Localized` 机制)：工作流的**显示文本**——工作流名/描述、阶段名(看板列)、节点名——同样改 `Localized`、按语言解析、编辑器用同款语言下拉；节点 inline 提示词/命令/路径/`operation`/`ref` 等**保持单值**(喂 AI 或结构标识，不翻)。`Localized` 原语抽到中立 `src/shared/localized.ts` 供规则包与工作流共用。
- i18next 继续承载 app 外壳静态文案，与本机制**两层共存**、同吃 `settings.language`。

## Capabilities

### New Capabilities
- `rule-pack-localization`: 规则包内容的多语言模型与解析——`Localized` 逐字段语言表、可翻/不可翻字段边界、开放语言键、回退链(当前语言→英语→仅有的)、消费面单语言解析、编辑面并排对照编辑与"留空不写入"。

### Modified Capabilities
- `rule-pack-model`: 规则包条目与包元数据里的可翻字段(`name`/`description`/`text`/模板 `content` 等)由单字符串改为 `Localized`；`validateRulePack` 按新形状校验(每个可翻字段至少一种非空语言)；`deriveEffectiveConstitution` 新增语言入参、按回退链解析出单语言的生效宪法；内置默认规则包种子改为 zh/en 双语且标识符跨语言逐字相同。
- `rule-pack-library`: 规则包编辑器改为**顶栏语言下拉 + 单栏编辑所选语言**(语言再多也只占一个下拉、不横向膨胀)；命令/路径等不可翻字段仍单输入框。
- `workflow-definition`: 工作流显示文本字段(工作流名/描述、阶段名、节点名)由单字符串改为 `Localized`；`validateWorkflow` 按新形状校验；两个内置默认工作流种子改为 zh/en 双语(结构字段跨语言逐字相同)；`migrateWorkflowShape` 对旧裸字符串名做 upcast(`{zh:值}`)。
- `workflow-editor`: 工作流编辑器顶栏加语言下拉、单栏编辑所选语言的显示文本(真值+灰色占位、留空不写键)，复用共享 `LocalizedTextInput`；只读引用按界面语言解析。

## Impact

- **改动代码**：
  - `src/shared/rule-pack.ts`：新增 `Localized` 类型 + `resolveLocalized` 纯函数(回退链)；`RulePackItem`/`RulePack` 可翻字段改 `Localized`；`validateRulePack`；`deriveEffectiveConstitution(+language)`；`createDefaultRulePack` 双语种子。
  - `src/shared/agent-prompt.ts`：消费已解析的 `{name,text}`，基本不动(确认语言透传)。
  - `src/main/index.ts` + `src/main/rule-pack-store.ts`：宪法派生/种子调用透传 `settings.language`；`parseRulePack` 经 `migrateRulePackShape` 归一旧格式(裸字符串 upcast)。
  - `src/renderer/.../ConstitutionSettings.tsx`：勾选列表按当前语言解析显示 `pack.name`/`rule.name`。
  - `src/renderer/.../ui/LocalizedTextInput.tsx`：新增共享单栏语言输入组件(真值+灰色占位)，规则库与工作流编辑器共用。
  - `src/renderer/.../RuleLibrary.tsx`：编辑器改为顶栏语言下拉 + 单栏编辑所选语言(用共享组件)。
  - `src/renderer/.../i18n/locales/{zh,en}.ts`：新增编辑器 chrome 文案(编辑语言等)；顺带把外观下拉选项(深色/浅色/跟随系统)从硬编码改为走 i18next(`settingsPanel.appearanceOption.*`)。
  - **工作流多语言**：抽出中立 `src/shared/localized.ts`(`Localized`/`resolveLocalized`/`hasAnyLanguage`/`setLocalized`)，`rule-pack.ts` 再导出；`src/shared/types.ts`(工作流显示文本字段改 `Localized`)、`src/shared/workflow.ts`(校验 + 双语种子 + 旧格式 upcast)、`src/main/workflow-store.ts`(clone)、`src/main/engine/engine.ts`(+`language` 依赖、节点名解析成标签)、`src/main/index.ts`(透传语言)、`src/renderer/.../lib/board.ts`(阶段/节点名按语言解析)、`WorkflowEditor.tsx`/`WorkflowLibrary.tsx`/`WorkflowPicker.tsx`。
- **复用既有**：`src/shared/language.ts`(`SupportedLanguage`/`coerceLanguage`)、`settings.language`。
- **不改动**：IPC 包管理契约的语义、命令/路径/标识符/inline 提示词的单值约束；**无数据迁移**(无老数据；旧单语言定义读入时防御性 upcast)。
