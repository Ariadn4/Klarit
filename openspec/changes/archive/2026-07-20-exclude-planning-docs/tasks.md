## 1. agent 分类排除计划类（main，测试先行）

- [x] 1.1 在 `src/main/document-scan.test.ts` 写红：agent 分类指令含"计划类文档不列入"；给定 agent 判某容器为计划类，规整后该条不进登记表、归档目标类照常在
- [x] 1.2 `src/main/document-scan.ts`：agent 分类/分组指令加一条——判断路径是否计划类（任务作用域计划/提案产物），是则不列入（同噪声）；不硬编码路径清单
- [x] 1.3 跑绿：`npx vitest run src/main/document-scan.test.ts`

## 2. 无 agent 兜底轻量排除计划容器（shared/main，测试先行）

- [x] 2.1 在分类兜底所在的测试（`src/shared/document-registry.test.ts` 或 `document-scan.test.ts`）写红：明显计划/提案容器下的叶子在兜底路判为**不纳管**；判不准者仍走既有强/弱信号
- [x] 2.2 兜底分类加「计划容器排除」最高优先档（轻量路径判断），并入坍缩前的过滤
- [x] 2.3 跑绿：对应测试

## 3. 修正既有矛盾场景（回归）

- [x] 3.1 更新受影响的既有测试：原以 `openspec/changes` 作纳管条目/坍缩示例的用例改为「被排除」或换中性示例，确认 `openspec/specs` 等归档目标仍纳管
- [x] 3.2 跑绿：登记表相关全部测试

## 4. 全量校验

- [x] 4.1 `npm run typecheck`
- [x] 4.2 `npm run test:run`（全绿）
