## 1. 先红：把缺陷钉成失败的测试

- [x] 1.1 在 `src/main/command-run.test.ts` 加用例「杀进程树的手段拉不起来也不崩进程」：mock `node:child_process` 的 `spawn` 返回一个会异步发 `'error'` 的假 `ChildProcess`，在 Windows 分支下调用导出的 `killTree(pid)`，断言不产生未捕获异常（挂 `process.on('uncaughtException')` 侦测，或断言 `unhandledRejection`/进程级错误未发生）
- [x] 1.2 加用例「延后的兜底强杀失败也不崩进程」：POSIX 分支下让 2 秒后的兜底 `process.kill(-pid, 'SIGKILL')` 抛错（用假计时器推进），断言错误被吞、无未捕获异常
- [x] 1.3 跑 `npx vitest run src/main/command-run.test.ts`，确认这两条**先红**，且失败原因确实是未捕获异常（不是断言写歪）

## 2. 后绿：修 killTree

- [x] 2.1 给 `killTree` 里 `spawn('taskkill', ...)` 返回的 `ChildProcess` 挂 `'error'` 监听器吞掉拉起失败；`try/catch` 保留（接同步参数错误），并把注释改对——现注释说「吞掉错误」但实际拦不到异步失败
- [x] 2.2 复核 POSIX 分支的 `setTimeout` 兜底强杀，确保其内层 `try/catch` 覆盖所有抛出路径（当前看似正确，按 1.2 的红测试确认）
- [x] 2.3 更新 `command-run.ts` 顶部文件注释，写明「杀进程树是尽力而为，其自身失败静默且不冒泡到进程级」
- [x] 2.4 跑 `npx vitest run src/main/command-run.test.ts`，确认 1.1/1.2 转绿

## 3. 验证不回归

- [x] 3.1 跑 `npm run typecheck`
- [x] 3.2 跑 `npm run test:run` 全量，确认 921 条既有用例仍全绿（尤其 `command-run` 的「取消即杀整棵进程树」与 agent 执行相关用例）
- [x] 3.3 确认 `src/main/agent/runner.ts` 一行未改——它只是 `killTree` 的消费者，修复自动惠及

## 4. 收尾

- [x] 4.1 按 Conventional Commits 提交（`fix(command-run): ...`）
- [x] 4.2 运行 `/opsx:sync` 把 delta spec 并回 `openspec/specs/command-execution/spec.md`，再归档本 change
