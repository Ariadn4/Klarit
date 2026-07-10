## Why

工作流编辑器里「产出」「门」「执行者」几处字段过于含糊或缺失，用户无法据此声明出可被引擎执行的契约：

- **产出**：`类型`（占位「如 report」）与 `格式`（占位「如 md」）都是自由文本、语义重叠；而**产出路径本就编码了名称与文件类型**（`docs/change/spec.md`——文件名即名称、`.md` 即格式），这两个字段是冗余。真正缺的是「这份 markdown 要长成什么样」——像 OpenSpec 那样用模板规定必需的标题/章节，让基线门把能客观校验「符合格式」。
- **门**：`自动校验` 只有一句说明，没地方填**用什么命令**客观校验、校验**哪个产出**；`人工评审` 也没法声明 project-goals 写明的**动作按钮**。
- **engine 执行者**：操作 spec 是自由文本框（「如 create-branch」），但引擎内置操作是**封闭词表**，本该是下拉。
- **agent 执行者**：project-goals 写明可指定**编程工具与模型**（`{工具, 模型, 额外参数}`），当前数据模型与 UI 完全缺失。

## What Changes

- **产出模型重构**（**BREAKING**：`WorkflowOutput` 重构为「目的地 + 模板」）：
  - 砍掉自由文本 `type`、`format`：产出的**标识与文件类型由路径本身承载**，不再单列 `name`/`fileFormat`。
  - 产出围绕**目的地 `destination`**（可扩展判别联合）表达；**v1 仅 `file` 形态**：`{ kind:'file', path }`，path 为相对分支目录路径、须 `.md`（v1 产出即 markdown）。**卡片数据形态 `card` 暂缓**——需求卡数据模型尚未建立，无从指向卡片哪个模块，待其落地后以新增 kind 增量引入。
  - 保留**模板 `template`**（可选，`none`/`inline`/`file`）：声明产出 markdown 的**结构规范**（必需标题/章节），对齐 OpenSpec，可手写或使用包内文件。
  - `required` 不变。
- **门把模型重构**（**BREAKING**：`WorkflowGateItem` 扩为判别联合）：
  - **自动校验**：新增**校验命令 `command`**（必填，退出码即通过/失败，**裸命令**）与可选**校验目标 `targets`**（指向本节点某些产出路径；不填＝整体检查）。
  - **人工评审**：新增**动作按钮 `actions`**（零或多个 `{名称, 命令}`，**裸命令**，直接可配置）；声明后抛决策时渲染、绑定命令。
- **engine 执行者 → 下拉**：操作 spec 由自由文本改为从**引擎内置操作集**择一的下拉（建分支/开 worktree/合并/删分支+worktree 等）。
- **agent 执行者补执行配置**（**BREAKING**：`agent` 执行者新增可选 `exec`）：
  - 新增 `exec = { 工具?, 模型?, 额外参数? }`，全部可空、**声明式不写裸命令**。
  - **级联两层**：**全局设置 < 节点声明**（无「工作流默认」层）；节点不声明即跟随全局。
  - 工具/模型在 UI 上为**下拉**，选项来自引擎「扫描 agent」模块的真实列表（**不硬编码**），默认项为「跟随全局（不声明）」。
- **校验扩展**：产出 file 路径合规且 `.md`、模板 file 路径合规、自动门命令非空且目标匹配本节点产出路径、动作按钮名称/命令非空。

## Capabilities

### New Capabilities
<!-- 无新增能力：均为既有能力的需求变更。可导入注册器（产出模板 + 校验 check）另起规则包层的卡，不在本变更。 -->

### Modified Capabilities
- `workflow-definition`: 产出、门把、agent 执行配置的数据模型变更，及相应校验规则与包内模板文件存储。
- `workflow-editor`: 产出、门、engine 操作、agent 工具/模型的编辑控件变更。

## Impact

- 代码：`src/shared/types.ts`（`WorkflowOutput`/`WorkflowGateItem`/`NodeExecutor` 的 agent 分支）、`src/shared/workflow.ts`（校验与默认种子）、`src/main/workflow-store.ts`（旧包反序列化迁移）、`src/renderer/src/components/WorkflowEditor.tsx`（`OutputsEditor`/`GateEditor`/`ExecutorFields`）、对应 `*.test.ts(x)`。
- 集成：agent 工具/模型下拉需读「扫描 agent」模块的列表（待该模块就绪后接入；选项为空时优雅降级为「跟随全局」）。
- 持久化：`workflow.yaml` 产出/门把字段重构；模板「使用文件」沿用包内文件存储（与 skill 同机制）。迁移旧包：有路径的旧产出归一为 `file` 目的地、`template` 置 `none`（旧 `type`/`format` 丢弃，文件类型并入路径）；**无路径的旧产出（卡片数据）在 card 形态落地前无法表达，迁移时丢弃**（旧数据基本为空、card 此前也未真正落地）。
- 文档：`docs/project-goals.md`——`产出[]` 字段描述同步为「目的地 + 模板 + 必选」；agent 执行配置级联由「全局 < 工作流默认 < 节点」更正为「**全局 < 节点**」。
- 范围外（单开卡）：**可导入注册器**（产出模板 + 客观门校验 check，OpenSpec schema 包式开放导入），放在规则包层；卡片数据产出（card 目的地）随需求卡数据模型一并做；agent 不可用时回退抛决策属引擎运行期。
- 无新增第三方依赖。
