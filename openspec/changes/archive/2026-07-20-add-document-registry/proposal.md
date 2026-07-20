## Why

Klarit 要「维护文档」，可现在**根本没有「文档」这个一等概念**——代码里只有「工作流节点跑出来的产物文件」和「rule-pack 的 output-template」，没有任何东西记录**一个既有项目里已经有哪些文档、各是什么脾性、该怎么续写**。于是导入一个真实项目后，Klarit 对它的文档现状一无所知，日后想自动归档只能瞎猜。

用户要的是：**导入项目时扫一遍，把文本文档分成「动态文档」（只记最新现状、可覆写）和「快照文档」（某时刻的冻结记录、只追加），生成一张目录让用户过一遍、手动增删改判**。但真正的价值不在这张分类表本身——它是为**未来一个「归档」引擎节点**服务的：那个节点在任务收尾时，把本次产生的内容按用户的文档习惯各归各位（动态的进动态、快照的进快照）。

而「按用户习惯」这件事，**光靠分类标签远远不够**。`docs/adr/` 存在 ≠ 每个任务都写一条 ADR——有的用户只在重大改动才落 ADR。这个「频率/意图」是读文件读不出来的。所以本 change 的核心产出不是分类表，而是**为每个文档位置起草一段「习惯 prompt」**：LLM 读文档内容样本推断格式习惯（模板、命名、时态），用户在确认保存前补上读不出来的意图（何时写、写不写）。**审批（=确认并保存）之所以必须，正因为这段 prompt 一半是「猜的意图」而非「读到的事实」。** 未审批的 prompt 不生效。

这张带习惯 prompt 的登记表，是 per-project 的**单一事实源**；下游的归档节点读它、并（在模型支持时）派多个子 agent 并行处理不同文档。**本 change 只做采集侧**（扫描→分类→坍缩→起草→审批→登记表→UI），归档节点是它 enable 的下一个 change。

## What Changes

- **新增一等概念「文档登记表」（document registry）**：per-project（按成员仓）持久化的 `ManagedDoc[]` + 一段项目级「文档公约」。每条 `ManagedDoc` 是三件套 `{ location, kind: 'dynamic'|'snapshot', habitPrompt, approved }`，文件夹坍缩条目再带 `coversFiles`。
- **候选扫描 + agent 语义分析**：walker（`IGNORED_DIRS` + `.gitignore` 叠加，跳软链/点目录）收候选清单；有 agent 时把清单+内容样本一次交给 agent，按**「是否是一类」**分组+分类+起草一体产出条目（跨类文件夹拆开、互异草稿逐文件列），产出经规整校验（幻觉丢弃、前缀圈 `coversFiles`）；无 agent / 失败回落词表启发式+同类坍缩兜底并如实报因。**「不纳管」不是用户可见的第三桶**——用户只见动态、快照两桶，从两桶都移出即隐式落入不纳管、不进表、不占 UI。
- **习惯 prompt 起草（读内容样本）**：起草是 agent 分析的一部分——据样本推断格式类习惯（模板/命名/时态）写入各条 `habitPrompt`，并起草项目级「文档公约」前言；只写正向要求与示例。全部初始 `approved=false`。
- **审批 = 确认并保存**：不设逐条审批开关——「确认并保存」把整表（各条 + 公约）置为已审批并落盘；「跳过」按未审批状态保存。保存后再编辑某条 prompt/路径/公约会把该项打回草稿。未审批的 prompt 对下游归档节点不生效。
- **onboarding「左右两栏 + 改判箭头」UI**：导入项目后多一步（分析完成后**统一推出**，期间只显示加载指示）——两栏（动态 / 快照），行可展开（露覆盖计数 + 可编辑路径 + habitPrompt 编辑），`⇄` 在两栏间改判，`✕` 移出（落隐式不纳管），`+ 添加文件/文件夹`做逆操作（找回移错的 / 纳入没扫到的）。
- **设置里的常驻编辑面板**：`SettingsPanel` 新增一个 `project-documents` section，复用同一编辑器，允许随时手动调整登记表与公约。

## Capabilities

### New Capabilities
- `document-registry`: 文档登记表的**领域模型 + 候选扫描/agent 语义分析（分组+分类+起草一体，启发式兜底）/审批 + 持久化 + IPC**——`ManagedDoc` 三件套、`DocKind`、按「是否是一类」组织条目、读样本起草 habitPrompt 与项目级公约、per-成员仓持久化为单一事实源。
- `document-registry-ui`: **onboarding 两栏改判编辑器**（动态/快照双栏、分析完成统一推出、行展开露覆盖计数+可编辑路径+habitPrompt、`⇄` 改判、`✕` 移出、`+ 添加`逆操作、确认并保存即整表审批）**与设置常驻面板**（复用同一编辑器）；遵 `docs/brand` 语义令牌、深浅双主题。

### Modified Capabilities
- `settings-panel`: section 导航新增 `project-documents`，挂载文档登记表编辑器（复用 `document-registry-ui`）。

## Impact

- **新代码**：`src/shared/types.ts`（`DocKind`、`ManagedDoc`、`DocRegistry` 及 IPC 载荷类型）、`src/shared/document-registry.ts`（启发式分类兜底、同类坍缩、校验/规整——纯函数好测）、`src/main/document-store.ts`（per-成员仓 JSON 持久化，比照 `store.ts`/`card-store.ts`）、`src/main/document-scan.ts`（walker + `.gitignore` + `analyzeDocuments` agent 语义分析编排）、`src/shared/ipc.ts` + `src/main/index.ts` + `src/preload/index.ts`（`documents:analyze/get/save` 通道 + `documents:onboard`/`projects:changed` 推送）、`src/renderer/src/stores/documents.ts`（zustand）、`src/renderer/src/components/DocumentRegistryEditor.tsx`（两栏编辑器）+ `DocumentOnboardingDialog`/`DocumentRegistrySettings` 接入 onboarding 与 `SettingsPanel`。
- **复用**：`filetree.ts` 的 `IGNORED_DIRS`/walker、`project-service.ts` 的导入结果、`ui/ListEditor`/`ExpandableRow`/`Field` 原语、agent 执行侧（起草复用现成 agent 调用路径）。
- **依赖**：语义分析/起草依赖已配置的 agent（Klarit 本就依赖）；无 agent 时回落**启发式兜底**，登记表仍生成（只有分类、无 prompt），UI 如实提示、配好后可「重新扫描」交给 agent。新增第三方依赖 `ignore`（.gitignore 解析）。
- **兼容**：纯增量。旧项目无登记表——首次进入 onboarding/设置时按需扫描生成；已导入的老项目在设置里手动触发扫描。
- **不在本 change（下游）**：
  - **「归档」引擎节点**——新工作流节点类型，运行时读这张登记表 + 审批过的 habitPrompt，把本次产物各归各位；模型支持时**派多个子 agent 并行**处理不同文档（不支持子 agent 的模型则串行）。它是本 change enable 的下一个 change。
  - 登记表随归档产生**新文档时的自动增量更新** / 习惯**漂移重扫**。
  - 启发式分类的持续调优（它已降级为无 agent 兜底；主路径是 agent 读清单+样本做语义分组分类）。
