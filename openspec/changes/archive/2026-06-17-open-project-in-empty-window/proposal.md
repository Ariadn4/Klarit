## Why

dogfood 过程中调整了「打开项目」的落点行为：当前窗口**没有已选项目**（空状态窗口）时，从切换器选项目应直接在**本窗口**打开，而不是另开新窗口；只有当前窗口**已有项目**时才开新窗口。该行为已在代码与 e2e 中落地，但 `workspace-windows` 主 spec 仍写着「选另一个项目 → 新窗口」，没有「空窗口 → 本窗口」这一分支。本 change 把 spec 回填到与代码一致。

## What Changes

- 修订 `workspace-windows` 的「在新窗口打开项目」要求：打开项目的落点取决于当前窗口是否已绑定项目——未绑定则在本窗口打开，已绑定则在新窗口打开（不覆盖当前项目）。
- 仅为 spec 回填（catch-up）：对应实现（`openProject` IPC 按 `manager.current(win)` 是否为空分流）与回归 e2e（「空窗口选项目时在本窗口打开（不新开窗口）」）已存在。

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
- `workspace-windows`: 「在新窗口打开项目」要求扩展——当前窗口未绑定项目时在本窗口打开，已绑定时才新窗口打开。

## Impact

- 文档：`openspec/specs/workspace-windows/spec.md` 的「在新窗口打开项目」要求。
- 代码：无新增改动（`src/main/index.ts` 的 `openProject` 处理已实现该分流）。
- 测试：无新增（`e2e/app.spec.ts` 已含「空窗口选项目时在本窗口打开」用例）。
