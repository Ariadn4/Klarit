## Why

运行引擎脊柱(`add-engine-execution-spine`)已建好阶段状态机、幂等 ensure 的 git 执行器、失败四归宿与统一前进式决策、可恢复的 IPC,但**只有 `engine` 节点真跑**;`command` 节点在 `runExecuting` 里被 no-op 跳过,客观门 `evalAutoGate` 是恒 `true` 的桩,人工门的动作按钮无处执行。工作流因此还无法跑测试/构建/校验这类最常见的活,也无法在交付前做客观自检。

`command` 还是脊柱里**第一个「executing 阶段可被中途打断」的执行者**——它把脊柱为长任务预留的「按执行者类型决定可否中断」从设计兑现成代码,顺带补上脊柱在 git 秒级操作下被掩盖的一处 `pause` 竞态。

## What Changes

- **新增可取消的命令运行器**:`spawn` + shell 跑任意 CLI 串,流式捕获 stdout/stderr/退出码,支持**真正取消(杀整棵进程树)**;被取消 ≠ 失败。
- **`command` 节点真正执行**:在节点 worktree 跑命令,async / 可取消 / 可恢复,复用现有阶段状态机与决策回路;替换原 no-op 跳过。
- **重跑护栏 = 可选「前置检查命令」**:`command` 执行者新增可选 `check` 字段(reconcile-by-probe,同引擎 ensure 哲学)——执行前先跑 `check`,已完成(退出 0)则跳过、不重复执行;无 `check` 则默认重跑。让中断恢复直接重跑即安全,**不弹「重跑还是跳过」给用户**。**BREAKING**:无(`check` 为可选、向后兼容)。
- **客观门(auto-gate)落地**:`evalAutoGate` 从桩接成真跑门命令,`inline`(裸命令)与 `ref`(引用规则库 `objective-check` 条目)两种都做;退出码即过/不过,失败走已存在的前进式门决策。
- **人工门动作按钮可执行**:manual gate 的动作按钮点击即在 worktree 跑其命令、流式回显、可停(如「启动 app」=`npm start`),经新 IPC `runGateAction` 触发,不混进前进式决策选项。
- **每条命令可选超时**:命令节点主命令、客观门、门把动作各自可选 `timeoutSec`(全局默认无超时);到点杀进程树并按失败处理(命令/门抛前进式决策,动作仅终止回显超时)。`npm start` 等长驻留空即不超时。
- **流式输出进度事件**:新增 `op-chunk` 进度事件承载增量输出,命令节点 / 客观门 / 动作按钮三处共用。
- **引擎运行模型补强**:`start/resume/decide` 落初始断点后后台驱动、立即返回(长命令不再使 IPC 在关窗时变孤儿);引擎内存持有「活运行登记表」,`pause` 对活运行真杀子进程并在阶段边界落 `paused`,修掉脊柱里 `pause` 写另一副本被 `drive` 覆盖回 `running` 的竞态。
- **编辑器软提示**:工作流编辑器命令输入处提示「非幂等命令建议加前置检查命令」(刻意不拿部署/发布当例子——那类引导用户走引擎操作)。
- **不碰 PTY / agent / subworkflow**:它们仍跳过(留下一个 change)。

## Capabilities

### New Capabilities
- `command-execution`: 可取消的 shell 命令运行器——`spawn` + shell 跑任意命令、流式捕获输出与退出码、取消即杀整棵进程树(`taskkill /T` on Windows、进程组 kill on POSIX),纯函数式 + 结构化结果、可独立测;与 `git-write-operations` 并列,供引擎命令节点 / 客观门 / 门动作按钮共用。

### Modified Capabilities
- `engine-execution`: `command` 节点从「跳过」改为「真正执行」(含前置检查跳过、非零退出的人工前进式兜底决策、`executing` 阶段可被中途打断);客观门从桩改为真跑命令(inline + ref);人工门动作按钮经新 IPC 执行;新增流式 `op-chunk` 事件;`start/resume/decide` 非阻塞化 + 内存活运行登记 + `pause` 真杀子进程。
- `workflow-definition`: `command` 执行者新增可选 `check`(前置检查命令)字段;命令节点主命令、客观门项、门把动作各新增可选 `timeoutSec`(正数);均向后兼容、含结构校验(check 声明则非空、timeoutSec 声明则正数),不破坏读写往返。
- `workflow-editor`: `command` 节点设置块新增「前置检查命令」输入与「非幂等命令建议加前置检查」软提示;主命令/客观门/动作各加可选「超时(秒)」输入。

## Impact

- **新增**:`src/main/command-run.ts`(+ 测试)——可取消命令运行器。
- **改 main**:`src/main/engine/engine.ts`(活运行登记、非阻塞 start/resume/decide、`pause` 杀子进程、command 执行 + 前置检查、`evalAutoGate` 真跑、`op-chunk` 发射)、`engine/decisions.ts`(命令失败决策、auto-gate 富化)、`index.ts` + `preload`(注册 `runGateAction`、转发 `op-chunk`、注入 rulePacks 解析依赖)。
- **改 shared**:`src/shared/types.ts`(`NodeExecutor` 的 command 加 `check?`+`timeoutSec?`、auto 门项加 `timeoutSec?`、`GateAction` 加 `timeoutSec?`、`EngineProgressEvent` 加 `op-chunk`、`EngineDecision` 加 `actions?`、`KlaritApi` 加 `runGateAction`)。
- **改 renderer**:`DogfoodRunCard.tsx`(动作按钮 + 流式输出回显 + 停止)、工作流编辑器命令节点设置(check 输入 + 软提示)、`i18n/locales/{zh,en}.ts`(`engineDecision` 新键 + 编辑器软提示,zh/en 同键)。
- **依赖**:不引第三方依赖(进程树 kill 内联实现)。
- **Non-Goals**:不强制 command 的 `writableScope`(diff-revert 属 agent 越界自愈,future)、不校验 outputs 齐全(基线门 future)、不实现 PTY / agent / subworkflow。
