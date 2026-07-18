## 1. 抽取共享组件（先红后绿，含针对性测试）

- [x] 1.1 新建 `<RunStatusLine breakpoint workflow fallbackStatus>`：封装 `runDot()` + `<RunDot>` + `subLabel`（工作中/检查中/等待决策）+ 暂停图标 + 无运行回落 `fallbackStatus`；先写测试覆盖各态（呼吸蓝/静止红/暂停/无运行回落）
- [x] 1.2 卡面 `RequirementCardView.tsx` 改用 `<RunStatusLine>` 替换内联块（`:82-101`），跑既有 `RequirementCardView.test.tsx` 确认无回归
- [x] 1.3 新建 `<CardBranchChips card>`：封装 `cardBranches(slug)` 拉取 + `useEffect` 依赖 + chip 平铺 + 点击 `focusCardGitView`；先写测试覆盖（无分支不渲染、多仓平铺、点击调 `focusCardGitView(slug, memberId)`）
- [x] 1.4 卡面改用 `<CardBranchChips>` 替换内联分支块（`:104-124`），跑既有测试确认无回归

## 2. 详情抽屉头部：运行进度 + 删旧状态行

- [x] 2.1 在 `RequirementCardDetail.test.tsx` 先写测试：头部渲染 `<RunStatusLine>`（与卡面一致）、不再出现「`状态 · proposedName`」文字行、无运行时回落生命周期状态
- [x] 2.2 `RequirementCardDetail.tsx` 头部删除 `t(status) · card.proposedName` 那行（`:152-154`），改渲染 `<RunStatusLine breakpoint={bp} workflow={wf} fallbackStatus={card.status}>`

## 3. 详情抽屉分支条目

- [x] 3.1 先写测试：详情面板渲染 `<CardBranchChips>`（已建分支时出条目、点击跳 git 视图；未建时不渲染）
- [x] 3.2 在 `RequirementCardDetail.tsx` 正文合适位置渲染 `<CardBranchChips card={card}>`

## 4. 打开详情联动 git 视图（App 侧门控）

- [x] 4.1 在 `App.test.tsx` 先写测试：`detailSlug` 变为已建分支的卡且侧栏未显示该分支 → 调 `focusCardGitView(slug, firstMemberId)`；侧栏已显示该(仓,分支) → 不调；未建分支的卡 → 不调
- [x] 4.2 在 `App.tsx` 加 `useEffect` 订阅 `detailSlug`：非空时 `cardBranches(slug)` 取首仓条目，与当前 `viewState` 比对（`view==='git' && gitMemberId===branches[0].memberId && gitBranch===branches[0].branch`），未命中才 `focusCardGitView(slug, branches[0].memberId)`；无条目不联动

## 5. 主控 loading 过渡

- [x] 5.1 先写测试：点击主控后到 `setRun` 兑现前，主控呈 loading（转圈 + `disabled`），兑现后复位为对应 `▶`/`⏸`
- [x] 5.2 `RequirementCardDetail.tsx` 加本地 `pending` state，把 `run/pause/resume` 的 onClick 包成 `setPending(true) → try/await → finally setPending(false)`；pending 期间主控图标换 `<Loader2 className="animate-spin">` 并 `disabled`

## 6. 验收与收尾

- [x] 6.1 `npm run test:run` 全绿、`npm run typecheck` 通过
- [x] 6.2 `npm start` dogfood 手验四条：点有分支卡→侧栏切对应分支（已显示则不切）；抽屉分支名可点跳转；主控点击有 loading；抽屉头部圆点+文案与卡面一致、旧状态行已删
- [x] 6.3 深浅双主题各扫一遍：新块仅用语义令牌、两套主题都正确翻色（遵 `docs/brand`）
