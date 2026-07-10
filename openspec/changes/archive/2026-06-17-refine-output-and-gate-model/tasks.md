## 1. 数据模型（src/shared/types.ts）

- [x] 1.1 新增 `OutputTemplate`（`none`/`inline`/`file`）与 `OutputDestination`（v1 仅 `{kind:'file',path}`，留判别联合给将来 card），把 `WorkflowOutput` 改为 `{ destination, template, required }`
- [x] 1.2 新增 `GateAction = { label, command }`，把 `WorkflowGateItem` 改为判别联合：`auto` 含 `command` 与可选 `targets`、`manual` 含可选 `actions`
- [x] 1.3 新增 `AgentExecConfig = { toolId?, model?, extraArgs? }`，给 `NodeExecutor` 的 agent 分支加可选 `exec`
- [x] 1.4 导出引擎内置操作常量（`ENGINE_OPERATIONS`）作为 UI 与校验单一来源

## 2. 校验与种子（src/shared/workflow.ts，测试先行）

- [x] 2.1 在 `workflow.test.ts` 先写红：产出 file 路径非法（绝对/..）被拒、产出路径非 `.md` 被拒、模板 file 路径非法被拒、auto 缺命令被拒、auto 目标不匹配产出路径被拒、manual 动作缺名称/命令被拒、agent 缺省 exec 合法，及各自合法通过用例
- [x] 2.2 在 `validateNode` 实现产出（destination.file 路径合规且 `.md`、template.file 路径合规）、门把（auto 命令非空+targets 匹配本节点产出 path、manual 动作名称/命令非空）、agent exec（字段为可空字符串）的校验，复用 `isSafeRelativePath`/`nonEmpty`
- [x] 2.3 确认 `createDefaultWorkflow` 在新类型下仍合法（空 outputs、agent 无 exec），跑绿种子用例

## 3. 旧包迁移（src/main/workflow-store.ts，测试先行）

- [x] 3.1 在 `workflow-store.test.ts` 先写红：读入含旧 `output.{type,format,path}`（含有路径与无路径两种）、旧门把 `{kind,description}`、无 `exec` 的 agent 的 yaml，断言归一为新形状且不抛异常
- [x] 3.2 实现旧→新形状归一：有路径旧产出→`{destination:{kind:'file',path}, template:{kind:'none'}}`（丢弃旧 type/format），无路径旧产出（卡片数据）丢弃；门把缺 command→空命令、缺 actions→空数组；agent 无 exec 保持 undefined
- [x] 3.3 验证损坏/缺字段包仍跳过不崩（沿用既有损坏包用例）

## 4. 编辑器 UI（src/renderer/src/components/WorkflowEditor.tsx，测试先行）

- [x] 4.1 在 `WorkflowEditor.test.tsx` 先写红：产出区 file 路径输入（须 `.md`）+ 模板手写/使用文件；门区 auto 显示命令+目标多选、manual 显示动作按钮增删、切换类型呈现对应字段；engine 操作为下拉；agent 区有工具/模型下拉（含「跟随全局」）+ 额外参数
- [x] 4.2 把 `ExecutorFields` 中 agent「使用文件」段抽为可复用 `PackageFileField`（新建/导入/查看/移除），agent skill 既有用例回归通过
- [x] 4.3 重写 `OutputsEditor`：file 路径输入（`PathInput`，须 `.md`）+ 模板（复用 `PackageFileField`）+ 必选
- [x] 4.4 重写 `GateEditor`：类型下拉后按 kind 分支——auto 命令输入 + 目标多选（选项来自本节点产出 path）；manual 动作按钮列表（名称+命令+增删）；切换 kind 给对应默认空结构
- [x] 4.5 engine 操作字段改 `<select>`（`ENGINE_OPERATIONS`）；agent 增 `exec` 区（工具/模型下拉读 agent 扫描列表、缺省「跟随全局」、额外参数文本），仅 agent 类型呈现
- [x] 4.6 更新「加产出」「加门把」「加节点」默认值为新形状

## 5. 文档与回归

- [x] 5.1 同步 `docs/project-goals.md`：`产出[]` 字段描述改为「目的地（v1 仅 file 路径）/模板/必选」；agent 执行配置级联由「全局 < 工作流默认 < 节点」更正为「全局 < 节点」；门把描述与本变更一致
- [x] 5.2 `npm run typecheck` 两套 config 通过
- [x] 5.3 `npm run test:run` 全绿
- [x] 5.4 `npm start`（不监听源码）人工核对：编辑产出/门/engine 操作/agent 工具模型、保存往返、非法输入被拦（用户确认通过）

## 6. 实现中的迭代反馈（用户验收驱动）

- [x] 6.1 agent 工具/模型下拉接入真实数据源 `window.klarit.scanAgents()`（`detectedAgents` 经 `App → SettingsPanel → WorkflowLibrary → WorkflowEditor` 透传），模型随工具联动、未检测到的已存值仍展示
- [x] 6.2 门把去掉「说明」字段：`auto{command,targets?}` / `manual{actions?}`；校验/迁移/编辑器/spec/project-goals 同步
- [x] 6.3 人工评审切换即预置一行「文案+命令」输入框；`cleanForSave` 剔除全空行（零按钮合法、半填校验拦下）
- [x] 6.4 修复深色模式露白：`WorkflowEditor` 写死的 `bg-white` 改为随主题翻色的语义令牌（`bg-canvas`/`bg-paper`），与全局约定一致
