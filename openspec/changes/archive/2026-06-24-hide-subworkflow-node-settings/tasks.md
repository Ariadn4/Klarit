## 1. 子工作流隐藏三块

- [x] 1.1 在 `WorkflowEditor.test.tsx` 先写测试：subworkflow 节点详情不呈现可写范围/产出/检查三块（先红）。需有「其它工作流」供选（others 非空）以让 subworkflow 执行者可用
- [x] 1.2 在 `WorkflowEditor.tsx` 的 `nodeSectionVisibility` 增 `subworkflow → 三块皆否` 分支（agent/command 维持全显、engine 维持能力表）（转绿）

## 2. 校验

- [x] 2.1 `npm run test:run` 全绿（518/518）、`npm run typecheck` 通过
