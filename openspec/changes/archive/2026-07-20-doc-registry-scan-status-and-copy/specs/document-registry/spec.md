## MODIFIED Requirements

### Requirement: 读内容样本起草习惯 prompt

起草是 agent 语义分析的一部分：agent **MUST 读文档内容样本**（文件级读文件头；文件夹级取样若干代表文件），据样本推断**格式类习惯**（模板结构、字段、命名规则、时态语气）写入各条 `habitPrompt`（界面上称「文档规定」）；并起草项目级公约写入 `conventionPreamble`（界面上称「项目级文档公约」）。文档规定与公约 MUST **只写正向要求与示例**（要怎么写），不用反例/禁止式表述。所有起草结果初始 `approved`/`conventionApproved` 为 `false`。

**公约起草 MUST 收窄到两项事实**：文档用什么**自然语言**写、各类文档放在**哪个目录**（目录约定）。公约 MUST NOT 起草风格类内容（排版、语气、标点、标题层级、强调与引用写法等）——风格属于各条文档规定的范畴，公约层再写一遍既累赘又容易与单条冲突。公约草稿 SHALL 保持简短。

无可用 agent 时，系统 MUST **跳过起草**、仍产出登记表（启发式分类与坍缩，`habitPrompt` 为空），并可后续按需重新分析。

#### Scenario: 起草读样本并写入 habitPrompt
- **WHEN** 对 `docs/adr/` 起草，样本显示 Nygard 模板与 `NNNN-kebab.md` 命名
- **THEN** 其 `habitPrompt` 草稿含该模板与命名约定，且 `approved` 为 `false`

#### Scenario: 公约只起草语言与目录约定
- **WHEN** agent 读样本起草项目级文档公约
- **THEN** 起草指令要求公约只写写作语言与目录约定、不写排版/语气/标点等风格条款，并保持简短

#### Scenario: 无 agent 时跳过起草仍出表
- **WHEN** 扫描时无可用 agent
- **THEN** 登记表照常生成（启发式 kind 与坍缩），各条 `habitPrompt` 为空，不阻断流程
