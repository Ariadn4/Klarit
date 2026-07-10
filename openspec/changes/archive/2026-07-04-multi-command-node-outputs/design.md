## Context

引擎已有一套**后台命令**基建(`engine-execution` 的「命令节点的手动推进与后台化」+「命令输出按命令/后台任务分桶缓冲且可回看」):每条后台命令有独立 `bgId`、独立桶(`bg:<bgId>`)、独立中止(`stopBackground`)、可区分终态(stopped/exited/timeout),生命周期为「run 完成/中止即杀、暂停杀进程留可重启记录、关软件按记录重启」。卡详情也已有「后台命令」分格 UI(一进程一格,`CommandOutputView` + 停止/清除)。

两个缺口挡住了「一个节点跑多条命令」:

1. **`command` 执行者只有单条 `command: string`**(`src/shared/types.ts`)——一节点跑不了 2 条前台命令,detach 只能产 1 条后台。
2. **门动作按钮**(`runGateAction`)是弱平行机制:输出 `emit(op-chunk, nodeId)` 无 `bgId` → 全进 `node:<nodeId>` 一桶(夹揉);中止用单槽 `a.actionAbort`(后起覆盖先起 → 只能停最后一个)。

序列化是通用 `YAML.stringify(def)`、读旧包走 `migrateWorkflowShape` —— 故数据模型可干净扩展、旧包自动归一。

## Goals / Non-Goals

**Goals**
- `command` 节点可声明并并发跑**多条命令**,各自前台桶、各自前置检查/超时、各自可 detach/中止。
- 门动作按钮接入后台命令基建:各自 bgId/桶/中止/后台生命周期,按 identity 单例,按钮据进程态在「启动↔中止」切换。
- 「同节点并发多命令各自分桶、各自可中止」升为引擎通用契约。
- 编辑器可编多命令;卡详情前台按命令分格。
- 内置「验收样例」种子覆盖三个面。

**Non-Goals**
- 不改 `command-execution` 运行器。
- 不发明新后台生命周期——多命令 detach 与门动作复用现有后台语义。
- 门动作**不随 `resumeAll` 自动拉起**(用户手动再触发);多命令节点里 detach 到后台的命令沿用后台「暂停恢复重启」语义(它们是节点工作的一部分,与门动作旁路进程不同)。

## Decisions

### 决策 1:`command` 执行者 → `commands: CommandSpec[]`

```ts
interface CommandSpec { label?: string; command: string; check?: string; timeoutSec?: number }
| { kind: 'command'; commands: CommandSpec[] }
```

移除单 `command`/`check`/`timeoutSec`。**迁移**(`migrateNode`):command 执行者若无 `commands` 但有旧 `command`,归一为 `commands: [{ command, check?, timeoutSec? }]`;对新形状幂等。**校验**:`commands` 至少一条,每条 `command` 非空、`check` 若声明非空、`timeoutSec` 若声明为正数。序列化自动写新形状。

### 决策 2:引擎并发跑一个节点的全部命令,各自分桶/检查/超时/detach/中止

`runCommandNode` 为 `commands` 每条起一个并发的 `execCmd`,每条:

```
命令 i → 前台桶 node:<nodeId>:<i>（emit op-chunk 带 cmdIndex=i；桶路由 bgId?bg:bgId : cmdIndex!=null?node:<id>:<i> : node:<id>）
       → 各自 check 前置检查、各自 timeoutSec、各自 detach 到 bg:<bgId>(carry 各自前台输出)、各自 abort
```

**节点完成判定**:全部命令自然退出 0 → 节点 done → 进门把。**任一命令非零/超时** → 杀掉本节点其余仍在跑的命令,抛该命令的失败/超时决策(沿用 `buildCommandFailedDecision`/`buildCommandTimeoutDecision`,带命令标签)。**手动推进**对本节点**尚在跑的全部命令**生效:`detach`=把它们各自转后台(各自 bgId)后推进;`abort`=各自杀掉后推进。单命令节点是其退化(n=1),行为与今日一致。

> `execCmd` 参数化:新增 `cmdIndex` 用于前台桶键与事件;`detach`/`abort` 从「单命令单槽」改为可作用于并发多命令——用 per-command 的 detach resolver 与统一的 `a.abort`(abort 杀全部)。detach 现状是全局 `a.detachResolve` 单槽,需改为「detach 当前节点全部在跑命令」的广播(推进语义是节点级,不是单命令级)。

### 决策 3:门动作按钮登记为后台命令,按 identity 单例

`runGateAction(runId, actionIndex)`:铸 `bgId`、以动作文案为 label **登记进 `background[]`**、`onChunk` 带 `bgId`(进 `bg:<bgId>`)、进程句柄进后台活进程表、**立即返回 `{ bgId }`**(不 await 长驻进程)。中止经既有 `stopBackground(runId, bgId)`。终局清理/关软件杀沿用 `killBackgroundOf`/`killAllBackground`。

动作身份 = `(nodeId, actionIndex)`。后台记录带 `sourceAction?: { nodeId, index }` 与 `manual: true`(不自动拉起)。同一动作已有活进程时再次触发 = 先 `stopBackground` 旧的再起新的。去掉 `a.actionAbort` 单槽;`stopGateAction` 退役或转薄封装 `stopBackground`。

**动作不随开机自动拉起**:恢复流程跳过 `manual: true` 的后台记录(或最简实现:门动作后台记录只活内存、不落持久 `background[]`,关软件即随进程消失,重开为干净空态)。下方 spec 以「不自动拉起」为准,持久与否留实现层。

### 决策 4:通用契约——同节点并发多命令各自分桶、各自可中止

`engine-execution` 显式收敛一句:一个节点同一时刻并发运行的多条命令(前台每命令、后台每 bgId、门动作每 bgId),MUST 各进各自的桶、各持独立中止句柄——任一条输出/中止 MUST NOT 影响另一条。前台多命令、detach 后台命令、门动作都是它的实例。

### 决策 5:UI

- **编辑器**:`command` 节点从单命令输入 → 多命令行列表(预置一行,增删,空行保存剔除,至少一条非空),每行含命令行 + 可选标签/前置检查/超时。
- **卡详情前台**:当前节点为 command 时,按其 `commands` **每条一格** `CommandOutputView`(桶 `node:<nodeId>:<i>`,题=label 或命令),取代单一「当前命令」。
- **决策动作按钮**:`RunDecisionPanel` 每个 action 据其对应进程(按动作身份匹配当前后台列表)运行态在「启动↔中止」切换;各动作进程输出进卡详情既有「后台命令」分格。动作运行态由 `runId` 当前后台列表**派生**,不塞进持久决策。

### 决策 6:内置「验收样例」种子工作流

`createAcceptanceSampleWorkflow(id)`,随 app 出现在工作流库(与 `createDefaultWorkflow` 同注册路径),节点:
- **A 两条前台命令**(短命令,各流几行后退出 0)——验并发前台各自分格、节点自然完成。
- **B 人工评审门 + 两个动作按钮**(如「启动计数器 A/B」跑长驻脚本)——验按钮启动↔中止、各自输出。
- **C 两条后台命令**(两条长驻命令,手动推进 detach)——验各自后台分格、各自中止。

命令用跨平台可跑的最小命令(如 `node -e "..."` 循环打印),不依赖用户装什么。

## Risks / Trade-offs

- **detach 语义从单命令变节点级**:现状 `advanceCommand('detach')` detach 当前单命令;多命令下它 detach 本节点全部在跑命令。语义仍是「节点转后台推进」,一致;但实现要把单槽 resolver 改成节点级广播。
- **失败并发**:多命令并发时一条失败要收掉其余。策略:第一条失败即 abort 本节点其余,抛该失败决策(不做「等全部结束再汇总」——长驻命令不会结束)。
- **决策 `actions` 运行态**:易变活进程态不入持久决策,UI 用当前后台列表按动作身份派生,避免不一致。
- **门动作与多命令 detach 后台在 UI 同区**:都进「后台命令」分格,语义一致(不阻塞运行的旁路/工作进程),label 可区分,可接受。

## Migration

`command` 节点旧单命令包由 `migrateNode` 归一为 `commands[]`(读时),写回即新形状;旧 `.md`/`.yaml` 不需手改。IPC `runGateAction` 返回 `{code,killed,timedOut}` → `{ bgId }`,同步预载与唯一调用方 `RequirementCardDetail`。种子/PR 工作流当前不含 command 节点,无需改;新增验收样例种子。
