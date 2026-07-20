## ADDED Requirements

### Requirement: 文档登记表领域模型

系统 SHALL 定义一等概念「文档登记表」（document registry），per-成员仓（`RepoMember`）持久化，作为下游文档操作的**单一事实源**。模型 MUST 含：

- `DocKind`：判别联合 `'dynamic' | 'snapshot'`——**仅此两值**；「不纳管」不是一个 kind，它表达为**该文档不在登记表内**。
- `ManagedDoc`：三件套 `{ id, location, kind, habitPrompt, approved }`，`location` 为**相对成员仓根**的路径；文件夹级条目额外带 `isFolder: true` 与 `coversFiles: string[]`（该文件夹下所有纳管叶子的相对路径）。
- `DocRegistry`：`{ memberId, docs: ManagedDoc[], conventionPreamble: string, conventionApproved: boolean }`——`conventionPreamble` 是项目级「文档公约」（跨文件通则）。

`habitPrompt` 与 `conventionPreamble` 未经审批（`approved` / `conventionApproved` 为 `false`）时 MUST 被视为**草稿**，下游文档操作 MUST NOT 依赖未审批的 prompt 行使习惯（至多按 `kind` 兜底）。

#### Scenario: kind 仅两值，不纳管即不在表
- **WHEN** 一个文档被用户从两桶都移出
- **THEN** 它从 `docs[]` 中移除，登记表**不**为它保留任何 `kind` 值或占位条目

#### Scenario: 文件夹级条目带 coversFiles
- **WHEN** 一条 `ManagedDoc` 的 `isFolder` 为 `true`
- **THEN** 它带 `coversFiles`，列出该文件夹下所有被纳管的叶子文件相对路径

#### Scenario: 未审批 prompt 视为草稿
- **WHEN** 一条 `ManagedDoc` 的 `approved` 为 `false`
- **THEN** 该条的 `habitPrompt` 被标为草稿，读取方据 `approved` 判其是否生效

### Requirement: 扫描候选与 agent 语义分析

系统 SHALL 提供候选收集（离线）：遍历成员仓目录，遵守 `filetree` 的 `IGNORED_DIRS` **并叠加该仓 `.gitignore`**，收集文本文档候选叶子（如 `.md/.txt/.rst/.adoc`），排除被忽略目录与二进制/代码文件。遍历 MUST **不跟进符号链接/junction**（防走进 worktree/外部大目录或成环）且跳过点开头目录（`.claude`/`.vscode` 等工具配置噪声）。

有可用 agent 时，**分组、分类与起草 SHALL 由 agent 一体完成**：一次调用，输入为候选文件清单（全量相对路径）与内容样本（取样限流），输出为按**「是否是一类」**组织的条目清单——每条含 `location`（文件或文件夹）、`kind`、`habitPrompt`——与项目级公约。**跨类文件夹 MUST 拆开**（如 `openspec/changes` 与 `openspec/specs` 分列两条），互不同类的草稿夹 MUST NOT 合并成一条，噪声（模板/许可证等）不列。agent 产出 MUST 经规整校验：`location` 必须真实存在于候选中（文件精确匹配；文件夹按前缀圈出 `coversFiles`），幻觉条目丢弃，`kind` 仅两值，全部 `approved:false`。

#### Scenario: agent 按语义拆开跨类文件夹
- **WHEN** agent 分析返回 `openspec/changes`（dynamic）与 `openspec/specs`（dynamic）两条
- **THEN** 登记表含两条独立条目，各自圈出自己子树的 `coversFiles`——不因同 kind 被合并成一条 `openspec`

#### Scenario: agent 幻觉条目被过滤
- **WHEN** agent 返回一条 `location` 在候选中不存在（既非候选文件、也非任何候选的前缀夹）
- **THEN** 该条被丢弃，不进登记表

无 agent 或 agent 调用失败时，系统 MUST 回落**纯路径/文件名启发式**（不读内容）把每个候选叶子判为 `dynamic`、`snapshot` 或**不纳管**，并如实报告降级原因。启发式信号分**强弱两级**：

- **强信号**（整词匹配路径段/文件名 token）：快照信号（`adr`、`decision`、`changelog`、`release`、`meeting`、`retro`、`postmortem`、日期前缀等）→ `snapshot`；动态信号（`readme`、`architecture`、`design`、`spec`、`prd`、`guide`、`seed` 等）→ `dynamic`。仅一侧命中即判该侧。
- **弱兜底（文档目录）**：两侧强信号都命中（冲突）或都未命中时，若该叶子位于**文档目录**（路径含 `docs`/`doc`/`documentation` 段）→ 判 `dynamic`（文档目录里的东西默认是要管的文档，而非直接蒸发；用户可改判）。
- 以上都不中 → **不纳管**（不进两桶，用户可后续手动添加）。

启发式分类 MUST 能在**无 agent** 时独立完成（离线纯函数）。

#### Scenario: 被忽略目录不进候选
- **WHEN** 扫描一个含 `node_modules/`、`dist/`、及 `.gitignore` 所列 `build/` 的仓
- **THEN** 这些目录下的文档**不**出现在候选叶子中

#### Scenario: 快照信号归快照
- **WHEN** 候选叶子路径为 `docs/adr/0003-use-dockview.md`
- **THEN** 它被启发式判为 `snapshot`

#### Scenario: 动态信号归动态
- **WHEN** 候选叶子路径为 `docs/architecture.md`
- **THEN** 它被启发式判为 `dynamic`

#### Scenario: 模糊项落不纳管而非硬塞
- **WHEN** 候选叶子为仓根的 `notes.md`，无快照亦无动态信号、也不在文档目录下
- **THEN** 它被判为**不纳管**（不进任一桶），而非被强行归入某桶

#### Scenario: 文档目录下无强信号默认动态（不蒸发）
- **WHEN** 候选叶子为 `docs/project-goals.md`，文件名无强信号
- **THEN** 它按文档目录弱兜底判 `dynamic`，出现在登记表里供用户改判

#### Scenario: 强信号胜过文档目录弱兜底
- **WHEN** 候选叶子为 `docs/CHANGELOG.md`
- **THEN** 强快照信号胜出，判 `snapshot`

### Requirement: 文件夹坍缩（按「是否是一类」区分，启发式兜底路径）

**适用范围：无 agent / agent 失败的兜底路径**（agent 主路径由 agent 按语义自行分组）。系统 SHALL 按**「是否是一类」**组织登记表：

- **是一类**（一个非仓根文件夹下全部纳管叶子同 `kind`、≥2 个，不纳管者跳过）→ 坍缩成**一条**文件夹级 `ManagedDoc`（`isFolder: true`、`coversFiles` 为该子树全部纳管叶子），收在**最高有意义的层**、不逐子夹展开；纯中转链（无直属纳管叶子、只有一个含内容子夹）继续下钻、收在有意义的那层。
- **不是一类**（子项含不同 `kind`，如 `docs/` 下动态快照混杂）→ 该文件夹**不**坍缩：文件**单独成条**，其下同类子夹各自按上一条规则收。

坍缩 MUST 为纯函数、可测。

#### Scenario: 同类文件夹坍缩为一条
- **WHEN** `docs/adr/` 下 8 个叶子全为 `snapshot`（`docs/` 下无其它文档）
- **THEN** 结果含一条 `{ location: 'docs/adr', isFolder: true, kind: 'snapshot', coversFiles: [8 项] }`，而非 8 条（中转链下钻：收在 `docs/adr` 而非笼统的 `docs`）

#### Scenario: 多个同类子夹收成父夹一条
- **WHEN** `openspec/changes/` 下几十个 change 子夹的叶子全为 `dynamic`
- **THEN** 结果只含一条 `{ location: 'openspec/changes', isFolder: true }`，不逐 change 出条目

#### Scenario: 混合文件夹不坍缩
- **WHEN** `docs/` 直属含 `architecture.md`(dynamic) 与子夹 `adr/`(snapshot)
- **THEN** `docs/` 本身不坍缩：`architecture.md` 独立成条、`adr/` 各自按同类规则坍缩

#### Scenario: 坍缩跳过不纳管子项
- **WHEN** `docs/spec/` 下有 3 个 `dynamic` 叶子与 1 个不纳管叶子
- **THEN** `docs/spec/` 坍缩为一条 `dynamic`，`coversFiles` 只含那 3 个纳管叶子

### Requirement: 读内容样本起草习惯 prompt

起草是 agent 语义分析的一部分：agent **MUST 读文档内容样本**（文件级读文件头；文件夹级取样若干代表文件），据样本推断**格式类习惯**（模板结构、字段、命名规则、时态语气）写入各条 `habitPrompt`；并起草跨文件通则写入 `conventionPreamble`。习惯 prompt 与公约 MUST **只写正向要求与示例**（要怎么写），不用反例/禁止式表述。所有起草结果初始 `approved`/`conventionApproved` 为 `false`。

无可用 agent 时，系统 MUST **跳过起草**、仍产出登记表（启发式分类与坍缩，`habitPrompt` 为空），并可后续按需重新分析。

#### Scenario: 起草读样本并写入 habitPrompt
- **WHEN** 对 `docs/adr/` 起草，样本显示 Nygard 模板与 `NNNN-kebab.md` 命名
- **THEN** 其 `habitPrompt` 草稿含该模板与命名约定，且 `approved` 为 `false`

#### Scenario: 无 agent 时跳过起草仍出表
- **WHEN** 扫描时无可用 agent
- **THEN** 登记表照常生成（启发式 kind 与坍缩），各条 `habitPrompt` 为空，不阻断流程

### Requirement: 登记表编辑与审批

系统 SHALL 支持对登记表的编辑：**改判**（在 `dynamic`/`snapshot` 间切换某条 `kind`）、**移出**（从 `docs[]` 删除一条 = 落隐式不纳管）、**添加**（把一个文件或文件夹加入某桶，可为先前移出者或未扫到者）、**改路径**（编辑某条 `location`——agent 分组不合意时手动收级；与既有条目撞路径不应用）、**编辑** `habitPrompt`/`conventionPreamble`。**审批以「确认保存」为动作**：确认保存把当前表整表置为已审批（各条 `approved:true` + `conventionApproved:true`）；编辑 prompt/路径/公约会把对应审批打回 `false`（批的是当时那份内容）。所有编辑经持久化 MUST 落盘。

#### Scenario: 改判切换 kind
- **WHEN** 用户把 `CHANGELOG.md` 从快照改判为动态
- **THEN** 该条 `kind` 变为 `dynamic` 并持久化

#### Scenario: 移出即离表
- **WHEN** 用户移出 `LICENSE`
- **THEN** 该条从 `docs[]` 删除、持久化后不再出现在任一桶

#### Scenario: 添加找回移错者
- **WHEN** 用户经「添加文件/文件夹」选中先前移出的 `LICENSE` 并指定为动态
- **THEN** 它以 `kind: 'dynamic'` 重新进入 `docs[]`

#### Scenario: 编辑后确认保存即审批
- **WHEN** 用户改动某条 `habitPrompt` 文本后点「确认并保存」
- **THEN** 该条以修改后的文本 `approved: true` 持久化（整表随之全部已审批）

#### Scenario: 改路径收级
- **WHEN** 用户把 `openspec/changes/add-x` 条目的路径改为 `openspec/changes`
- **THEN** 该条 `location`/`id` 更新且回未审批草稿；若表内已有 `openspec/changes` 条目则不应用

#### Scenario: 移除项目/解绑成员连带删登记表
- **WHEN** 用户移除一个项目（或把某成员仓从项目解绑）
- **THEN** 其成员仓的登记表随之删除；此后重新导入/关联即**白纸重新识别**（重新扫描、不带旧表）
