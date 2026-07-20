## 1. 领域模型与分类/坍缩纯函数（shared，测试先行）

- [x] 1.1 在 `src/shared/document-registry.test.ts` 写红：`classify(leaf)` 把 `docs/adr/0003.md`→snapshot、`docs/architecture.md`→dynamic、`notes.md`→不纳管；被 `IGNORED_DIRS`/`.gitignore` 覆盖的路径不产候选
- [x] 1.2 写红：`collapse(classified)` 全子项同类→一条文件夹条目（带 `coversFiles`）；混合类型不坍缩；坍缩跳过不纳管子项
- [x] 1.3 写红：`validateRegistry`/`normalizeRegistry`——kind 仅 `dynamic|snapshot`；移出=离表；未审批条 `approved:false`
- [x] 1.4 `src/shared/types.ts`：加 `DocKind`、`ManagedDoc`、`DocRegistry` 及 IPC 载荷类型
- [x] 1.5 `src/shared/document-registry.ts`：实现 `classify`（路径/名启发式，不读内容）、`collapse`（自底向上纯函数）、校验/规整
- [x] 1.6 跑绿：`npx vitest run src/shared/document-registry.test.ts`

## 2. 持久化 store（main，测试先行）

- [x] 2.1 在 `src/main/document-store.test.ts` 写红：`get(memberId)` 无表返回空壳；`save` 落盘后 `get` 读回一致；per-成员仓隔离（不同 memberId 互不覆盖）
- [x] 2.2 `src/main/document-store.ts`：per-成员仓 JSON 持久化（userData，比照 `card-store.ts`）
- [x] 2.3 跑绿：`npx vitest run src/main/document-store.test.ts`

## 3. 扫描 + 起草编排（main，测试先行）

- [x] 3.1 在 `src/main/document-scan.test.ts` 写红：`scanDocuments(dir)` 遵 `IGNORED_DIRS` + `.gitignore`，只收文本文档叶子；产出经 classify+collapse 的 `ManagedDoc[]`（无 prompt）
- [x] 3.2 写红：`draftHabits(docs, sampleReader, agent)` 读样本→为各条与项目起草 `habitPrompt`/`conventionPreamble`、`approved:false`；**无 agent 时跳过起草仍返回表**
- [x] 3.3 `src/main/document-scan.ts`：walker（复用 filetree 逻辑）+ `.gitignore` 叠加（`ignore` 包，先 `npm view` 取 latest）+ 起草编排（读样本→拉现成 agent 调用路径）
- [x] 3.4 跑绿：`npx vitest run src/main/document-scan.test.ts`

## 4. IPC 通道（main/preload/shared）

- [x] 4.1 `src/shared/ipc.ts`：加 `documents:scan` `documents:get` `documents:save` `documents:redraft`
- [x] 4.2 `src/main/index.ts`：注册对应 handler（scan→document-scan、get/save→document-store、redraft→draftHabits）
- [x] 4.3 `src/preload/index.ts`：暴露 `scanDocuments`/`getDocuments`/`saveDocuments`/`redraftDocuments`
- [x] 4.4 `src/shared/types.ts`：补 API surface 类型

## 5. renderer store（测试先行）

- [x] 5.1 在 `src/renderer/src/stores/documents.test.ts` 写红：`scan()` 调 `window.klarit.scanDocuments` 并载入；`reclassify(id)` 切 kind；`eject(id)` 离表；`add(path,kind)` 入表；`editPrompt(id,text)`/`approve(id)`；`save()` 持久化
- [x] 5.2 `src/renderer/src/stores/documents.ts`：zustand store 实现上述 action
- [x] 5.3 跑绿：`npx vitest run src/renderer/src/stores/documents.test.ts`

## 6. 两栏改判编辑器（renderer，测试先行）

- [x] 6.1 在 `DocumentRegistryEditor.test.tsx` 写红：两栏各呈一桶（无第三栏）；`⇄` 改判把行移到另一栏；`✕` 移出后两栏均不显示；展开文件夹条目露 `coversFiles` + prompt 编辑 + 审批；`+ 添加`把路径入桶；「文档公约」区可编辑+审批
- [x] 6.2 写红：仅用语义令牌、无硬编码颜色（校验关键类名不含 `bg-white`/`text-gray-*` 等）
- [x] 6.3 `src/renderer/src/components/DocumentRegistryEditor.tsx`：实现（复用 `ExpandableRow`/`ListEditor`/`Field`；`⇄` 点击改判为基础路径，dnd 拖拽改判留作增强）
- [x] 6.4 跑绿：`npx vitest run src/renderer/src/components/DocumentRegistryEditor.test.tsx`

## 7. 接入 onboarding 与设置（renderer，测试先行）

- [x] 7.1 写红：导入项目后触发扫描并以编辑器呈现；可「跳过」保存当前态；接入点覆盖 `ManageProjectsScreen`/`AgentOnboardingDialog` 之后
- [x] 7.2 写红：`SettingsPanel` 「项目设置」组含 `project-documents` 项，选中展示编辑器；设置里改判+审批落盘；触发重扫并入新文档不覆盖已审批条
- [x] 7.3 接入 onboarding 流程与 `SettingsPanel`（`SectionId` 加 `project-documents`）
- [x] 7.4 跑绿：相关组件测试

## 8. i18n 文案

- [x] 8.1 `src/renderer/src/i18n/locales/zh.ts` 与 `en.ts` 补：动态文档/快照文档、改判、移出、添加文件/文件夹、习惯 prompt、文档公约、审批、待审批、覆盖 N 个文件、跳过、重新扫描、无 agent 跳过起草提示
- [x] 8.2 确认编辑器所有可见文本与 aria-label 走 i18n，深浅两主题语义令牌不硬编码

## 9. 全量校验

- [x] 9.1 `npm run typecheck`
- [x] 9.2 `npm run test:run`（全绿）
