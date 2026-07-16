## ADDED Requirements

### Requirement: 用户中止运行到终局（abort）

引擎 SHALL 提供一个 **`abort(runId)`** 原语，把一个未完成的运行**中止到 `aborted` 终局**：杀掉前台在跑命令、杀掉全部后台活进程并**清空后台记录**（不为重启保留）、把断点 `state` 落为 `aborted` 并持久化。`abort` 与 `pause` 的区别在于——`pause` 为可恢复而保留后台记录并落 `paused`，`abort` 落**终态**且不保留。对**已终局**（`done`/`aborted`）的运行，`abort` MUST 幂等：原样返回其断点、不重复拆除；对**未知 runId** MUST 返回 `null`、不抛异常。`abort` 供「删卡级联中止」调用（见 `requirement-card-detail`），使删除一张仍在运行/暂停的卡时不留孤儿运行与后台进程。

#### Scenario: 中止停在门上的运行

- **WHEN** 对一个停在人工门（`waiting-decision`）的运行调 `abort`
- **THEN** 运行落 `aborted` 终局，后台进程被杀、记录清空，`getRunState` 读到 `aborted`

#### Scenario: 中止暂停中的运行

- **WHEN** 对一个已 `paused` 的运行调 `abort`
- **THEN** 运行落 `aborted` 终局

#### Scenario: 对已终局/未知运行幂等

- **WHEN** 对一个已 `done` 的运行、或一个未知 `runId` 调 `abort`
- **THEN** 已 `done` 者原样返回其断点、不改动；未知 `runId` 返回 `null`、不抛异常
