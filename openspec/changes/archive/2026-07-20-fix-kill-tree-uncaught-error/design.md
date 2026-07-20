## Context

`killTree(pid)`（`src/main/command-run.ts`）是「取消即杀整棵进程树」的唯一实现，被两条路径共用：命令运行器 `runCommand`，以及 agent 运行器 `src/main/agent/runner.ts:64`。

现状代码的两条分支：

```
Windows:  try { spawn('taskkill', ['/pid', pid, '/T', '/F']) } catch { /* 吞 */ }
POSIX:    try { process.kill(-pid, 'SIGTERM') } catch { /* 吞 */ }
          setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch {} }, 2000).unref?.()
```

POSIX 分支是对的：`process.kill` 同步抛，`try/catch` 接得住；`setTimeout` 回调里也有自己的 `try/catch`。

Windows 分支是错的：`spawn()` **不会**因为拉不起子进程而同步抛——它同步返回一个 `ChildProcess`，失败以异步 `'error'` 事件送达。所以那个 `try/catch` 实际上一个错误都拦不到。而 Node 的约定是：`EventEmitter` 发出 `'error'` 事件时若无监听器，就把它当异常抛出到进程级。`killTree` 从不给返回的 `ChildProcess` 挂监听器，于是 `taskkill` 拉不起来就等于一次未捕获异常。

触发条件是资源相关的：`EMFILE`/句柄耗尽、`taskkill` 被安全软件拦截或不在 `PATH`。在负载高时才碰得到，这也是它至今没被发现的原因。

后果按调用方分：测试里崩 vitest worker；生产里 `runCommand` 与 agent 中止都跑在 Electron 主进程，崩的是主进程——用户点一次「中止 agent」就可能把应用带走。

## Goals / Non-Goals

**Goals:**
- 让 `killTree` 在任何失败下都不把错误冒泡到进程级，兑现 `command-execution` 规格已经写死的「永不抛」。
- 保持 `killTree` 现有签名与语义（同步、`void` 返回、尽力而为）——两个调用方都是即发即忘，不该被迫改。

**Non-Goals:**
- 不动 `command-run.test.ts` 里那个负载相关 flaky 的加固（`alive(0)` 恒真、PID 复用、`until` 的 5s 预算）。那是独立问题，另开。
- 不让 `killTree` 变成可等待的（返回 Promise / 报告杀没杀成）。调用方目前不需要，改了会牵动 `runCommand` 的 resolve 时机，超出这次范围。
- 不改「杀进程树是尽力而为」这个立场——失败依然静默。

## Decisions

**决策一：给 `taskkill` 子进程挂 `'error'` 监听器，而不是继续依赖 `try/catch`。**

这是唯一能接住异步 `'error'` 的办法。`try/catch` 要不要留是次要问题——留着无害（`spawn` 在参数非法时确实会同步抛），但它不能替代监听器。两者是互补的，不是二选一。

考虑过的替代方案：

- *用 `execFile`/`exec` 换掉 `spawn`* —— 回调式 API 会把拉起失败送进回调的 `err`，写起来确实更顺。但换 API 会改变进程创建的细节（`exec` 还会多起一层 shell），对一个纯错误处理修复来说动静太大，且 `taskkill` 的输出我们本来就不关心。否决。
- *在主进程挂全局 `process.on('uncaughtException')` 兜底* —— 那是拿全局开关盖局部 bug，会顺带吞掉别处真正该崩的错误。否决。

**决策二：POSIX 分支同样审一遍，即使当前看起来是对的。**

`setTimeout` 的回调在事件循环后续轮次里跑，那里抛出来就是未捕获异常，外层 `try/catch` 够不着。当前它自带 `try/catch`，所以是安全的——但这条约束要写进规格（已写入 delta spec 的「延后的兜底强杀失败也不崩进程」场景），否则以后有人重构掉那个内层 `try/catch` 不会有任何东西提醒。这次落一个测试把它钉住。

**决策三：测试怎么写才不靠平台分叉。**

难点是 `killTree` 的 Windows 分支只在 Windows 上跑，而「`spawn` 失败」本身不好在真机上按需触发。按项目「测公共 API、不为可测性拆私有」的约定，测试应该打 `killTree` 这个已导出的公共 API，用 `vi.mock('node:child_process')` 让 `spawn` 返回一个会异步发 `'error'` 的假 `ChildProcess`，断言进程不出现未捕获异常。平台分支用 `vi.stubGlobal` 之类手段覆盖 `process.platform` 的读取——具体手法留给实现阶段，先写红。

## Risks / Trade-offs

**[挂了监听器就把 `taskkill` 的真实失败彻底静默了]** → 这本来就是既定立场（杀进程树尽力而为，规格里写明了）。真正的兜底在别处：`runCommand` 以 `killed` 为真返回，上层据此判断；孤儿进程有 POSIX 的进程组强杀和 Windows 的 `/T`。这次不引入新的可观测性，但如果以后要查「为什么进程没杀掉」，这里是加日志的位置。

**[`process.platform` 在测试里被 stub，可能与真实 Windows 行为脱节]** → 这次只改错误处理路径，杀进程的实际行为一行不动，脱节风险低。真实行为已由既有的「取消即杀整棵进程树」用例在 Windows 上覆盖。

**[修完之后原 flaky 可能还在]** → 是的，这次修的是一个独立确认的缺陷，不是对 flaky 的诊断结论。压测 30 轮没复现出那个 flaky，本 change 不承诺解决它。
