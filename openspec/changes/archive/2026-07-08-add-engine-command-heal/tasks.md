# Tasks

> 约定:**测试先行**(先写测试、确认先红后绿,针对公共 API);用**假 heal agent**(注入假 `runAgent` + 假 `readHandshake`,同 B2)不依赖真 CLI;每组做完 `npm run typecheck` + `npm run test:run` 全绿。

## 1. 类型先行(先红)

- [x] 1.1 `src/shared/types.ts`:加 `RunBreakpoint.healRuns?: Record<string, AgentNodeRun>`(键 `${nodeId}:${memberId}`,命令退化 `${nodeId}`);为 agent 运行记录加字段(`AgentNodeRun.prompt` 供观测,SHA/尝试次数已有)
- [x] 1.2 `src/main/git-write.ts`:`mergeBranch` 签名加可选 `{ leaveConflict?: boolean }`(与下组行为一并落地)
- [x] 1.3 跑 typecheck 确认类型接线通过、既有测试不被破坏

## 2. git 写侧:mergeBranch 保留冲突态模式

- [x] 2.1 `git-write.test.ts`:补测试——默认模式冲突仍即时 abort 回干净态(既有行为不变);`leaveConflict` 模式冲突**不 abort**、`MERGE_HEAD` 存活、报 `conflict`
- [x] 2.2 实现 `mergeBranch` 的 `leaveConflict` 分支(冲突时跳过 `merge --abort`),默认路径不动
- [x] 2.3 确认先红后绿(git-write 15/15 通过,typecheck 全绿)

## 3. heal prompt 拼装(纯函数)

- [x] 3.1 测试:合并冲突版 / 命令失败版 / 处置版 heal 任务段——公共输入复用 `assembleAgentPrompt`、仅替换 `# 任务` 段;含要点;确定可复现
- [x] 3.2 实现 heal 任务段拼装(`healMergeTask`/`healCommandTask`/`healDispositionTask` 于 `agent-prompt.ts`,复用公共输入)
- [x] 3.3 确认先红后绿(agent-prompt 32/32 通过)

## 4. heal 编排:合并冲突(首战一)

- [x] 4.1 契约测试(假 heal agent):合并回主线冲突 → 在卡工作区把主线并进卡分支(leaveConflict)→ 假 heal 把冲突文件写成解决态(不提交)→ 引擎校验无残留冲突标记 → `scopeGuard` 提交成合并提交 → 卡分支快进合回主线 → `is-ancestor` 确认收敛
- [x] 4.2 契约测试:合并 heal **超限** → 引擎重置卡分支回并主线前 + abort 在途合并(卡分支干净)→ 回落**原样** `mergeConflict`「放弃合并,跳过该节点」决策(计数=3)
- [x] 4.3 契约测试:**逐仓** heal——两成员仓仅一个冲突,只对冲突仓拉 heal(healRuns 仅 web 键)、另一仓直接干净合并推进
- [x] 4.4 实现:`engine.ts:runEngineOp/runEngineOpForMember` 逐仓 heal 子流程(`healMergeMember`:并主线→leaveConflict→拉 heal→校验无残留标记→scopeGuard 提交→快进合回→确认);超限复位回干净态回落既有决策
- [x] 4.5 确认先红后绿(engine-heal 契约测试通过)

## 5. heal 编排:命令失败 + 命令节点客观门失败(首战二)

- [x] 5.1 契约测试(假 heal agent):命令主命令非零 → 拉 heal 改代码 → 引擎提交 → 重跑该命令退 0 → 收敛推进(计数清零);**超限** → 回落原样 `commandFailed`
- [x] 5.2 实现覆盖:命令节点**客观门**报错走同一 `healCommand`(重跑那道门验证);引擎节点门报错**不** heal(直接人工);命令/门**超时不** heal(既有 timeout 决策)
- [x] 5.3 实现:`engine.ts` 命令主命令非零(`runCommandNode`)、命令节点门报错(gate 段)在抛人工前插入 `healCommand`;路由判别仅这两类 + 合并冲突
- [x] 5.4 确认先红后绿

## 6. heal 计数与持久化

- [x] 6.1 契约测试:heal 计数按 `(节点,成员仓)`(`merge:<memberId>`/命令 `<nodeId>`)累计、复用上限(3);超限计数=3;收敛后清零(=0)
- [x] 6.2 实现:`RunBreakpoint.healRuns` 读写断点、每次尝试 `store.save` 落盘、恢复沿用(循环从持久化 attempts 续)、通过清零
- [x] 6.3 确认先红后绿

## 7. 决策自由输入 + 转交 AI 路由

- [x] 7.1 测试:`decisions.ts` **除人工评审门外**各构造器统一附自由输入(`freeInput`);**人工评审门不带**;push 无远端仍用专用远端地址填空。渲染层 `RunDecisionPanel` 据 `input` 自动渲染/不渲染
- [x] 7.2 测试:`engine.decide` 含自由文本——**有当前 agent** 经续接注入;**无当前 agent**(engine 失败)**新起读写处置 agent**(runAgent.start 被调用);heal agent 提问经 `heal:<key>` 注入回该 heal
- [x] 7.3 实现:决策构造(除人工评审门)统一带自由输入;`healDispositionTask` 处置 prompt;`decide` 路由——heal 答复注入 heal / agent 注入当前 agent / 远端地址配远端 / 其余新起 `runDispositionAgent`;`RunDecisionPanel` 自由输入框(既有)
- [x] 7.4 确认先红后绿

## 8. 观测:全量留痕 + prompt 随输出可见

- [x] 8.1 实现+测试:每次 agent/heal 运行把**完整 prompt** 记入断点(`agentRuns[nodeId].prompt` / `healRuns[key].prompt`);会话转写、握手、归宿、SHA、尝试次数已随断点持久化;关软件重开可查(memory/file store 同源)
- [x] 8.2 实现:`RequirementCardDetail` agent 活动框加「查看喂给 AI 的完整 prompt」折叠块(读 `agentRuns[nodeId].prompt`),i18n `board.viewPrompt`
- [x] 8.3 实现:prompt 随运行记录持久化 + 渲染层展示
- [x] 8.4 确认先红后绿(heal 测试断言 `healRuns[key].prompt`;typecheck 全绿)

## 9. 收尾:全绿 + 验收工作流 + 测试项目

- [x] 9.1 `npm run typecheck` + `npm run test:run` 全绿(80 文件 / 820 用例)
- [x] 9.2 测试项目 + 9.3 验收工作流 + 覆盖矩阵:落成 `acceptance.md`(可复制的建仓脚本 + 工作流节点序列 + 逐条覆盖清单)
- [x] 9.4 dogfood(真机 + 真 claude)验收通过:命令失败自愈成功(claude 改 feature.txt→重跑过);合并冲突自愈成功(claude 在卡分支解冲突、**保留两侧意图**、引擎提交合回主线);失败路径(断网 claude 连不上)回落人工、决策原因带「AI 尝试 3 次 + 真实报错」
- [x] 9.5 dogfood 暴露并修掉:①合并冲突判定改用 `ls-files -u`(未合并条目、语言无关),不再被空/本地化输出误判为 error;②回落决策原因带上「AI 尝试次数 + 每次失败原因(agent 输出尾部)」;③需求卡注入只保留描述、用 `'''` 框住、空字段不漏占位;④决策面板「原因」框移到选项之前
- [x] 9.6 `/opsx:archive` 同步增量 spec 到主 spec + 归档
