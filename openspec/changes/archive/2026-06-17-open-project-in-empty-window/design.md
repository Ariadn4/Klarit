## Context

`workspace-windows` 既有要求是「从切换器选另一个项目 → 新窗口打开」，前提假设当前窗口总是已绑定项目。但实际存在**空状态窗口**：registry 里有项目、却没有可恢复的会话时，首启会得到一个未绑定任何项目的窗口（切换器显示「选择项目」）。这种窗口里选项目，再开新窗口会留下一个空壳窗口，体验割裂。

## Goals / Non-Goals

**Goals:** 让「打开项目」的落点对齐已实现行为：未绑定→本窗口，已绑定→新窗口。

**Non-Goals:** 不改导入流程（其本就在空窗口绑定）、不改会话恢复、不改多窗口聚焦既有窗口的逻辑。

## Decisions

### D1：落点由 `manager.current(win)` 是否为空决定
`openProject` IPC 处理：`win && !manager.current(win)` → `bindWindow(win, projectId)`（本窗口绑定）；否则 `manager.openProject(projectId)`（聚焦既有或新开窗口）。与导入流程的 `bindOrOpen` 同一套判定，保持一致。

## Risks / Trade-offs

- [已绑定窗口选当前项目] → `openProject` 内既有「聚焦不重开」逻辑覆盖，不受影响。
- [空窗口里所选项目已在别处打开] → 当前实现会在本窗口绑定一份（罕见边界）；保持简单，后续如需可改为聚焦既有窗口。
