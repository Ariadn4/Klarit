# 验收:引擎/命令节点技术失败自愈(dogfood)

契约测试(`src/main/engine/engine-heal.test.ts`,假 heal agent)已覆盖机制正确性、全绿。本文件是**真机 + 真 agent CLI** 的端到端 dogfood 指南:造一个真产出东西的小测试项目、配一条穿过所有排查节点的工作流,用 `npm start`(不监听源码)跑,逐条核对各失败情况下 agent 的应对与回落。

> 前置:软件设置里已选一个可用的默认 agent(claude / codex / cursor 之一,已装 CLI)。未选默认 agent 时 heal 不可用 → 所有技术失败直接回落人工(也是合法的兜底路径,可单独验一遍)。

## 1. 造测试项目(可直接复制运行)

一个极小的真库(TS + vitest),预埋:①一个失败测试 → 必然触发命令自愈;稍后用两张改同一文件同一行的卡 → 必然造合并冲突。

```bash
mkdir klarit-heal-demo && cd klarit-heal-demo
git init -b main
cat > package.json <<'JSON'
{ "name": "heal-demo", "version": "0.0.0", "scripts": { "test": "vitest run" }, "devDependencies": { "vitest": "^3" } }
JSON
mkdir src
# 预埋一个「会失败」的实现 + 测试:sum 故意写错 → npm test 挂 → 命令自愈让 agent 修
cat > src/calc.ts <<'TS'
export function sum(a: number, b: number): number { return a - b } // BUG：应为 a + b
TS
cat > src/calc.test.ts <<'TS'
import { it, expect } from 'vitest'
import { sum } from './calc'
it('sum adds', () => { expect(sum(2, 3)).toBe(5) })
TS
# 一个供两张卡各改同一行、制造合并冲突的文件
echo 'export const TITLE = "hello"' > src/title.ts
npm i >/dev/null 2>&1
git add -A && git commit -qm "init: 预埋失败测试 + 冲突文件"
```

在 Klarit 里把该目录作为项目导入(单仓即可;多仓验收另建 `web`/`api` 两仓,标签分前后端)。

## 2. 配验收工作流(节点序列)

新建一条工作流,阶段随意,节点按序(覆盖引擎脊柱 + agent + command + 门 + 合并):

1. `engine` create-branch → `engine` open-worktree(建卡分支与工作区)
2. `agent` 「实现」:prompt 让它把 `src/title.ts` 的 `TITLE` 改成卡描述里的值(制造正常 agent 写 + 产出一份 `REPORT.md`)——挂一道**客观门** `npm test`(用于验 agent 门自愈)
3. `command` 「跑测试」:`commands: [{ command: "npm test" }]`(预埋的 bug 会让它挂 → 命令自愈)
4. `command` 「构建」正常通过一条命令(如 `node -e "process.exit(0)"`),验通过路径
5. 一道**人工评审门**(声明动作按钮 `npm start` 可选;验「通过」+ 确认**不显示自由输入框**)
6. `engine` merge-branch(合并回主线;第二张卡在此撞冲突 → 合并自愈)
7. `engine` delete-branch / remove-worktree(验脊柱收尾;delete 未合并时的人工决策 + 自由输入→处置 agent)

多仓验收:把卡 `repos` 设为 `[web, api]`,只在 web 改冲突文件、api 改别的 → 第 6 步验**逐仓 heal**(只 web 拉 heal)。

## 3. 逐条覆盖清单(对着跑、逐项打勾)

| # | 情况 | 怎么触发 | 期望 |
|---|---|---|---|
| 1 | 引擎脊柱 | 跑到底 | 建分支/worktree/合并/删 正常 |
| 2 | agent 正常写 + 产出 | 第 2 步 | `src/title.ts` 被改、`REPORT.md` 产出、紫点亮、活动框可展开看到**完整 prompt** |
| 3 | **agent 门自愈** | 第 2 步 `npm test` 首过没过 | 续接**原** agent 重做(非新拉),门再过 |
| 4 | **agent 运行时提问 + 自由输入注入当前 agent** | 让 agent 写 `need-decision` 握手 | 卡内决策(sourceKind=agent)+ 自由输入框;提交后注回原 agent |
| 5 | **命令没过 → 自愈** | 第 3 步(预埋 bug) | 临时 heal agent 改 `src/calc.ts` → 引擎提交 → 重跑 `npm test` 过 → 推进;活动区可见 heal prompt |
| 6 | **命令自愈超限 → 人工** | 把 bug 弄成 agent 修不动(或临时把默认 agent 配坏) | 3 次后回落「命令执行失败:重试/跳过」+ 自由输入框 |
| 7 | 命令通过 | 第 4 步 | 退 0 直接推进 |
| 8 | 人工评审门 | 第 5 步 | 弹「通过」,**无自由输入框**;有动作按钮则可启动/中止 |
| 9 | 合并干净 | 第一张卡第 6 步 | 直接合并,无 heal |
| 10 | **合并冲突 → 自愈** | 第二张卡改同一行后第 6 步 | 在**卡分支**上解冲突(主线不动)→ 快进合回 → 继续 |
| 11 | **合并自愈超限 → 人工** | 令 heal 连续失败 | 卡分支复位干净,回落「放弃合并,跳过该节点」+ 自由输入框 |
| 12 | **多仓逐仓 heal** | 多仓卡、仅一仓冲突 | 只冲突仓拉 heal,另一仓照过 |
| 13 | **自由输入 → 新起处置 agent** | 对任一无当前 agent 的失败决策(如 delete 未合并、合并超限)写自由输入提交 | 新起读写处置 agent:能改就改+提交后重跑;非代码可解则经握手解释、把建议作为新选项交回 |
| 14 | 观测留痕 | 全程 | 每个 agent/heal 的完整 prompt + 输出可查(关重开仍在) |

## 4. 跑法

```bash
npm start   # electron-vite preview（不监听源码，避免热重载造成半合并死循环）
```

在卡详情面板逐条推进、核对上表。**注意**:dogfood 必须用 `npm start`(预览已构建产物),不要用 `npm run dev`。

## 5. 通过标准

上表 14 项全部符合预期;各**超限**路径回落到与今日**一字不差**的原有人工决策;主线在任何 heal 失败后都保持干净(未被处置 agent 误改)。通过后执行 `/opsx:archive` 同步增量 spec。
