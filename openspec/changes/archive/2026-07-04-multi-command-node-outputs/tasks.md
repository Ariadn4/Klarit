## 1. 数据模型:command 执行者多命令(测试先行)

- [x] 1.1 `src/shared/types.ts`:新增 `CommandSpec`,`command` 执行者改为 `commands: CommandSpec[]`(移除单 `command`/`check`/`timeoutSec`)
- [x] 1.2 校验测试(先红):`commands` 空→非法;每条命令行非空、`check` 若声明非空、`timeoutSec` 若声明正数
- [x] 1.3 迁移测试:旧 `{command, check?, timeoutSec?}` → `commands:[{...}]`;新形状幂等
- [x] 1.4 实现 `validateExecutor` command 分支 + `migrateNode` 归一;全绿

## 2. 引擎:节点并发多命令(测试先行)

- [x] 2.1 契约测试(先红):一个节点两条命令并发跑,各进 `node:<id>:0` / `node:<id>:1` 桶,读一桶不含另一桶
- [x] 2.2 测试:全部命令退出 0 → 节点 done 进门把;某条非零/超时 → 杀其余、抛带命令标签的失败/超时决策
- [x] 2.3 测试:`advanceCommand('detach')` 把本节点尚在跑的全部命令各自转后台(各自 bgId、carry 各自前台输出);`'abort'` 各自杀掉后推进
- [x] 2.4 测试:单命令节点(n=1)行为与旧一致(回归)
- [x] 2.5 实现 `execCmd`(参数化 `cmdIndex`/前台桶键)、`emit` 桶路由按 `cmdIndex`、`runCommandNode` 并发编排、detach 广播到节点级;全绿

## 3. 引擎:门动作接后台基建(测试先行)

- [x] 3.1 测试:`runGateAction` 铸 bgId、登记后台、`onChunk` 带 bgId(进 `bg:<bgId>`)、返回 `{ bgId }`
- [x] 3.2 测试:两个动作各自桶、各自可中止(`stopBackground`),停一个不影响另一个,无孤儿
- [x] 3.3 测试:同一动作重复触发=先停后起(不叠 spawn);run 终局杀全部动作进程;关软件后不自动拉起
- [x] 3.4 实现 `runGateAction`(登记后台 + 单例)、`stopGateAction` 转 `stopBackground`、去 `actionAbort` 单槽;全绿

## 4. 共享类型 + IPC

- [x] 4.1 `runGateAction` 返回 `{ bgId }`;`op-chunk` 加可选 `cmdIndex`;preload/IPC 同步
- [x] 4.2 唯一调用方对齐返回签名

## 5. 编辑器:多命令列表(测试先行)

- [x] 5.1 组件测试(先红):command 节点呈现多命令行列表,预置一行,可增删,空行保存剔除,至少一条非空;每行有命令行 + 可选标签/前置检查/超时
- [x] 5.2 实现 `WorkflowEditor` command 节点编辑;i18n 键补齐;全绿

## 6. 卡详情:前台按命令分格 + 动作切换态(测试先行)

- [x] 6.1 组件测试(先红):当前 command 节点按 `commands` 每条一格输出(桶 `node:<id>:<i>`,题=label/命令),不再单一「当前命令」
- [x] 6.2 组件测试:`RunDecisionPanel` 动作按钮据进程运行态渲染「启动↔中止」;两个动作进程各自一格接后台分格,互不混
- [x] 6.3 实现 `RequirementCardDetail` + `RunDecisionPanel`;动作运行态由当前后台列表按动作身份派生;全绿

## 7. 内置验收样例种子工作流

- [x] 7.1 `createAcceptanceSampleWorkflow(id)`:①2 条前台命令节点 ②2 个门按钮人工评审节点 ③2 条 detach 后台命令节点(命令用 `node -e` 循环等跨平台最小命令)
- [x] 7.2 随 app 注册进工作流库(同默认种子路径);构造测试

## 8. 收尾

- [x] 8.1 `npm run typecheck` + `npm run test:run` 全绿
- [x] 8.2 dogfood 手测(`npm start`):跑验收样例,三节点各自输出分开、各自可中止,门按钮启动↔中止;run 完成后进程被收（已在应用里验收通过）
- [x] 8.3 `openspec validate multi-command-node-outputs --strict` 通过
