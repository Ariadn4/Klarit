## Context

Klarit 现在的「首次启动」只有一件事：在 `src/main/settings.ts` 的 `initSettings` 里，当 `settings.json` 没有 `language` 字段时读取系统语言并写回（`undefined` 即首次启动信号）。应用没有任何 agent CLI 探测，也没有 onboarding 弹窗——「agent」目前只作为工作流节点执行器的一种 kind 存在于 `src/shared/types.ts`，与「编排本地安装的 agent CLI」无关。

设置走的是一套手写约定，而非 zustand/electron-store：
- 持久化：`src/main/store.ts` 的 `readJson/writeJson`，文件落在 `app.getPath('userData')`。
- 形状：`AppSettings`（`src/shared/types.ts`），目前 `{ language?, appearance? }`。
- IPC：channel 名集中在 `src/shared/ipc.ts`，handler 在 `src/main/index.ts`（`app.whenReady()` 内），preload 暴露为 `KlaritApi`。
- 渲染：`App.tsx` 用 `useState` 持有、挂载时 `window.klarit.getX()` 拉取，props 串到 `SettingsPanel.tsx` 的 `app-general` 区。

本设计要在不偏离上述模式的前提下，新增 agent 扫描、默认 agent/模型偏好、首次启动引导弹窗，以及通用设置里的两个联动下拉。

## Goals / Non-Goals

**Goals:**
- 复用现有 settings/IPC/store 模式增加 `defaultAgent` / `defaultModel` 两个应用级偏好。
- 主进程提供「扫描本地已安装 agent」与「按 agent 取模型清单」的能力，健壮、永不因缺失而崩。
- 首次启动「扫到 agent 才弹、可跳过」的引导弹窗；扫不到不打扰。
- 通用设置里两个联动下拉（agent → 模型），即时持久化。
- 弹窗与下拉遵循品牌规范、深浅两套；逻辑用纯函数承载以便先写测试。

**Non-Goals:**
- 不实际用所选 agent 去执行任何编排/跑 CLI（那是后续 change）。
- 不在本次做 API Key/凭据填写、审批模式、CLI 路径兜底（用户已确认弹窗仅 agent + 模型）。
- 不引入 node-pty/xterm 集成。
- 不做 agent 版本检测、健康检查或在线模型清单拉取（模型清单先用内置静态表）。

## Decisions

**1. 偏好形状与「未选择」语义。** 在 `AppSettings` 增加 `defaultAgent?: AgentId` 与 `defaultModel?: string`，沿用「字段 `undefined` = 未选择 = 首次启动信号」的既有约定，与 `language` 一致，无需另设 `hasOnboarded` 标志。
- *备选*：单独的 onboarding 完成标志位。否决：与语言设计不一致，且偏好缺省本身已是充分信号。

**2. agent 探测放主进程，纯逻辑可测。** 在 `src/main/` 新增 `agents.ts`，对受支持 agent 逐一用 `child_process`（`execFile` + 跨平台 `where`/`which` 或 `--version` 探测，类比 `git.ts`）判断可用性，单个探测包 try/catch + 超时，任一失败视为未检测到。受支持 agent 表与「每个 agent 的模型清单」作为静态数据放 `src/shared/agents.ts`（纯数据 + 纯函数：`listSupportedAgents()`、`modelsForAgent(id)`、`coerceDefaultModel(agentId, modelId)`），便于单测且供两端共享。
- *备选*：探测放渲染层。否决：渲染进程不应直接 spawn CLI，且违反现有「主进程管系统访问」的边界。
- *备选*：在线/动态拉取模型清单。否决：超范围、引入网络与失败面；先用静态表，后续可换。

**3. 扫描时机：`app.whenReady()` 内、随设置初始化。** 与语言检测同段触发。但扫描结果**不持久化**（每次启动重扫，反映用户新装/卸载的 agent），仅经 IPC 按需提供给渲染层。是否首次启动由 `defaultAgent === undefined` 判定。
- *备选*：缓存扫描结果到磁盘。否决：agent 安装状态会变，缓存易过期；探测开销可接受。

**4. 偏好更新时的模型一致性归一。** `setDefaultAgent` 与 `setDefaultModel` 经共享纯函数 `coerceDefaultModel` 校验：写入的 model 必须属于该 agent 的清单；切换 agent 时若旧 model 不属于新 agent，则把 `defaultModel` 重置（清空）。校验与归一在主进程写入前完成，保证落盘值始终自洽。

**5. 引导弹窗：渲染层新组件，由首启状态驱动。** 新增 `AgentOnboardingDialog.tsx`（顶层 portal，复用 `SettingsPanel` 的浮层与品牌令牌做法）。`App.tsx` 挂载时：拉 `getDefaultAgent()` 与 `scanAgents()`；当 `defaultAgent` 未设置**且**扫描列表非空 → 显示弹窗。「确认」走 `setDefaultAgent/Model` 持久化；「跳过」只关弹窗不写值。扫描列表为空 → 不显示。
- *备选*：弹窗逻辑放主进程用原生 dialog。否决：需要品牌化 UI 与模型联动，React 组件更合适。

**6. IPC 表面最小化。** 新增 channel：`agents:scan`（返回已检测 agent 列表）、`agents:models`（入参 agentId，返回模型清单——或直接随 scan 一并返回每 agent 的模型，省一次往返）、`settings:getDefaultAgent/setDefaultAgent/getDefaultModel/setDefaultModel`。`KlaritApi` 暴露对应薄方法。倾向 `scanAgents()` 一次性返回 `{ id, name, models: [...] }[]`，减少往返与状态竞态。

## Risks / Trade-offs

- **跨平台探测不可靠**（PATH 差异、Windows `where` vs Unix `which`、agent CLI 命名不一）→ 探测逻辑按 agent 配置可执行名 + 多策略（`--version`/PATH 查找），单测覆盖归一逻辑，运行期 try/catch 兜底为「未检测到」，宁可漏报不崩溃。
- **静态模型清单会过时** → 接受为当前范围内权衡；清单集中在 `src/shared/agents.ts` 一处，后续换成动态拉取只改一处。
- **探测拖慢启动** → 探测在 `whenReady` 内异步、设超时；即使慢也不阻塞窗口创建（弹窗是拿到结果后再决定显示）。
- **首启扫到 agent 但用户跳过后清单变化** → 用户随时可在「通用」设置里改；设置项的空态/联动覆盖了「之后才装 agent」的情况。
- **与未来真正执行 agent 的 change 的契约** → 本次只存 id 字符串，agent/model id 取稳定值，避免未来重命名破坏已存偏好。

## Migration Plan

- 纯增量、向后兼容：`AppSettings` 新增可选字段，旧 `settings.json`（无这些字段）读出即「未选择」，老用户下次启动等同首次启动 agent 引导（扫到才弹、可跳过），不影响语言/外观。
- 无数据迁移、无破坏性变更。回滚：移除新 IPC/UI 与字段即可，遗留在 `settings.json` 里的 `defaultAgent/defaultModel` 字段对旧逻辑无害（被忽略）。

## Open Questions

- 受支持 agent 的首批清单与各自模型 id 取值，是否就用 Claude Code / Codex / Cursor 三者起步？（实现时以 `src/shared/agents.ts` 静态表落地，可在 review 时增删。）
- `scanAgents()` 是否一次性内联返回各 agent 的模型清单（本设计倾向「是」，省往返）——若未来模型清单改为动态/异步获取，可能需要拆分。
