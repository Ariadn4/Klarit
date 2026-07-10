## Why

工作流的数据模型已就绪(`shared/workflow.ts`、`shared/types.ts`),但**没有任何东西能跑它**:`git.ts` 只有只读探测(`probeGit`/`listBranches`/`listWorktrees`),`engine` 执行者只是个 `operation` 字符串、无执行器,IPC 全是请求/响应、没有长任务的触发/恢复机制。project-goals.md 已经把运行模型写成了概念(运行断点、失败与中断、决策机制、暂停/恢复),但概念没有可执行的脊柱。

本变更给它**第一根能跑、能取消、能恢复的执行脊柱**,且**只用确定性 git 操作**——不碰 PTY、不拉 agent。这样第一个集成测试就是一条「在临时仓上跑完整 git 生命周期」的 smoke,验证运行模型本身。真正写代码的 `agent`/`command`/`subworkflow` 执行者留给后续 proposal 2/3/4;它们要复用的运行模型与决策回路,在这里立起来。

## What Changes

- **运行模型**:把「一个节点的执行」建成**阶段状态机**(executing → gate 0 → gate 1 → … → done),每个阶段边界写一次**断点**;运行态分 `running` / `waiting-decision` / `paused`;恢复 = 跳回 (节点, 阶段) 重跑当前阶段。运行以 `runId` 标识、断点按运行持久化(需求卡数据模型尚未落地,运行不绑卡)。
- **引擎执行者**:把每个引擎操作建成**幂等的 `ensure-*` 调谐器**(reconcile-by-probe)——先探测 git/fs 实际状态,已达目标即跳过,否则补齐。这让「跑了一半被打断」的恢复变成「重跑即收敛」,无需 WAL。
- **失败四归宿,永不静默卡住,也不滥扰人**:成功 / **自动处理**(瞬时锁重试、环境性缺失跳过)/ **交给 agent 自愈**(技术性失败如冲突——本变更只留口子不实现)/ **人工拍板**(意图/破坏性/凭据类)。人工决策走**统一结构**(背景 + 前进式选项 + 单/多选 + 可选填空如远端地址),**选项一律前进式、无「中止」死结**;决策带 `sourceKind`(本变更恒 `engine`),自填选项由 `agent` 来源派生(引擎处理不了开放答案)。**人工评审门复用同一回路(本变更只上「通过」,打回连同回退基建留后续)**。
- **git.ts 写侧**:新增**异步 git 运行器** + **写侧四件套**(建分支 / 加 worktree / 删 worktree / 删分支)+ 合并 + 推送 + **junction 链接与防御性解链**。解链是一道**防御性扫描**(删 worktree 前无条件扫并解掉任何 reparse point,绝不递归进去),即便用户/AI 越过软件私自建的 junction 也兜得住。
- **引擎操作词表 4 → 8**:拆 `delete-branch-worktree` 为 `remove-worktree` + `delete-branch`,新增 `link-env`(关联环境)、`push-branch`、`delete-remote-branch`;旧 `delete-branch-worktree` 作为**复合别名**仍被识别(向后兼容既有种子包)。分支配对校验随之更新。
- **两个默认工作流**:`本地直合`(…→合并→push main→删 worktree→删本地分支)与 `PR 模式`(…→push 需求分支→人工评审门→合并→push main→删云端分支→删 worktree→删本地分支),前半段共用。两者都用「本地裸仓当 origin」做 hermetic smoke;真正的 `gh pr create/merge` 留作后续 command 节点升级。
- **一次性触发的 IPC**:`engine:start(RunRequest) → {runId}`(触发一次、立即返回)、`pause`/`resume`/`decide`/`getRunState` + `engine:progress` 事件通道;引擎持有运行生命周期,渲染层只触发与观察,关窗不丢运行;开机自动恢复进行中的运行。
- **非引擎执行者本变更内跳过**:`agent`/`command`/`subworkflow` 节点被显式标记为「执行器未落地」并以 no-op 跳过(发进度事件),使含「实现占位」节点的默认工作流仍能端到端跑完。

## Capabilities

### New Capabilities
- `engine-execution`: 工作流的运行引擎——阶段状态机运行模型、运行态与断点恢复、幂等 `ensure-*` 引擎执行器(8 个操作)、失败四归宿与统一前进式决策回路(自动/agent口子/人工拍板,人工门复用)、一次性触发且可取消可恢复的 IPC 契约、非引擎执行者的跳过约定。
- `git-write-operations`: `git.ts` 写侧——异步 git 运行器、写侧四件套(建/删分支、加/删 worktree)、合并(冲突即 abort)、推送(非快进/无远端即结构化失败)、junction 链接与防御性解链(绝不递归进 reparse point),均为可独立测试的纯函数 + 结构化结果。

### Modified Capabilities
- `workflow-definition`: 引擎内置操作集由 4 扩到 8(+ 复合别名),能力声明随新操作扩展;分支配对语义校验改为「`create-branch` 配 `delete-branch`(或复合别名)」;内置默认工作流种子由「一个」改为「两个(本地直合 / PR 模式)」。

## Impact

- **新增代码**:`src/main/engine/`(运行循环、ensure 执行器、运行态持久化、决策路由)、`src/main/git.ts` 写侧 + `src/main/junction.ts`(或并入 git.ts)、`src/main/index.ts` 注册引擎 IPC、`src/preload/index.ts` 暴露引擎 API、`src/shared/types.ts` 增运行态/决策/RunRequest 类型。
- **改动既有**:`src/shared/workflow.ts`(`ENGINE_OPERATIONS` 4→8、`checkBranchPairing` 配对逻辑、`createDefaultWorkflow` → 产出两个默认工作流)、引擎操作能力声明表、`workflow-store`/main 种子(种入两个默认)。
- **复用既有**:只读 `git.ts`(`makeGitRunner`/`probeGit` 等)、`multi-repo-project` 的成员仓上下文、`userData` 存储约定。
- **向后兼容**:`delete-branch-worktree` 仍被识别(复合别名),既有种子包不破;新增能力声明为元数据不入 `workflow.yaml`。
- **不在本变更内**:`agent`/`command`/`subworkflow` 执行器实现、需求卡数据模型绑定、自由输入决策与跨卡升级、真正的 `gh` PR(push/远端合并的 GitHub 集成)、决策的全局 agent 解读。
- **测试**:git 写侧四件套/合并/推送/junction 防御性解链(临时仓 + 本地裸仓);ensure 幂等(重复跑收敛);阶段状态机断点恢复(中途 kill 进程后重启续跑);失败→固定决策路由(冲突/未合并/非快进);两个默认工作流端到端 smoke(含中途关闭重开验证恢复)。
