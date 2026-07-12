# Tier 2 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 Tier 2 的 5 项功能——任务依赖、顺序子任务、循环/重复任务、项目支持、面板拖拽交互。

**架构：** 内核优先——先扩展数据模型和缓存构建逻辑，再实现依赖引擎和重复逻辑，最后实现前端 UI 和拖拽交互。每个任务产出可构建、可验证的增量。

**技术栈：** TypeScript 5, Svelte 4, Vite 5, webpack 5, siyuan@1.2.2, pnpm

**设计规格：** `docs/superpowers/specs/2026-07-06-tier2-design.md`

---

## 文件结构

| 文件 | 职责 | 任务 |
|------|------|------|
| `src/shared/types.ts` | TaskCacheEntry 接口，新增 5 个字段 | 1 |
| `src/shared/constants.ts` | 新增 5 个 ATTR_* 常量 + RPC_ERROR_DEP_CYCLE | 1 |
| `src/kernel/cache-manager.ts` | loadAll 读取新属性 + na-sort 迁移 | 2 |
| `src/kernel/sync-engine.ts` | buildEntryFromAttrs 读取新属性 | 2 |
| `src/kernel/task-service.ts` | buildEntryFromAttrs + removeTask 清除 + updateTask 依赖检测/重复逻辑/reorderTask/convertToTask taskType + getProjectReminders | 3,4,5,6,7 |
| `src/kernel/rpc-server.ts` | 注册 reorderTask + getProjectReminders RPC | 6,7 |
| `src/kernel/priority-engine.ts` | isBlocked + 修改 isNextActionCandidate | 3 |
| `src/kernel/repeat-engine.ts` | 新文件：计算下一重复日期的纯函数 | 5 |
| `src/frontend/kernel-bridge.ts` | 新增 reorderTask + getProjectReminders 方法 | 6,7 |
| `src/frontend/stores/task-store.ts` | 新增 projectReminders 状态 + loadProjectReminders | 8 |
| `src/frontend/components/TaskDetail.svelte` | 新增依赖/顺序/重复/项目类型字段 | 8 |
| `src/frontend/components/TaskCard.svelte` | 阻塞标记 + 循环标记 + 项目卡片样式 | 8 |
| `src/frontend/components/StatusCheckbox.svelte` | 阻塞锁样式 | 8 |
| `src/frontend/components/NextActionView.svelte` | 项目待收尾区域 | 8 |
| `src/frontend/components/AllTasksView.svelte` | 子任务按 na-sort 排序 | 8 |
| `src/frontend/components/ProjectView.svelte` | 项目视图重构 | 8 |
| `src/frontend/components/drag-handler.ts` | 新文件：pointer events 拖拽逻辑 | 9 |
| `src/i18n/en.json` | 新增 24 个 i18n key | 8 |
| `src/i18n/zh-CN.json` | 新增 24 个 i18n key | 8 |
| `src/index.ts` | 斜杠菜单+右键菜单+命令增加"转为项目" | 8 |
| `src/index.scss` | 拖拽指示器样式 + 项目卡片样式 + 阻塞样式 | 8,9 |

---

### 任务 1：共享类型与常量扩展

**文件：**
- 修改：`src/shared/types.ts`
- 修改：`src/shared/constants.ts`

- [ ] **步骤 1：扩展 TaskCacheEntry 接口**

在 `src/shared/types.ts` 的 `TaskCacheEntry` 接口末尾（`title: string;` 之后）添加 5 个新字段：

```typescript
    depends: string;        // na-depends 原始值
    depMode: string;        // na-dep-mode，默认 "all"
    sequential: boolean;    // na-sequential === "1"
    repeat: string;         // na-repeat 原始值
    sort: number;           // na-sort 转数字，默认 -1（表示未设置）
    blocked: boolean;       // 由内核 isBlocked 计算的缓存字段
```

- [ ] **步骤 2：新增属性常量和错误码**

在 `src/shared/constants.ts` 的 `ATTR_PARENT` 行之后添加：

```typescript
export const ATTR_DEPENDS = "custom-na-depends";
export const ATTR_DEP_MODE = "custom-na-dep-mode";
export const ATTR_SEQUENTIAL = "custom-na-sequential";
export const ATTR_REPEAT = "custom-na-repeat";
export const ATTR_SORT = "custom-na-sort";
```

在 `RPC_ERROR_TIMEOUT` 行之后添加：

```typescript
export const RPC_ERROR_DEP_CYCLE = -32007;
```

- [ ] **步骤 3：构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

预期：构建成功（新增字段和常量不影响现有逻辑，TypeScript 类型检查通过）。

- [ ] **步骤 4：Commit**

```bash
git add src/shared/types.ts src/shared/constants.ts
git commit -m "feat: extend TaskCacheEntry with depends, depMode, sequential, repeat, sort fields and constants"
```

---

### 任务 2：缓存构建逻辑同步

**文件：**
- 修改：`src/kernel/cache-manager.ts`
- 修改：`src/kernel/sync-engine.ts`
- 修改：`src/kernel/task-service.ts`

- [ ] **步骤 1：更新 cache-manager.ts loadAll 中的属性读取**

在 `src/kernel/cache-manager.ts` 的 `loadAll()` 方法中，找到构建 entry 的代码块（约 L54-85，读取 ATTR_TASK、ATTR_PARENT、ATTR_STATUS 等的位置），在 `ATTR_CONTEXT` 读取之后、`order` 计算之前，添加新属性读取：

```typescript
                    depends: attrs[ATTR_DEPENDS] || "",
                    depMode: attrs[ATTR_DEP_MODE] || "all",
                    sequential: attrs[ATTR_SEQUENTIAL] === "1",
                    repeat: attrs[ATTR_REPEAT] || "",
                    sort: attrToNumber(attrs[ATTR_SORT], -1),
```

确保在文件顶部 import 中添加 `ATTR_DEPENDS, ATTR_DEP_MODE, ATTR_SEQUENTIAL, ATTR_REPEAT, ATTR_SORT`。

- [ ] **步骤 2：更新 sync-engine.ts buildEntryFromAttrs**

在 `src/kernel/sync-engine.ts` 的 `buildEntryFromAttrs` 方法中（约 L199-238），找到读取 `ATTR_CONTEXT` 的行（约 L229），在其后添加：

```typescript
        depends: attrs[ATTR_DEPENDS] || "",
        depMode: attrs[ATTR_DEP_MODE] || "all",
        sequential: attrs[ATTR_SEQUENTIAL] === "1",
        repeat: attrs[ATTR_REPEAT] || "",
        sort: attrToNumber(attrs[ATTR_SORT], -1),
```

确保在文件顶部 import 中添加 `ATTR_DEPENDS, ATTR_DEP_MODE, ATTR_SEQUENTIAL, ATTR_REPEAT, ATTR_SORT`。

- [ ] **步骤 3：更新 task-service.ts buildEntryFromAttrs**

在 `src/kernel/task-service.ts` 的 `buildEntryFromAttrs` 方法中（约 L609-634），找到读取 `ATTR_CONTEXT` 的行，在其后添加与步骤 2 相同的 5 行代码。

- [ ] **步骤 4：更新 removeTask 清除新属性**

在 `src/kernel/task-service.ts` 的 `removeTask` 方法中（约 L193-261），找到构建 `clearAttrs` 对象的位置（约 L244-253，设置各 `custom-na-*` 为空字符串），添加：

```typescript
        [ATTR_DEPENDS]: "",
        [ATTR_DEP_MODE]: "",
        [ATTR_SEQUENTIAL]: "",
        [ATTR_REPEAT]: "",
        [ATTR_SORT]: "",
```

- [ ] **步骤 5：更新 convertToTask 默认属性**

在 `src/kernel/task-service.ts` 的 `convertToTask` 方法中（约 L75-191），找到设置默认属性的位置（约 L107-115），在默认属性中添加：

```typescript
        "na-sort": "",  // 将由 na-sort 迁移逻辑或 convertToTask 默认逻辑赋值
```

同时在 `convertToTask` 中，设置 na-parent 后、广播前，计算新任务的 na-sort 默认值：

```typescript
        // 设置默认 na-sort
        const siblings = this.cacheManager.getByParent(parentId);
        const maxSort = siblings.reduce((max, s) => Math.max(max, s.sort), -1);
        defaultAttrs["na-sort"] = String(maxSort < 0 ? 0 : maxSort + 10000);
```

- [ ] **步骤 6：实现 na-sort 迁移**

在 `src/kernel/cache-manager.ts` 的 `loadAll()` 方法末尾（设置 lastSyncTime 之后、return 之前），添加 na-sort 迁移逻辑：

```typescript
        // na-sort 迁移：为 sort=-1 的现有子任务分配间距编号
        await this.migrateSortValues();
```

在 CacheManager 类中新增方法：

```typescript
    private async migrateSortValues(): Promise<void> {
        const parents = new Set<string>();
        for (const entry of Object.values(this.cache) as TaskCacheEntry[]) {
            if (entry.parentId) parents.add(entry.parentId);
        }
        for (const parentId of parents) {
            const children = this.getByParent(parentId).filter(c => c.sort === -1);
            if (children.length === 0) continue;
            children.sort((a, b) => a.blockId.localeCompare(b.blockId));
            const updates: Array<{ blockId: string; sort: number }> = [];
            for (let i = 0; i < children.length; i++) {
                const sortValue = i * 10000;
                children[i].sort = sortValue;
                updates.push({ blockId: children[i].blockId, sort: sortValue });
            }
            // 批量写入 na-sort 属性
            for (const u of updates) {
                try {
                    await siyuanFetch("/api/attr/setBlockAttrs", {
                        id: u.blockId,
                        attrs: { [ATTR_SORT]: String(u.sort) },
                    });
                } catch (e) {
                    // 迁移失败不影响启动，下次加载会重试
                }
            }
        }
    }
```

确保导入 `ATTR_SORT` 和 `siyuanFetch`。

- [ ] **步骤 7：更新 index.ts DEFAULT_TASK_ATTRS**

在 `src/index.ts` 的 `DEFAULT_TASK_ATTRS` 对象中（约 L8-14），添加：

```typescript
    "custom-na-sort": "",
```

- [ ] **步骤 8：构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

预期：构建成功。

- [ ] **步骤 9：Commit**

```bash
git add src/kernel/cache-manager.ts src/kernel/sync-engine.ts src/kernel/task-service.ts src/index.ts
git commit -m "feat: sync all buildEntryFromAttrs with new Tier 2 attributes, add na-sort migration"
```

---

### 任务 3：依赖引擎实现

**文件：**
- 修改：`src/kernel/priority-engine.ts`

- [ ] **步骤 1：实现 isBlocked 函数**

在 `src/kernel/priority-engine.ts` 中，在 `isNextActionCandidate` 函数之前，添加 `isBlocked` 函数：

```typescript
export function isBlocked(entry: TaskCacheEntry, cache: Record<string, TaskCacheEntry>): boolean {
    // 1. 显式依赖
    if (entry.depends) {
        const depIds = entry.depends.split("|");
        const validDepIds: string[] = [];
        for (const depId of depIds) {
            if (!cache[depId]) {
                console.warn(`[NextAction] dependency references non-existent task: ${depId}`);
                continue;
            }
            validDepIds.push(depId);
        }
        if (validDepIds.length > 0) {
            if (entry.depMode === "any") {
                const allIncomplete = validDepIds.every(id => cache[id].status !== "done");
                if (allIncomplete) return true;
            } else {
                const anyIncomplete = validDepIds.some(id => cache[id].status !== "done");
                if (anyIncomplete) return true;
            }
        }
    }

    // 2. 顺序约束
    if (entry.parentId) {
        const parent = cache[entry.parentId];
        if (parent?.sequential) {
            const siblings = parent.childIds
                .map(id => cache[id])
                .filter(Boolean)
                .sort((a, b) => {
                    if (a.sort !== b.sort) return a.sort - b.sort;
                    return a.blockId.localeCompare(b.blockId);
                });
            const myIndex = siblings.findIndex(s => s.blockId === entry.blockId);
            if (myIndex > 0) {
                const hasIncompleteBefore = siblings.slice(0, myIndex).some(s => s.status !== "done");
                if (hasIncompleteBefore) return true;
            }
        }
    }

    return false;
}
```

- [ ] **步骤 2：修改 isNextActionCandidate**

修改 `src/kernel/priority-engine.ts` 中的 `isNextActionCandidate` 函数，在 `return true;` 之前添加：

```typescript
    if (entry.taskType === "2") return false;
    if (isBlocked(entry, cache)) return false;
```

- [ ] **步骤 3：构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

预期：构建成功。

- [ ] **步骤 4：Commit**

```bash
git add src/kernel/priority-engine.ts
git commit -m "feat: implement isBlocked for dependency and sequential constraints, update isNextActionCandidate"
```

---

### 任务 4：updateTask 依赖验证与环路检测

**文件：**
- 修改：`src/kernel/task-service.ts`

- [ ] **步骤 1：实现依赖环路检测**

在 `src/kernel/task-service.ts` 中添加私有方法：

```typescript
    private detectDependencyCycle(blockId: string, dependsStr: string): boolean {
        if (!dependsStr) return false;
        const depIds = dependsStr.split("|");
        const visited = new Set<string>();
        const queue = [...depIds];
        let depth = 0;
        while (queue.length > 0 && depth < 100) {
            const currentId = queue.shift()!;
            if (currentId === blockId) return true;
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            const entry = this.cacheManager.get(currentId);
            if (entry?.depends) {
                queue.push(...entry.depends.split("|"));
            }
            depth++;
        }
        return false;
    }
```

- [ ] **步骤 2：实现顺序约束矛盾检测**

```typescript
    private checkSequentialConflict(blockId: string, dependsStr: string): boolean {
        if (!dependsStr) return false;
        const entry = this.cacheManager.get(blockId);
        if (!entry?.parentId) return false;
        const parent = this.cacheManager.get(entry.parentId);
        if (!parent?.sequential) return false;
        const depIds = dependsStr.split("|");
        const siblings = parent.childIds.map(id => this.cacheManager.get(id)).filter(Boolean).sort((a, b) => a.sort - b.sort);
        const mySort = entry.sort;
        for (const depId of depIds) {
            const depEntry = this.cacheManager.get(depId);
            if (depEntry && depEntry.sort > mySort) return true;
        }
        return false;
    }
```

- [ ] **步骤 3：在 updateTask 中集成检测**

在 `updateTask` 方法中，找到写入 na-parent 时的循环引用检测逻辑（约 L309-325），在其附近添加对 na-depends 的处理：

在参数校验之后、获取写锁之前，检查是否有 `na-depends` 属性变更：

```typescript
        // 依赖环路检测
        const dependsAttr = normalizedAttrs["na-depends"];
        if (dependsAttr !== undefined && this.detectDependencyCycle(blockId, dependsAttr)) {
            return { _rpcError: { code: -32007, message: "Dependency cycle detected" } };
        }
        // 顺序约束矛盾检测（警告，不阻止）
        const hasSequentialConflict = dependsAttr !== undefined && this.checkSequentialConflict(blockId, dependsAttr);
```

在方法返回值中，如果有冲突则附加标记：

```typescript
        const result = this.cacheManager.get(blockId)!;
        if (hasSequentialConflict) {
            return { ...result, _warning: "sequentialConflict" };
        }
        return result;
```

- [ ] **步骤 4：实现 na-repeat 写入验证**

在 `updateTask` 的参数校验部分，添加对 `na-repeat` 值的验证：

```typescript
        const repeatAttr = normalizedAttrs["na-repeat"];
        if (repeatAttr !== undefined && repeatAttr !== "") {
            try {
                const parsed = JSON.parse(repeatAttr);
                if (!["day", "week", "month", "year"].includes(parsed.freq)) {
                    return { _rpcError: { code: -32001, message: "Invalid repeat freq" } };
                }
                if (typeof parsed.interval !== "number" || parsed.interval < 1 || parsed.interval > 999 || !Number.isInteger(parsed.interval)) {
                    return { _rpcError: { code: -32001, message: "Invalid repeat interval" } };
                }
                if (parsed.from !== undefined && !["due", "complete"].includes(parsed.from)) {
                    return { _rpcError: { code: -32001, message: "Invalid repeat from" } };
                }
            } catch {
                return { _rpcError: { code: -32001, message: "Invalid repeat JSON" } };
            }
        }
```

- [ ] **步骤 5：构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

- [ ] **步骤 6：Commit**

```bash
git add src/kernel/task-service.ts
git commit -m "feat: add dependency cycle detection, sequential conflict check, and na-repeat validation in updateTask"
```

---

### 任务 5：循环/重复任务逻辑

**文件：**
- 创建：`src/kernel/repeat-engine.ts`
- 修改：`src/kernel/task-service.ts`

- [ ] **步骤 1：创建 repeat-engine.ts**

创建 `src/kernel/repeat-engine.ts`，实现纯函数的下一日期计算：

```typescript
interface RepeatRule {
    freq: "day" | "week" | "month" | "year";
    interval: number;
    from: "due" | "complete";
}

export function parseRepeatRule(json: string): RepeatRule | null {
    try {
        const parsed = JSON.parse(json);
        if (!["day", "week", "month", "year"].includes(parsed.freq)) return null;
        if (typeof parsed.interval !== "number" || parsed.interval < 1 || !Number.isInteger(parsed.interval)) return null;
        if (parsed.from !== undefined && !["due", "complete"].includes(parsed.from)) return null;
        return {
            freq: parsed.freq,
            interval: parsed.interval,
            from: parsed.from || "due",
        };
    } catch {
        return null;
    }
}

export function calculateNextDate(baseDate: string, rule: RepeatRule): string {
    const date = new Date(baseDate + "T00:00:00Z");
    switch (rule.freq) {
        case "day":
            date.setUTCDate(date.getUTCDate() + rule.interval);
            break;
        case "week":
            date.setUTCDate(date.getUTCDate() + rule.interval * 7);
            break;
        case "month": {
            const targetMonth = date.getUTCMonth() + rule.interval;
            const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
            const adjustedMonth = targetMonth % 12;
            const lastDay = new Date(Date.UTC(targetYear, adjustedMonth + 1, 0)).getUTCDate();
            date.setUTCFullYear(targetYear, adjustedMonth, Math.min(date.getUTCDate(), lastDay));
            break;
        }
        case "year": {
            const targetYear = date.getUTCFullYear() + rule.interval;
            const lastDay = new Date(Date.UTC(targetYear, date.getUTCMonth() + 1, 0)).getUTCDate();
            date.setUTCFullYear(targetYear, date.getUTCMonth(), Math.min(date.getUTCDate(), lastDay));
            break;
        }
    }
    return date.toISOString().slice(0, 10);
}
```

- [ ] **步骤 2：在 updateTask 中集成重复逻辑**

在 `src/kernel/task-service.ts` 的 `updateTask` 方法中，找到写锁释放之前、广播变更之前的位置（约 L370），在释放锁之前添加重复逻辑：

```typescript
        // 循环/重复任务：status 变为 done 且 repeat 非空时触发
        const updatedEntry = this.cacheManager.get(blockId);
        if (updatedEntry && normalizedAttrs["na-status"] === "done" && updatedEntry.repeat) {
            const rule = parseRepeatRule(updatedEntry.repeat);
            if (rule) {
                const today = new Date().toISOString().slice(0, 10);
                const baseDate = rule.from === "complete" ? today : (updatedEntry.due || today);
                const nextDate = calculateNextDate(baseDate, rule);
                const repeatAttrs: Record<string, string> = {
                    "na-status": "todo",
                    "na-start": "",
                };
                if (updatedEntry.due) {
                    repeatAttrs["na-due"] = nextDate;
                }
                await siyuanFetch("/api/attr/setBlockAttrs", { id: blockId, attrs: repeatAttrs });
                const finalAttrs = await siyuanFetch<Record<string, string>>("/api/attr/getBlockAttrs", { id: blockId });
                const finalEntry = this.buildEntryFromAttrs(blockId, finalAttrs, updatedEntry);
                this.cacheManager.set(finalEntry);
            } else {
                // 解析失败：清除 na-repeat，任务保持 done
                console.error(`[NextAction] invalid repeat rule for ${blockId}: ${updatedEntry.repeat}`);
                await siyuanFetch("/api/attr/setBlockAttrs", { id: blockId, attrs: { "na-repeat": "" } });
                const finalAttrs = await siyuanFetch<Record<string, string>>("/api/attr/getBlockAttrs", { id: blockId });
                const finalEntry = this.buildEntryFromAttrs(blockId, finalAttrs, updatedEntry);
                this.cacheManager.set(finalEntry);
            }
        }
```

在文件顶部添加 import：

```typescript
import { parseRepeatRule, calculateNextDate } from "./repeat-engine";
```

- [ ] **步骤 3：构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

- [ ] **步骤 4：Commit**

```bash
git add src/kernel/repeat-engine.ts src/kernel/task-service.ts
git commit -m "feat: implement repeat task engine and integrate into updateTask"
```

---

### 任务 6：项目支持 + 新增 RPC

**文件：**
- 修改：`src/kernel/task-service.ts`
- 修改：`src/kernel/rpc-server.ts`

- [ ] **步骤 1：实现 getProjectReminders**

在 `src/kernel/task-service.ts` 的 TaskService 类中添加方法：

```typescript
    getProjectReminders(): TaskCacheEntry[] {
        if (!this.isReady) return [];
        const all = this.cacheManager.getAll();
        return all.filter(entry => {
            if (entry.taskType !== "2") return false;
            if (entry.status === "done") return false;
            if (entry.childIds.length === 0) return false;
            return entry.childIds.every(id => {
                const child = this.cacheManager.get(id);
                return child && child.status === "done";
            });
        });
    }
```

- [ ] **步骤 2：修改 convertToTask 支持 taskType**

在 `convertToTask` 方法中，修改参数签名，增加可选的 `taskType` 参数：

```typescript
    async convertToTask(blockId: string, cleanTitle?: string, taskType: string = "1"): Promise<TaskCacheEntry | RpcResult> {
```

在设置默认属性的位置，将硬编码的 `"na-task": "1"` 替换为：

```typescript
        "na-task": taskType,
```

- [ ] **步骤 3：注册新 RPC 方法**

在 `src/kernel/rpc-server.ts` 中，在 `rebuildParentRelationships` 注册之后，添加：

```typescript
    siyuan.rpc.bind("nextaction_getProjectReminders", async () => {
        return taskService.getProjectReminders();
    });

    // 修改 convertToTask 注册，传递 taskType 参数
```

同时修改现有的 `convertToTask` 注册（约 L43-53），在参数中添加 `taskType`：

```typescript
    siyuan.rpc.bind("nextaction_convertToTask", async (p: any) => {
        // ... 现有错误处理
        const result = await taskService.convertToTask(p.blockId, p.cleanTitle, p.taskType || "1");
        // ... 现有逻辑
    });
```

添加 `reorderTask` RPC 注册：

```typescript
    siyuan.rpc.bind("nextaction_reorderTask", async (p: any) => {
        if (!p.blockId) return rpcError(-32001, "Missing blockId");
        const result = await taskService.reorderTask(p.blockId, p.parentId ?? undefined, p.afterId ?? undefined);
        if (hasRpcError(result)) return result;
        return result;
    });
```

- [ ] **步骤 4：实现 reorderTask 方法**

在 `src/kernel/task-service.ts` 的 TaskService 类中添加方法：

```typescript
    async reorderTask(blockId: string, newParentId?: string, afterId?: string): Promise<TaskCacheEntry | RpcResult> {
        if (!this.isReady) return { _rpcError: { code: -32005, message: "Kernel not ready" } };

        const entry = this.cacheManager.get(blockId);
        if (!entry) return { _rpcError: { code: -32002, message: "Task not found" } };

        const parentId = newParentId !== undefined ? newParentId : entry.parentId;

        // 循环引用检测
        if (parentId) {
            let current: string | undefined = parentId;
            const visited = new Set<string>();
            while (current && !visited.has(current)) {
                if (current === blockId) return { _rpcError: { code: -32003, message: "Circular reference" } };
                visited.add(current);
                const parentEntry = this.cacheManager.get(current);
                current = parentEntry?.parentId;
            }
        }

        // 项目不能成为普通任务的子任务
        if (entry.taskType === "2" && parentId) {
            const parentEntry = this.cacheManager.get(parentId);
            if (parentEntry && parentEntry.taskType === "1") {
                return { _rpcError: { code: -32001, message: "Project cannot be child of task" } };
            }
        }

        await this.mutex.acquire();
        try {
            // 更新 na-parent
            if (newParentId !== undefined && newParentId !== entry.parentId) {
                await siyuanFetch("/api/attr/setBlockAttrs", {
                    id: blockId,
                    attrs: { [ATTR_PARENT]: newParentId },
                });
            }

            // 计算新的 na-sort
            const siblings = parentId
                ? this.cacheManager.getByParent(parentId).filter(s => s.blockId !== blockId)
                : this.cacheManager.getAll().filter(s => !s.parentId && s.blockId !== blockId);
            siblings.sort((a, b) => a.sort - b.sort || a.blockId.localeCompare(b.blockId));

            let newSort: number;
            if (!afterId || afterId === "") {
                newSort = siblings.length > 0 ? Math.floor((siblings[0].sort - 10000 + siblings[0].sort) / 2) : 0;
                if (newSort < 0 || (siblings.length > 0 && siblings[0].sort - newSort < 10)) {
                    newSort = 0;
                    await this.renumberSiblings(parentId, blockId, afterId || "");
                }
            } else {
                const afterIndex = siblings.findIndex(s => s.blockId === afterId);
                if (afterIndex === -1 || afterIndex === siblings.length - 1) {
                    newSort = siblings.length > 0 ? siblings[siblings.length - 1].sort + 10000 : 0;
                } else {
                    newSort = Math.floor((siblings[afterIndex].sort + siblings[afterIndex + 1].sort) / 2);
                    if (siblings[afterIndex + 1].sort - siblings[afterIndex].sort < 10) {
                        await this.renumberSiblings(parentId, blockId, afterId);
                        return this.cacheManager.get(blockId)!;
                    }
                }
            }

            await siyuanFetch("/api/attr/setBlockAttrs", {
                id: blockId,
                attrs: { [ATTR_SORT]: String(newSort) },
            });

            const finalAttrs = await siyuanFetch<Record<string, string>>("/api/attr/getBlockAttrs", { id: blockId });
            const finalEntry = this.buildEntryFromAttrs(blockId, finalAttrs, entry);
            this.cacheManager.set(finalEntry);
            this.syncEngine.broadcastChanges();
            return finalEntry;
        } catch (e: any) {
            return errorToRpcError(e);
        } finally {
            this.mutex.release();
        }
    }

    private async renumberSiblings(parentId: string | undefined, excludeId: string, afterId: string): Promise<void> {
        const siblings = parentId
            ? this.cacheManager.getByParent(parentId)
            : this.cacheManager.getAll().filter(s => !s.parentId);
        siblings.sort((a, b) => a.sort - b.sort || a.blockId.localeCompare(b.blockId));

        for (let i = 0; i < siblings.length; i++) {
            const newSort = i * 10000;
            siblings[i].sort = newSort;
        }
        // 更新缓存后异步持久化
        const writePromises = siblings.map(s =>
            siyuanFetch("/api/attr/setBlockAttrs", {
                id: s.blockId,
                attrs: { [ATTR_SORT]: String(s.sort) },
            }).catch(() => {})
        );
        await Promise.all(writePromises);
    }
```

- [ ] **步骤 5：构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

- [ ] **步骤 6：Commit**

```bash
git add src/kernel/task-service.ts src/kernel/rpc-server.ts
git commit -m "feat: implement getProjectReminders, reorderTask, and convertToTask taskType support"
```

---

### 任务 7：前端内核桥接更新

**文件：**
- 修改：`src/frontend/kernel-bridge.ts`

- [ ] **步骤 1：新增 RPC 桥接方法**

在 `src/frontend/kernel-bridge.ts` 的 `getDoneTaskCount` 方法之后、`bindTasksChanged` 之前，添加：

```typescript
    async getProjectReminders(): Promise<TaskCacheEntry[]> {
        return this.call("getProjectReminders", {});
    }

    async reorderTask(blockId: string, parentId?: string, afterId?: string): Promise<TaskCacheEntry> {
        return this.call("reorderTask", { blockId, parentId: parentId ?? null, afterId: afterId ?? null });
    }

    async convertToProject(blockId: string, cleanTitle?: string): Promise<TaskCacheEntry> {
        return this.call("convertToTask", { blockId, cleanTitle, taskType: "2" });
    }
```

- [ ] **步骤 2：构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

- [ ] **步骤 3：Commit**

```bash
git add src/frontend/kernel-bridge.ts
git commit -m "feat: add getProjectReminders, reorderTask, convertToProject to KernelBridge"
```

---

### 任务 8：前端 UI 实现（i18n + TaskDetail + TaskCard + 视图 + 项目）

**文件：**
- 修改：`src/i18n/en.json`
- 修改：`src/i18n/zh-CN.json`
- 修改：`src/frontend/stores/task-store.ts`
- 修改：`src/frontend/components/TaskDetail.svelte`
- 修改：`src/frontend/components/TaskCard.svelte`
- 修改：`src/frontend/components/StatusCheckbox.svelte`
- 修改：`src/frontend/components/NextActionView.svelte`
- 修改：`src/frontend/components/AllTasksView.svelte`
- 修改：`src/frontend/components/ProjectView.svelte`
- 修改：`src/index.ts`
- 修改：`src/index.scss`

- [ ] **步骤 1：更新 i18n 文件**

在 `src/i18n/en.json` 末尾（`"loadMore"` 之后）添加：

```json
    "dependencies": "Dependencies",
    "depMode": "Dependency Mode",
    "depModeAll": "All must complete",
    "depModeAny": "Any can complete",
    "blocked": "Blocked",
    "sequential": "Sequential",
    "repeat": "Repeat",
    "repeatFreq": "Frequency",
    "repeatEveryDay": "Every day",
    "repeatEveryWeek": "Every week",
    "repeatEvery2Weeks": "Every 2 weeks",
    "repeatEveryMonth": "Every month",
    "repeatEveryYear": "Every year",
    "repeatInterval": "Interval",
    "repeatFrom": "Calculate from",
    "repeatFromDue": "Due date",
    "repeatFromComplete": "Completion date",
    "project": "Project",
    "task": "Task",
    "projectReminders": "Projects to Close",
    "convertToProject": "Convert to Project",
    "projectProgress": "{done}/{total} completed",
    "depCycleDetected": "Dependency cycle detected",
    "invalidRepeatRule": "Invalid repeat rule",
    "depConflictWarning": "Dependency conflicts with sequential order"
```

在 `src/i18n/zh-CN.json` 末尾添加对应中文：

```json
    "dependencies": "依赖",
    "depMode": "依赖模式",
    "depModeAll": "全部完成",
    "depModeAny": "任一完成",
    "blocked": "已阻塞",
    "sequential": "顺序执行",
    "repeat": "重复",
    "repeatFreq": "频率",
    "repeatEveryDay": "每天",
    "repeatEveryWeek": "每周",
    "repeatEvery2Weeks": "每两周",
    "repeatEveryMonth": "每月",
    "repeatEveryYear": "每年",
    "repeatInterval": "间隔",
    "repeatFrom": "推算基准",
    "repeatFromDue": "截止日",
    "repeatFromComplete": "完成日",
    "project": "项目",
    "task": "任务",
    "projectReminders": "项目待收尾",
    "convertToProject": "转为项目",
    "projectProgress": "{done}/{total} 已完成",
    "depCycleDetected": "检测到依赖环路",
    "invalidRepeatRule": "无效的重复规则",
    "depConflictWarning": "依赖与顺序约束冲突"
```

- [ ] **步骤 2：更新 task-store.ts**

在 `src/frontend/stores/task-store.ts` 的 `TaskState` 接口中添加 `projectReminders` 字段：

```typescript
    projectReminders: TaskCacheEntry[];
```

在 store 初始值中添加 `projectReminders: []`。

在 `createTaskStore` 返回对象中添加方法：

```typescript
        async loadProjectReminders() {
            if (!bridge) return;
            try {
                const reminders = await bridge.getProjectReminders();
                update(s => ({ ...s, projectReminders: reminders }));
            } catch (e: any) {
                console.error("[NextAction] loadProjectReminders failed:", e);
            }
        },
```

在 `loadTasks` 方法末尾（fetch contexts 之后），添加调用 `this.loadProjectReminders()` — 注意需通过返回对象中引用。

改为在 `loadTasks` 中，在 update store 时同时获取 projectReminders：

```typescript
            // 在 loadTasks 的 try 块内，fetch contexts 之后
            const projectReminders = state.activeView === "nextAction" ? await bridge.getProjectReminders() : [];
            update(s => ({ ...s, tasks, contexts, projectReminders, loading: false }));
```

- [ ] **步骤 3：更新 TaskDetail.svelte**

在 `src/frontend/components/TaskDetail.svelte` 中：

(a) 在本地状态声明区域添加：

```typescript
    let repeatEnabled = !!task.repeat;
    let repeatFreq = "week";
    let repeatInterval = 1;
    let repeatFrom = "due";

    $: if (task.repeat) {
        try {
            const parsed = JSON.parse(task.repeat);
            repeatFreq = parsed.freq || "week";
            repeatInterval = parsed.interval || 1;
            repeatFrom = parsed.from || "due";
        } catch {}
    }

    let taskType = task.taskType || "1";
```

(b) 在 scheduleSave 方法中，在 attrs 对象中添加新属性：

```typescript
            "na-depends": depends,
            "na-dep-mode": depMode,
            "na-sequential": sequentialEnabled ? "1" : "",
            "na-repeat": repeatEnabled ? JSON.stringify({ freq: repeatFreq, interval: repeatInterval, from: repeatFrom }) : "",
```

确保 `depends`、`depMode`、`sequentialEnabled` 等本地变量已声明。

(c) 在模板中，父任务字段之后添加以下字段区域：

- **任务/项目类型切换**：SegmentControl
- **依赖**：SearchSelect 多选模式搜索任务
- **顺序执行**：开关
- **重复规则**：开关 + 频率/间隔/推算基准

(d) 重复开关关闭时立即保存（不经防抖）：

```typescript
    async function handleRepeatToggle() {
        repeatEnabled = !repeatEnabled;
        if (!repeatEnabled) {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = null;
            try {
                const updated = await bridge.updateTask(task.blockId, { "na-repeat": "" });
                if (onSave) onSave(updated);
            } catch (e: any) {
                console.error("[NextAction] updateTask (repeat toggle) failed:", e);
            }
        } else {
            handleChange();
        }
    }
```

(e) 任务类型切换时立即保存：

```typescript
    async function handleTaskTypeChange(newType: string) {
        if (newType === taskType) return;
        taskType = newType;
        try {
            const updated = await bridge.updateTask(task.blockId, { "na-task": newType });
            if (onSave) onSave(updated);
        } catch (e: any) {
            console.error("[NextAction] updateTask (taskType) failed:", e);
        }
    }
```

- [ ] **步骤 4：更新 TaskCard.svelte**

在 `src/frontend/components/TaskCard.svelte` 中：

(a) 添加 `isBlocked` 计算属性（需传入所有任务数据或由父组件传入 blocked 状态）：

```typescript
    export let isBlocked: boolean = false;
```

(b) 在 meta 区域，截止日期旁添加循环标记：

```svelte
{#if task.repeat}
    <span class="na-task-card__repeat-mark" title={i18n?.repeat || "Repeat"}>🔄</span>
{/if}
```

(c) 为项目类型添加专属 CSS 类：

```svelte
<div class="na-task-card" class:na-task-card--project={task.taskType === "2"} class:na-task-card--blocked={isBlocked} ...>
```

- [ ] **步骤 5：更新 StatusCheckbox.svelte**

在 `src/frontend/components/StatusCheckbox.svelte` 中添加阻塞样式：

```svelte
<script lang="ts">
    export let status: string = "todo";
    export let isBlocked: boolean = false;
    export let onclick: ((e: MouseEvent) => void) | undefined = undefined;
</script>

<span
    class="na-status-checkbox"
    class:na-status-checkbox--doing={status === "doing"}
    class:na-status-checkbox--waiting={status === "waiting"}
    class:na-status-checkbox--done={status === "done"}
    class:na-status-checkbox--blocked={isBlocked}
    on:click|stopPropagation={(e) => { if (onclick) onclick(e); }}
></span>
```

- [ ] **步骤 6：更新 NextActionView.svelte — 项目待收尾区域**

在 `src/frontend/components/NextActionView.svelte` 的任务列表之后、加载更多之前，添加项目待收尾区域：

```svelte
{#if $taskStore.projectReminders.length > 0}
    <div class="na-project-reminders">
        <div class="na-project-reminders__header">{i18n?.projectReminders || "Projects to Close"}</div>
        {#each $taskStore.projectReminders as project (project.blockId)}
            <TaskCard
                task={project}
                isBlocked={false}
                {onEdit}
                {onStatusClick}
                {onContextMenu}
                {i18n}
            />
        {/each}
    </div>
{/if}
```

- [ ] **步骤 7：更新 AllTasksView.svelte — 子任务按 na-sort 排序**

在 `src/frontend/components/AllTasksView.svelte` 的 `groupByParent` 函数中，修改 children 的排序逻辑，在 `childrenMap.set(t.parentId, children)` 之前添加排序：

```typescript
            children.sort((a, b) => {
                if (a.sort !== b.sort) return a.sort - b.sort;
                return a.blockId.localeCompare(b.blockId);
            });
```

同时为每个 TaskCard 传入 `isBlocked` prop——需要从 taskStore 数据计算。在 AllTasksView 的 each 循环中，添加阻塞计算（通过检查 task.depends 和父任务的 sequential 状态）。

由于前端没有完整缓存，`isBlocked` 最简单的实现方式是：在 TaskCacheEntry 中增加一个 `blocked` 字段，由内核在 `buildEntryFromAttrs` 时计算。

在 `src/shared/types.ts` 的 TaskCacheEntry 中添加：

```typescript
    blocked: boolean;       // 由内核计算
```

在 `src/kernel/task-service.ts` 和 `src/kernel/sync-engine.ts` 和 `src/kernel/cache-manager.ts` 的 buildEntryFromAttrs 中，在返回 entry 之前计算：

```typescript
        blocked: isBlocked(entry, cache),
```

注意：这需要在缓存构建完成后才能计算，因此在 cache-manager 的 loadAll 中，需在 childIds 构建完成后遍历一次计算 blocked。

在 AllTasksView 的 TaskCard 上传入 `isBlocked={task.blocked}`。

- [ ] **步骤 8：更新 ProjectView.svelte**

重构 `src/frontend/components/ProjectView.svelte`：

- 顶级只显示 `taskType === "2"` 的项目
- 项目下展开子任务树（复用 AllTasksView 的 groupByParent 逻辑）
- 项目卡片显示进度条

核心逻辑变更：

```typescript
    $: projects = $taskStore.tasks.filter(t => t.taskType === "2" && t.status !== "done");
    $: childrenByParent = buildChildrenMap($taskStore.tasks);

    function getProjectProgress(project: TaskCacheEntry): { done: number; total: number } {
        const children = project.childIds.map(id => $taskStore.tasks.find(t => t.blockId === id)).filter(Boolean);
        const done = children.filter(c => c.status === "done").length;
        return { done, total: children.length };
    }
```

- [ ] **步骤 9：更新 index.ts — 转为项目入口**

在 `src/index.ts` 中：

(a) 斜杠菜单（约 L146-184）增加"转为项目"选项：

```typescript
            {
                filter: ["转为项目", "convert to project", "zrxm"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">${this.i18n.convertToProject}</span></div>`,
                id: "convertToProject",
                callback: async (protyle: any) => {
                    // ... 与 convertToTask 相同的清理逻辑，但调用 bridge.convertToProject
                },
            },
```

(b) 块图标菜单（约 L192-211）增加"转为项目"菜单项：

```typescript
                detail.menu.addItem({
                    icon: "iconFolder",
                    label: this.i18n.convertToProject,
                    click: async () => {
                        // ... 调用 doConvertToTask(blockId, undefined, "2")
                    },
                });
```

(c) 修改 `doConvertToTask` 函数签名，添加 `taskType` 参数：

```typescript
    async doConvertToTask(blockId: string, cleanTitle?: string, taskType: string = "1") {
```

在 RPC 调用中传递 taskType：

```typescript
            const result = await this.bridge.call("convertToTask", { blockId, cleanTitle, taskType });
```

在降级路径中也传递 taskType：

```typescript
            const attrs = { ...DEFAULT_TASK_ATTRS, "custom-na-task": taskType };
```

(d) 新增"转为项目"命令：

```typescript
        this.addCommand({
            langKey: "convertToProject",
            hotkey: "",
            callback: () => {
                const editor = this.getEditor();
                if (editor) {
                    const blockId = nodeElement.dataset.nodeId || editor.protyle.block.rootID;
                    this.doConvertToTask(blockId, undefined, "2").then(() => {
                        taskStore.loadTasks();
                    }).catch((e: any) => {
                        showMessage(`[NextAction] Error: ${e.message}`);
                    });
                }
            },
        });
```

- [ ] **步骤 10：更新 index.scss**

在 `src/index.scss` 中添加以下样式：

```scss
// 项目卡片样式
.na-task-card--project {
    border-left-color: #3498db !important;
    background: rgba(52, 152, 219, 0.05);
}

.na-task-card--project .na-task-card__title::before {
    content: "📁 ";
}

// 项目进度条
.na-project-progress {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--b3-theme-on-surface-secondary);
}

.na-project-progress__bar {
    flex: 1;
    height: 3px;
    background: var(--b3-border-color);
    border-radius: 2px;
    overflow: hidden;
}

.na-project-progress__fill {
    height: 100%;
    background: #27ae60;
    border-radius: 2px;
}

// 阻塞状态
.na-status-checkbox--blocked {
    border-color: #95a5a6 !important;
    background: transparent !important;
    opacity: 0.5;

    &::after {
        content: "🔒";
        font-size: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
}

// 循环标记
.na-task-card__repeat-mark {
    font-size: 11px;
    opacity: 0.7;
}

// 项目待收尾区域
.na-project-reminders {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px dashed var(--b3-border-color);
}

.na-project-reminders__header {
    font-size: 11px;
    color: var(--b3-theme-on-surface-secondary);
    padding: 4px 8px;
    margin-bottom: 4px;
}
```

- [ ] **步骤 11：构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

- [ ] **步骤 12：Commit**

```bash
git add src/i18n/ src/frontend/ src/index.ts src/index.scss src/shared/types.ts src/kernel/
git commit -m "feat: implement Tier 2 frontend UI — i18n, TaskDetail, TaskCard, project support, views"
```

---

### 任务 9：拖拽交互实现

**文件：**
- 创建：`src/frontend/components/drag-handler.ts`
- 修改：`src/frontend/components/AllTasksView.svelte`
- 修改：`src/index.scss`

- [ ] **步骤 1：创建 drag-handler.ts**

创建 `src/frontend/components/drag-handler.ts`，实现 pointer events 自定义拖拽逻辑：

```typescript
import { taskStore } from "../stores/task-store";
import type { TaskCacheEntry } from "../../shared/types";

interface DragConfig {
    container: HTMLElement;
    getCardElement: (blockId: string) => HTMLElement | null;
    onReorder: (blockId: string, parentId: string | null, afterId: string | null) => Promise<void>;
}

export function createDragHandler(config: DragConfig) {
    let isDragging = false;
    let dragBlockId: string | null = null;
    let ghost: HTMLElement | null = null;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0;
    let startY = 0;
    const LONG_PRESS_MS = 300;
    const MOVE_THRESHOLD_PX = 5;
    const INDENT_SIZE = 28;

    function onPointerDown(e: PointerEvent, blockId: string) {
        if (e.button !== 0) return;
        startX = e.clientX;
        startY = e.clientY;
        dragBlockId = blockId;

        longPressTimer = setTimeout(() => {
            longPressTimer = null;
        }, LONG_PRESS_MS);

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
    }

    function onPointerMove(e: PointerEvent) {
        if (!dragBlockId) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging) {
            if (longPressTimer !== null) {
                if (Math.abs(dx) > MOVE_THRESHOLD_PX || Math.abs(dy) > MOVE_THRESHOLD_PX) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                    document.removeEventListener("pointermove", onPointerMove);
                    document.removeEventListener("pointerup", onPointerUp);
                    return;
                }
                return;
            }
            if (Math.abs(dx) > MOVE_THRESHOLD_PX || Math.abs(dy) > MOVE_THRESHOLD_PX) {
                startDrag(e);
            }
            return;
        }

        if (ghost) {
            ghost.style.left = `${e.clientX - 10}px`;
            ghost.style.top = `${e.clientY - 10}px`;
        }

        updateDropTarget(e);
    }

    function startDrag(e: PointerEvent) {
        isDragging = true;
        const cardEl = config.getCardElement(dragBlockId!);
        if (!cardEl) return;

        ghost = cardEl.cloneNode(true) as HTMLElement;
        ghost.classList.add("na-drag-ghost");
        ghost.style.position = "fixed";
        ghost.style.width = `${cardEl.offsetWidth}px`;
        ghost.style.opacity = "0.7";
        ghost.style.pointerEvents = "none";
        ghost.style.zIndex = "9999";
        ghost.style.left = `${e.clientX - 10}px`;
        ghost.style.top = `${e.clientY - 10}px`;
        document.body.appendChild(ghost);

        cardEl.classList.add("na-drag-source");

        document.addEventListener("keydown", onKeyDown);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            endDrag();
        }
    }

    function onPointerUp(e: PointerEvent) {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);

        if (longPressTimer !== null) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
            dragBlockId = null;
            return;
        }

        if (!isDragging) {
            dragBlockId = null;
            return;
        }

        const target = getDropTarget(e);
        if (target) {
            config.onReorder(dragBlockId!, target.parentId, target.afterId);
        }

        endDrag();
    }

    function endDrag() {
        isDragging = false;
        dragBlockId = null;

        if (ghost) {
            ghost.remove();
            ghost = null;
        }

        const source = config.container.querySelector(".na-drag-source");
        if (source) source.classList.remove("na-drag-source");

        clearIndicators();
        document.removeEventListener("keydown", onKeyDown);
    }

    function getDropTarget(e: PointerEvent): { parentId: string | null; afterId: string | null } | null {
        if (ghost) ghost.style.display = "none";
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (ghost) ghost.style.display = "";

        if (!el) return null;
        const cardItem = el.closest("[data-task-block-id]") as HTMLElement;
        if (!cardItem) return null;

        const targetBlockId = cardItem.dataset.taskBlockId!;
        if (targetBlockId === dragBlockId) return null;

        const rect = cardItem.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        const relX = e.clientX - rect.left;
        const indentZone = INDENT_SIZE;

        let parentId: string | null = null;
        let afterId: string | null = null;

        // 获取目标任务的当前 parentId
        // 从 taskStore 获取当前任务列表
        let currentTasks: TaskCacheEntry[] = [];
        taskStore.subscribe(s => { currentTasks = s.tasks; })();
        const targetTask = currentTasks.find(t => t.blockId === targetBlockId);
        if (!targetTask) return null;

        if (relX < indentZone && relY > 0.3 && relY < 0.7) {
            // 成为子任务
            parentId = targetBlockId;
            afterId = null;
        } else if (relY < 0.5) {
            // 插入前面（同级）
            parentId = targetTask.parentId || null;
            afterId = null;
        } else {
            // 插入后面（同级）
            parentId = targetTask.parentId || null;
            afterId = targetBlockId;
        }

        return { parentId, afterId };
    }

    function updateDropTarget(e: PointerEvent) {
        clearIndicators();

        if (ghost) ghost.style.display = "none";
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (ghost) ghost.style.display = "";

        if (!el) return;
        const cardItem = el.closest("[data-task-block-id]") as HTMLElement;
        if (!cardItem) return;

        const rect = cardItem.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;
        const relX = e.clientX - rect.left;
        const indentZone = INDENT_SIZE;

        if (relX < indentZone && relY > 0.3 && relY < 0.7) {
            cardItem.classList.add("na-drop-target-child");
        } else if (relY < 0.5) {
            cardItem.classList.add("na-drop-target-before");
        } else {
            cardItem.classList.add("na-drop-target-after");
        }
    }

    function clearIndicators() {
        config.container.querySelectorAll(".na-drop-target-before, .na-drop-target-after, .na-drop-target-child").forEach(el => {
            el.classList.remove("na-drop-target-before", "na-drop-target-after", "na-drop-target-child");
        });
    }

    return { onPointerDown };
}
```

- [ ] **步骤 2：在 AllTasksView.svelte 中集成拖拽**

在 `src/frontend/components/AllTasksView.svelte` 中：

(a) 导入 drag handler：

```typescript
    import { createDragHandler } from "./drag-handler";
```

(b) 在 onMount 中初始化：

```typescript
    import { onMount } from "svelte";

    let dragHandler: ReturnType<typeof createDragHandler> | null = null;

    onMount(() => {
        const container = document.querySelector(".na-view--all-tasks .na-view__list") as HTMLElement;
        if (container) {
            dragHandler = createDragHandler({
                container,
                getCardElement: (blockId: string) => container.querySelector(`[data-task-block-id="${blockId}"]`),
                onReorder: async (blockId, parentId, afterId) => {
                    try {
                        const updated = await bridge.reorderTask(blockId, parentId ?? undefined, afterId ?? undefined);
                        taskStore.applyUpdate(updated);
                    } catch (e: any) {
                        console.error("[NextAction] reorderTask failed:", e);
                    }
                },
            });
        }
    });
```

(c) 在每个 `.na-all-tasks__item` 的 div 上添加 `data-task-block-id` 属性和 pointerdown 事件：

```svelte
    <div class="na-all-tasks__item" data-task-block-id={task.blockId}
         class:na-all-tasks__item--root={indent === 0} style="--indent: {indent}"
         on:pointerdown={(e) => dragHandler?.onPointerDown(e, task.blockId)}>
```

- [ ] **步骤 3：添加拖拽相关 CSS**

在 `src/index.scss` 中添加：

```scss
// 拖拽
.na-drag-ghost {
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: rotate(1deg);
}

.na-drag-source {
    opacity: 0.3;
}

.na-drop-target-before {
    border-top: 2px solid var(--b3-theme-primary, #3498db) !important;
}

.na-drop-target-after {
    border-bottom: 2px solid var(--b3-theme-primary, #3498db) !important;
}

.na-drop-target-child {
    background: rgba(52, 152, 219, 0.1);
    outline: 1px dashed var(--b3-theme-primary, #3498db);
}
```

- [ ] **步骤 4：构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

- [ ] **步骤 5：Commit**

```bash
git add src/frontend/components/drag-handler.ts src/frontend/components/AllTasksView.svelte src/index.scss
git commit -m "feat: implement pointer-events drag-and-drop for task reordering in AllTasksView"
```

---

### 任务 10：集成验证与收尾

**文件：**
- 无新文件

- [ ] **步骤 1：完整构建验证**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run build
```

预期：构建成功，无 TypeScript 错误。

- [ ] **步骤 2：部署到思源测试环境**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized && pnpm run deploy
```

- [ ] **步骤 3：手动验证清单**

1. 重启思源，检查插件加载无错误
2. 在文档中创建两个任务，设置 A 依赖 B（na-depends），验证 A 不出现在 Next Action
3. 完成 B 后验证 A 出现在 Next Action
4. 对父任务开启 na-sequential，验证子任务按顺序出现
5. 设置循环任务（每周重复），标记完成后验证 due 日期自动推算
6. 右键菜单"转为项目"，验证项目不出现在 Next Action 主列表
7. 完成项目所有子任务后验证项目出现在"项目待收尾"区域
8. 在全部任务视图中拖拽任务排序
9. 拖拽任务到另一个任务上设置父子关系
10. 验证编辑弹窗中的依赖/重复/项目类型字段正常工作

- [ ] **步骤 4：修复验证中发现的问题**

根据测试结果修复 bug，每次修复单独 commit。

- [ ] **步骤 5：最终 Commit**

```bash
git add -A
git commit -m "feat: complete Tier 2 — dependencies, sequential tasks, repeats, projects, drag-and-drop"
```
