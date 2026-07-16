import type { MyDayState, MyDayTaskEntry } from "../shared/types";
import { MY_DAY_DATA_PATH, DEFAULT_MY_DAY_RESET_HOUR } from "../shared/constants";
import type { PluginSettings } from "../shared/settings";
import { Mutex } from "./mutex";
import { setMyDayTaskCompletedAt } from "../shared/my-day";

function resolveDayKey(now: Date, resetHour: number): string {
    const boundaryHour = Math.max(0, Math.min(23, resetHour));
    const effectiveDate = new Date(now);
    if (effectiveDate.getHours() < boundaryHour) {
        effectiveDate.setDate(effectiveDate.getDate() - 1);
    }
    const year = effectiveDate.getFullYear();
    const month = String(effectiveDate.getMonth() + 1).padStart(2, "0");
    const day = String(effectiveDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function createDefaultMyDayState(dayKey: string): MyDayState {
    return {
        schema: 1,
        dayKey,
        tasks: [],
        updatedAt: Date.now(),
    };
}

export class MyDayManager {
    private siyuan: any;
    private settings: PluginSettings;
    private state: MyDayState | null = null;
    private mutex: Mutex;

    constructor(siyuan: any, settings: PluginSettings) {
        this.siyuan = siyuan;
        this.settings = settings;
        this.mutex = new Mutex();
    }

    updateSettings(settings: PluginSettings): void {
        this.settings = settings;
    }

    private getResetHour(): number {
        return this.settings.myDayResetHour ?? DEFAULT_MY_DAY_RESET_HOUR;
    }

    async load(): Promise<MyDayState> {
        const currentDayKey = resolveDayKey(new Date(), this.getResetHour());
        try {
            const data = await this.siyuan.storage.get(MY_DAY_DATA_PATH);
            const parsed = await data.json() as MyDayState;
            if (parsed && parsed.schema === 1 && parsed.dayKey === currentDayKey) {
                this.state = parsed;
                return { ...this.state, tasks: [...this.state.tasks] };
            }
        } catch (_e) {
            // file does not exist or parse error — create fresh
        }
        this.state = createDefaultMyDayState(currentDayKey);
        await this.persist();
        return { ...this.state, tasks: [...this.state.tasks] };
    }

    async getState(): Promise<MyDayState> {
        if (!this.state) {
            return this.load();
        }
        const currentDayKey = resolveDayKey(new Date(), this.getResetHour());
        if (this.state.dayKey !== currentDayKey) {
            this.state = createDefaultMyDayState(currentDayKey);
            await this.persist();
        }
        return { ...this.state, tasks: [...this.state.tasks] };
    }

    private async persist(): Promise<void> {
        if (!this.state) return;
        this.state.updatedAt = Date.now();
        await this.siyuan.storage.put(MY_DAY_DATA_PATH, JSON.stringify(this.state));
    }

    private applyState(newState: MyDayState): MyDayState {
        this.state = newState;
        return { ...this.state, tasks: [...this.state.tasks] };
    }

    async addTask(blockId: string): Promise<MyDayState> {
        const { promise } = this.mutex.acquire();
        const lock = await promise;
        try {
            return await this._addTask(blockId);
        } finally {
            lock.release();
        }
    }

    private async _addTask(blockId: string): Promise<MyDayState> {
        const current = await this.getState();
        const existing = current.tasks.find(t => t.blockId === blockId);
        if (existing) return current;
        const maxOrder = current.tasks.length > 0
            ? Math.max(...current.tasks.map(t => t.order))
            : -1;
        const entry: MyDayTaskEntry = {
            blockId,
            addedAt: Date.now(),
            scheduleStart: null,
            scheduleEnd: null,
            order: maxOrder + 1,
        };
        const newState: MyDayState = {
            ...current,
            tasks: [...current.tasks, entry],
        };
        const savedState = this.state;
        this.state = newState;
        try {
            await this.persist();
        } catch (e) {
            this.state = savedState;
            throw e;
        }
        return { ...this.state, tasks: [...this.state.tasks] };
    }

    async removeTask(blockId: string): Promise<MyDayState> {
        const { promise } = this.mutex.acquire();
        const lock = await promise;
        try {
            return await this._removeTask(blockId);
        } finally {
            lock.release();
        }
    }

    private async _removeTask(blockId: string): Promise<MyDayState> {
        const current = await this.getState();
        const newTasks = current.tasks.filter(t => t.blockId !== blockId);
        if (newTasks.length === current.tasks.length) return current;
        const newState: MyDayState = {
            ...current,
            tasks: newTasks,
        };
        const savedState = this.state;
        this.state = newState;
        try {
            await this.persist();
        } catch (e) {
            this.state = savedState;
            throw e;
        }
        return { ...this.state, tasks: [...this.state.tasks] };
    }

    async reorderTask(blockId: string, afterId?: string): Promise<MyDayState> {
        const { promise } = this.mutex.acquire();
        const lock = await promise;
        try {
            return await this._reorderTask(blockId, afterId);
        } finally {
            lock.release();
        }
    }

    private async _reorderTask(blockId: string, afterId?: string): Promise<MyDayState> {
        const current = await this.getState();
        const idx = current.tasks.findIndex(t => t.blockId === blockId);
        if (idx === -1) return current;
        const tasks = [...current.tasks];
        const [entry] = tasks.splice(idx, 1);
        if (afterId) {
            const afterIdx = tasks.findIndex(t => t.blockId === afterId);
            if (afterIdx >= 0) {
                tasks.splice(afterIdx + 1, 0, entry);
            } else {
                tasks.push(entry);
            }
        } else {
            tasks.unshift(entry);
        }
        tasks.forEach((t, i) => { t.order = i; });
        const newState: MyDayState = { ...current, tasks };
        const savedState = this.state;
        this.state = newState;
        try {
            await this.persist();
        } catch (e) {
            this.state = savedState;
            throw e;
        }
        return { ...this.state, tasks: [...this.state.tasks] };
    }

    async setSchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        const { promise } = this.mutex.acquire();
        const lock = await promise;
        try {
            return await this._setSchedule(blockId, start, end);
        } finally {
            lock.release();
        }
    }

    private async _setSchedule(blockId: string, start: number | null, end: number | null): Promise<MyDayState> {
        const current = await this.getState();
        const entryIndex = current.tasks.findIndex((t) => t.blockId === blockId);
        if (entryIndex === -1) {
            throw new Error(`Task ${blockId} not found in My Day`);
        }
        // 校验：start 和 end 都为 null 或都不为 null
        if ((start === null) !== (end === null)) {
            throw new Error("scheduleStart and scheduleEnd must both be null or both be set");
        }
        if (start !== null && end !== null) {
            if (start < 0 || end > 1440) {
                throw new Error(`Schedule minutes out of range: start=${start}, end=${end}`);
            }
            if (end - start < 15) {
                throw new Error(`Schedule duration too short: ${end - start} minutes (min 15)`);
            }
            if (end - start > 720) {
                throw new Error(`Schedule duration too long: ${end - start} minutes (max 720)`);
            }
        }
        const updatedEntry: MyDayTaskEntry = {
            ...current.tasks[entryIndex],
            scheduleStart: start,
            scheduleEnd: end,
        };
        const newTasks = [...current.tasks];
        newTasks[entryIndex] = updatedEntry;
        const newState: MyDayState = {
            ...current,
            tasks: newTasks,
            updatedAt: Date.now(),
        };
        const savedState = this.state;
        this.state = newState;
        try {
            await this.persist();
        } catch (e) {
            this.state = savedState;
            throw e;
        }
        return { ...this.state, tasks: [...this.state.tasks] };
    }

    async removeSchedule(blockId: string): Promise<MyDayState> {
        return this.setSchedule(blockId, null, null);
    }

    async markTaskCompleted(blockId: string, completedAt: number): Promise<MyDayState> {
        return this.updateTaskCompletedAt(blockId, completedAt);
    }

    async clearTaskCompleted(blockId: string): Promise<MyDayState> {
        return this.updateTaskCompletedAt(blockId, undefined);
    }

    private async updateTaskCompletedAt(blockId: string, completedAt: number | undefined): Promise<MyDayState> {
        const { promise } = this.mutex.acquire();
        const lock = await promise;
        try {
            const current = await this.getState();
            const newState = setMyDayTaskCompletedAt(current, blockId, completedAt);
            if (newState === current) return current;

            const savedState = this.state;
            this.state = newState;
            try {
                await this.persist();
            } catch (e) {
                this.state = savedState;
                throw e;
            }
            try {
                await this.siyuan.rpc.broadcast("myDayChanged", {
                    ...this.state,
                    tasks: [...this.state.tasks],
                });
            } catch (e: any) {
                this.siyuan?.logger?.warn?.(`MyDayManager: failed to broadcast completion change: ${e.message || e}`);
            }
            return { ...this.state, tasks: [...this.state.tasks] };
        } finally {
            lock.release();
        }
    }
}
