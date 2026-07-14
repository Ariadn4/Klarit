## ADDED Requirements

### Requirement: 用户可发起的本卡干预入口

引擎 SHALL 暴露两个**用户可发起的本卡干预入口**，供单需求 agent 的干预提议经确认后调用（触发式、非阻塞，同既有 IPC 契约立即返回 `{ runId }` + `settled`）：

- **`reenter(runId, targetNodeId, 指令)`**：把运行**重入**到目标节点 K 前向修复——复用内容驱动回退的「重入不重置」语义（见 `content-driven-rollback`「确认后重入执行」）：拨 `currentNodeId=K`、`phase=executing`，为 K..N 重锚越界/提交基线、保留会话续接 token，把 `指令` 作为「修复前向」上下文注入 K 的执行者，再 `drive` 前向重流。MUST NOT `git reset`、MUST NOT 撤下游代码/产出。`targetNodeId` 不是本运行的真实节点时 MUST 拒绝、不改动运行。
- **`inject(runId, 指令)`**：把 `指令` 注入**当前执行节点**的执行者会话（设当前节点 `pendingAnswer`），重跑该节点 `executing`（经续接把指令带入），不改变当前节点位置、不回退。当前无可注入的 agent 节点时 MUST 优雅无操作（不报错）。

两入口 MUST 只作用于**该运行（该卡）自身**，MUST NOT 触碰别的运行；破坏性由调用侧（渲染层确认流）把关，引擎侧忠实执行。

#### Scenario: reenter 重入目标节点前向修复

- **WHEN** 以 `reenter(runId, K, 指令)` 发起，K 是本运行真实节点
- **THEN** 引擎拨回 K 并进入 executing、重锚 K..N 基线、把 `指令` 注入 K 的执行者续接、前向重流，不对任何成员仓 `git reset`、下游已产出仍在

#### Scenario: reenter 目标非法被拒

- **WHEN** `reenter` 的 `targetNodeId` 不在本运行节点里
- **THEN** 引擎拒绝、不改动运行态

#### Scenario: inject 注入当前节点重跑

- **WHEN** 以 `inject(runId, 指令)` 发起，当前节点为 agent 执行者
- **THEN** 引擎把 `指令` 设为当前节点 `pendingAnswer`、重跑 executing，经续接把指令带入执行者会话，当前节点位置不变

#### Scenario: 无可注入节点时优雅无操作

- **WHEN** 当前无处于可注入状态的 agent 节点
- **THEN** `inject` 优雅无操作，不报错、不误改断点

### Requirement: 干预一张活跑的运行须先安全挂起

当 `reenter`/`inject` 作用于一张**正在驱动（活跑）**的运行时，引擎 MUST **先安全挂起**再变更断点——复用暂停的阶段边界机制（在阶段边界 abort 前台/后台活进程、保留可重启记录、落 `paused`），挂起后再重锚基线/设注入、再 `drive`。当运行已处于非驱动态（`waiting-decision`/`paused`/等待中）时，MUST 直接变更断点，无需额外挂起。此挂起 MUST NOT 丢失会话续接 token 与后台命令登记（与既有暂停一致）。

#### Scenario: 活跑运行干预前先落边界

- **WHEN** 对一张正在 executing 的运行发起 `reenter`
- **THEN** 引擎先在阶段边界安全挂起（不硬杀中途、保留续接 token 与后台登记），再重入目标节点前向重流

#### Scenario: 已挂起运行直接干预

- **WHEN** 对一张已 `paused`/`waiting-decision` 的运行发起 `reenter`/`inject`
- **THEN** 引擎直接变更断点并驱动，无需再次挂起
