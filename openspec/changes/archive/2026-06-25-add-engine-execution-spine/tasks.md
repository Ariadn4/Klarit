## 1. 测试先行(先红)— git 写侧

- [x] 1.1 异步 git 运行器:成功命令返 `{code:0,stdout}`、失败命令返非零 code + stderr 且 Promise 不抛(临时仓)
- [x] 1.2 写侧四件套:建分支(指向基点)、加 worktree、删 worktree(后 `worktree list` 不含它)、删本地分支安全删(已合并成功 / 未合并被拒并带原因)
- [x] 1.3 合并:无冲突成功、冲突即 `--abort` 回干净态并报「冲突」、已合并报「已是最新」
- [x] 1.4 推送:用 `git init --bare` 本地裸仓当 origin——普通推送成功、非快进被拒报「非快进」、删远端分支成功 / 已不在报「已不在」
- [x] 1.5 junction:链接后 `lstat`/`readlink` 探到指向;防御性解链解掉自建与「私自建」junction 且目标内容不变;断言扫描遇 reparse point 不递归进去

## 2. git.ts 写侧 + junction 实现

- [x] 2.1 `src/main/git.ts` 增异步运行器(`execFile`,返结构化结果,不带 signal)与四件套 + 合并 + 推送原语,纯函数式、返结构化结果
- [x] 2.2 junction 链接/防御性解链(`fs.symlink(...,'junction')` + 浅扫 `lstat`,绝不递归进 reparse point)——并入 git.ts 或新建 `src/main/junction.ts`
- [x] 2.3 跑 1.1–1.5 转绿

## 3. 测试先行(先红)— 运行模型与引擎执行器

- [x] 3.1 ensure 幂等:对同一目标连跑两次,第二次探测已达即 no-op、git/fs 状态不变(逐操作)
- [x] 3.2 半成品调谐:被中断留下的失效 worktree 注册被 prune/repair 后补齐;在途 merge(MERGE_HEAD)被 abort 后重做
- [x] 3.3 删分支级联:分支仍被 worktree 检出时,`delete-branch` 先移除该 worktree(含防御性解链)再删分支
- [x] 3.4 阶段状态机断点:跑到某节点某阶段后 kill 进程,重启从 `(节点,阶段)` 续而非重来;门把停在第 k 道则恢复从第 k 道续
- [x] 3.5 失败三归宿:造合并冲突 / 删未合并分支 / 非快进推送,断言抛对应固定选项决策、运行进 `waiting-decision`、含「中止」兜底;`decide` 选项后按语义续跑
- [x] 3.6 人工评审门:执行到人工门进 `waiting-decision` 带动作按钮与通过/打回,选「通过」过门推进
- [x] 3.7 非引擎执行者:含 agent 占位节点的工作流跑到该节点发「跳过」事件并推进、不报错
- [x] 3.8 一次性触发 IPC:`start` 立即返 runId、运行独立存活;关重开后 `getRunState` 可观察;开机扫 `running` 自动续

## 4. 引擎执行器 + 运行模型实现

- [x] 4.1 `src/shared/types.ts` 增类型:`RunRequest`、运行态(`running`/`waiting-decision`/`paused`)、断点(currentNode + phase + pendingDecision)、固定选项决策、progress 事件
- [x] 4.2 `src/main/engine/`:阶段状态机执行循环(executing→gate k→done,阶段边界写断点)、暂停标志在阶段边界生效
- [x] 4.3 ensure-* 调谐器(8 操作)组合 git 写侧原语 + 探测,reconcile 半成品;`delete-branch-worktree` 别名 = remove-worktree + delete-branch
- [x] 4.4 失败三归宿 + 固定选项决策路由(逐操作的预定义选项表,含中止兜底);人工门复用同一回路
- [x] 4.5 运行态持久化到 `userData/engine-runs/<runId>.json`;恢复按断点续;`whenReady` 扫 `running` 自动续
- [x] 4.6 跑 3.1–3.6 转绿

## 5. 词表 + 默认工作流 + 校验

- [x] 5.1 `src/shared/workflow.ts`:`ENGINE_OPERATIONS` 4→8 + 识别复合别名 `delete-branch-worktree`
- [x] 5.2 引擎操作能力声明表扩展:8 操作三能力(仅 `push-branch.supportsGate=true`,余皆否),未知/别名回落正确
- [x] 5.3 `checkBranchPairing`:`create-branch` 配 `delete-branch` 或复合别名 `delete-branch-worktree`
- [x] 5.4 `createDefaultWorkflow` 产出**两个**默认(本地直合 / PR 模式),前半段共用、交付段不同,均过结构校验与分支配对
- [x] 5.5 main 种子改为种入两个默认工作流(`seedIfEmpty` 路径);更新因断言旧单一默认而变脆的既有测试
- [x] 5.6 跑 workflow 相关单测转绿(含能力声明、配对、两默认校验)

## 6. IPC 接线 + 端到端 smoke

- [x] 6.1 `src/main/index.ts` 注册 `engine:start/pause/resume/decide/getRunState` handler + `engine:progress` 事件;`src/preload/index.ts` 暴露引擎 API
- [x] 6.2 端到端 smoke:在临时项目仓(+ 本地裸仓 origin)分别跑「本地直合」与「PR 模式」两个默认工作流到完成,断言各阶段 git/远端/worktree/junction 状态
- [x] 6.3 恢复 smoke:在某节点中途结束运行进程后重启,断言从断点续跑至完成、不重做上游
- [x] 6.4 跑 3.7、3.8 转绿

## 7. 校验与收尾

- [x] 7.1 `npm run typecheck`(node + web 两套)与 `npm run test:run` 全绿
- [x] 7.2 dogfood:`npm start`(不监听源码)在一个临时项目里激活两个默认工作流各跑一遍,中途关软件重开验证自动恢复
- [x] 7.3 确认既有种子包(含 `delete-branch-worktree` 的旧默认)仍能加载、校验、被引擎按别名执行
