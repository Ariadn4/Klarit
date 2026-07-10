## 1. 依赖与共享类型

- [x] 1.1 `npm view` 确认后加入依赖：`yaml@^2.9.0`、`@dnd-kit/core@^6.3.1`、`@dnd-kit/sortable@^10.0.0`
- [x] 1.2 在 `src/shared/types.ts` 定义工作流类型：`WorkflowDefinition`、`WorkflowStage`、`WorkflowNode`、执行者联合类型（agent/engine/command/subworkflow）、agent 驱动指令判别联合（`inline` / `file`）、`WorkflowOutput`、可写范围、门
- [x] 1.3 在 `src/shared/types.ts` 的 `Project` 增加 `activeWorkflowId?: string | null`；扩展 `KlaritApi` 加入工作流库与激活相关方法签名

## 2. 工作流定义与校验（main，测试先行）

- [x] 2.1 写测试：`validateWorkflow` —— 节点恰一个执行者、id/显示名非空、产出与可写范围路径相对合规（禁绝对、禁 `..`）；先红
- [x] 2.2 实现 `validateWorkflow` 纯函数使测试转绿
- [x] 2.3 写测试：包目录读写——`workflow.yaml` 序列化/反序列化往返一致、伴随 skill 文件随包读出、损坏包返回错误而非抛出；先红
- [x] 2.4 实现工作流包读写（基于 `yaml` 库读写 `userData/workflows/<id>/workflow.yaml` + 包内 skill 文件），损坏包安全处理，使测试转绿
- [x] 2.5 写测试 + 实现内置默认工作流种子：节点序列以 `engine` 操作为主（建分支→开 worktree→占位→合并→删分支+worktree）、库为空才种、已有不覆盖、种子本身合法

## 3. 工作流库服务（main，测试先行）

- [x] 3.1 写测试：`listWorkflows` 扫描 `userData/workflows/` 下各包、列出合法工作流、跳过损坏包；先红后绿（复用 `store.ts` 约定）
- [x] 3.2 写测试 + 实现 `createWorkflow`（建包+默认模板、唯一 id）、`cloneWorkflow`（复制整包含 skill 文件、源不变）
- [x] 3.3 写测试 + 实现 `getWorkflow` / `saveWorkflow`（保存前校验，失败返回原因不写盘）
- [x] 3.4 写测试 + 实现 `importWorkflow`（整包导入、校验、id 冲突分配新 id、非法拒绝）、`exportWorkflow`（导出含 skill 文件的等价包）
- [x] 3.5 写测试 + 实现包内 skill 文件管理：新建（撰写存入包）、导入（拷入包）、移除引用时清理，引用恒为相对包路径
- [x] 3.6 写测试 + 实现 `deleteWorkflow`：先清理所有指向它的项目激活指针、再删整个包目录，删除后无悬挂引用

## 4. 项目激活工作流（main，测试先行）

- [x] 4.1 写测试：注册表读写 `activeWorkflowId`，未设置读为「未激活」、设置后读回一致、随项目身份不断链；先红
- [x] 4.2 实现 `getActiveWorkflow` / `setActiveWorkflow` 并接入注册表持久化，使测试转绿
- [x] 4.3 在 `src/main/index.ts` 注册全部工作流相关 IPC handler，preload 经 contextBridge 暴露到 `KlaritApi`

## 5. 渲染层：项目设置区与激活选择器（测试先行）

- [x] 5.1 写组件测试：设置面板含「项目设置」区、与 app 级设置分区；未绑定项目时空态不报错；先红
- [x] 5.2 在 `Settings.tsx` 实现「项目设置」区骨架（遵循品牌规范与 `@theme` 令牌），使测试转绿
- [x] 5.3 写测试 + 实现工作流激活选择器：列出全部工作流、标示当前激活、切换即时持久化并刷新

## 6. 渲染层：工作流库管理与编辑器（测试先行）

- [x] 6.1 写测试 + 实现库管理交互：新建/克隆/删除入口，操作后列表与选中态刷新
- [x] 6.2 写测试：表单式编辑器各字段按类型呈现（文本/下拉/路径输入）并填入当前值、切换执行者类型展示对应驱动指令字段、agent 驱动指令「手写/使用文件」切换映射到 kind、路径输入实时拒绝绝对路径与 `..`；先红后绿
- [x] 6.3 写测试 + 实现「使用文件」下的新建/导入 skill 交互：新建撰写存入包、导入拷入包，节点引用相对包路径
- [x] 6.4 写测试 + 实现节点有序列表与 @dnd-kit 拖拽排序（新顺序即定义节点次序）、新增/删除节点
- [x] 6.5 写测试 + 实现保存：合法写回包（`workflow.yaml` + skill 文件）并刷新列表/激活选择器；非法阻止保存并提示原因、磁盘不变

## 7. 收尾验证

- [x] 7.1 `npm run typecheck` 与 `npm run test:run` 全绿
- [x] 7.2 `npm run dev` 手动走查：新建→编辑（拖拽排序）→保存→切换激活→重启保持；删除被激活工作流后无悬挂引用
- [x] 7.3 运行 `openspec validate add-workflow-management` 通过
