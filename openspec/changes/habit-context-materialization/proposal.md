## Why

`workflow-authoring`「自动 author 须能读到项目文件」现在的做法是**把项目各成员仓的真实路径整个作 `--add-dir` 挂给 author**（`src/main/index.ts:1371`，注释标为「设计决策 #10 根因修复」）。它确实修好了原来的根因（author 跑在 scratch 里只能靠 prompt 猜），但换来一个新问题：**大项目上 author 极慢，claude 进程 CPU 累计飙到上万秒**。

有意思的是，同一个文件往下十行，我们对**文档**已经做对了：

```ts
// 免得它靠 --add-dir 自行发现文档（不可靠）。fs 调用留此处，格式化交纯函数 formatDocEnumForIntent。
const docPaths = addDirs.flatMap((root) => scanDocuments(root).map((d) => d.location)).slice(0, 80)
```

**Klarit 做廉价确定性枚举，agent 做解读。** 这个模式在文档上跑通了，但习惯痕迹那条还停在半路——`workflow-onboarding`「习惯痕迹为轻量存在性门控」只答「有没有」，答完就把整个仓丢给 author 自己翻。

于是 author 面对的是一整个项目，而它真正需要的只是那几个习惯文件。

## What Changes

- **先量根因，再改**（本 change 的第一步，不跳过）：CPU 到底烧在 `--add-dir` 的目录索引上，还是烧在 author agent 自己满项目 glob 上？两者的修法不同。先在一个大仓上分别测「挂仓根不提问」与「挂小目录 + 同样提问」，把结论写进 design 再往下做。
- **习惯痕迹从「存在性」升级为「枚举 + 物化」**：`AGENT_HABIT_MARKERS` 命中的**具体路径**被枚举出来，其内容**逐字复制**到一个 per-run 的**习惯上下文包**目录。**逐字复制、不解析、不摘要、不裁剪**——Klarit 只决定「哪些文件值得给」，author 照旧自己读原文做全部解读。既有的存在性门控**保持不变**（它答「有没有」用于门控，枚举答「在哪」用于喂料，两者并存不互相取代）。
- **上下文包附一份 manifest**：列出包里每个文件**在原项目中的真实路径**（否则 author 看到一堆脱离语境的文件，不知道 `CLAUDE.md` 来自哪个成员仓）、以及 Klarit 预先跑好的**廉价确定性摘要**——`git log --oneline` 近若干条、`package.json` 的 scripts、成员仓清单。这些都是 author 本来要自己跑命令去拿、拿一次就烧一轮的东西。
- **author 只挂上下文包，不挂仓根**：`--add-dir` 指向这个小目录。系统意图相应改为「习惯材料已收集在此，直接读；只读探查、只输出工作流定义、不改动任何文件」。
- **包在运行结束后清理**，不残留在用户项目里，也不写进任何成员仓（避免污染用户仓库）。

## Capabilities

### Modified Capabilities
- `workflow-authoring`: 「自动 author 须能读到项目文件」改为——author 的可访问目录是**物化的习惯上下文包**（含逐字复制的痕迹文件 + 真实路径 manifest + 廉价预算摘要），而非项目成员仓根。只读约束与「只输出工作流定义」不变。

### Added Capabilities（并入现有能力）
- `workflow-onboarding`: 新增「习惯痕迹枚举与物化」——命中路径枚举、逐字复制、manifest 组成、per-run 生命周期与清理。与既有存在性门控并存，MUST NOT 取代它。

## Impact

- **依赖 / 复用**：建立在 `workflow-onboarding`（`AGENT_HABIT_MARKERS` 标记集直接复用）、`workflow-authoring`（author 调用链）之上。物化的形状与既有 `docPaths` 枚举同构——同一个「Klarit 枚举、agent 解读」模式推广到习惯。
- **代码**：`src/main/agent-habits.ts`（存在性门控旁新增枚举 + 物化）；`src/main/index.ts:1371-1387`（改喂上下文包、去掉仓根 addDirs）；`src/main/workflow-onboarding.ts`（生命周期与清理）；意图合成文案。
- **兼容**：**产出契约完全不变**——author 照旧产整份定义、照旧过脚手架规整（`workflow-from-habits`）与两闸校验。变的只是它读什么。聊天写工作流路径不受影响（那条本来就不挂项目）。
- **风险（需在实现中处理）**：author 看不到项目其余部分了。如果某项目的习惯藏在标记集没覆盖的地方，author 会漏。缓解是 manifest 里带一份**深度受限的项目目录清单**（只列路径、不读内容，很便宜），让 author 至少知道项目长什么样；标记集本身可扩展。这是**用「可能漏一点」换「快一个数量级」**的取舍，需要 dogfood 验证是否划算——如果实测漏得厉害，回退方案是保留仓根挂载但靠 manifest 引导，只是那样可能治不好 CPU。
- **不在本 change**：把这套物化推广到别的 agent 节点（`agent-execution` 的执行期 agent 本来就该在 worktree 里跑，不适用）、把简报写进 agent 原生约定文件（`CLAUDE.md`/`AGENTS.md`）——我们在用户仓 worktree 里跑，写进去会污染用户仓库，这条不能照搬。
