## ADDED Requirements

### Requirement: 习惯痕迹枚举与逐字物化,与存在性门控并存

系统 SHALL 提供**习惯痕迹的路径枚举**：对各成员仓根按既有标记集（`.claude/`、`CLAUDE.md`、`.cursor/`、`AGENTS.md`、`.codex`、`.github/`）产出**命中的具体路径清单**。

该枚举与既有的**存在性门控**（「习惯痕迹为轻量存在性门控,不抽取内容」）**并存**，MUST NOT 取代它：门控答「有没有可学的东西」用于决定要不要跑 author，枚举答「在哪」用于备料。二者 MUST 共用同一标记集，不得各自维护一份。

系统 SHALL 把枚举命中的文件**逐字复制**进一个 per-run 的**习惯上下文包**目录。复制 MUST 是逐字的：

- MUST NOT 解析、摘要、改写或裁剪文件内容
- MUST NOT 做行数截断或「只取前 N 字节」——author 读到的必须与原文逐字节相同
- 文件超出体积上限时 MUST **整个不收录**并在 manifest 中标注「过大未收录」，MUST NOT 收录半截内容（半截的规矩文件比没有更容易让 author 误判）

因此「Klarit 决定哪些文件值得给、author 决定这些文件说明什么」的分工不变——本要求 MUST NOT 被解读为对既有「不抽取内容」约束的放宽。

#### Scenario: 枚举与门控共用标记集

- **WHEN** 某成员仓有 `CLAUDE.md` 与 `.cursor/`
- **THEN** 存在性门控返回「有习惯」，枚举返回这两条具体路径，二者依据同一标记集

#### Scenario: 逐字复制不改一个字

- **WHEN** 某成员仓的 `CLAUDE.md` 被物化进包
- **THEN** 包内副本与原文件逐字节相同（无摘要、无截断、无改写）

#### Scenario: 超大文件整个不收录并标注

- **WHEN** 某痕迹文件超出体积上限
- **THEN** 包内不含该文件，manifest 标注其路径与「过大未收录」

#### Scenario: 无痕迹时不物化

- **WHEN** 存在性门控判定项目「无习惯」
- **THEN** 不建包（自动 author 本就不因习惯而触发）

### Requirement: 上下文包的 manifest 组成

习惯上下文包 SHALL 附一份 manifest，至少含：

- 包内每个文件**在原项目中的真实绝对路径**（多仓项目必需——两个成员仓可能各有一个同名 `CLAUDE.md`）
- 各成员仓清单
- `git log --oneline` 近若干条（每个成员仓）
- 各成员仓 `package.json` 的 `scripts`（存在时）
- **深度受限的项目目录清单**（只列路径、不读内容），使 author 能知道项目大致构成、判断有无明显该看却未收录的东西

manifest 中的摘要项 MUST 为**原样输出**——Klarit 跑命令取回什么就贴什么，MUST NOT 解读或归纳。

包内文件 SHALL 按 `<成员仓名>/<原相对路径>` 组织，以免多仓同名文件互相覆盖。

#### Scenario: manifest 给出真实路径

- **WHEN** 包内含一份来自成员仓 `web` 的 `CLAUDE.md`
- **THEN** manifest 标明其真实绝对路径，且包内位置为 `web/CLAUDE.md`

#### Scenario: 多仓同名不覆盖

- **WHEN** 两个成员仓各有一个 `CLAUDE.md`
- **THEN** 二者分别落在各自成员仓名的子目录下，都能被读到

#### Scenario: 摘要原样不解读

- **WHEN** manifest 收录 `git log --oneline` 输出
- **THEN** 收录的是命令原始输出，Klarit 不对提交习惯做任何归纳

### Requirement: 上下文包为 per-run,绝不写进用户仓库

习惯上下文包 SHALL 在每次自动 author 调用时新建，并在该次调用结束（正常或异常）后**清理**，不残留。

包 MUST **建在应用自己的临时区**，MUST NOT 建在任何成员仓内、MUST NOT 建在项目目录内——写进用户仓库会进 git 并污染用户项目。

#### Scenario: 调用结束后清理

- **WHEN** 一次自动 author 调用结束（含 author 失败或超时的情形）
- **THEN** 本次的上下文包被清理，不残留

#### Scenario: 不写进成员仓

- **WHEN** 系统为一次 author 调用物化上下文包
- **THEN** 包路径不在任何成员仓内、不在项目目录内，用户仓库的 git 状态不受影响
