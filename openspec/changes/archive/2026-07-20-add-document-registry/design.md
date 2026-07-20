## Context

Klarit 无「文档」一等概念（扫描确认：`种子文档/动态文档/快照文档/spec/document` 在 `src/` 零命中）；被建模的是 `Project → RepoMember → 需求卡 → 工作流产物文件`。但导入/扫描的底层管道已齐：`project-service.ts` 的 `importProject()`、`nested.ts`、`filetree.ts`（walker + `IGNORED_DIRS` 已排 `node_modules/.git/dist`）。设置面板 `SettingsPanel.tsx` 有 section 导航骨架与 `ui/ListEditor`、`ExpandableRow` 原语。**没有**任何左右穿梭（transfer-list）组件——dnd-kit 只用于单列排序。

约束：测试先行（针对公共 API）；UI 遵 `docs/brand`、仅语义令牌、深浅双主题；动态文档只记最新现状。

本 change 只做**采集侧**；归档节点是下游。

## Goals / Non-Goals

**Goals：**
- 导入项目时扫出文本文档，启发式分成动态/快照两桶（第三态「不纳管」隐式、不上 UI）。
- 同类文件夹自底向上坍缩成一条、可见可展开。
- 读文档内容样本，为每条与项目整体起草「习惯 prompt」，逐条审批后方生效。
- onboarding 两栏改判 UI + 设置常驻编辑面板，可增删改判、编辑并审批 prompt。
- 登记表 per-成员仓持久化，作为下游归档节点的单一事实源。

**Non-Goals：**
- 不做归档节点本身（下游 change）。
- 不做登记表随归档自动增量 / 习惯漂移重扫。
- 分类不读内容（只起草读内容）；不做 LLM 分类兜底。
- 不做文档内容的编辑/预览编辑（只读样本用于起草）。

## Decisions

### 决策 1：三态但只暴露两桶——「不纳管」是隐式落点，非可见分类

用户明确：对用户只有动态、快照两类；从两桶都移出即「其他」。故模型上 `DocKind = 'dynamic' | 'snapshot'`，**不纳管不是一个 kind 值**——它就是「不在 `docs[]` 里」。UI 两栏对应两个 kind，`✕` 把一条从表里移除（=隐式不纳管），`+ 添加`把文件/文件夹（含之前移错的、或没扫到的）加回表。

- **理由**：把「不纳管」做成显式第三桶会平白多一栏、逼用户面对一堆 LICENSE/模板噪声；隐式落点让 UI 只承载用户真正要管的两类。
- **代价**：移出后不可见，必须有 `+ 添加`逆操作，否则移错找不回——已纳入 UI 契约。

### 决策 2：agent 一体做「分组 + 分类 + 起草」，启发式只当无 agent 兜底

**（dogfood 修订：推翻早期「启发式分类、agent 只起草」版本。）** 路径启发式分不出语义上的「类」——
实测把 `openspec/changes`（工作草稿）与 `openspec/specs`（主 spec）并成一条、把 docs/ 下互不相同的
草稿合成一夹。「是否是一类」本质是**语义判断**，必须读清单与内容——这正是 agent 的活。

- **agent 分析（主路径）**：一次调用，输入 = 候选文件清单（全量相对路径）+ 内容样本（取样限流），
  输出 = 按「是否是一类」组织的条目清单（每条：location（文件或文件夹）、kind、habitPrompt）+ 项目级
  公约。跨类文件夹必须拆开（changes 与 specs 分列两条），互不同类的草稿夹逐文件列，噪声（模板/
  许可证等）不列。产出经**规整校验**：location 必须真实存在于候选中（文件精确匹配、文件夹按前缀圈
  `coversFiles`），幻觉条目丢弃；kind 仅两值；全部 `approved:false`。
- **启发式兜底（降级路径）**：无 agent / agent 调用失败时退回词表启发式（强弱两级信号 + 同类坍缩，
  见下），保证离线也能出表，并向用户**如实**报告降级原因（绝不把失败误报成未配置 agent）。

```
强·snapshot: adr, decision(s), changelog, release(s), meeting, retro,
             postmortem, incident, 日期前缀(YYYY-MM-DD-*)
强·dynamic : readme, architecture, arch, design, spec, prd, guide, seed, overview, api
弱·兜底    : 位于文档目录（docs/doc/documentation 段）→ dynamic
判定       : 仅一侧强信号→该侧；冲突或无强信号→文档目录弱兜底→dynamic；都不中→不纳管
```

- **理由**：分组质量直接决定登记表可用性（它是下游归档节点的操作单元）；语义分组的 token 成本一次性、
  可接受。慢靠「统一推出 + 加载指示」解决（见决策 7），不靠牺牲质量。
- **备选**：纯启发式分类（原方案）——快、离线，但分组不可用（dogfood 实证），降级为兜底。

### 决策 7：分析完成后统一推出，过程只给加载指示

确认步**不做中间态展示**：有 agent 时，弹窗从触发起显示加载指示（分析中…），直到 agent 分析
（分组+分类+起草）一体完成才把分类与 prompt 一并呈现；无 agent 时立即呈现启发式结果 + 降级提示。

- **理由**：先展示启发式分组再被 agent 结果整体替换 = 刚看完的东西被推翻，比等待更糟。等待的
  可感知性由加载指示保证（此前 dogfood 的痛点是**无反馈**，不是等待本身）。

### 决策 3：按「是否是一类」坍缩——是一类收一条（最高层），不是一类单独标记

**（适用范围：启发式兜底路径。agent 主路径由 agent 按语义自行分组，本决策的纯函数仅在无 agent /
失败降级时组织登记表。）** 坍缩是纯函数 `collapse(leaves): ManagedDoc[]`，组织原则是**「是否是一类」**：一个子树（非仓根）**全部纳管叶子**（跳过不纳管者、≥2 个）同 `kind`（=是一类）时，坍缩为一条 `{ location: 该子树顶层夹, isFolder: true, kind, coversFiles: [全部纳管叶子相对路径] }`——多个同类子夹收成父夹**一条**；纯中转链（无直属叶子、只有一个含内容子夹）继续下钻、收在有意义的那层；**不是一类**（混合）的文件夹不坍缩——文件单独标记成条、同类子夹各自收。

```
openspec/changes/{几十个 change 夹}全 dynamic ⟹ 一条 📁 openspec/changes（不逐 change 记）
docs/adr/{0001..0008}.md 全 snapshot（docs 无它物）⟹ 一条 📁 docs/adr（中转链下钻，不笼统记 docs）
docs/{architecture.md(dyn), spec/(dyn), adr/(snap)}
       ⟹ docs/ 混合，不坍缩：architecture.md 一条、spec/ 坍缩一条、adr/ 坍缩一条
```

UI 展开一条文件夹条目即列 `coversFiles`。坍缩条目的 habitPrompt 挂在文件夹层（「这一类文档怎么写」）。

- **理由**：登记表的价值在**抽象**——用户过表时要的是「这一类文档怎么归」，几十条同类子夹条目是噪声（dogfood 实测 openspec/changes 逐夹展开出 90+ 条，不可用）。纯函数好测（先红后绿覆盖最高层坍缩/中转链下钻/混合不坍缩/部分不纳管）。

### 决策 4：习惯 prompt 三件套里的「事实 vs 意图」分工

`habitPrompt` 的内容分两半，起草与审批各管一半：

```
起草器读样本能得到（格式类，事实）      审批时用户补（频率/意图，猜不出）
────────────────────────────────      ──────────────────────────────
Nygard ADR 模板、Status 字段            "只在重大架构决策才追加一条"
文件名 NNNN-kebab.md 连号                "日常任务不写 ADR"
标题祈使句、现在时                        "spec 过时直接改、不留旧版"
```

起草器输出草稿（`approved=false`），用户可编辑后审批。**未审批 → 下游归档节点忽略该条 prompt**（可只按 kind 兜底，但不照习惯）。项目级「文档公约」前言同理：起草跨文件通则、用户审批。

- **理由**：审批不是走过场——它是补全 LLM 读不到的意图的唯一入口，也是防止起草幻觉污染归档行为的闸。

### 决策 5：per-成员仓持久化，单独的 `document-store`

登记表按 `RepoMember` 存（多仓项目每个成员仓一份），单独 `src/main/document-store.ts`（JSON in userData，比照 `card-store.ts`），不塞进 registry `store.ts`。

- **理由**：文档现状是**每个仓自己的事**（多仓项目各仓文档结构不同）；单独 store 边界清晰、迁移独立。
- **备选**：塞进 `Project`/`store.ts`——会把大数组塞进 registry JSON、与项目元数据耦合，弃。

### 决策 6：UI 不是纯 transfer-list，是「两栏策略卡 + 改判箭头」

每行要挂可编辑的 prompt，行不能只是文件名。两栏（动态左、快照右），行头是图标+路径+`⇄`(改判)+`✕`(移出)，展开区是覆盖计数（文件夹时，不列明细）+ **可编辑路径**（agent 分组不合意时手动收级）+ habitPrompt textarea。**不设逐条审批开关——「确认并保存」即整表审批**（跳过=保存未审批态；保存后再编辑会把该条打回草稿）。底部 `+ 添加文件/文件夹` + 一个「文档公约」区（项目级 prompt）。dnd-kit 拖拽改判为增强项（可后补），点 `⇄` 是基础路径。

- **理由**：既保留用户想要的「左右箭头改判」直觉，又承载三件套。复用 `ExpandableRow`/`ListEditor` 观感、语义令牌。

## Flow

```
导入项目(existing importProject)
      │
      ▼
候选收集(walker)                  # main：IGNORED_DIRS + .gitignore + 跳软链/点目录
      │  → 文本文档候选叶子清单（相对路径）
      ▼
┌── 有 agent（主路径）────────────────┐   ┌── 无 agent / 失败（兜底）──────────┐
│ analyzeDocuments(候选, 样本, agent) │   │ classify + collapse（shared 纯函数）│
│  一次调用：语义分组+分类+起草+公约   │   │  词表启发式 + 同类坍缩，离线可跑     │
│  → 规整校验（幻觉丢弃、圈 covers）  │   │  → ManagedDoc[]（无 prompt）+ 降级因 │
└──────────────┬──────────────────┘   └──────────────┬──────────────────┘
               ▼                                      ▼
onboarding 确认步                 # renderer：分析完成前只显示加载指示，完成后统一呈现；
      │                           #           改判/移出/添加/编辑/审批
      ▼
document-store.save(memberId)     # 持久化为单一事实源  ──▶ (下游)归档节点读它
```

## Risks

- **起草费 token / 慢**：文档多时逐条起草贵。缓解——文件夹坍缩天然减条数；起草可并发；无 agent 时跳过起草只出分类表，后补。
- **启发式误判**：`notes.md` 之类模糊。缓解——UI 兜底改判；模糊项默认落「不纳管草稿」而非硬塞某桶，避免误纳管。
- **`.gitignore` 解析**：需正确叠加到 `IGNORED_DIRS`。缓解——用成熟解析（`ignore` 包，`npm view` 取 latest）或复用已有忽略逻辑；测试覆盖被忽略目录不进候选。
