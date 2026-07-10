## 1. i18n 文案

- [x] 1.1 在 `zh.ts` 的 `newRequirement` 下新增 `editing`(编辑中)与 `reviewPending`(带 `{{count}}`,如「{{count}} 张候选待审阅」)
- [x] 1.2 在 `en.ts` 同步新增对应键(`editing` / `reviewPending`)

## 2. store 连接的入口组件(测试先行)

- [x] 2.1 为「+ 创建」入口组件写测试:按 `phase` + `windowOpen` 断言四态外观(idle=「+ 创建」、processing=转圈「建卡中」、reviewing 收起=「N 张候选待审阅」、describing 收起=「编辑中」),先红
- [x] 2.2 补测试:非 idle 相点击按钮调用 `openEntry`(不发起第二次分解),先红
- [x] 2.3 抽出 `CreateRequirementEntry` 组件:直接订阅 `useNewRequirementStore`(`phase`/`reviewCards.length`/`windowOpen`/`openEntry`),按相位渲染图标+文案,onClick 统一 `openEntry`;仅用语义令牌、深浅双主题,让 2.1/2.2 转绿

## 3. 接线看板与移除旧浮标

- [x] 3.1 `KanbanBoard.tsx`/`BoardColumn.tsx`:在「待办」列体底部原「+ 创建」位置渲染 `CreateRequirementEntry`;`BoardColumn` 保持纯展示(`onCreate` → `createSlot` 注入槽位,不 import 流程 store);`App.tsx` 去掉 prop-drill 的 `onCreate`
- [x] 3.2 `NewRequirementFlow.tsx`:删除 `CreatingCardsIndicator` 及其渲染分支(保留 `UnboundNotice`);确认无残留 import/引用
- [x] 3.3 更新受影响测试:`BoardColumn.test.tsx`、`KanbanBoard.test.tsx`、`NewRequirementFlow.test.tsx` 改为断言按钮承载状态/注入槽位、右下角无独立「建卡中」;`App.test.tsx` idle 入口不变(`新建需求`)

## 4. 校验

- [x] 4.1 `npm run typecheck` 通过
- [x] 4.2 `npm run test:run` 全绿(88 files / 859 tests)
- [x] 4.3 `e2e/card-board.spec.ts` 无「建卡中」/底栏指示相关断言,无需同步(全仓 grep 确认)
- [x] 4.4 `openspec validate --changes create-button-flow-status` 通过
