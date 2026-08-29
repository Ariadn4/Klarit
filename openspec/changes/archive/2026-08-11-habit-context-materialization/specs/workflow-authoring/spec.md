## MODIFIED Requirements

### Requirement: 自动 author 须能读到项目文件

自动(无头)author 一份「照项目习惯写」的工作流时,系统 SHALL 让 author agent **能读到该项目的习惯材料**——把一个 per-run 物化的**习惯上下文包**（组成与生命周期见 `workflow-onboarding`）作为 agent 的**可访问目录**（如 `--add-dir`）传入。该包内含项目习惯痕迹文件的**逐字副本**、各文件真实路径的 manifest，以及 Klarit 预先跑好的廉价确定性摘要（`git log --oneline`、各成员仓 `package.json` 的 scripts、成员仓清单、深度受限的项目目录清单）。

系统 SHALL **不再**把项目各成员仓根目录整体作为可访问目录传入——那是「author 在大项目上极慢、CPU 累计上万秒」的成因；author 需要的习惯材料已由 Klarit 确定性地收集进包中。

系统意图 SHALL 相应告知 agent「本项目的习惯材料已收集在可访问目录中，直接读它、不必也无法遍历整个项目」,并保留**只读约束**:只做只读探查、只输出工作流定义、不改动任何文件。

author 的**产出契约不变**——照旧产出整份工作流定义，照旧经固定脚手架规整与既有两闸校验。

#### Scenario: author 拿到的是上下文包而非仓根

- **WHEN** 自动 author 触发
- **THEN** author agent 的可访问目录是本次物化的习惯上下文包,**不含**项目成员仓根目录

#### Scenario: 包内可读到痕迹原文

- **WHEN** 项目某成员仓有 `CLAUDE.md` 与 `.claude/`
- **THEN** author 能在包内读到它们的逐字副本,内容与原文件逐字节相同

#### Scenario: 包内可读到预算摘要

- **WHEN** author 需要推断提交习惯与常用命令
- **THEN** 包的 manifest 已含 `git log --oneline` 近若干条与各成员仓 `package.json` 的 scripts,author 无需自行起子进程获取

#### Scenario: 意图带只读约束与「材料已备」告知

- **WHEN** 合成自动 author 的系统意图
- **THEN** 意图告知习惯材料已收集在可访问目录中,并约束只读探查、只输出工作流、不改动任何文件

#### Scenario: 产出契约不变

- **WHEN** author 基于上下文包产出工作流定义
- **THEN** 产出照旧为整份定义,照旧经脚手架规整与两闸校验,契约与本变更前一致
