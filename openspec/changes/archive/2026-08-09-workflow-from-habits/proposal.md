## Why

`auto-workflow-on-import`(已落)让自动 author 产出**整份** `WorkflowDefinition`。dogfood 实测反复暴露:author 在**脊柱与归档**上不可靠——分支/合并/清理/验收/归档的**位置**老是搞错(archive-docs 排到合并后、归档排到验收前、opsx 归档与预制 archive-docs 冗余并存),而 prompt 求 LLM 已被证明治不住(step 1 喂回 2 轮仍不改)。

根因:让 LLM 产**整份**流,就把「本该固定的脊柱」也交给它去猜。改法(用户拍板):**把脊柱写死,只让 LLM 生成中间的「干活」段**——

```
固定头(写死)：建分支 → 开 worktree → 关联环境
生成中间(LLM,按项目习惯)：立规格 → 实现 → 自检 …（纯干活）
固定尾(写死,仅 本地直合/PR 变体)：
  【人工验收门】→ 归档 → 合并 → 推送 → 删 worktree → 删本地分支
```

脊柱固定后,**排序问题从结构上消失**（验收/归档/合并/清理位置永远对,LLM 错不到脊柱）,**不需要任何 lint/repair 去检测归档排序**——只靠结构 + 轻量 LLM 规范。

归档这步:**仍用 `archive-docs`**,但它要归档的**文档清单由 author 生成时直接列出**（author 本就用 `--add-dir` 读项目）,`archive-docs` 节点自带清单直接归档,**不再需要第二步扫描**（`demand-driven-doc-scan` 的扫描降为「节点没带清单」时的兜底）。

## What Changes

- **内置工作流脚手架(固定头/尾 + 中间注入点)**:新增脚手架 `buildScaffoldedWorkflow(variant, middle, archiveDocPaths)`（纯函数,shared）——把固定头、生成的中间、固定尾（含人工验收门、归档 `archive-docs` 槽、合并/推送/清理）按 `variant`（本地直合 / PR）拼成完整合法 `WorkflowDefinition`。顺序钉死:**中间干活 → 验收门 → 归档 → 合并 → 清理**。
- **自动 author 产出经脚手架规整(机制:产整份→规整,不改产出契约)**:自动路 author 照旧产整份,系统把其**干活节点当中间**喂给 `buildScaffoldedWorkflow`——脊柱类节点(分支/合并/清理/验收门/归档)被**丢弃并以固定脊柱替换**,变体由产出推断,归档清单从其 archive-docs 节点抽出。故 author 把脊柱摆错也无所谓。产出仍过两闸校验。**聊天写工作流路不变**。（比改 author「只产中间」的契约更稳,结果等价。）
- **`archive-docs` 消费节点自带清单,扫描降兜底**:`archive-docs` 节点携带 author 列的文档清单时,`runArchiveDocsNode` **按该清单归档**、不读扫描登记表；节点无清单时才回落到 `demand-driven-doc-scan` 的登记表（兜底,不废弃已有机制）。
- **写工作流 skill 加轻量归档规范(正向、通用、不点名)**:author skill 教——中间段**尽量只 1 个文档归档节点**；项目**有自己的归档方式就优先用它**（措辞通用,不点名具体技能）；它没覆盖到的文档,由 author **列进 `archive-docs` 节点的清单**。归档**不设门**,但（脚手架已保证）在验收之后。
- **archive-docs 配置由 author 产出、去掉独立文档 agent(实测反馈)**:实测保存/激活后仍有一次额外扫描——因 author 没填清单、空清单触发激活扫描。改:Klarit 用 `scanCandidates` **廉价枚举**项目文档喂给 author,author **剔除项目自有归档覆盖的、剩余分动态/快照**,写进 archive-docs 节点配置（字段升级 `string[]` → `{path,kind}[]`）。归档配置随工作流一次产出,**移除激活时的扫描触发、自动流不再跑独立文档分析 agent**（取代 `demand-driven-doc-scan` 的激活扫描）。登记表/手动重扫留作兜底。

## Capabilities

### Modified Capabilities
- `workflow-authoring`: (a) 新增**脚手架装配**——自动 author 产「中间 + 归档清单 + 变体」,系统以固定头/尾脚手架（本地直合/PR 变体、验收→归档→合并次序钉死）拼成整份 `WorkflowDefinition`；(b) `buildAuthorWorkflowSkill` 相应改为教「只产中间干活段 + 列归档清单 + 选变体」，并加轻量归档规范（≤1 归档节点、优先项目自带归档、通用不点名）。聊天整份产出路径不变。
- `workflow-definition`(或新 `workflow-scaffold`): 定义内置脚手架的**固定头/尾结构**与**变体**（本地直合 / PR）、及钉死的顺序（中间→验收门→归档→合并→清理）。
- `document-archive`: `archive-docs` SHALL 支持**节点自带文档清单**（author 列）作为归档来源；有清单则据其归档、无清单回落扫描登记表（兜底）。

## Impact

- **依赖 / 复用**:建立在 `auto-workflow-on-import`（脚手架尾复用其审批门/清理/合并节点写法）、`demand-driven-doc-scan`（降为 archive-docs 无清单时的兜底）之上。复用 `repairWorkflow`+两闸校验兜合法性。
- **代码**:`src/shared/workflow.ts`（`buildScaffoldedWorkflow` + 脚手架模板 + skill 改写）；`src/main/orchestrate-service.ts` / `workflow-onboarding.ts`（自动路改用脚手架装配产出）；`src/main/engine/engine.ts`（`runArchiveDocsNode` 支持节点自带清单、无则回落登记表）。
- **兼容**:聊天整份产出、既有内置默认工作流、既有 archive-docs+登记表机制均保留（archive-docs 清单缺省时行为不变）。自动路产出形态变（中间+清单+变体→装配）。
- **不需要**:归档排序的 lint/repair（脚手架结构消灭了排序问题）。
- **不在本 change**:习惯→执行器 tool/model 映射、Cursor习惯vs本机Claude 调和——正交,后续增量。
