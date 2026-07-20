## Why

Klarit 要「维护文档」，可现在**根本没有「文档」这个一等概念**——代码里只有「工作流节点跑出来的产物文件」和「rule-pack 的 output-template」，没有任何东西记录**一个既有项目里已经有哪些文档、各是什么脾性、该怎么续写**。于是导入一个真实项目后，Klarit 对它的文档现状一无所知，日后想自动归档只能瞎猜。

用户要的是：**导入项目时扫一遍，把文本文档分成「动态文档」（只记最新现状、可覆写）和「快照文档」（某时刻的冻结记录、只追加），生成一张目录让用户过一遍、手动增删改判**。但真正的价值不在这张分类表本身——它是为**未来一个「归档」引擎节点**服务的：那个节点在任务收尾时，把本次产生的内容按用户的文档习惯各归各位（动态的进动态、快照的进快照）。

而「按用户习惯」这件事，**光靠分类标签远远不够**。`docs/adr/` 存在 ≠ 每个任务都写一条 ADR——有的用户只在重大改动才落 ADR。这个「频率/意图」是读文件读不出来的。所以本 change 的核心产出不是分类表，而是**为每个文档位置起草一段「习惯 prompt」**：LLM 读文档内容样本推断格式习惯（模板、命名、时态），用户在审批时补上读不出来的意图（何时写、写不写）。**审批之所以必须，正因为这段 prompt 一半是「猜的意图」而非「读到的事实」。** 未审批的 prompt 不生效。

这张带习惯 prompt 的登记表，是 per-project 的**单一事实源**；下游的归档节点读它、并（在模型支持时）派多个子 agent 并行处理不同文档。**本 change 只做采集侧**（扫描→分类→坍缩→起草→审批→登记表→UI），归档节点是它 enable 的下一个 change。

## What Changes

- **新增一等概念「文档登记表」（document registry）**：per-project（按成员仓）持久化的 `ManagedDoc[]` + 一段项目级「文档公约」。每条 `ManagedDoc` 是三件套 `{ location, kind: 'dynamic'|'snapshot', habitPrompt, approved }`，文件夹坍缩条目再带 `coversFiles`。
- **扫描 + 启发式分类**：复用现有 `filetree` 的 walker 与 `IGNORED_DIRS`、叠加 `.gitignore`，扫出文本文档候选；按路径/文件名启发式判「动态 / 快照 / 不纳管」。**「不纳管」不是用户可见的第三桶**——用户只见动态、快照两桶，从两桶都移出即隐式落入不纳管、不进表、不占 UI。
- **自底向上文件夹坍缩**：一个文件夹的所有纳管子项同类时，坍缩成一条文件夹级 `ManagedDoc`（带 `coversFiles`）；UI 里**可见、可展开**看它圈了哪些文件。混合类型的文件夹不坍缩，逐项记。
- **习惯 prompt 起草（读内容样本）**：分类后，起草器 **MUST 读文档内容样本**（整文件或文件头 + 文件夹取样若干），为每条 `ManagedDoc` 起草 `habitPrompt`（格式/模板/命名/时态），并起草一段项目级「文档公约」前言（跨文件的通则）。全部初始 `approved=false`。
- **逐条审批**：UI 里一条条审批 habitPrompt（可编辑后再批）+ 审批项目级公约。未审批的 prompt 对下游归档节点不生效。
- **onboarding「左右两栏 + 改判箭头」UI**：导入项目后多一步——两栏（动态 / 快照），行可展开（露 `coversFiles` + habitPrompt 编辑 + 审批），`⇄` 在两栏间改判，`✕` 移出（落隐式不纳管），`+ 添加文件/文件夹`做逆操作（找回移错的 / 纳入没扫到的）。
- **设置里的常驻编辑面板**：`SettingsPanel` 新增一个 `project-documents` section，复用同一编辑器，允许随时手动调整登记表与公约。

## Capabilities

### New Capabilities
- `document-registry`: 文档登记表的**领域模型 + 扫描/分类/坍缩/起草/审批 + 持久化 + IPC**——`ManagedDoc` 三件套、`DocKind`、文件夹坍缩规则、启发式分类、读样本起草 habitPrompt 与项目级公约、per-成员仓持久化为单一事实源。
- `document-registry-ui`: **onboarding 两栏改判编辑器**（动态/快照双栏、行展开露 coversFiles+habitPrompt+审批、`⇄` 改判、`✕` 移出、`+ 添加`逆操作）**与设置常驻面板**（复用同一编辑器）；遵 `docs/brand` 语义令牌、深浅双主题。

### Modified Capabilities
- `settings-panel`: section 导航新增 `project-documents`，挂载文档登记表编辑器（复用 `document-registry-ui`）。

## Impact

- **新代码**：`src/shared/types.ts`（`DocKind`、`ManagedDoc`、`DocRegistry` 及 IPC 载荷类型）、`src/shared/document-registry.ts`（分类启发式、文件夹坍缩、校验/规整——纯函数好测）、`src/main/document-store.ts`（per-成员仓 JSON 持久化，比照 `store.ts`/`card-store.ts`）、`src/main/document-scan.ts`（walker + `.gitignore` + 起草编排，起草读样本 → 拉 agent）、`src/shared/ipc.ts` + `src/main/index.ts` + `src/preload/index.ts`（scan/get/save/redraft 通道）、`src/renderer/src/stores/documents.ts`（zustand）、`src/renderer/src/components/DocumentRegistryEditor.tsx`（两栏编辑器）+ 接入 onboarding 与 `SettingsPanel`。
- **复用**：`filetree.ts` 的 `IGNORED_DIRS`/walker、`project-service.ts` 的导入结果、`ui/ListEditor`/`ExpandableRow`/`Field` 原语、agent 执行侧（起草复用现成 agent 调用路径）。
- **依赖**：起草 habitPrompt 依赖已配置的 agent（Klarit 本就依赖）；无 agent 时**跳过起草**，登记表仍生成（只有分类、无 prompt），UI 提示可稍后补起草。不引入新第三方依赖。
- **兼容**：纯增量。旧项目无登记表——首次进入 onboarding/设置时按需扫描生成；已导入的老项目在设置里手动触发扫描。
- **不在本 change（下游）**：
  - **「归档」引擎节点**——新工作流节点类型，运行时读这张登记表 + 审批过的 habitPrompt，把本次产物各归各位；模型支持时**派多个子 agent 并行**处理不同文档（不支持子 agent 的模型则串行）。它是本 change enable 的下一个 change。
  - 登记表随归档产生**新文档时的自动增量更新** / 习惯**漂移重扫**。
  - 用内容读取做分类（本期分类靠启发式；LLM 只在起草阶段读内容，不做分类兜底——留待需要时再加）。
