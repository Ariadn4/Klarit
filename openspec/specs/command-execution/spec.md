# command-execution Specification

## Purpose
定义引擎共用的**可取消命令运行器**：在指定工作目录下经 shell 跑任意 CLI 命令、流式捕获 stdout/stderr、以结构化结果返回退出码而永不抛错，并支持经取消信号杀掉整棵进程树。供命令节点、客观门与人工门动作按钮共用。

## Requirements

### Requirement: 可取消的命令运行器

系统 SHALL 提供一个**可取消的命令运行器**:在指定工作目录(`cwd`)下经 shell 跑一条任意 CLI 命令字符串,**流式**捕获其 stdout/stderr,并在结束时返回**结构化结果** `{ code, stdout, stderr, killed }`(退出码 + 全量输出 + 是否被取消)。运行器 MUST **永不抛**——失败以非零 `code` 表达(由调用方据 `code` 判定,不靠 try/catch 控流),与既有 git 运行器一致。它经 shell 解析命令(命令为工作流作者自填的可信输入),供引擎的命令节点、客观门与人工门动作按钮共用。

运行器 SHALL 接受一个可选**取消信号**:信号触发时 MUST **杀掉该命令的整棵进程树**(不止父 shell,连其子孙进程一并终止),使「`shell` 起的命令再 fork 出的子进程」不残留。被取消时结果 MUST 标记 `killed` 为真,供上层区分「命令真失败」与「被主动打断」。

#### Scenario: 成功命令返回退出码与输出
- **WHEN** 在一个目录下跑一条成功的命令
- **THEN** 返回 `code=0` 与捕获的 stdout,Promise 正常 resolve(不抛),`killed` 为假

#### Scenario: 失败命令以结构化结果返回而非抛错
- **WHEN** 跑一条非零退出的命令(如不存在的命令、或脚本主动非零退出)
- **THEN** 返回非零 `code` 与 stderr 文本,Promise 仍 resolve,`killed` 为假

#### Scenario: 流式增量输出
- **WHEN** 命令持续向 stdout/stderr 输出
- **THEN** 运行器在命令结束前即以增量块的形式回调输出(不必等命令退出才一次性给出),并同时累积全量供终态结果

#### Scenario: 取消即杀整棵进程树
- **WHEN** 一条命令(及其再起的子进程)正在运行时取消信号被触发
- **THEN** 该命令及其所有子孙进程被终止,运行器以 `killed` 为真返回,不残留孤儿进程

#### Scenario: 永不退出的命令可被取消
- **WHEN** 一条不会自行退出的长驻命令(如启动一个常驻服务)被取消
- **THEN** 进程树被终止,运行器以 `killed` 为真返回
