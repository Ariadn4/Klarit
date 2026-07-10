## 1. 测试先行(先红)

- [x] 1.1 `command-run.test.ts`:成功命令(code=0+stdout)、非零退出(code≠0+stderr 不抛)、流式 `onChunk` 增量回调、cancel 杀整棵进程树(自起子进程的脚本 + abort 后断言子孙皆灭、`killed=true`)、永不退出命令可被取消
- [x] 1.2 `engine.test.ts`:command 节点执行成功推进、cwd=worktreePath;前置检查(check 退 0→跳过主命令、check 退非零→跑主命令、无 check→直接跑、恢复时 check 收敛不重复)
- [x] 1.3 `engine.test.ts`:command 非零退出抛 `commandFailed` 前进式决策(retry/skip)、不自动重试、被 kill 不抛决策;`decide` 按选项续跑
- [x] 1.4 `engine.test.ts`:auto-gate 真跑——inline 命令过/不过路由、ref 解析规则库 objective-check 后跑、ref 条目缺失按缺失上报不崩
- [x] 1.5 `engine.test.ts`:`pause` 即时杀在跑命令并落 paused(不被 drive 覆盖回 running)、`resume` 续跑;`start` 非阻塞立即返回 + 后台驱动经事件推进
- [x] 1.6 `engine.test.ts`:`runGateAction` 跑动作命令 + 流式 op-chunk + 可停,且不推进运行(仍停在 manual gate)
- [x] 1.7 workflow 校验测试:command 的 `check` 声明则非空、未声明照常合法、空 check 被拒;`timeoutSec` 声明则正数、非正数/非数值被拒、未声明合法
- [x] 1.8 `engine.test.ts`:命令/客观门超时即杀进程树并抛对应前进式决策(命令超时/检查超时)、不落 paused;未声明超时的长驻命令不被超时
- [x] 1.9 确认以上全部先红(对应实现尚未写)

## 2. 可取消命令运行器(command-execution)

- [x] 2.1 新建 `src/main/command-run.ts`:`runCommand(command,{cwd,signal,onChunk})=>Promise<{code,stdout,stderr,killed}>`,`spawn`+shell+流式累积、永不抛
- [x] 2.2 进程树 kill:Windows `taskkill /pid <pid> /T /F`、POSIX `detached`+进程组 `kill(-pid)`(SIGTERM 超时升 SIGKILL),`killed` 标记
- [x] 2.3 跑 1.1 转绿

## 3. 共享类型与 IPC 契约

- [x] 3.1 `shared/types.ts`:`NodeExecutor` 的 command 加 `check?: string` + `timeoutSec?: number`;auto 门项加 `timeoutSec?: number`;`GateAction` 加 `timeoutSec?: number`
- [x] 3.2 `shared/types.ts`:`EngineProgressEvent` 加 `op-chunk`(runId/nodeId/stream/chunk);`op-output` 退化为终态摘要(含 code)
- [x] 3.3 `shared/types.ts`:`EngineDecision` 加可选 `actions?: {label,index}[]`;`KlaritApi` 加 `runGateAction(runId,actionIndex)`
- [x] 3.4 `npm run typecheck` 过(含下游消费方编译)

## 4. 引擎运行模型补强

- [x] 4.1 引擎内存「活运行登记表」`Map<runId,{abort,paused}>`;`start/resume/decide` 改返回 `{ runId, settled: Promise<RunBreakpoint> }`——后台驱动、`settled` 在 park(done/waiting-decision/paused/aborted)时 resolve
- [x] 4.2 `pause` 对活运行 `abort.abort()`+置 `paused`;`drive` 循环在阶段边界检查 `paused` 即落盘退出,消除覆盖竞态
- [x] 4.3 IPC(main/index.ts):`engineStart/Resume/Decide` 只取 `runId`、回当前断点(`getRunState`),绝不 await `settled`;`KlaritApi` 形态不变(仍回 RunBreakpoint=初始断点)
- [x] 4.4 迁移既有测试:`engine.test.ts`(~26 处)+`smoke.test.ts`(3 处)的 `await engine.start()/decide()/resume()` 改到 `settled`/await-park 模式,确认全绿
- [x] 4.5 跑 1.5 转绿

## 5. 命令节点执行 + 前置检查 + 失败决策

- [x] 5.1 `runExecuting` 接 command:取 `active[runId].abort.signal` 透传 `runCommand`,cwd=worktreePath(回落 repoPath),发 op-chunk/op-output
- [x] 5.2 前置检查护栏:有 `check` 先跑→退 0 则 no-op 跳过主命令、退非零才跑;无 check 直接跑
- [x] 5.3 被 kill(killed&&paused)不抛决策、phase 维持 executing;非零退出走 `commandFailed` 决策(decisions.ts 新增)、不自动重试
- [x] 5.4 主命令超时:到 `timeoutSec` 即取消(杀树)并走「命令超时」前进式决策(`commandTimeout`)、不落 paused
- [x] 5.5 `agent`/`subworkflow` 仍跳过(只移除 command 的跳过分支)
- [x] 5.6 跑 1.2 / 1.3 / 1.8(命令超时部分)转绿

## 6. 客观门真跑(inline + ref)

- [x] 6.1 `evalAutoGate` 改真跑:返回 `{pass,code,output,timedOut}`;inline 跑裸命令,ref 经注入的 rulePacks 解析 objective-check 条目命令再跑;cwd=worktreePath、走可取消 runner;门项 `timeoutSec` 到点杀树
- [x] 6.2 `buildAutoGateDecision` 富化 `{command,code}` 参 + raw 输出;超时走「检查超时」决策(`gateTimeout`);ref 缺失按缺失上报
- [x] 6.3 引擎依赖注入 `getObjectiveCheckCommand(ref)`(复用 previewAgentNodePrompt 解析先例)
- [x] 6.4 跑 1.4 / 1.8(检查超时部分)转绿

## 7. 人工门动作按钮 + IPC 接线

- [x] 7.1 `buildManualGateDecision` 携带 `actions:[{label,index}]`(命令留主进程)
- [x] 7.2 引擎 `runGateAction(runId,actionIndex)`:取当前 manual gate 第 index 个 action 命令、worktree 下跑、流式 op-chunk、独立 abort 句柄可停;动作 `timeoutSec` 到点终止并回显「已超时」(不抛运行级决策)
- [x] 7.3 `main/index.ts`+`preload`:注册 `runGateAction`、转发 `op-chunk`、给 engine 注入 rulePacks 解析依赖
- [x] 7.4 跑 1.6 转绿

## 8. 工作流校验

- [x] 8.1 命令 `check` 校验:声明则非空(对齐 inline gate 命令约束),未声明合法
- [x] 8.2 `timeoutSec` 校验:命令节点主命令/客观门项/动作的 `timeoutSec` 声明则须正数,非正数/非数值被拒,未声明合法
- [x] 8.3 跑 1.7 转绿

## 9. 渲染层与 i18n

- [x] 9.1 `DogfoodRunCard.tsx`:渲染 manual gate 动作按钮(触发 runGateAction)、累积 op-chunk 流式回显区、动作「停止」按钮
- [x] 9.2 工作流编辑器:command 节点加「前置检查命令」输入 + 软提示(不拿部署/发布作例);主命令/客观门/动作各加可选「超时(秒)」输入
- [x] 9.3 `locales/{zh,en}.ts`:`engineDecision` 新键(commandFailed 含 {command,code}、commandTimeout、gateTimeout、auto-gate 富化、动作/输出 chrome)+ 编辑器前置检查软提示 + 超时输入文案,zh/en 同键

## 11. 命令节点手动推进 + 后台化（决策 11）

- [x] 11.1 测试先行:`engine-command.test.ts` detach→转后台(listBackground/stopBackground/killAllBackground)、abort→杀+推进、跳过门把
- [x] 11.2 `command-run.ts` 加 `onStart(handle:{kill})` 暴露杀句柄
- [x] 11.3 引擎:`Active` 加 `advance/detachResolve/background`;`execCmd` 支持 detach(Promise.race);`runCommandNode` 返回 `advance`;drive 命令分支处理 advance(跳过门把)
- [x] 11.4 引擎方法 `advanceCommand/listBackground/stopBackground/killAllBackground`;`background` 进度事件
- [x] 11.5 IPC + preload + app before-quit 杀后台;types `KlaritApi` 增三方法 + `EngineProgressEvent` 加 background
- [x] 11.6 渲染层:命令执行中两控件、后台命令面板(列出+中止)、store backgrounds + App 接 background 事件
- [x] 11.7 跑 11.1 转绿

## 12. 客观门失败按原因+节点类型分流 + 可读原因（决策 12）

- [x] 12.1 测试先行:命令/引擎节点门报错→立即交用户(不重跑)、超时→只重跑门 3 次升级、超时抖动收敛、reason 带检查输出不显示退出码、decide rerun-node/skip
- [x] 12.2 types:`GateAttempt`、`EngineDecision.gateHistory`+`reason`、`RunBreakpoint.gateLog`、`gate-retry` 事件
- [x] 12.3 引擎 gate 分支:报错按节点类型分流(engine/command→立即交用户;agent/subworkflow→重跑节点占位)、超时→重跑门(MAX_GATE_RETRY=3)、计数持久化、通过清零、`buildGateDecision`(reason=检查输出)
- [x] 12.4 `decide` 加 `rerun-node` + 门决策清该门 log
- [x] 12.5 i18n:gateFailed/gateEscalated/optRerunGate/optRerunNode/gateReason/gateHistory{Error,Timeout}(zh+en,去退出码);commandFailed 去退出码;渲染层展示 reason + gateHistory
- [x] 12.6 跑 12.1 转绿

## 10. 验收

- [x] 10.1 `npm run typecheck` + `npm run test:run` 全绿
- [x] 10.2 dogfood `npm start`(不监听源码)在 f:\klarit-dogfood\app:跑带 command 节点 + inline auto-gate 的工作流,通过/失败/前置检查跳过决策均验过
- [x] 10.3 dogfood 验收:命令成功/失败决策、auto 门失败可读原因、人工门动作流式回显+停止、长命令转后台/中止并完成流程、暂停=一切静止+恢复重启后台、后台超时自动收尾——均验过
- [ ] 10.4 `/opsx:archive`:增量 spec 同步进主 specs(command-execution 新建、engine-execution / workflow-definition / workflow-editor 合并)
