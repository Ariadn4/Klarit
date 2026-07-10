## 1. 行为实现（已落地，回填登记）

- [x] 1.1 `openProject` IPC 按 `manager.current(win)` 是否为空分流：未绑定→`bindWindow`（本窗口），已绑定→`openProject`（新窗口/聚焦）
- [x] 1.2 渲染层选项目后刷新当前窗口（`onSelectProject` await 后 `refresh`），使本窗口绑定即时呈现

## 2. 回归测试（已存在）

- [x] 2.1 e2e：空窗口（registry 有项目、无会话恢复）选项目 → 在本窗口打开、窗口数仍为 1
- [x] 2.2 e2e：已绑定窗口选另一个项目 → 新窗口、原窗口不变（既有用例保持绿）

## 3. 文档一致性

- [x] 3.1 回填 `workspace-windows`「在新窗口打开项目」要求，使 spec 与代码一致
