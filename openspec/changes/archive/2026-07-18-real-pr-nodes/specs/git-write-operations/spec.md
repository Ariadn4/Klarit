## ADDED Requirements

### Requirement: 拉取并判定分支已合并 / 上游 gone

系统 SHALL 提供一个**平台无关、免平台 CLI** 的只读判定原语,供**外部门 `pr-merged`**(见 `engine-execution`「引擎执行外部门」)核查「feature 分支是否已在其托管平台上合并」——**只用 git**,不调 `gh`/`glab` 等任何平台工具。该原语 MUST 先 `fetch --prune`(把远端最新态与已删远端分支同步下来),再据下述**任一**信号判定「已合并」:

- **已并入基分支**:feature 分支的提交已是其基分支(如 `origin/main`)的祖先(普通/快进合并即此)。
- **上游 gone**:feature 分支的上游远程分支已不存在(`gone`)——对应平台「合并后自动删分支」;这也是 **squash/rebase 合并**下唯一稳的信号(此时提交不作祖先出现,靠远端分支被删来判定)。

原语 MUST 返回**结构化结果**,足以让上层(`engine-execution` 的**外部门 `pr-merged`**)判定「已合并 / 尚未合并」,且对「无上游 / 无远端 / fetch 失败」等情形 MUST 以结构化结果表达而非抛错(与写侧其余原语一致,不靠 try/catch 控流)。该原语为**只观察**语义——除 `fetch --prune` 同步远端引用外,MUST NOT 改动本地分支、工作区或提交。

#### Scenario: 已并入基分支判为已合并
- **WHEN** 对一个其提交已是 `origin/<base>` 祖先的 feature 分支执行该判定
- **THEN** `fetch --prune` 后判为已合并,结构化结果标记 merged

#### Scenario: 上游 gone 判为已合并
- **WHEN** feature 分支的上游远程分支已被平台删除(合并后自动删分支)
- **THEN** `fetch --prune` 后该上游变 `gone`,判为已合并(覆盖 squash/rebase 合并)

#### Scenario: 未合并判为尚未合并
- **WHEN** feature 分支既未并入基分支、上游也仍存在
- **THEN** 判为尚未合并,结构化结果标记 not-merged,不抛错

#### Scenario: fetch 失败以结构化结果表达
- **WHEN** `fetch` 因无远端/网络失败
- **THEN** 原语返回结构化失败结果(而非抛异常),由上层据此决策
