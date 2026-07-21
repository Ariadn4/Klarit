## Context

`add-document-registry`（已落）提供消费对象：per-成员仓的 `DocRegistry`（`document-store`）+ `ManagedDoc{ location, kind, habitPrompt, approved, coversFiles? }` + `conventionPreamble`；`exclude-planning-docs` 保证表里只剩归档目标、无计划稿。本 change 加它的消费者——一个引擎操作节点。

现成同构范式是 `open-pr`（`real-pr-nodes`）：引擎操作集是**封闭集** `ENGINE_OPERATION_SPECS`（`src/shared/workflow.ts`），对外是引擎操作、内部委派 agent；`runEngineOpForMember`（`src/main/engine/engine.ts`）分派；`open-pr` 经委派包装成 agent 节点执行，且 `commitChanges:false`（外部动作不提交）。能力门控已有先例（门按 capability 显隐）。

约束：测试先行；封闭引擎操作集单一来源；多仓各归各仓。

## Goals / Non-Goals

**Goals：**
- 新引擎操作 `archive-docs`：读登记表 + 审批过 prompt，按 kind 路由归档，**产生文档写入并提交**。
- 子 agent 支持时并行处理多文档、否则串行退化，行为等价。
- 缺表/无 agent/未审批/空表的清楚兜底。
- 写工作流 skill 自动带上新操作。

**Non-Goals：**
- 不做登记表模型/UI（那是 `add-document-registry`）、不做计划节点（已定不做）。
- 不做归档回写登记表（新建文档自动增量）——后续。
- 不做归档 dry-run 预览/diff 审阅门——后续增强。
- 不动既有引擎操作与门类语义。

## Decisions

### 决策 1：`archive-docs` 是引擎操作、内部委派 agent——照搬 open-pr 分派，但**提交**

沿 `open-pr` 的「对外引擎操作、内部委派 agent」路径加 `archive-docs` 到 `ENGINE_OPERATION_SPECS`。关键差异：`open-pr` 是外部动作不产生提交（`commitChanges:false`）；**`archive-docs` 写文档文件，MUST 提交这些改动**——它就是要沉淀内容到仓里。故包装委派时保留并提交 worktree 改动。

- **理由**：复用成熟分派与失败路由（`no-agent` 挂起），只在「提交与否」这一点分叉。

### 决策 2：子 agent 并行靠能力探测门控，缺则串行退化

`archive-docs` 执行时探测运行时 agent/模型**是否支持子 agent**（复用现有 capability 门控思路）：支持 → 按 `ManagedDoc` 条目分组、派 N 个子 agent 并行；不支持 → 单 agent 顺次处理全部条目（同一委派指令，串行）。两路**产出语义等价**，仅并发度不同。分组粒度 = 一条 `ManagedDoc`（文件夹坍缩条目算一组）。探测不准时保守走串行。

- **理由**：文档彼此独立、天生可并行；但不能假设所有模型有子 agent，必须有串行退化。

### 决策 3：归档路由由 kind + 审批过 habitPrompt 合成委派指令

委派指令合成器（比照 `open-pr` 的委派）从登记表拼装，交给（子）agent：`dynamic` 条 → 就地更新、只留最新现状；`snapshot` 条 → 按习惯决定是否追加一条冻结记录；外加审批过的项目级公约作前言。**未审批的 habitPrompt/公约不注入**，至多按 kind 兜底。"本次该不该落快照"由 agent 依习惯意图 + 任务上下文判断，引擎 MUST NOT 硬编码频率规则。

- **理由**：习惯是自然语言意图，判断最适合 agent；引擎只负责把审批过的意图喂进去。

### 决策 4：缺表/无 agent/空表的兜底比照 open-pr

无 agent → 失败挂起、决策 `no-agent`（比照 `open-pr`）；无登记表 → 失败挂起、提示先建立文档登记表；空 `docs[]` → noop 过节点（无可归档，不算失败）。

## Flow

```
交付段 archive-docs 节点(每涉及成员仓)
      │
      ▼
document-store.get(memberId)          # 读登记表(来自 add-document-registry)
      │  无表 → 挂起(建表提示) / 空 docs → noop 过
      ▼
探测子 agent 能力
      ├─支持→ 按 ManagedDoc 分组，派 N 子 agent 并行
      └─不支持→ 单 agent 串行 for-each
      │  每(子)agent 收到 kind+审批过 habitPrompt 合成的委派指令
      ▼
agent 就地更新动态文档 / 按习惯追加快照文档
      │  无 agent → 挂起(no-agent)
      ▼
提交文档改动 → 过节点
```

## Risks

- **子 agent 能力探测不准**：误判有子 agent 会失败。缓解——探测保守，不确定即走串行退化。
- **归档 agent 误改动态 / 乱追加快照**：习惯表达不足时。缓解——审批过的习惯才注入；快照默认谨慎、可不写；dry-run 预览门留作后续。
- **多仓并发提交**：各成员仓独立归档提交，隔离在各自 worktree（既有多仓机制已保证）。
