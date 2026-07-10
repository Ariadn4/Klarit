## Context

需求卡分类现以封闭枚举 `CardCategory = 'epic' | 'feature' | 'bug'` 表达（`src/shared/types.ts:361`），运行时词表 `CARD_CATEGORIES`（`src/shared/requirement-card.ts:14`）是 UI 徽章与校验的单一来源。这个字段把两件事捆在一起：**呈现语义**（这是个啥）与**流动行为**（`docs/project-goals.md:236-239`：epic 不逐列流动、feature 逐列流动）。用户无法扩出自己的类型。

`docs/project-goals.md` 已把流动规则、看板列、运行断点设计好，但代码侧只落了"静态需求卡 + 关系图 + 状态词表"。`workflow-stage-kanban-columns` 是邻接 change（看板列），它要按"类型→流动原型"决定卡怎么呈现；本 change 负责提供 archetype 这一机制来源。`localize-seed-packs` 在做默认包种子，本 change 的默认类型种子与之同址。

## Goals / Non-Goals

**Goals:**
- 把"流动机制"（容器/子叶两原型）封死在引擎，把"类型语义"（名称/描述/选哪个原型）开放给用户。
- 卡片 `category` 枚举 → `typeId` 引用；校验从封闭表改为"在册集合参数化"，保持纯逻辑无 fs/无 IPC。
- 项目级单一工作流：其 stages = 看板列，所有 leaf 共用流动；类型不带工作流。
- 工作流激活时播种其建议 leaf 类型进项目注册表（类型仍归注册表所有）。
- 分解 skill 由注册表自动生成（拆分模板 + 类型 name/description），可在类型编辑处预览，保留高级覆盖。
- 设置页可增删改查类型。
- 老数据与既有行为零损迁移（默认类型种子 + `category→typeId` 映射）。

**Non-Goals:**
- 不实现看板列的流动呈现本身（归 `workflow-stage-kanban-columns`）；本 change 只产出 archetype 供其消费。
- 不做"每类型一条工作流"（Jira 式按类型分流）——项目单一工作流，类型不带流。
- 不动关系图三种边、状态词表 `CARD_STATUSES`、运行断点。
- 不做类型的跨项目 marketplace/分享（v1 仅本地，导入格式开放留待后续）。
- 不实现候选卡落库（仍止于产出/审阅，落库归其它 change）。

## Decisions

### D1：两原型封闭、写死在引擎；类型语义开放
`CardArchetype = 'container' | 'leaf'` 作为封闭联合，不开放扩展。用户只能定义"挂在某原型上的命名类型"。
- **为什么**：`container` 语义牵动 `parent/child` 的 `3/3` 汇总、父卡归档直达一整套机制（project-goals.md:245）。把原型开放=让数据层改机制，引擎无法兜底。两原型已覆盖真实诉求（容器/流通），bug 只是 leaf 的一个 flavor。
- **取舍 vs 全开放（类型自带任意流动行为）**：放弃，耦合关系图过深、易造出引擎处理不了的组合。

### D2：项目级单一工作流，类型不带工作流；激活时播种类型
看板 = 项目激活的那条工作流的 stages（一套列）；所有 leaf 卡共用它流动，container 不流动。类型只 `{id, name, description, archetype}`，**不带 `defaultWorkflowId`**。工作流定义可声明一组**建议 leaf 类型**（`suggestedTypes`），激活时**播种**进项目类型注册表（幂等、已存在跳过）；播种后类型归注册表所有，停用/换工作流不会让在册卡片成孤儿。`container` 的 `epic` 为内置通用类型，始终可用、不随工作流走。
- **为什么**：① 看板天然是一套列，"激活工作流"在现有设计（project-goals.md:121、分解 spec）本就是项目单数；让每类型各带一条工作流会逼看板按类型分泳道，复杂且无对应需求（bug 在 project-goals 里只是"可选"，未声明走不同流）。② 播种而非"工作流拥有类型"——回应"选工作流就用对应类型"的诉求，同时避开两个硬伤：container 无法住进工作流、停用工作流会孤儿化卡片引用。
- **取舍 vs 每类型一条工作流（Jira 式，曾拟的"甲方案"）**：放弃。灵活但看板复杂度、与单一激活工作流的设计冲突，收益不抵成本；卡片级换流可留作后续能力。
- **取舍 vs 工作流直接拥有类型**：放弃，孤儿引用 + container 无处安放。

### D3：校验改为"在册 typeId 集合参数化"，纯逻辑不读注册表
`validateCandidateCard` / `validateRequirementCard` 增加一个入参（在册 typeId→archetype 的映射或集合），用它判 typeId 在册与 archetype 关系合法性。
- **为什么**：`requirement-card.ts` 的定位是无 fs/无 IPC 主渲染共享纯逻辑（spec `requirement-card-model`）。注册表是有状态数据，必须由调用方（渲染层审阅 / 主进程落库）读出后注入，纯逻辑保持纯。
- **取舍 vs 纯逻辑自己读注册表**：违背纯逻辑定位、不可测，放弃。

### D4：未知 typeId 拒绝 + 进 `CandidateIssue`，不静默回落
外部 AI 经 `submitDecomposedCandidates` 推的候选若 typeId 不在册，标记为 issue（同悬挂关系、空标题待遇），不偷偷改成某默认类型。
- **为什么**：静默回落会掩盖分解 prompt 与类型注册表不同步的真实问题，且悄悄改变用户意图。显式报错让审阅界面能提示、可纠。

### D5：archetype 同时管关系合法性
只有 container 可作 `parent`；leaf 挂子卡非法；container 可嵌套 container。这部分校验同样以"在册集合+archetype"为输入的纯逻辑提供。
- **为什么**：`3/3` 汇总、父卡归档直达都假设"容器才有子卡"。若放任 leaf 挂子卡，这些机制无定义。

### D6：默认类型作为种子，可编辑、不写死
注册表为空时种入 `epic`(container)/`feature`(leaf)/`bug`(leaf)；老卡 `category:'x'` 映射到 `typeId:'x'`。默认类型与自定义类型同等、可改可删。
- **为什么**：开箱即用 + 老数据零损；不强制保留符合 project-goals「不强推默认值」（goals:43）。
- **落点**：与 `localize-seed-packs` 默认包种子同址同机制，复用其落点避免两套种子逻辑。

### D7：类型注册表为**项目级**，存在各项目的 registry 记录里（验收时定）
类型集存 `project.cardTypes`（registry.json，userData、不入 git），与 `activeWorkflowId`/`constitution` 并列、按项目身份关联——与 `getActiveWorkflow`/`getConstitutionGovernance` 同一套 registry-core 读写模式。设置页「需求卡类型」归**项目设置**、按当前绑定项目管理；未绑定项目显示空态。纯增删改/播种逻辑在 `shared/card-type.ts`（`upsert/remove/seed/projectCardTypes`），registry-core 薄封装。
- **为什么**：验收时用户明确要「不同项目不同类型、选工作流时自动播种到对应项目」——必须项目级隔离。最初实现成全局库（单文件）是偏差，已纠正对齐 spec 的「项目类型注册表」。
- **默认种子**：项目 `cardTypes` 未设置时 `getProjectCardTypes` 回落 `DEFAULT_CARD_TYPES`（epic/feature/bug），开箱即用；首次写入（编辑/播种）才落库。

### D8：分解 skill 由注册表自动生成，手写/导入降级为可选覆盖
生效分解 skill = 固定**拆分模板**（怎么拆、输出候选卡结构、slug 规则、保留附件路径）+ 由注册表在册类型 `name+description` 自动生成的**分类段**。解析顺序：高级覆盖 skill（若用户手写/导入）> 自动生成 skill。设置页类型编辑处可**预览**自动生成的完整 skill 文本。
- **为什么**：类型的 `description` 本就是"何时用此类型"的分类知识，"怎么分类"这段从注册表派生即可，无需用户重复维护两处；用户改类型描述就改了分解行为，单一来源。
- **取舍 vs 维持现状（仅注入类型上下文到可手写 skill）**：放弃——会让"分类规则"散在 skill 文本与类型描述两处、易漂移。保留覆盖入口给需要自定义拆分启发式的高级场景，不堵死。

## Risks / Trade-offs

- **[BREAKING：卡字段 `category→typeId`]** → 提供迁移：读旧卡时 `category` 值原样作 typeId（默认种子保证 epic/feature/bug 在册）；迁移函数对新形状幂等（参考 `migrateWorkflowShape` 模式）。
- **[删除被引用类型留下悬挂引用]** → 注册表删除时检查引用，阻止删除或要求改派，返回可读原因（spec 已定）。
- **[分解 prompt 与注册表不同步：LLM 编造不在册 typeId]** → D4 显式 issue，不回落；审阅界面提示用户。
- **[校验签名变更波及所有调用点]** → `validateCandidateCard` 等增参是源码级破坏；需扫描全部调用点（decompose-service、审阅 UI、测试）同步更新；先写测试锁新签名行为（测试先行）。
- **[与 workflow-stage-kanban-columns 的接口竞合]** → 本 change 只暴露 archetype 解析结果，看板列消费它；两 change 通过 archetype 字段解耦，避免互相阻塞。
- **[container 嵌套 container 引入层级深度]** → v1 允许但不做深度上限/环检测之外的特殊处理；归属唯一约束（project-goals.md:245）仍成立，单亲不会成环。
- **[工作流激活播种依赖"项目激活工作流"机制]** → 该机制现有设计已存在（分解 spec 引"激活工作流"）；播种做成激活时的幂等接缝，已存在的 typeId 跳过，不覆盖用户已编辑的类型。
- **[`suggestedTypes` 扩展 WorkflowDefinition]** → 可选字段，旧工作流无此字段照常加载（迁移幂等）；只播种 leaf 类型，container/epic 内置不经播种。

## Migration Plan

1. 模型层：`types.ts` 加 `CardArchetype`、`CardTypeDef`，卡字段 `category: CardCategory` → `typeId: string`；保留旧形状读取的迁移函数。
2. 纯逻辑：`requirement-card.ts` 校验增"在册集合"入参；移除 `CARD_CATEGORIES` 作为卡分类来源（保留或迁为默认种子定义）；加 archetype 关系校验。先写测试锁行为。
3. 存储+IPC：main 侧类型注册表存储（userData）+ 默认种子（与 localize-seed-packs 同址）+ IPC 契约 + preload `KlaritApi`；工作流激活播种 `suggestedTypes` 的幂等接缝。
4. 分解：`decompose-service.ts` 生效 skill 由注册表自动生成（拆分模板 + 类型）+ 覆盖优先；候选校验用注册表，未知 typeId 进 issue；提供"预览生成 skill"的读接口。
5. 设置 UI：SettingsPanel 接入"需求卡类型"区 + 类型管理组件（含分解 skill 预览，参考 RuleLibrary/WorkflowLibrary）+ i18n。
6. 数据迁移：已落库卡 `category→typeId` 原样映射；首启种入默认类型；`WorkflowDefinition` 加可选 `suggestedTypes`（迁移幂等）。
- **回滚**：注册表为空则回落默认种子，行为等同旧三类；卡字段与工作流迁移幂等，可重跑。

## Open Questions

- ~~类型注册表项目级 vs 全局~~ → **已定：项目级**（验收时用户拍板）。存 `project.cardTypes`，工作流声明 `suggestedTypes`、激活时幂等播种进当前项目；设置页「需求卡类型」归项目设置。
- 工作流的「新建需求 prompt」字段：验收时**已从编辑器移除**（分解 skill 现由类型注册表自动生成，该覆盖入口暂不需要）；模型字段 `newRequirementInstruction` 与解析兜底保留，未来需要时再恢复 UI。
- 卡片级是否允许覆盖项目工作流（某张 leaf 卡换一条流）？本 change 不做（项目单一工作流），留作后续能力。
