## Context

工作流编辑器（`WorkflowEditor.tsx`）的产出、门把、执行者几处字段「含糊或缺失、引擎无法执行」：

- `WorkflowOutput = { type; format; path?; required }`——`type`/`format` 自由文本、语义重叠。
- `WorkflowGateItem = { kind; description }`——只有一句说明，没有命令、目标、动作按钮。
- engine 执行者的 `operation` 是自由文本框，但引擎内置操作是封闭词表。
- agent 执行者缺 `{工具, 模型, 额外参数}` 执行配置（project-goals 已写明）。

`docs/project-goals.md`「工作流与节点」其实已写明更完整的模型，数据模型与 UI 尚未跟上。本变更把这几处对齐到可执行契约，并借鉴 OpenSpec「用 markdown 模板 + 校验器规定产出格式」的做法。纯逻辑（类型、校验、默认种子）在 `src/shared/`，main 与 renderer 共享、无 fs 依赖；包读写在 `src/main/workflow-store.ts`；产出模板「使用文件」复用既有 skill 包内文件机制（`createSkillFile`/`importSkillFile`/`readSkillFile`）。

## Goals / Non-Goals

**Goals:**
- 产出 = `目的地(v1 仅 file{path}) + 模板(none/inline/file) + 必选`——路径承载标识与文件类型，v1 产出为 markdown（path 须 `.md`）。
- 门把按类型携带可执行字段：自动＝裸命令 + 可选目标；人工＝零或多个动作按钮 `{名称, 命令}`。
- engine 操作改为引擎内置操作集的下拉。
- agent 执行者补 `exec = {工具?, 模型?, 额外参数?}`，**级联两层（全局 < 节点）**，工具/模型下拉读引擎 agent 扫描列表。
- 校验扩展覆盖新字段；旧 `workflow.yaml` 包可控迁移读入。

**Non-Goals:**
- 不实现引擎执行门把命令、不实现基线门把「符合模板」校验（执行引擎后续承接；本变更只落声明与存储）。
- 不开放 markdown 以外的产出文件类型（path 须 `.md`）。
- **不做卡片数据产出（card 目的地）**——需求卡数据模型尚未建立，随其一并做；destination 留判别联合，card 为将来非破坏增量。
- **不做可导入注册器**（产出模板 + 校验 check 的 OpenSpec schema 包式开放导入）——单开规则包层的卡。
- 不做 agent 工具/模型「声明不可用时回退抛决策」的运行期逻辑；不做「工作流默认」级联层（确认只有全局 + 节点两层）。
- 不硬编码工具/模型列表——数据源是引擎「扫描 agent」模块。

## Decisions

### 决策 1：产出——「目的地 + 模板」，path 承载标识与文件类型

```ts
export type OutputTemplate =
  | { kind: 'none' }
  | { kind: 'inline'; text: string }
  | { kind: 'file'; path: string } // 相对包目录，禁绝对/..，文件随包

export type OutputDestination =
  | { kind: 'file'; path: string } // 相对分支目录、禁绝对/..、须 .md
  // 将来：| { kind: 'card'; section: ... }  随需求卡数据模型一并做

export interface WorkflowOutput {
  destination: OutputDestination
  template: OutputTemplate
  required: boolean
}
```

- **砍掉 `name`/`fileFormat`**：file 产出的路径已编码标识（文件名）与类型（扩展名），单列即冗余。基线门把按「必选产出齐全」可用 path 指名缺失。
- **目的地做判别联合**：v1 只 `file`；卡片数据 `card` 暂缺（需求卡数据模型未建，无从指向卡片模块），将来加 kind 是非破坏增量。单变体联合是刻意为之的演进位。
- **`template` 复用 `AgentInstruction` 同构的 inline/file**，UI/存储/校验皆可复用，增 `none` 表「不声明」。

### 决策 2：门把——判别联合，自动＝裸命令+目标，人工＝动作按钮（均无「说明」）

```ts
export interface GateAction { label: string; command: string }

export type WorkflowGateItem =
  | { kind: 'auto'; command: string; targets?: string[] }
  | { kind: 'manual'; actions?: GateAction[] }
```

- **不带 `description`**：auto 的命令、manual 的按钮文案本身即自描述，独立「说明」字段冗余，已去掉。
- `command` v1 为**裸命令字符串**（逃生口形态）；将来可导入注册器落地后再加 `ref` 引用形态，是**纯增量、不破坏**——本变更刻意把裸命令当作「inline 形态」预留这条演进路径。
- `targets` 存产出 **path**（destination 已无 name），校验时按路径匹配本节点产出；为空＝整体检查。
- `actions` 的 `command` 同 command 执行者，裸 CLI、不做路径校验、直接可配置。**UI 切到人工评审即预置一行（文案+命令）输入框**，完全空白的行保存时由 `cleanForSave` 剔除（零按钮合法），半填则校验拦下。

### 决策 3：engine 操作改下拉

`engine` 执行者的 `operation` 取值是引擎内置的封闭词表（`create-branch` / `open-worktree` / `merge-branch` / `delete-branch-worktree` 等）。数据模型仍存字符串标识，但**编辑器渲染为下拉**，选项来自一个导出的内置操作常量（单一来源，供 UI 与将来引擎共用）。校验保持「operation 非空」，下拉天然保证取值合法。

### 决策 4：agent 执行配置

```ts
export interface AgentExecConfig {
  toolId?: string   // adapter id；空=跟随全局
  model?: string    // 空=跟随全局
  extraArgs?: string
}
export type NodeExecutor =
  | { kind: 'agent'; instruction: AgentInstruction; exec?: AgentExecConfig }
  | ... // engine / command / subworkflow 不变
```

- **级联两层：全局设置 < 节点声明**（无「工作流默认」）。字段空＝跟随全局。
- 工具/模型 UI 为下拉，**数据源已接 `window.klarit.scanAgents()`**（`DetectedAgent[]`，本机已检测到的 agent + 各自模型）：`App` 已在拉，经 `SettingsPanel → WorkflowLibrary → WorkflowEditor` 透传。模型下拉**随所选工具联动**（取该 agent 的 `models`），切工具时清掉不属于它的旧模型；换机器/工具没装时仍展示已存值并标「（未检测到）」，不静默丢。列表空时降级为只有「跟随全局」。
- 校验只查「字段为可空字符串」，**不校验工具/模型真实可用**（属引擎运行期）。
- **替代方案**：把工具/模型也做成裸启动命令——否决，project-goals 明令声明式，裸命令仅自定义 adapter 逃生口，后续再说。

### 决策 5：校验扩展（`src/shared/workflow.ts`）

`validateNode` 内追加：产出 `destination.file.path` 合规相对路径且以 `.md` 结尾、`template.file` 路径合规；门把 `auto.command` 非空且 `targets` 每项匹配本节点产出 path、`manual.actions` 每项 `label`/`command` 非空。复用既有 `isSafeRelativePath`/`nonEmpty`；内置 engine 操作导出为常量（`ENGINE_OPERATIONS`），UI 与校验/将来引擎单一来源。

### 决策 6：UI（`WorkflowEditor.tsx`）

- 抽 `ExecutorFields` 里 agent「使用文件」那段为可复用 `PackageFileField`（新建/导入/查看/移除），产出模板与 agent skill 共用。
- `OutputsEditor`：file 路径输入（须 `.md`）+ 模板（`PackageFileField` 的手写/使用文件）+ 必选。
- `GateEditor`：类型下拉后按 kind 分支——auto 渲染命令 + 目标多选（选项来自本节点产出路径）；manual 渲染动作按钮列表（文案+命令+增删），**切到 manual 预置一行**，`cleanForSave` 剔除全空行。**门把无「说明」字段。**
- engine 字段改 `<select>`（内置操作常量）；agent 增 `exec` 区（工具/模型下拉读 `detectedAgents`、模型随工具联动、额外参数文本），仅 `agent` 类型呈现。
- **品牌令牌**：编辑器原先写死 `bg-white` 不随主题翻色，深色模式露白；改为语义令牌（控件 `bg-canvas`、卡片 `bg-paper`，与 `SettingsPanel` 等一致），全项目不再有 `bg-white` 死值。

## Risks / Trade-offs

- **[BREAKING：旧 workflow.yaml 读入]** 旧 `output.{type,format}`、旧门把 `{kind,description}`、无 `exec` 的 agent 与新形状不兼容 → 在 `workflow-store.ts` 反序列化做**形状归一**：有路径的旧产出 → `{ destination:{kind:'file',path}, template:{kind:'none'} }`（旧 `type`/`format` 丢弃，文件类型并入路径），**无路径的旧产出（卡片数据）丢弃**（card 未落地，且旧数据基本为空）；门把缺 `command`→空命令、缺 `actions`→空数组；agent 无 `exec` 保持 undefined（合法）。迁移不强改路径扩展名——非 `.md` 旧路径在保存时才暴露为校验错误，读取不崩。
- **[扫描列表未就绪]** agent 工具/模型下拉数据源还没接 → 降级为只有「跟随全局」一项，字段仍可空保存；接入后无需改数据模型。
- **[抽 `PackageFileField` 触动 agent 既有交互]** → 用既有 `WorkflowEditor.test.tsx` 的 agent skill 用例回归。
- **[targets 引用产出路径，路径改了会悬挂]** → 校验按路径匹配，找不到即报错引导修正；不做自动级联重命名（v1 产出少，不值）。

## Migration Plan

1. 加新类型与校验（先红：补 `workflow.test.ts` 用例）。
2. `workflow-store.ts` 反序列化加旧→新形状归一（库层测试覆盖旧样例读入）。
3. 改 `WorkflowEditor` UI 与测试（含 `PackageFileField` 抽取、engine 下拉、agent exec）。
4. 同步 `docs/project-goals.md`：产出字段描述 + 把 agent 执行配置级联从「全局 < 工作流默认 < 节点」更正为「全局 < 节点」。
5. 回归 `npm run typecheck` + `npm run test:run`。

回滚：变更集中在 4 个源文件 + 反序列化一处，未动外部依赖，直接还原即可；已用新版保存过的包不被旧代码读懂——属正常前向不兼容。

## Open Questions

- 产出将来要不要支持 markdown 以外的文件类型？v1 path 锁 `.md`，放开即放宽校验，非破坏。
- 自动门 `targets` 将来要不要支持「分支状态/测试」等非产出目标（project-goals 提到）？v1 只指向产出 path，其余靠 `command` 表达。
- **统一演进线**：`skill/prompt`、`产出模板`、`客观门校验` 三者现在都用「inline / 包内文件 / 裸命令」兜底；将来的**可导入注册器**（规则包层、OpenSpec schema 包式开放导入）对三者是同一套「注册器引用 / 导入源」增量——skill 走「导入即拷进包」、模板走引用或导入、check 走 `ref`。均非破坏，单开规则包层的卡统一设计。
