## Why

杀进程树的 `killTree`（`src/main/command-run.ts`）用 `try/catch` 包 `spawn('taskkill', ...)`，但 `spawn` 失败**不 throw**——它异步发 `'error'` 事件，`try/catch` 一个都拦不到；而返回的 `ChildProcess` 没挂 `'error'` 监听器，Node 对无监听的 `'error'` 事件的处理是**抛未捕获异常**。于是「取消一条命令」这个动作在资源紧张时会崩掉整个进程：测试里崩 vitest worker，生产里崩 Electron 主进程。

这直接违反 `command-execution` 规格已经写死的「运行器 MUST 永不抛」。而且 `killTree` 被 `src/main/agent/runner.ts` 复用，所以 agent 执行路径同样暴露——用户点「中止 agent」就可能把主进程带走。

## What Changes

- `killTree` 的失败处理改为覆盖**异步失败**：给 `taskkill` 子进程挂 `'error'` 监听器，让杀进程失败被吞掉而不是冒泡成未捕获异常。
- POSIX 分支里那个 2 秒后兜底 `SIGKILL` 的 `setTimeout` 回调同样审一遍——它在事件循环里跑，抛出来一样是未捕获异常。
- `command-execution` 规格补一条：取消/杀进程树这条路径**自身失败**时也不得抛，运行器仍以 `killed` 为真正常 resolve。

范围严格限定在这一个错误处理缺陷。不含任何 flaky 测试加固（`command-run.test.ts` 的 `alive(0)`、PID 复用、`until` 预算等问题另议）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `command-execution`: 把「MUST 永不抛」明确延伸到取消/杀进程树路径——杀进程树的手段本身失败（拉不起 `taskkill`、目标已退、无权限）时运行器不得抛，仍以 `killed` 为真 resolve。

## Impact

- `src/main/command-run.ts` — `killTree`（导出的公共 API）。
- `src/main/agent/runner.ts:64` — 消费者，不改代码，但修复后不再有崩主进程的风险。
- `src/main/command-run.test.ts` — 补针对 `killTree` 失败路径的测试（先红后绿）。
- 无 API 签名变更、无破坏性变更、无新依赖。
