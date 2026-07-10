## Why

需求卡的分类现在写死成 `epic | feature | bug` 三选一封闭枚举（`CardCategory`），分类语义（"这是个啥"）和流动行为（epic 不逐列流动、feature 逐列流动）被塞进同一个字段，用户无法按自己的方法论扩出 `spike`、`chore`、`技术债` 等类型。我们要把"流动机制"留在引擎、把"类型语义"开放给用户，让分解 skill 按用户定义的类型给卡分类、引擎按类型背后的原型解析流动。

## What Changes

- **新增「需求卡类型」可自定义机制**：引擎内置两种封闭的*流动原型*（archetype）——`container`（容器，不逐列流动，停"待办"列当子卡入口，子卡全归档后从"待办"直达"归档"）与 `leaf`（子叶/流通单位，逐列流动）。这两种机制写死在引擎、不开放。
- **用户可定义 N 个 `CardTypeDef`**：`{ id, name(显示名/徽章), description, archetype }`。`description` 是给分解 skill 的 AI 分类指令（非 UI 提示）。**类型不带工作流**——一个项目激活**单一工作流**，其 stages 即看板列，所有 `leaf` 卡共用它流动；`container` 不流动。
- **类型为项目级**：每个项目有自己的一份类型集，存在该项目的注册表记录（`project.cardTypes`，与 `activeWorkflowId`/`constitution` 并列），项目间隔离；未设置时回落默认种子。设置页「需求卡类型」归**项目设置**、管理当前绑定项目。
- **工作流声明建议类型 + 激活播种**：工作流定义可声明一组**建议类型**（`container`/`leaf` 皆可）；项目激活该工作流时把这些类型幂等播种进**该项目**类型集（已存在跳过、停用不删、不孤儿）。内置默认工作流自带默认类型（epic/feature/bug）。
- **BREAKING**：需求卡的 `category: CardCategory` 字段改为 `typeId: string`，引用一个 `CardTypeDef`。校验从"在封闭表 `CARD_CATEGORIES` 内"改为"`typeId` 在项目类型注册表内在册"——纯逻辑 `requirement-card.ts` 把"在册 typeId 集合（含 archetype）"作为参数传入；外部 AI 经 `submitDecomposedCandidates` 推的候选若用了不在册类型，拒绝并进 `CandidateIssue`（同悬挂关系待遇），不静默回落。
- **默认类型作为种子预置**：`epic→container`、`feature→leaf`、`bug→leaf`；老数据 `category:'x'` 平滑映射为 `typeId:'x'`（默认种子保证三者在册、不孤儿）。
- **archetype 同时管关系合法性**：只有 `container` 能挂子卡（`parent/child` 的 `3/3` 汇总、父卡归档直达建立在"容器才有子卡"上）；给 `leaf` 卡挂子卡非法、进校验。容器可嵌套容器（大目标拆中目标，v1 允许），`leaf` 永远是叶子。
- **分解 skill 由类型注册表自动生成**：生效分解 skill = 固定**拆分模板**（怎么拆/输出结构）+ 注册表在册类型的 `name + description`（自动生成的分类段）。用户主要通过**编辑类型描述**来影响分解分类；高级用户仍可**手写/导入一份覆盖 skill** 兜底。候选卡 `typeId` 不在册时进 `CandidateIssue`、不静默回落。
- **设置页新增「需求卡类型」设置区**：可查看/新增/编辑/删除自定义类型（设置 `name`、`description`、`archetype`），并能**预览由注册表自动生成的分解 skill**；遵循品牌规范、对齐现有规则库/工作流库设置区结构。
- **不动的部分**：关系图三种边（`parent/child`、`blocked_by/blocks`、`coupled_with`）、状态词表 `CARD_STATUSES`、运行断点——本次只动 `category→typeId` 这一刀。

## Capabilities

### New Capabilities
- `card-type-registry`: 需求卡类型的可自定义机制——`CardTypeDef` 模型、两种封闭流动原型（container/leaf）、类型注册表的增删改查与持久化、默认类型种子、工作流激活播种类型、设置页的类型管理 UI 与自动生成分解 skill 的预览。

### Modified Capabilities
- `requirement-card-model`: 卡片 `category` 枚举字段改为 `typeId` 引用；校验由封闭词表改为"在册 typeId"参数化校验；archetype 驱动的关系合法性（仅 container 可挂子卡）；老数据 `category→typeId` 映射。
- `requirement-decomposition`: 生效分解 skill 由"固定拆分模板 + 注册表类型"自动生成（手写/导入降级为可选覆盖）；候选 `typeId` 不在册时进 `CandidateIssue`。
- `workflow-definition`: 工作流定义可声明一组**建议类型**（`suggestedTypes`，container/leaf 皆可），供激活时播种进项目类型集；内置默认工作流自带默认类型。

## Impact

- **代码**：
  - `src/shared/types.ts`（`CardCategory:361`、`CandidateCard`/`RequirementCard` 模型 `379-399` → 引入 `CardTypeDef`、`CardArchetype`，卡字段 `category→typeId`；`WorkflowDefinition` 加可选 `suggestedTypes`）。
  - `src/shared/requirement-card.ts`（`CARD_CATEGORIES:14`、`validateCandidateCard`/`validateRequirementCard` 改为接受在册 typeId 集合+archetype、archetype 关系校验）。
  - `src/main/decompose-service.ts`（生效分解 skill 由项目类型集自动生成 + 可选覆盖；候选按项目类型集校验）。
  - **项目级类型存储**：`project.cardTypes`（registry）+ `registry-core` 读写/播种（`getProjectCardTypes`/`setProjectCardTypes`/`seedProjectCardTypes`）；纯增删改/播种逻辑在 `shared/card-type.ts`（`upsert/remove/seed/projectCardTypes`）。IPC（`ipc.ts`、`preload/index.ts`、`KlaritApi`）按当前项目读写；工作流激活播种接缝在 `setActiveWorkflow`。
  - 设置页组件（`SettingsPanel.tsx` 项目设置组接入新区，`CardTypeLibrary.tsx` 含分解 skill 预览子页、`CardColorPicker.tsx` 选色器）；`WorkflowEditor.tsx` 加「建议类型」绑定区（移除旧「新建需求 prompt」字段）。
  - 标签色板令牌（`index.css` 的 `--color-tag-*`，与品牌/语义色分离）+ `cardTypeColors.ts`（渲染层 class 映射）。
  - i18n 文案（`i18n/locales/zh.ts` / `en.ts`）。
- **数据迁移**：已落库需求卡的 `category` 字段（`migrateCardTypeId`）；项目未设置类型集时回落默认种子；`WorkflowDefinition` 加可选 `suggestedTypes`（迁移幂等）。
- **关联变更**：`workflow-stage-kanban-columns`（看板列）= 项目激活工作流的 stages，所有 leaf 共用；本 change 提供 archetype，看板按其决定卡片流不流。
