# Tasks

> 设计已定:固定脚手架 + 自动 author 产出规整到脚手架 + archive-docs 自带 author 清单 + 轻量 skill 规范(不 lint/repair)。

## 1. 脚手架装配(纯函数,核心)
- [x] 1.1 写测试:`buildScaffoldedWorkflow(variant, middle, archiveDocPaths, meta)`——本地直合/PR 两变体拼出 中间→验收门→归档→合并→清理;过 `validateWorkflow`+`checkBranchPairing`;lint 无「固化前缺审批」
- [x] 1.2 写测试:middle 混入脊柱节点 → 丢弃;variant 缺省 → 本地直合;archiveDocPaths 空 → 无清单(回落兜底);id 去重
- [x] 1.3 实现 `buildScaffoldedWorkflow` + 两变体脚手架模板(复用 step 1 尾节点写法);`executor.archiveDocs` 字段

## 2. archive-docs 支持节点自带清单
- [x] 2.1 写测试:节点带清单 → `runArchiveDocsNode` 按清单归档、不读登记表;无清单 → 回落登记表
- [x] 2.2 实现:`runArchiveDocsNode` 顶部据 `executor.archiveDocs` 选清单/登记表;`buildArchiveDelegationFromPaths` 助手

## 3. 自动 author 产出规整到脚手架
- [x] 3.1 写测试:自动 author 产出(脊柱摆错)→ `authorWorkflow` 经 `buildScaffoldedWorkflow` 规整成固定脊柱提案(lint 干净);聊天路不走脚手架
- [x] 3.2 实现:`authorWorkflow` 内 `normalizeOntoScaffold`(仅自动路);`inferScaffoldVariant`/`extractArchiveDocPaths` 助手

## 4. skill 归档规范
- [x] 4.1 写测试:`buildAuthorWorkflowSkill()` 正向含「尽量一个归档节点/优先项目自带(通用不点名,断言不含 opsx:archive)/没覆盖的列进 archive-docs/归档不设门」
- [x] 4.2 实现:skill 加归档规范段(正向讲原因、通用不点名);脊柱排序交脚手架、skill 不再教

## 5. 提案预览主操作合并为「保存并设为本项目工作流」一键(实测反馈)
- [x] 5.1 写测试(GlobalChatPanel/WorkflowEditor):chromeless 底栏未激活时主按钮=「保存并设为本项目工作流」→ 一键 save+setActiveWorkflow;已激活→「更新工作流」仅保存;保存校验不过→不激活;移除独立「设置为本项目工作流」+二次确认;设置态不受影响
- [x] 5.2 实现:WorkflowEditor chromeless 底栏合并主按钮 + i18n;GlobalChatPanel 传参

## 6. archive-docs 配置由 author 产出 + 去掉独立文档 agent/激活扫描(实测反馈)
- [x] 6.1 字段升级:`executor.archiveDocs` `string[]` → `{path,kind:'dynamic'|'snapshot'}[]`(types + `buildScaffoldedWorkflow` 带入 + `extractArchiveDocs` 抽取,更新相关测试)
- [x] 6.2 写测试/实现:engine `runArchiveDocsNode` 按 `{path,kind}` 归档(动态就地/快照追加、writableScope 限配置路径);无配置回落登记表
- [x] 6.3 写测试/实现:自动 author 路注入 `scanCandidates` 文档枚举到 prompt;skill 教「据枚举剔除自有归档覆盖、剩余分动态/快照、写进 archive-docs 配置」
- [x] 6.4 实现:移除 `activateWorkflow` 里的 demand-driven 扫描触发(`needsDocScanOnActivate` 钩子);自动流不再触发 `analyzeDocuments`;登记表/手动重扫兜底保留;写测试确认激活不再扫描

## 7. archive-docs 归档配置可见(实测:前端没渲染该字段)
- [x] 7.1 写测试/实现:WorkflowEditor 节点详情对 `archive-docs` 节点展示/编辑 `executor.archiveDocs`（一行一条:路径 + 动态/快照,可增删）;非该操作不显示;空态给提示
- [x] 7.2 实现:`logProposal` 概览带上每个 archive-docs 节点的 `archiveDocs` 配置,便于读日志核对 author 到底产没产出

## 9. 去 archive-docs 登记表兜底 + 文案(实测:不需要登记表了)
- [x] 9.1 写测试/实现:engine `runArchiveDocsNode` 无配置 → no-op 不归档、**不再回落登记表**(去掉 registry 分支);有配置照旧按 {path,kind} 归档
- [x] 9.2 i18n 文案:归档配置说明改书面版(讲清动态/快照规则、不提登记表)、空态「尚未指定要归档的文档」、下拉只留「动态/快照」
- [x] 9.3 (登记表 store/扫描/onboarding/设置面板 代码保留;整套移除留待后续单独 change B)

## 8. 收尾
- [x] 8.1 `npm run typecheck`(两套)+ `npm run test:run` 全绿(前几轮)
- [x] 8.2 手动 dogfood(多轮实测):脚手架头/尾固定正确(验收→归档→合并)、archive-docs 节点详情可见 `{path,kind}` 配置(实测 author 产出 docs/README.md=dynamic)、一键「保存并设为本项目工作流」验过。遗留:假「人工验收」(→ manual-review 引擎操作,后续)、生成慢(--add-dir,后续)——不阻塞本 change
