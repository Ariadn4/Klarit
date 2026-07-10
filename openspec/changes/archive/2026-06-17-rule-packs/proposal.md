## Why

project-goals 的四层结构里「规则包」是核心 IP 的承载层（"文件夹结构、文档约束、架构约束等具体规范"），但目前**完全没有实体**——宪法只在文档里被提及（"规则包派生，强制遵守抽象/解耦/测试先行……"），产出模板与客观门校验在工作流里只能逐条手写、无法复用或分享。缺了规则包这一层：

- **宪法无处安放**：用户没法自定义宪法规则、没法按项目开关某条规则（比如项目 A 要「测试先行」、项目 B 不要）。
- **模板/校验无单一来源**：10 条工作流要产出同款 spec、跑同一条 `openspec validate`，得复制粘贴 10 遍，改一处要改十处。
- **没有"导入一套方法论"的能力**：project-goals 承诺"导入格式 v1 必须开放"，但没有可导入的包格式。

## What Changes

建立「规则包」这一层，作为应用级、可编辑、可导入的**治理内容库**，一步到位含三类内容与两种消费方式：

- **规则包底座**（新 `rule-pack-model`）：规则包 = 命名的、可移植的包，持有一组**带类型的条目**——`constitution-rule`（宪法规则）/ `output-template`（产出模板）/ `objective-check`（客观门校验）。以**开放的包格式**（YAML 包目录，类比工作流包）持久化于 userData、不入 git；含内置默认包、可由用户新建/编辑/删除、可导入第三方包、可导出。
- **宪法治理**（新 `project-constitution`）：**应用层编辑规则库内容**（增/改/删宪法规则、管理多个包）；**项目层激活包 + 逐条规则 on/off**；引擎据此**派生某项目的「生效宪法」=（激活包的宪法规则）−（在该项目关掉的）**，供将来注入每个 agent 节点（注入本身属引擎运行期，不在本变更）。
- **规则库管理 UI**（新 `rule-pack-library`）：**应用设置**里浏览/新建/编辑/删除/导入/导出规则包及其条目；**项目设置**里激活宪法包并逐条开关。
- **工作流引用规则包条目**（改 `workflow-definition`）：**产出模板只「引用规则库」**（`none | ref`，去掉 inline/file 嵌入、内容统一住规则库、单一来源）；**客观门校验为「裸命令 + 引用」**（`inline | ref`，一行命令仍可裸写、可复用的命名 check 从库引用）。
- **工作流编辑器接引用 + 写库**（改 `workflow-editor`）：模板引用处可选已有条目，或「新建/编辑」直接把内容写进规则库再引用（手写新建即落进库）。

## Capabilities

### New Capabilities
- `rule-pack-model`: 规则包的数据模型与开放包格式——命名包持有带类型条目（宪法规则/产出模板/客观门校验）、userData 包目录持久化、内置默认、新建/编辑/删除/导入/导出、校验。
- `project-constitution`: 宪法的治理——项目激活规则包、逐条规则 on/off、派生某项目的「生效宪法」（供将来引擎注入）。
- `rule-pack-library`: 规则库的管理界面——应用设置编辑包与条目（CRUD + 导入/导出），项目设置激活宪法包并逐条开关。

### Modified Capabilities
- `workflow-definition`: 产出模板收成 `none | ref`（只引用规则库）、客观门校验为 `inline | ref`（裸命令 + 引用），相应扩展校验与旧形态迁移。
- `workflow-editor`: 模板「不声明/从规则库引用」+「新建/编辑」写库；自动校验「裸命令/从规则库引用」；规则包编辑器三类分区。

## Impact

- 新代码：`src/shared/rule-pack.ts`（纯模型/校验/默认种子，main+renderer 共享）、`src/main/rule-pack-store.ts`（包目录读写/导入导出，类比 `workflow-store.ts`）、IPC（`shared/ipc.ts` + `preload` + `main/index.ts`）、应用设置规则库编辑 UI 与项目设置宪法开关 UI（renderer 组件）。
- 改动：`src/shared/types.ts`（`OutputTemplate`/门把校验加 `ref` 形态、规则包相关类型）、`src/shared/workflow.ts`（ref 校验）、`WorkflowEditor.tsx`（ref 选择）、`Project` 增「激活宪法包 + 项目级规则开关」状态（属项目管理数据，存 userData）。
- 持久化：新增 `userData/rule-packs/<id>/`（开放 YAML 包格式）；项目的宪法激活/开关存项目管理数据。
- 文档：`docs/project-goals.md`「规则包」「公共契约（宪法来源）」处补实体描述。
- 明确范围外（v1 non-goals）：引擎对宪法的**实际注入**、对校验命令的**实际执行**、对模板的**符合性强制**（均属引擎运行期，后续承接）；社区 **marketplace**（project-goals 定为 v2）；直接读 **OpenSpec schema** 的适配导入（先做自有开放格式，适配留下一步）；把「工作流 + 它引用的规则包」打成单一**方法论分发包**（上层打包，留模型位、不实现）。
- 无新增第三方依赖（YAML 复用既有 `yaml`）。
