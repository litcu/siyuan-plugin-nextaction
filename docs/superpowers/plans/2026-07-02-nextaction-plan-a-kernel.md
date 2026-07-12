# NextAction MVP 计划A：项目脚手架 + 内核插件

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 搭建思源笔记插件项目结构，实现内核插件的完整业务逻辑（缓存、任务CRUD、优先级排序、增量同步、RPC服务），可通过前端RPC调用验证。

**架构：** 前端插件(Svelte+Vite) + 内核插件(TypeScript+webpack)双轨架构。前端通过 `this.kernel.rpc` 内置机制调用内核方法。内核维护全量任务缓存，通过 `siyuan.client.fetch()` 读写思源后端API，通过 `siyuan.rpc` 暴露业务方法。

**技术栈：** TypeScript 5, Svelte 4, Vite 5, webpack 5, esbuild-loader, siyuan@1.2.2, pnpm

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `plugin.json` | 插件元数据 |
| `package.json` | npm配置、脚本、依赖 |
| `tsconfig.json` | TypeScript配置 |
| `vite.config.ts` | 前端构建（CommonJS输出） |
| `webpack.kernel.config.js` | 内核构建（ES Module输出） |
| `scripts/make_dev_copy.js` | 开发模式自动复制产物到思源插件目录 |
| `src/index.ts` | 前端插件入口，仅注册顶栏按钮+Dock面板+斜杠菜单+命令，提供最小UI验证内核功能 |
| `src/kernel.ts` | 内核插件入口，组装各模块，注册生命周期 |
| `src/index.scss` | 基础样式 |
| `src/declarations.d.ts` | .scss/.svelte模块声明 |
| `src/i18n/en.json` | 英文国际化 |
| `src/i18n/zh-CN.json` | 中文国际化 |
| `src/shared/types.ts` | 前后端共享类型（TaskCacheEntry等） |
| `src/shared/constants.ts` | 共享常量（状态ID、优先级ID、属性名等） |
| `src/kernel/types.ts` | 内核内部类型（Mutex、SyncResult等） |
| `src/kernel/constants.ts` | 内核常量（SQL模板、定时器间隔等） |
| `src/kernel/utils.ts` | 工具函数（attrToNumber、numberToAttr、siyuanFetch封装） |
| `src/kernel/mutex.ts` | Promise-based互斥锁 |
| `src/kernel/priority-engine.ts` | 优先级计算（纯函数，无IO） |
| `src/kernel/cache-manager.ts` | 任务缓存管理（全量加载、增量同步、删除检测） |
| `src/kernel/task-service.ts` | 任务业务逻辑（CRUD、转换、移除） |
| `src/kernel/sync-engine.ts` | 增量同步引擎（定时查询、变更检测、广播） |
| `src/kernel/rpc-server.ts` | RPC方法注册与分发 |
| `icon.png` | 插件图标 160x160 |
| `preview.png` | 预览图 1024x768 |

---

### 任务 1：项目初始化与脚手架

**文件：**
- 创建：`plugin.json`
- 创建：`package.json`
- 创建：`tsconfig.json`
- 创建：`vite.config.ts`
- 创建：`webpack.kernel.config.js`
- 创建：`src/index.ts`
- 创建：`src/kernel.ts`
- 创建：`src/index.scss`
- 创建：`src/declarations.d.ts`
- 创建：`src/i18n/en.json`
- 创建：`src/i18n/zh-CN.json`
- 创建：`icon.png`
- 创建：`preview.png`
- 创建：`scripts/make_dev_copy.js`

- [ ] **步骤 1：初始化npm项目**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized
pnpm init
```

- [ ] **步骤 2：安装依赖**

```bash
pnpm add -D siyuan@1.2.2 typescript@^5 svelte@^4 @sveltejs/vite-plugin-svelte@^3 vite@^5 sass@^1 @dop251/types-goja_nodejs-buffer @dop251/types-goja_nodejs-global @dop251/types-goja_nodejs-url webpack@^5 webpack-cli@^7 esbuild-loader@^4 copy-webpack-plugin@^14 mini-css-extract-plugin@^2 npm-run-all@^4 tslib@^2
```

- [ ] **步骤 3：创建 plugin.json**

```json
{
  "name": "nextaction",
  "author": "z00813717",
  "url": "",
  "version": "0.1.0",
  "minAppVersion": "3.7.0",
  "kernels": ["windows", "linux", "darwin", "ios", "android", "docker"],
  "backends": ["windows", "linux", "darwin", "ios", "android", "docker"],
  "frontends": ["desktop", "mobile", "browser-desktop", "browser-mobile", "desktop-window"],
  "disabledInPublish": false,
  "displayName": {
    "default": "NextAction",
    "zh-CN": "今天干点啥"
  },
  "description": {
    "default": "GTD task management plugin for SiYuan",
    "zh-CN": "面向思源笔记的 GTD 任务管理插件"
  },
  "readme": {
    "default": "README.md",
    "zh-CN": "README.zh-CN.md"
  },
  "funding": {
    "openCollective": "",
    "patreon": "",
    "github": "",
    "custom": []
  },
  "keywords": ["GTD", "task", "todo", "next action", "任务管理", "下一步行动"]
}
```

- [ ] **步骤 4：创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES6",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@kernel/*": ["src/kernel/*"],
      "@frontend/*": ["src/frontend/*"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "vendor"]
}
```

- [ ] **步骤 5：创建 vite.config.ts**

参照现有思源插件的 Vite 配置方式，配置：
- Svelte plugin
- `build.lib.formats: ["cjs"]`
- `build.lib.entry: resolve(__dirname, "src/index.ts")`
- `external: ["siyuan", "process"]`
- `output.assetFileNames`: style.css → index.css
- `output.manualChunks: undefined`, `inlineDynamicImports: true`
- 开发模式自动复制到 `D:\z00813717\Documents\SiYuan\SecBar\data\plugins\nextaction\`
- `viteStaticCopy` 复制 plugin.json, icon.png, preview.png, README*.md, i18n/

- [ ] **步骤 6：创建 webpack.kernel.config.js**

参照 `vendor/plugin-sample/webpack.kernel.config.js`：
- `entry: "./src/kernel.ts"`
- `output.library.type: "module"`, `experiments.outputModule: true`
- `esbuild-loader target: "es2015"`
- `external: { siyuan: "siyuan" }`

- [ ] **步骤 7：创建 src/index.ts（最小前端入口）**

```typescript
import { Plugin, showMessage } from "siyuan";
import "./index.scss";

export default class NextActionPlugin extends Plugin {
    onload() {
        // 最小入口，后续任务逐步添加功能
        console.log(`[NextAction] plugin loaded, i18n: ${this.i18n.pluginName}`);
    }

    onLayoutReady() {
        console.log("[NextAction] layout ready");
    }

    onunload() {
        console.log("[NextAction] plugin unloaded");
    }
}
```

- [ ] **步骤 8：创建 src/kernel.ts（最小内核入口）**

```typescript
export default class NextActionKernel {
    private siyuan: any;

    async onload() {
        this.siyuan = (globalThis as any).siyuan;
        await this.siyuan.logger.info("[NextAction] kernel loaded");
    }

    async onrunning() {
        await this.siyuan.logger.info("[NextAction] kernel running");
    }

    async onunload() {
        await this.siyuan.logger.info("[NextAction] kernel unloaded");
    }
}

const kernel = new NextActionKernel();
export const onload = kernel.onload.bind(kernel);
export const onrunning = kernel.onrunning.bind(kernel);
export const onunload = kernel.onunload.bind(kernel);
```

注意：内核插件必须导出 `onload`/`onrunning`/`onunload` 函数。参考 `vendor/plugin-sample/src/kernel.ts` 的生命周期注册方式，实际是通过 `siyuan.plugin.lifecycle` 注册。需要仔细对照示例代码调整入口格式。

- [ ] **步骤 9：创建 i18n 文件**

`src/i18n/en.json`:
```json
{
  "pluginName": "NextAction",
  "topBarTip": "NextAction Task Manager",
  "nextAction": "Next Actions",
  "allTasks": "All Tasks",
  "byProject": "By Project",
  "statusTodo": "To Do",
  "statusDoing": "In Progress",
  "statusWaiting": "Waiting",
  "statusDone": "Done",
  "priorityCritical": "Critical",
  "priorityHigh": "High",
  "priorityMedium": "Medium",
  "priorityLow": "Low",
  "priorityNone": "None",
  "importance": "Importance",
  "effort": "Effort",
  "dueDate": "Due Date",
  "startDate": "Start Date",
  "context": "Context",
  "convertToTask": "Convert to Task",
  "createTask": "Create Task",
  "removeTask": "Remove Task",
  "recalcOrders": "Recalculate Priorities",
  "noTasks": "No tasks yet",
  "taskPanel": "Task Panel",
  "markDone": "Mark Done",
  "openPanel": "Open Task Panel"
}
```

`src/i18n/zh-CN.json`:
```json
{
  "pluginName": "今天干点啥",
  "topBarTip": "今天干点啥 任务管理",
  "nextAction": "下一步行动",
  "allTasks": "全部任务",
  "byProject": "按项目",
  "statusTodo": "待办",
  "statusDoing": "进行中",
  "statusWaiting": "等待",
  "statusDone": "已完成",
  "priorityCritical": "紧急",
  "priorityHigh": "高",
  "priorityMedium": "中",
  "priorityLow": "低",
  "priorityNone": "无",
  "importance": "重要性",
  "effort": "工作量",
  "dueDate": "截止日期",
  "startDate": "开始日期",
  "context": "上下文",
  "convertToTask": "转为任务",
  "createTask": "新建任务",
  "removeTask": "移除任务",
  "recalcOrders": "重新计算优先级",
  "noTasks": "暂无任务",
  "taskPanel": "任务面板",
  "markDone": "标记完成",
  "openPanel": "打开任务面板"
}
```

- [ ] **步骤 10：创建 src/index.scss 和 src/declarations.d.ts**

`src/index.scss`:
```scss
.nextaction {
    font-family: var(--b3-font-family);
}
```

`src/declarations.d.ts`:
```typescript
declare module "*.scss";
declare module "*.png";
```

- [ ] **步骤 11：创建 scripts/make_dev_copy.js**

脚本功能：将构建产物复制到 `D:\z00813717\Documents\SiYuan\SecBar\data\plugins\nextaction\`。

参照常见插件部署脚本的实现方式，使用 `fs.cpSync` 或 `fs.copyFileSync` 复制：
- `index.js` → 目标目录
- `index.css` → 目标目录
- `kernel.js` → 目标目录/dist/
- `i18n/*` → 目标目录/i18n/
- `plugin.json` → 目标目录
- `icon.png` → 目标目录
- `preview.png` → 目标目录

- [ ] **步骤 12：创建占位的 icon.png 和 preview.png**

使用任意合法的 PNG 图片（可从 vendor/plugin-sample 复制并重命名，后续替换为正式图标）。

- [ ] **步骤 13：配置 package.json scripts**

```json
{
  "scripts": {
    "dev": "run-p dev:kernel dev:app",
    "dev:app": "vite build --watch --mode development",
    "dev:kernel": "webpack --config webpack.kernel.config.js --mode development",
    "build": "run-s build:kernel build:app",
    "build:app": "vite build --mode production",
    "build:kernel": "webpack --config webpack.kernel.config.js --mode production",
    "dev:copy": "node scripts/make_dev_copy.js"
  },
  "type": "module",
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **步骤 14：构建并验证插件加载**

```bash
cd D:/Codes/plugins/siyuan-mylifeorganized
pnpm run build
node scripts/make_dev_copy.js
```

打开思源笔记，在 设置→集市→已下载 中找到 NextAction 插件，启用后检查控制台是否有 `[NextAction] plugin loaded` 和 `[NextAction] kernel loaded` 日志。

预期：插件加载成功，前端和内核生命周期正常触发。

- [ ] **步骤 15：Commit**

```bash
git add -A
git commit -m "feat: scaffold NextAction plugin with Vite+webpack build, minimal frontend and kernel entry"
```

---

### 任务 2：共享类型与常量

**文件：**
- 创建：`src/shared/types.ts`
- 创建：`src/shared/constants.ts`

- [ ] **步骤 1：创建 src/shared/types.ts**

```typescript
export interface TaskCacheEntry {
    blockId: string;
    parentId: string;
    status: string;
    priority: string;
    importance: number;
    effort: number;
    due: string;
    start: string;
    context: string;
    taskType: string;
    order: number;
    childIds: string[];
    title: string;
}

export interface TaskChangeNotification {
    changedBlockIds: string[];
    changeTypes: Record<string, "create" | "update" | "delete">;
}
```

- [ ] **步骤 2：创建 src/shared/constants.ts**

```typescript
export const TASK_TYPE_TASK = "1";
export const TASK_TYPE_PROJECT = "2";

export const STATUS_TODO = "todo";
export const STATUS_DOING = "doing";
export const STATUS_WAITING = "waiting";
export const STATUS_DONE = "done";
export const ALL_STATUSES = [STATUS_TODO, STATUS_DOING, STATUS_WAITING, STATUS_DONE] as const;

export const PRIORITY_CRITICAL = "critical";
export const PRIORITY_HIGH = "high";
export const PRIORITY_MEDIUM = "medium";
export const PRIORITY_LOW = "low";
export const PRIORITY_NONE = "none";

export const PRIORITY_WEIGHTS: Record<string, number> = {
    [PRIORITY_CRITICAL]: 5,
    [PRIORITY_HIGH]: 4,
    [PRIORITY_MEDIUM]: 3,
    [PRIORITY_LOW]: 2,
    [PRIORITY_NONE]: 1,
};

export const ATTR_PREFIX = "na-";
export const ATTR_TASK = "na-task";
export const ATTR_STATUS = "na-status";
export const ATTR_PRIORITY = "na-priority";
export const ATTR_DUE = "na-due";
export const ATTR_START = "na-start";
export const ATTR_CONTEXT = "na-context";
export const ATTR_EFFORT = "na-effort";
export const ATTR_IMPORTANCE = "na-importance";
export const ATTR_PARENT = "na-parent";

export const DEFAULT_IMPORTANCE = 4;
export const DEFAULT_EFFORT = 4;

export const RPC_ERROR_INVALID_PARAMS = -32001;
export const RPC_ERROR_TASK_NOT_FOUND = -32002;
export const RPC_ERROR_CIRCULAR_REF = -32003;
export const RPC_ERROR_CONFLICT = -32004;
export const RPC_ERROR_NOT_READY = -32005;
export const RPC_ERROR_TIMEOUT = -32006;

export const SYNC_INTERVAL_MS = 5000;
export const DELETE_CHECK_INTERVAL_MS = 60000;
export const BROADCAST_DEBOUNCE_MS = 100;
export const WRITE_LOCK_TIMEOUT_MS = 10000;
```

- [ ] **步骤 3：Commit**

```bash
git add src/shared/
git commit -m "feat: add shared types and constants for task attributes, statuses, priorities, RPC errors"
```

---

### 任务 3：内核工具函数与互斥锁

**文件：**
- 创建：`src/kernel/utils.ts`
- 创建：`src/kernel/mutex.ts`
- 创建：`src/kernel/types.ts`
- 创建：`src/kernel/constants.ts`

- [ ] **步骤 1：创建 src/kernel/types.ts**

```typescript
export interface SiyuanApiResponse {
    code: number;
    msg: string;
    data: any;
}

export interface Mutex {
    acquire(): Promise<void>;
    release(): void;
}
```

- [ ] **步骤 2：创建 src/kernel/constants.ts**

```typescript
export const SQL_ALL_TASK_BLOCKS = `
    SELECT b.id, b.parent_id, b.content, b.updated
    FROM blocks b
    INNER JOIN attributes a ON a.block_id = b.id AND a.name = 'na-task'
    WHERE a.value IS NOT NULL AND a.value != ''
`.trim();

export const SQL_INCREMENTAL_CHANGES = (lastSyncTime: string) => `
    SELECT b.id, b.parent_id, b.updated, a.name, a.value
    FROM blocks b
    INNER JOIN attributes a ON a.block_id = b.id AND a.name LIKE 'na-%'
    WHERE b.updated > '${lastSyncTime}'
`.trim();

export const SQL_ALL_TASK_IDS = `
    SELECT b.id
    FROM blocks b
    INNER JOIN attributes a ON a.block_id = b.id AND a.name = 'na-task'
    WHERE a.value IS NOT NULL AND a.value != ''
`.trim();
```

- [ ] **步骤 3：创建 src/kernel/mutex.ts**

```typescript
import { Mutex as MutexInterface } from "./types";

export class Mutex implements MutexInterface {
    private queue: (() => void)[] = [];
    private locked = false;

    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
        } else {
            this.locked = false;
        }
    }
}
```

- [ ] **步骤 4：创建 src/kernel/utils.ts**

```typescript
import { ATTR_PREFIX, DEFAULT_IMPORTANCE, DEFAULT_EFFORT } from "../shared/constants";
import { SiyuanApiResponse } from "./types";

let siyuanRef: any = null;

export function setSiyuan(siyuan: any): void {
    siyuanRef = siyuan;
}

export function getSiyuan(): any {
    return siyuanRef;
}

export async function siyuanFetch<T = any>(path: string, body: object = {}): Promise<T> {
    const resp = await siyuanRef.client.fetch(path, {
        method: "POST",
        body: JSON.stringify(body),
    });
    const result: SiyuanApiResponse = await resp.json();
    if (result.code !== 0) {
        throw new Error(`API error ${result.code}: ${result.msg}`);
    }
    return result.data as T;
}

export function attrToNumber(value: string | undefined | null, defaultVal: number): number {
    if (value === undefined || value === null || value === "") {
        return defaultVal;
    }
    const num = parseInt(value, 10);
    return isNaN(num) ? defaultVal : num;
}

export function numberToAttr(val: number): string {
    return String(val);
}

export function isEmptyParent(parentId: string | undefined | null): boolean {
    return parentId === undefined || parentId === null || parentId === "";
}

export function validateTaskAttrs(attrs: Record<string, string>): string | null {
    for (const key of Object.keys(attrs)) {
        if (!key.startsWith(ATTR_PREFIX)) {
            return `Invalid attribute key: ${key}, must start with ${ATTR_PREFIX}`;
        }
        if (typeof attrs[key] !== "string") {
            return `Invalid attribute value for ${key}: must be string`;
        }
    }
    return null;
}
```

- [ ] **步骤 5：Commit**

```bash
git add src/kernel/utils.ts src/kernel/mutex.ts src/kernel/types.ts src/kernel/constants.ts
git commit -m "feat: add kernel utils, mutex, types, and SQL constants"
```

---

### 任务 4：优先级引擎

**文件：**
- 创建：`src/kernel/priority-engine.ts`

- [ ] **步骤 1：创建 src/kernel/priority-engine.ts**

```typescript
import { TaskCacheEntry } from "../shared/types";
import { PRIORITY_WEIGHTS } from "../shared/constants";

function calculateUrgency(dueDate: string): number {
    if (!dueDate) return 100;

    const now = new Date();
    const due = new Date(dueDate + "T23:59:59Z");
    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return Math.min(200, 100 + Math.abs(diffDays) * 2);
    if (diffDays === 0) return 95;
    if (diffDays === 1) return 85;
    if (diffDays === 2) return 75;
    if (diffDays === 3) return 65;
    if (diffDays === 4) return 55;
    if (diffDays === 5) return 45;
    if (diffDays === 6) return 35;
    if (diffDays === 7) return 25;
    if (diffDays <= 14) return 15;
    if (diffDays <= 30) return 8;
    return 3;
}

export function calculateOrder(entry: TaskCacheEntry): number {
    const importanceWeight = 14;
    const urgencyWeight = 0.3;
    const priorityWeight = 10;
    const effortWeight = 6;

    const importance = entry.importance;
    const effort = entry.effort;
    const priorityW = PRIORITY_WEIGHTS[entry.priority] || 1;
    const urgency = calculateUrgency(entry.due);

    return importance * importanceWeight
        + urgency * urgencyWeight
        + priorityW * priorityWeight
        + (8 - effort) * effortWeight;
}

export function isNextActionCandidate(entry: TaskCacheEntry, cache: Record<string, TaskCacheEntry>): boolean {
    if (entry.status === "done") return false;
    if (entry.status === "waiting") return false;
    if (entry.start && entry.start > new Date().toISOString().slice(0, 10)) return false;

    const hasIncompleteChild = entry.childIds.some((id) => {
        const child = cache[id];
        return child && child.status !== "done";
    });
    if (hasIncompleteChild) return false;

    return true;
}

export function sortTasks(tasks: TaskCacheEntry[]): TaskCacheEntry[] {
    return tasks.sort((a, b) => {
        if (b.order !== a.order) return b.order - a.order;
        if (a.due && b.due) {
            if (a.due !== b.due) return a.due.localeCompare(b.due);
        } else if (a.due) {
            return -1;
        } else if (b.due) {
            return 1;
        }
        if (b.importance !== a.importance) return b.importance - a.importance;
        return a.blockId.localeCompare(b.blockId);
    });
}
```

- [ ] **步骤 2：Commit**

```bash
git add src/kernel/priority-engine.ts
git commit -m "feat: add priority engine with urgency calculation, order formula, and Next Action filtering"
```

---

### 任务 5：缓存管理器

**文件：**
- 创建：`src/kernel/cache-manager.ts`

- [ ] **步骤 1：创建 src/kernel/cache-manager.ts**

实现以下方法：
- `loadAll()`: 全量加载缓存（SQL查询+batchGetBlockAttrs+构建childIds索引）
- `get(blockId)`: 获取单个缓存条目
- `getAll()`: 获取所有缓存条目
- `set(entry)`: 设置/更新缓存条目（同时维护childIds反向索引）
- `remove(blockId)`: 删除缓存条目（同时从父任务childIds中移除）
- `rebuild()`: 清空并重新加载

关键实现要点：
- 缓存容器用 `Record<string, TaskCacheEntry> = Object.create(null)`
- `loadAll()` 中，先 SQL 查所有 na-task 块的 id 和 parent_id，再 `batchGetBlockAttrs` 批量读取
- 构建 childIds：遍历缓存，对每个非空 parentId，将当前 blockId 追加到父条目的 childIds
- 属性读取后需要从 string 转换：importance/effort 用 `attrToNumber`，order 用 `calculateOrder`

- [ ] **步骤 2：Commit**

```bash
git add src/kernel/cache-manager.ts
git commit -m "feat: add cache manager with full load, get/set/remove, childIds index, and rebuild"
```

---

### 任务 6：增量同步引擎

**文件：**
- 创建：`src/kernel/sync-engine.ts`

- [ ] **步骤 1：创建 src/kernel/sync-engine.ts**

实现以下逻辑：
- `start()`: 启动 `setInterval(syncOnce, 5000)` 和 `setInterval(checkDeleted, 60000)`
- `stop()`: 清除定时器
- `syncOnce()`: 使用 Mutex 与写操作互斥，执行 SQL_INCREMENTAL_CHANGES 查询，对比缓存更新，有变更则通过 `siyuan.rpc.broadcast("tasksChanged", notification)` 广播通知
- `checkDeleted()`: 使用 Mutex 互斥，执行 SQL_ALL_TASK_IDS 查询，与缓存key做差集，删除不在结果中的条目
- 广播通知做 100ms 防抖：收集变更，100ms 后合并为一次广播

注意：需要先验证 goja 的 `setInterval` 支持。在 `kernel.ts` 的 `onrunning` 中先做一个简单的 `setInterval` 测试。若不支持，改为前端 `setInterval` 定期调用内核 `syncOnce` RPC 方法。

- [ ] **步骤 2：Commit**

```bash
git add src/kernel/sync-engine.ts
git commit -m "feat: add sync engine with incremental sync, delete detection, and debounced broadcast"
```

---

### 任务 7：任务服务

**文件：**
- 创建：`src/kernel/task-service.ts`

- [ ] **步骤 1：创建 src/kernel/task-service.ts**

实现以下方法（每个方法内部使用全局 Mutex 保证互斥）：

**convertToTask(blockId: string): TaskCacheEntry**
1. 校验 blockId 非空
2. 检查 isReady，否则返回 -32005
3. 调用 `getBlockAttrs(blockId)` 检查是否已是任务
4. 设置默认属性：`na-task="1"`, `na-status="todo"`, `na-priority="none"`, `na-importance="4"`, `na-effort="4"`
5. 向上查找祖先任务：SQL 查询从当前块到根的 parent_id 链，批量 `getBlockAttrs` 检查 na-task 属性，找到最近的祖先任务 → 设置 `na-parent`
6. 向下查找子孙任务：`getChildBlocks` 获取子孙，找出已有 na-task 属性且 na-parent 为空或指向当前块祖先的 → 更新 na-parent 为当前块
7. 更新缓存（含 childIds 维护）
8. 计算并设置 order
9. 广播变更

**removeTask(blockId: string): void**
1. 校验
2. 获取当前缓存条目及其子任务列表
3. 将子任务的 na-parent 重指向当前条目的 parentId（祖父任务）
4. 更新祖父任务缓存的 childIds
5. 调用 `setBlockAttrs` 清除当前块所有 `na-*` 属性（设为空字符串）
6. 从缓存移除当前条目
7. 广播变更

**updateTask(blockId: string, attrs: Record<string, string>): TaskCacheEntry**
1. 参数校验（validateTaskAttrs + status 合法性）
2. 获取 Mutex
3. 调用 `setBlockAttrs` 更新属性
4. 如果修改了 importance/effort/priority/due/start → 重算 order
5. 如果修改了 status 为 done → 检查父任务 childIds，若所有子任务完成则父任务可能出现在 Next Action
6. 如果修改了 na-parent → 循环引用检测（沿 parentId 链向上遍历最多100层）
7. 更新缓存
8. 释放 Mutex
9. 广播变更

**createTask(params: {parentBlockId?, notebookId?, title, attrs?}): TaskCacheEntry**
1. 确定创建位置：有 parentBlockId 则在该块下追加子块，否则需 notebookId 在笔记本下创建文档块
2. 调用 `appendBlock` 或 `createDocWithMd` 创建块
3. 设置默认属性 + 用户传入的 attrs
4. 如果有 parentBlockId，直接设置 `na-parent=parentBlockId`
5. 更新缓存
6. 广播变更

**getTask / getNextActions / getAllTasks / getTasksByParent / recalcAllOrders / rebuildCache / getContexts**

这些是读取操作，不获取 Mutex，直接从缓存读取和计算。

- [ ] **步骤 2：Commit**

```bash
git add src/kernel/task-service.ts
git commit -m "feat: add task service with CRUD, convert, remove, priority recalc, and all RPC methods"
```

---

### 任务 8：RPC服务端

**文件：**
- 创建：`src/kernel/rpc-server.ts`
- 修改：`src/kernel.ts`

- [ ] **步骤 1：创建 src/kernel/rpc-server.ts**

使用 `siyuan.rpc.bind(methodName, handler)` 注册所有 RPC 方法。每个方法：
- 解析 params 参数
- 调用对应的 TaskService 方法
- 返回 JSON-RPC 格式的 result
- 异常时返回 JSON-RPC error 对象

注册的方法列表：
- `convertToTask`, `removeTask`, `updateTask`, `createTask`
- `getTask`, `getNextActions`, `getAllTasks`, `getTasksByParent`
- `recalcAllOrders`, `rebuildCache`, `getContexts`
- `echo`（调试用，返回收到的参数）

- [ ] **步骤 2：修改 src/kernel.ts 组装所有模块**

在 `onload` 中：
1. 保存 siyuan 全局引用
2. 初始化 Mutex、CacheManager、TaskService、SyncEngine、RpcServer
3. 异步执行 CacheManager.loadAll()
4. loadAll 完成后设置 isReady = true
5. 通过 RpcServer 注册所有方法

在 `onrunning` 中：
1. 启动 SyncEngine

在 `onunload` 中：
1. 停止 SyncEngine
2. 清理缓存

- [ ] **步骤 3：构建并验证**

```bash
pnpm run build
node scripts/make_dev_copy.js
```

在思源中重新加载插件，使用浏览器控制台测试 RPC 调用：

```javascript
// 在思源笔记的开发者工具中执行
fetch("/api/plugin/rpc/nextaction", {
    method: "POST",
    body: JSON.stringify({jsonrpc: "2.0", method: "echo", params: ["hello"], id: 1})
}).then(r => r.json()).then(console.log)
```

预期：返回 `{"jsonrpc":"2.0","result":["hello"],"id":1}`

- [ ] **步骤 4：Commit**

```bash
git add src/kernel/rpc-server.ts src/kernel.ts
git commit -m "feat: add RPC server and wire up kernel entry with all modules"
```

---

### 任务 9：内核集成验证

**文件：**
- 修改：`src/index.ts`（添加最小验证UI）

- [ ] **步骤 1：修改前端入口添加RPC测试**

在 `src/index.ts` 的 `onLayoutReady` 中，监听内核 running 状态后，调用 `getNextActions` 并用 `showMessage` 显示结果数量：

```typescript
this.eventBus.on("kernel-plugin-state-change", async ({detail}: any) => {
    if (detail.code === 2) { // running
        try {
            const result = await this.kernel.rpc.call.getNextActions({});
            showMessage(`[NextAction] ${result.length} next actions loaded`);
        } catch (e) {
            showMessage(`[NextAction] RPC error: ${e}`);
        }
    }
});
```

- [ ] **步骤 2：手动端到端测试**

1. 在思源中打开一个文档
2. 使用属性面板手动给一个块添加 `na-task="1"`, `na-status="todo"`, `na-priority="high"`, `na-importance="6"`, `na-effort="3"`, `na-due="2026-07-05"` 属性
3. 在开发者工具中调用 `getNextActions` RPC
4. 验证返回结果包含该任务且 order 分值合理
5. 测试 `updateTask` 修改属性
6. 测试 `convertToTask` 将一个普通块转为任务
7. 测试 `removeTask` 移除任务属性

- [ ] **步骤 3：Commit**

```bash
git add src/index.ts
git commit -m "feat: add minimal frontend RPC test to verify kernel integration"
```

---

### 任务 10：最终整理与文档

**文件：**
- 创建：`README.md`
- 创建：`README.zh-CN.md`
- 修改：`package.json`（确认版本号）

- [ ] **步骤 1：编写 README.md**

简要说明插件用途、安装方式、开发方式。

- [ ] **步骤 2：编写 README.zh-CN.md**

中文版 README。

- [ ] **步骤 3：确认 package.json version 为 0.1.0**

- [ ] **步骤 4：最终构建验证**

```bash
pnpm run build
node scripts/make_dev_copy.js
```

在思源中重新加载插件，确认一切正常。

- [ ] **步骤 5：Commit**

```bash
git add -A
git commit -m "docs: add README and finalize v0.1.0 kernel plugin milestone"
```
