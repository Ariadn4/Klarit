# 设计:固定脚手架 + 只生成中间

## 核心:脚手架把脊柱写死,LLM 只填中间

```
┌ 固定头(写死,所有变体同) ──────────────┐
│ create-branch → open-worktree → link-env    │
├ 生成中间(LLM 按项目习惯,纯"干活")──────┤  ← author 只产这段(+ 归档清单 + 选变体)
│ 立规格 → 实现 → 自检 …                      │
├ 固定尾(写死,本地直合/PR 变体)──────────┤
│ 【人工验收门 manual】← 固定                   │
│ 归档 archive-docs（自带 author 列的文档清单）← 固定槽,验收后合并前,不设门 │
│ 本地直合: merge-branch → push-branch → remove-worktree → delete-branch │
│ 或 PR:    push-branch(+manual评审) → open-pr(external pr-merged) → remove-worktree → delete-branch │
└──────────────────────────────────────┘
```

**顺序钉死:中间干活 → 验收门 → 归档 → 合并 → 清理。** 排序问题 ①②③ 从结构上消失,不需 lint/repair。

## 实现:自动 author 产「中间 + 清单 + 变体」,系统装配

- **产出契约(自动路)**:author 产 `{ variant: 'local-merge'|'pr', middle: WorkflowNode[], archiveDocPaths: string[] }`,不产整份。
  - `middle`：纯干活节点（agent/command，项目习惯的实现流程），**不含**分支/worktree/合并/推送/清理/验收门/归档——那些是脚手架的。
  - `archiveDocPaths`：author 读项目后列出的、该由 `archive-docs` 归档的文档路径（技能没覆盖的那部分）。
  - `variant`：本地直合还是 PR（按项目习惯/有无 remote 推断）。
- **装配**:`buildScaffoldedWorkflow(variant, middle, archiveDocPaths, meta)`（纯函数,shared）→ 固定头 + middle + 验收门 + archive-docs(paths) + 固定尾(variant)。产出过 `repairWorkflow`+两闸校验兜底。
- **脚手架尾复用** step 1 的节点写法:审批/验收门（manual）、合并/推送/清理引擎节点、PR 变体的 open-pr+external 门。
- **聊天路不变**:仍产整份 `WorkflowDefinition`（用户全权控制、可搭任意结构）。脚手架只管**自动路**。

## archive-docs:节点自带清单,扫描降兜底

- `archive-docs` 节点新增可选**文档清单**（author 列的路径,存在节点配置里,如 `writableScope` 或专门字段）。
- `runArchiveDocsNode`：节点带清单 → **按清单归档**（agent 直接写这些文档,不读扫描登记表）；节点无清单 → 回落到 `demand-driven-doc-scan` 的登记表（兜底,机制不废）。
- 因自动路的 archive-docs 恒带清单 → 自动流**不触发扫描**；`demand-driven-doc-scan` 只在「手搭 archive-docs 没列清单」时兜底。

## skill 归档规范(正向、通用、不点名)

author skill 教（配合中间产出契约）:
- 归档**尽量只 1 个文档节点**;
- **优先用项目自己的归档方式**（措辞通用——「项目若有自己的归档/沉淀约定就用它」,**不点名**具体技能名，例子只轻点）;
- 它没覆盖到的文档,**列进 `archive-docs` 的清单**。
- 归档**不设门**（脚手架已保证它在验收之后）。

## 为何不用 lint/repair 检归档

脚手架把「验收→归档→合并」的次序**结构性写死**,author 根本产不出错位的归档（它只产中间干活段,归档是脚手架固定槽）。故本 change **不加**归档排序的 lint/repair——结构消灭问题,比事后检测更稳。（step 1 的「固化前必有审批门」等既有 lint/repair 保留,不冲突。）

## 边界

- **仅自动路**改造;聊天整份产出、既有内置默认工作流、既有 archive-docs+登记表均保留。
- **不改** archive-docs 无清单时的既有行为（回落登记表）。
- **不在本 change**:习惯→执行器 tool/model 映射、Cursor习惯vs本机Claude 调和（正交,后续增量）。

## 待落地时定的小things(非阻塞)

- `middle` 里若 author 误产了分支/合并类节点 → 装配时**丢弃**（只取干活类；比照 repairWorkflow 的「丢非法节点」）。
- `variant` 缺省 → 本地直合。
- 脚手架的 stage 归属:头=准备、中间=实现（author 可细分 stage,但都归中段）、尾=交付。

## 归档文档配置由 author 产出(去掉独立文档 agent 与激活扫描,实测反馈)

实测:工作流保存/激活后**还有一次额外扫描**——根因是 author 没往 archive-docs 填清单(它得自己发现文档,不可靠),空清单 → 激活时 `needsDocScanOnActivate` 命中 → 触发独立的文档分析 agent。

**改法(用户拍板)**:把「发现+分类文档」从「激活后的独立文档 agent」挪进「author 生成工作流的同一次运行」:

1. **Klarit 廉价枚举 → 喂 author**:复用 `scanCandidates`(纯文件遍历、走 .gitignore、**无 agent**)列出项目文档候选,注入 author 上下文。
2. **author 剔除项目自有归档覆盖的**:author 知道自己用了项目哪套归档,把那套已覆盖的文档剔掉。
3. **剩余分动态/快照**:每个剩余文档判 `dynamic`(就地更新现状)/`snapshot`(冻结追加),写进 archive-docs 节点配置。

**字段升级**:`executor.archiveDocs` 从 `string[]` → **`{ path: string; kind: 'dynamic'|'snapshot' }[]`**(带分类)。engine `runArchiveDocsNode` 按 `{path,kind}` 归档(复用现有动态/快照委派语义,来源从扫描登记表换成节点配置)。

**去掉独立文档 agent 与激活扫描**:archive-docs 配置恒由 author 产出 → **移除激活时的 demand-driven 扫描触发**(`activateWorkflow` 里的 `needsDocScanOnActivate` 钩子),自动流**不再跑独立的文档分析 agent**(`analyzeDocuments`)。这**取代** `demand-driven-doc-scan`(已落)的激活扫描机制。

**保留、不废**:`scanCandidates`(改喂 author);文档登记表 store + 设置里手动重扫 + `analyzeDocuments` 代码——**留作手搭工作流的兜底**(archive-docs 无 author 配置时仍可回落登记表),只是**自动流不再触发**。彻底移除整个登记表子系统留作后续可选清理,不在本 change。

**审阅点仍在**:archive-docs 的文档配置在**工作流预览编辑器**里可见可改(用户采纳前照样能审/调),只是没有单独的文档 onboarding 弹窗那一步了。
