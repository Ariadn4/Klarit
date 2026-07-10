## 1. 类型与共享(无 fs/IPC)

- [x] 1.1 `src/shared/types.ts`:新增 `StoredCard extends RequirementCard`,带 `projectId: string`、`repos: string[]`、`activeRunId?: string`(管理字段归 store 层,`RequirementCard` 纯模型与 `requirement-card.ts` 校验契约不动)
- [x] 1.2 `src/shared/types.ts`:`RunRequest` 加 `cardId?: string`;`RunBreakpoint` 加 `nodePath?: string[]`(`cardId` 随 `request` 进断点,引擎 `derive` 透传)
- [x] 1.3 `npm run typecheck` 两套 config 通过(字段新增不破坏既有读写)

## 2. 看板派生纯逻辑(先红后绿,针对公共 API)

- [x] 2.1 写测试:`nodeToStage(workflow)` —— 由激活工作流定义建 `nodeId → stageId` 索引(含节点不存在/无阶段的回落)
- [x] 2.2 写测试:`cardColumn(card, workflow, opts)` —— container 停待办/子卡全归档进已完成;leaf 未开始或无运行→待办、已完成→已完成、其余→当前节点阶段列;currentNodeId 不可映射→回落待办;列与状态正交
- [x] 2.3 写测试:`runDot(breakpoint, workflow)` —— waiting-decision→静止红;gate→呼吸黄(检查中);executing 按 executor.kind:engine/command→呼吸蓝、agent→呼吸紫(留口分支断言);done/无运行/paused→null;nodeLabel 取 nodePath 末项
- [x] 2.4 在 `src/renderer/src/lib/board.ts` 实现 2.1–2.3 纯函数,转绿(只用现有工作流定义,不新存运行态)

## 3. 需求卡 store(主进程,先红后绿)

- [x] 3.1 写测试:card store CRUD —— 一卡一文件 `userData/cards/<projectId>/<slug>.json`、按项目列出/按 id 取单/更新/删除、损坏文件容错跳过、同项目预取名唯一(内存+文件双后端契约)
- [x] 3.2 写测试:关系双向落地 —— 写 parent 落对侧 child、blocked_by↔blocks、coupled_with 自反;删卡清理悬挂边
- [x] 3.3 写测试:落库前经 `requirement-card-model` 纯校验(注入项目在册 typeId/archetype),非法拒绝并回可读原因
- [x] 3.4 写测试:统一创建接缝 `create(input)` —— 逐张 `newRequirementCard`+校验+落库+关系双向;一批含非法项时合法落库、非法回报不静默丢
- [x] 3.5 实现 `src/main/card-store.ts`(`createCardStore`/`createMemoryCardStore`,仿 `run-store.ts` 布局),转绿 3.1–3.4

## 4. 从卡派生运行 + 双向链(主进程,先红后绿)

- [x] 4.1 写测试 + 实现:`deriveRunRequest(card, project)`(`src/main/card-run.ts`)—— branch=slug、repoPath=repos[0](解析成员仓 rootPath)、workflowId=项目激活工作流、cardId=卡 id;多仓只取首仓;repos 空/无激活工作流/首仓不在项目→回可读原因不派生。引擎 `derive` 已透传 cardId(组 1.2)
- [x] 4.2 `cardsRun` 启动运行建双向链(卡 activeRunId ↔ request.cardId)+ 置进行中;`reconcileCardForRun` 按 state 事件跟随更新卡状态(done→已完成等)
- [x] 4.3 `resumeAll` 不改本体;开机续 running 断点 emit state→`reconcileCardForRun` 把卡对回进行中(cardId 经断点贯穿)
- [x] 4.4 (并入 4.1/4.2:派生纯函数 + IPC 绑卡接线已落)

## 5. 命令输出分桶缓冲(引擎,先红后绿)

- [x] 5.1 写测试:输出按桶累积 —— 前台键=node:<nodeId>、后台键=bg:<bgId>;多桶隔离、运行隔离(`output-buffer.test.ts`)
- [x] 5.2 写测试:可回看 —— 流过后按桶键读到累积输出;关重开后据持久化缓冲仍可按桶读;引擎集成测(命令输出进 node 桶,readOutput 回看)
- [x] 5.3 实现 `src/main/engine/output-buffer.ts`(按桶一文件 `<runId>/<bucket>.log`)+ 引擎 `emit` 包装追加 + `readOutput`/`listOutputBuckets` + op-chunk 加 `bgId`,转绿

## 6. 落库接缝接两条路 + IPC(主进程)

- [x] 6.1 统一创建接缝 = `cards:create` IPC(两条审阅通过路共用;外部 submit 仍止于审阅、渲染层审阅后调 create——渲染接线在组 8)
- [x] 6.2 暴露需求卡 CRUD(list/create/update/remove)+ run + worktreeExists IPC(`index.ts` + `preload` + `KlaritApi`),未绑定项目列出空态
- [x] 6.3 暴露命令输出按桶读取 IPC(`readRunOutput`/`listRunOutputBuckets`);卡运行控制复用既有 `start/pause/resume/decide/getRunState`
- [x] 6.4 暴露 git 视图程序化聚焦 IPC(`focusCardGitView`→主进程解析卡首仓+分支→`onGitViewFocus` 推渲染层)

## 7. 渲染层:看板真卡 + 卡详情(先红后绿 UI/组件测)

- [x] 7.1 `KanbanBoard` 按 `cardColumn` 渲染真卡入列(`RequirementCardView`);测:未开始 leaf/container 停待办、已完成进已完成。遵循语义令牌
- [x] 7.2 卡面圆点(`RunDot`:呼吸蓝/紫/黄、静止红 + `dot-breathe` 动画)+ 当前节点名 + 括号细状态 + 分支名;圆点/文案可点:静止红→开详情定位决策、呼吸点→开详情定位当前命令输出
- [x] 7.3 抽出可复用 `RunDecisionPanel`(titleKey/input/options/actions/reason/gateHistory,raw 不渲染;文案随语言实时翻译)
- [x] 7.4 `RequirementCardDetail` 详情面板 —— 基本信息 + 运行控制(运行/暂停/恢复)+ 单卡决策(挂 `RunDecisionPanel`,focus 定位)
- [x] 7.5 命令输出分流 `CommandOutputView` —— 前台 `node:<id>` 入口 + 各后台 `bg:<id>` 各自查看;seed 自缓冲 + 实时追加,关重开可回看
- [x] 7.6 分支名联动 —— 卡上分支名(有运行≈有 worktree 时可点)→ `focusCardGitView`→主进程推 `onGitViewFocus`→App 切 git 视图定位;点卡(非分支名/圆点)进详情

## 8. 手动新建落库 + dogfood 退役

- [x] 8.1 `newRequirement.ts:createTasks()` 接统一 `createCards`(替换"只清状态"现状)+ 落库后刷新看板;测改为断言调用 createCards
- [x] 8.2 删除 `DogfoodRunCard.tsx` + `lib/dogfood-cards.ts` 及全部引用(App 改用 cards store),无悬挂 import

## 9. 收尾与验收

- [x] 9.1 `npm run typecheck` + `npm run test:run` 全绿(655 测试);`npm run build` 三端构建通过
- [x] 9.2 GUI 验收(自动化):`e2e/card-board.spec.ts` 真起 Electron 驱动 UI —— 建卡→看板「待办」出卡→点卡进详情→点运行绑卡(引擎在真 git 仓跑)→关软件重开卡与 activeRunId 持久化。截图确认:卡按当前节点流到阶段列、静止红点+节点名、决策落卡详情(含输入+前进式选项)、命令输出区。【可选:用户再 `npm start` 手动眼检圆点呼吸动画/分支跳 git 视图等视觉细节】
- [x] 9.3 全量验证无回归(typecheck + 666 单测 + 3 card e2e + build),`/opsx:archive` 并把增量 spec 同步进主 specs

## 10. 验收后 UI 修正(dogfood 反馈,并入本 change)

- [x] 10.1 卡面类型改**色条**(标题上方,不显文案);详情保留文字徽章
- [x] 10.2 卡上分支名**仅在 worktree/分支真正建出后**展示,且显示引擎实际分支(断点 `request.branch`,非预取名);`gitViewFocus` 用实际分支
- [x] 10.3 审阅候选详情:返回入口移入标题栏、用 chevron 图标(去 `←`);详情视图不渲染「取消/创建任务」,须返回列表才可创建。测:进详情后创建/取消消失、chevron 返回复现
- [x] 10.4 补回命令节点手动推进控件到卡详情(迁自 dogfood 遗漏):非末节点「转后台/中止并进下一节点」;**末节点「中止并完成流程」**——修长驻命令(如 `npm start` 验收)卡末节点无法完成的缺口。e2e `card-advance.spec.ts` 验证
- [x] 10.5 后台命令生命周期修正:①终止(中止/退出/**超时**)后条目**保留并标终态**、用户点「清除」才移除(不再直接消失,尤其计时中止);②引擎 `background` 事件区分 `timeout`;③**转后台后命令输出归 bg 桶**(修「暂无输出」)。cards store 单测 + e2e `card-background.spec.ts`(多后台并存 + 超时保留 + 各自输出)验证
- [x] 10.6 修并发写覆盖 bug:后台命令结束(超时/退出)只从**当前持久化断点**摘记录,不回写转后台时捕获的过期断点——否则主流程越过 decide 推进后会被"弹回"旧节点。engine 回归测试(先红后绿:revert 后 `expected n1 to be n2`)+ engine-execution spec 场景
- [x] 10.7 转后台带走**转后台前的前台输出**并入 bg 桶,后台输出视图呈现从头完整输出(非只转后台后)。engine 回归测试(先红后绿:revert 后 bg 桶为空)+ spec 场景
- [x] 10.8 暂停时**不隐藏圆点与状态**:`runDot` 暂停时仅把呼吸→静止(`paused` 标志),**颜色与括号文案不变**(不塞「已暂停」),渲染层另加一个**暂停图标 ⏸** 表示暂停。board.test 更新 + kanban-board spec 补 paused 分支/场景
- [x] 10.9 修暂停变色 bug:**有待决策恒红、优先于阶段色**——暂停一个"命令失败→决策"的运行不再因命令阶段变蓝(与继续后显红一致)。board.test 加 paused+待决策→红 用例 + spec 场景
