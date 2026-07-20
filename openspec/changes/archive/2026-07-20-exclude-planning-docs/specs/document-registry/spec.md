## MODIFIED Requirements

### Requirement: 扫描候选与 agent 语义分析

系统 SHALL 提供候选收集（离线）：遍历成员仓目录，遵守 `filetree` 的 `IGNORED_DIRS` **并叠加该仓 `.gitignore`**，收集文本文档候选叶子（如 `.md/.txt/.rst/.adoc`），排除被忽略目录与二进制/代码文件。遍历 MUST **不跟进符号链接/junction**（防走进 worktree/外部大目录或成环）且跳过点开头目录（`.claude`/`.vscode` 等工具配置噪声）。

有可用 agent 时，**分组、分类与起草 SHALL 由 agent 一体完成**：一次调用，输入为候选文件清单（全量相对路径）与内容样本（取样限流），输出为按**「是否是一类」**组织的条目清单——每条含 `location`（文件或文件夹）、`kind`、`habitPrompt`——与项目级公约。**跨类文件夹 MUST 拆开**（动态与快照混居的夹拆成各自条目），互不同类的草稿夹 MUST NOT 合并成一条，噪声（模板/许可证等）不列。

**计划类文档 MUST 排除**：agent 在分组/分类时 SHALL 判断某路径是否属于**计划类文档**（任务作用域的计划/提案产物，即"要做什么"的前瞻稿，而非沉淀成果的归档目标）；判为计划类的 **MUST NOT 列入登记表**（与噪声同处理，不纳管）。判据交给 agent 自行判断，系统 MUST NOT 硬编码计划路径清单。

agent 产出 MUST 经规整校验：`location` 必须真实存在于候选中（文件精确匹配；文件夹按前缀圈出 `coversFiles`），幻觉条目丢弃，`kind` 仅两值，全部 `approved:false`。

#### Scenario: 计划类文档被 agent 排除
- **WHEN** agent 判定某路径（如某 change/提案容器）为计划类文档
- **THEN** 它不进登记表（不纳管），而归档目标类文档照常列入

#### Scenario: agent 按语义拆开跨类文件夹
- **WHEN** 一个文件夹下动态与快照文档混居，agent 返回两条不同 `kind` 的条目
- **THEN** 登记表含两条独立条目，各自圈出自己子树的 `coversFiles`，不因同父夹被合并成一条

#### Scenario: agent 幻觉条目被过滤
- **WHEN** agent 返回一条 `location` 在候选中不存在（既非候选文件、也非任何候选的前缀夹）
- **THEN** 该条被丢弃，不进登记表

无 agent 或 agent 调用失败时，系统 MUST 回落**纯路径/文件名启发式**（不读内容）把每个候选叶子判为 `dynamic`、`snapshot` 或**不纳管**，并如实报告降级原因。启发式信号分**强弱两级**，且**计划/提案容器优先排除**：

- **计划容器排除（最高优先）**：路径经轻量判断明显属于计划/提案容器的叶子 → **不纳管**；判不准的继续走下面的信号，交用户事后改判。
- **强信号**（整词匹配路径段/文件名 token）：快照信号（`adr`、`decision`、`changelog`、`release`、`meeting`、`retro`、`postmortem`、日期前缀等）→ `snapshot`；动态信号（`readme`、`architecture`、`design`、`spec`、`prd`、`guide`、`seed` 等）→ `dynamic`。仅一侧命中即判该侧。
- **弱兜底（文档目录）**：两侧强信号都命中（冲突）或都未命中时，若该叶子位于**文档目录**（路径含 `docs`/`doc`/`documentation` 段）→ 判 `dynamic`（文档目录里的东西默认是要管的文档，而非直接蒸发；用户可改判）。
- 以上都不中 → **不纳管**（不进两桶，用户可后续手动添加）。

启发式分类 MUST 能在**无 agent** 时独立完成（离线纯函数）。

#### Scenario: 被忽略目录不进候选
- **WHEN** 扫描一个含 `node_modules/`、`dist/`、及 `.gitignore` 所列 `build/` 的仓
- **THEN** 这些目录下的文档**不**出现在候选叶子中

#### Scenario: 兜底排除计划容器
- **WHEN** 无 agent，某叶子位于明显的计划/提案容器下
- **THEN** 它被兜底判为**不纳管**，不进两桶

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

坍缩 MUST 为纯函数、可测。坍缩只作用于纳管叶子——已按「计划容器排除」剔除的计划类叶子不参与坍缩。

#### Scenario: 同类文件夹坍缩为一条
- **WHEN** `docs/adr/` 下 8 个叶子全为 `snapshot`（`docs/` 下无其它文档）
- **THEN** 结果含一条 `{ location: 'docs/adr', isFolder: true, kind: 'snapshot', coversFiles: [8 项] }`，而非 8 条（中转链下钻：收在 `docs/adr` 而非笼统的 `docs`）

#### Scenario: 多个同类子夹收成父夹一条
- **WHEN** 某父夹下多个子夹的叶子全为同一 `kind`（且均非计划容器）
- **THEN** 结果只含一条该父夹级 `ManagedDoc`，不逐子夹出条目

#### Scenario: 混合文件夹不坍缩
- **WHEN** `docs/` 直属含 `architecture.md`(dynamic) 与子夹 `adr/`(snapshot)
- **THEN** `docs/` 本身不坍缩：`architecture.md` 独立成条、`adr/` 各自按同类规则坍缩

#### Scenario: 坍缩跳过不纳管子项
- **WHEN** `docs/spec/` 下有 3 个 `dynamic` 叶子与 1 个不纳管叶子
- **THEN** `docs/spec/` 坍缩为一条 `dynamic`，`coversFiles` 只含那 3 个纳管叶子
