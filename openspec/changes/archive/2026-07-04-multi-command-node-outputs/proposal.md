## Why

一个需求节点在验收/联调时常要**同时跑多条命令**——启动后端 + 启动前端、跑两个联调脚本。现有模型撑不住这个:

- **`command` 节点只有单条 `command: string`**:一个节点跑不了 2 条前台命令,detach 也只能产 1 条后台命令。
- **人工门动作按钮**虽支持多个 `actions[]`,但它们**共用一个前台桶、一个中止句柄**:输出全塞进 `node:<nodeId>` 一个桶(UI「当前命令」里**夹揉**),`actionAbort` 单槽被后起的动作覆盖(只能停最后一个、前一个进程泄漏),且没有「按钮身份」——重复点就重复 spawn。

用户要的很简单:**同一个节点里并发跑的多条命令,输出各自分开、各自可中止;门动作按钮点完「启动」就地变「中止」。** 覆盖三个面:①一个节点多条前台命令 ②一个节点多个门按钮 ③一个节点多条后台命令(前台命令 detach 而来)。

## What Changes

- **`command` 节点支持多条命令**:执行者从单 `command` 改为 `commands: CommandSpec[]`(每条 `{label?, command, check?, timeoutSec?}`)。引擎**并发**跑一个节点的全部命令,**各自一个前台桶**(`node:<nodeId>:<i>`)、各自前置检查与超时、各自可**单独 detach 到后台 / 单独中止**。节点在**全部命令自然退出 0**时完成;**手动推进**(detach/abort)对该节点**尚在跑的全部命令**生效。旧单命令包由迁移自动归一,序列化写新形状。
- **门动作按钮接入后台命令基建**:动作触发的命令**注册为该运行的一条后台命令**(各自 `bgId`/桶/中止/后台生命周期),按动作 identity 单例(重复触发=先停后起);去掉 `actionAbort` 单槽。动作生命周期取后台语义(run 终局杀、关软件杀),但**不随开机自动拉起**(用户手动再触发)。
- **输出分桶通用契约**:同节点并发的多条命令(前台每命令、后台每 bgId、门动作每 bgId)MUST 各进各桶、各持独立中止句柄,任一条输出/中止不影响另一条。
- **编辑器可编多命令**:`command` 节点详情从「一条命令」改为**一条以上命令行列表**(各含可选标签/前置检查/超时),预置一行、可增删、空行保存时剔除、至少一条非空。
- **卡详情按命令分格**:前台展示该节点**每条命令各一格**输出(以标签/命令为题);门动作按钮据其进程运行态在**启动 ↔ 中止**切换、各自输出接后台分格视图;不再往「当前命令」里混。
- **内置「验收样例」种子工作流**:随 app 出现在工作流库,含①2 条前台命令的节点 ②2 个门按钮的人工评审节点 ③2 条 detach 到后台的命令节点,供 dogfood 验收本能力。

## Capabilities

### Modified Capabilities
- `workflow-definition`: `command` 执行者由单 `command`(+`check`/`timeoutSec`)改为 `commands: CommandSpec[]`(至少一条,每条命令行非空、可选前置检查非空、可选超时正数);旧单命令形状迁移归一。
- `workflow-editor`: `command` 节点编辑由单命令输入改为**多命令行列表**(预置一行、可增删、空行剔除、至少一条非空),每条各有可选标签/前置检查/超时输入。
- `engine-execution`: `command` 节点**并发**跑其 `commands` 全部命令,各自前台桶(`node:<nodeId>:<i>`)、各自前置检查/超时/detach/中止;节点在全部命令退出 0 时完成,手动推进对尚在跑的全部命令生效。人工门动作按钮触发的命令**注册进后台命令登记**(各自 bgId/桶/中止/后台生命周期),按动作 identity 单例;动作输出不再进前台节点桶;新增「同节点并发多命令各自分桶且可独立中止」通用契约。
- `requirement-card-detail`: 前台命令输出按**每条命令各一格**分流展示;单卡决策里动作按钮据对应进程运行态在**启动 ↔ 中止**切换、各自输出接后台分格视图,不再汇入「当前命令」。

## Impact

- **共享类型**:`src/shared/types.ts` 的 `command` 执行者(新增 `CommandSpec`、`commands[]`,移除单 `command`/`check`/`timeoutSec`);`runGateAction` 返回改为 `{ bgId }`;`op-chunk` 事件加可选 `cmdIndex`。
- **共享逻辑**:`src/shared/workflow.ts` 的 `validateExecutor`(command 多命令校验)、`migrateNode`(单命令→`commands[]`)、默认/PR 种子若含 command 节点同步;新增「验收样例」种子构造。
- **主进程**:`src/main/engine/engine.ts` 的 `runCommandNode`(并发多命令 + 各自桶/检查/超时/detach/abort)、`execCmd`(参数化前台桶键)、`emit` 桶路由(按 `cmdIndex`)、`runGateAction`(登记后台、返回 bgId、单例)、去 `actionAbort` 单槽;`workflow-store` 序列化自动跟随。
- **渲染层**:`WorkflowEditor`(多命令列表编辑)、`RequirementCardDetail`(每命令分格 + 动作接后台分格)、`RunDecisionPanel`(动作按钮启动/中止切换态)。
- **测试**:workflow 校验/迁移、引擎多命令并发分桶/各自 detach/各自中止/门动作后台化、编辑器多命令、卡详情分格。
- **不动**:`command-execution` 运行器;后台命令既有暂停/恢复/超时语义(动作与多命令 detach 复用之)。
