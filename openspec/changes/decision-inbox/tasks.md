# Tasks

> 设计已定：收件箱是 `pendingDecision` 的投影（不落盘、不双写），断点加 `pendingSince` 供排序，只导航不回应，未聚焦才发通知。

## 1. 断点记录决策产生时刻（引擎，最底层先做）

- [x] 1.1 写测试：引擎置 `pendingDecision`（失败决策 / 人工门 / 外部门 / agent 提问各一）→ 断点带 `pendingSince`；`decideRun` 回应后二者一并清空；`abort` 停在决策上的运行 → 二者一并清空
- [x] 1.2 写测试：带 `pendingSince` 的断点恢复 → 续跑行为与不带时一致；缺 `pendingSince` 的老断点读取不报错
- [x] 1.3 实现：`RunBreakpoint.pendingSince?: number`（`src/shared/types.ts`）；`engine.ts` 置/清决策处成对读写

## 2. 收件箱条目派生（纯函数，shared）

- [x] 2.1 写测试：`toInboxEntry(bp, card)` —— `source` 以 `:manual-gate` 结尾 → `gateKind='review'`，其余 → `'failure'`；条目含 runId/cardId/cardName/source/titleKey/titleParams/pendingSince
- [x] 2.2 写测试：`sortInbox(entries)` 按 `pendingSince` 升序（等最久在前）；缺 `pendingSince` 者用回落时刻参与排序
- [x] 2.3 实现 `src/shared/decision-inbox.ts`（纯函数，无 fs、无时间依赖——「现在」由调用方传入）

## 3. 收件箱投影（主进程）

- [x] 3.1 写测试：`decision` 事件 → upsert 条目；决策被回应 → 移除；运行转 `aborted`/`done` → 移除
- [x] 3.2 写测试：`rebuild()` 由注入的 run-store 列表重算，只取 `pendingDecision !== null`；老断点缺 `pendingSince` → 回落文件 mtime、条目仍在
- [x] 3.3 写测试：切换项目 → 投影重建为新项目的条目；未绑定项目 → 空
- [x] 3.4 实现 `src/main/decision-inbox.ts`（注入 `onEngineProgress` / `listBreakpoints` / `listCards`，永不抛）

## 4. 桌面通知

- [x] 4.1 写测试：未聚焦 + 新增条目 → 发通知（含卡名与翻译后标题）；聚焦时不发；条目移除不发；`rebuild()` 产生的存量条目不发
- [x] 4.2 写测试：设置开关关闭 → 不发通知，但条目与徽标不受影响
- [x] 4.3 实现：通知发送（注入式，测试可桩）+ 点击通知聚焦窗口并跳卡；设置项 `notifyOnDecision`（默认 true）

## 5. IPC 与渲染层

- [x] 5.1 写测试：IPC 契约 —— 拉取当前收件箱、订阅变更；渲染层收到增删实时更新
- [x] 5.2 写测试（`DecisionInbox.tsx`）：条目按序渲染卡名/类型标识/翻译标题/等待时长；空态提示；**断言不存在**回应决策的选项/填空/动作按钮
- [x] 5.3 写测试（`DecisionInbox.tsx`）：点条目 → 打开对应卡详情并聚焦决策面板
- [x] 5.4 实现 `DecisionInbox.tsx` + IPC 接线 + i18n 文案（复用既有决策 i18n key 翻译条目标题）

## 6. 外壳入口

- [x] 6.1 写测试（外壳）：有待决策 → 顶栏入口带计数徽标；0 条 → 无徽标；点击展开/收起、展开态选中视觉；未绑定项目 → 不渲染入口
- [x] 6.2 实现：顶栏收件箱入口（语义令牌配色，深浅两套；徽标按 `docs/brand`）

## 7. 收尾

- [x] 7.1 `npm run typecheck` 两套干净、`npm run test:run` 全绿
- [x] 7.2 `npx openspec validate decision-inbox --strict`
- [ ] 7.3 dogfood：起三张卡自动并发跑到验收门，确认徽标计数、通知、跳转定位都对
