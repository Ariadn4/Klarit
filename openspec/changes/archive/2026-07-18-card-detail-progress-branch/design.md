## Context

卡面(`RequirementCardView.tsx`)已具备三件东西:①`runDot()`(`lib/board.ts`)派生 + `<RunDot>` 渲染 + 内联 `subLabel`/暂停图标 = 运行进度显示;②`cardBranches(slug)` 拉「已建分支」+ 「成员仓名/分支名」chip;③chip 点击 `focusCardGitView(slug, memberId)` → 主进程发 `gitViewFocusRequest` → `App.tsx:129` 把 `viewState` 切成 `{view:'git', gitMemberId, gitBranch}` 并持久化。

详情抽屉(`RequirementCardDetail.tsx`)三者皆无:头部只有第 152-154 行 `t(status) · card.proposedName` 文字行(名字是**预取名**,可能与引擎实际分支不符);主控 `run/pause/resume` 是 async IPC 但无过渡态。本设计把卡面这三件能力对齐进抽屉,并新增「打开详情联动 git 视图」。

## Goals / Non-Goals

**Goals:**
- 抽屉头部运行进度与卡面**像素级一致**,且靠**共享组件**保证不分叉。
- 抽屉展示可点分支条目(同卡面口径),点击跳 git 视图。
- 打开有分支的卡时,**仅当侧栏未在显示该分支**才联动切 git 视图(默认首仓)。
- 主控异步过渡:点击到兑现之间转圈 + 禁用。

**Non-Goals:**
- 不改主进程 IPC / 引擎(全部复用 `cardBranches`/`focusCardGitView`/`pauseRun`/`resumeRun`/`runCard`)。
- 不改「worktree 判定口径」:与卡面一致,门控是「分支已建」,不探测盘上 worktree。
- 不动 git 视图空态、不动跨卡决策。

## Decisions

### 决策 1:抽出两个共享组件,消除卡面/抽屉的重复

- `<RunStatusLine breakpoint workflow fallbackStatus>`:封装 `runDot()` + `<RunDot>` + `subLabel`(工作中/检查中/等待决策)+ 暂停图标 + 无运行回落 `fallbackStatus`。卡面(`RequirementCardView.tsx:82-101`)与抽屉头部都渲染它。
- `<CardBranchChips card>`:封装「`cardBranches(slug)` 拉取 + `useEffect` 依赖(`activeRunId`/`currentNodeId`/`phase`)+ chip 平铺 + 点击 `focusCardGitView`」。卡面(`:104-124`)与抽屉都渲染它。

**为何**:诉求原文是「与卡面**完全一致**」。复制两份必然随迭代分叉;抽共享组件是唯一稳的做法。这是纯实现重构,不改契约。备选(各写各的)被否。

### 决策 2:「打开详情联动 git 视图」放在 `App.tsx`,因为判据(当前侧栏 viewState)在那

「仅当侧栏没在显示该分支才切」需要读**当前** `viewState`——它是 `App.tsx` 的本地状态(`getSidebarView` 持久化),store(`cards.ts`)看不到。故联动逻辑落 `App.tsx`:

- 一个 `useEffect` 订阅 `useCardsStore(s => s.detailSlug)`,在 slug 变为非空时:
  1. `cardBranches(slug)` 取该卡已建分支,取**第一个成员仓**条目(`branches[0]`,对应 Q3 首仓)。无条目 → 不联动(未建分支的卡打开不切)。
  2. 与当前 `viewState` 比对:`view==='git' && gitMemberId===branches[0].memberId && gitBranch===branches[0].branch` 即「已在显示该分支」→ **跳过**。
  3. 否则调 `focusCardGitView(slug, branches[0].memberId)`(复用既有链路,`App.tsx:129` 的 `onGitViewFocus` 会切并持久化)。

**为何不放 store 的 `openDetail`**:store 不持有 sidebar view,做「是否已在显示」的门控要把 viewState 灌进 store,污染分层。放 App 最贴近数据。备选(store 内联动)被否。

**为何用 `cardBranches` 而非 `focusCardGitView` 的内部解析**:`focusCardGitView` 无条件发事件(还会对未建分支回落到 `proposedName`),满足不了「未建分支不切」「已显示则不切」两个门控;renderer 侧先用 `cardBranches` 拿到真实首仓分支再决定切不切。多一次 `cardBranches` 调用,开销可忽略。

### 决策 3:主控 loading 用组件本地 `pending` 态,`finally` 复位

`RequirementCardDetail` 内 `useState<boolean>` pending。主控 onClick 包成 `async () => { setPending(true); try { await run/pause/resume } finally { setPending(false) } }`。pending 期间主控图标换 `<Loader2 className="animate-spin">`、`disabled`。兑现后 `setRun` 更新 store,`state`/`canRun` 重算,按钮回到对应 `▶`/`⏸`。

**为何本地 state 而非 store**:过渡态是纯视图瞬态、只此面板关心,不必进 store。`animate-spin` 是 Tailwind 既有工具类,无需新令牌。

## Risks / Trade-offs

- **[联动切换打扰用户]** 打开卡就抢 git 视图 → 已用 Q2 门控(仅当未在显示该分支才切)缓解;首仓判定与卡面 chip 默认一致,行为可预期。
- **[`cardBranches` 多调一次]** App 联动 + `<CardBranchChips>` 各拉一次 → 调用轻(仅探本地分支存在),可接受;若要省可后续提到 store 缓存,本期不做。
- **[pending 与快速再点]** pending 期间 `disabled` 已防重复点;兑现前状态未变,不会误触发двойн动作。
- **[共享组件回归]** 抽 `RunStatusLine`/`CardBranchChips` 触碰卡面 → 卡面既有测试(`RequirementCardView.test.tsx`)是回归网,共享组件另加针对性测试,先红后绿。
