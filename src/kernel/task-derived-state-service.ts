import type { TaskCacheEntry } from "../shared/types";
import type { CacheManager } from "./cache-manager";
import { calculateOrder, getBlockedReason } from "./priority-engine";

/**
 * Owns cache-only values that are derived from task relationships. Callers pass
 * authoritative cache changes; this service expands the affected relationship
 * graph and returns only entries whose derived values actually changed.
 */
export class TaskDerivedStateService {
    constructor(private readonly cacheManager: CacheManager) {}

    reconcile(seedIds: Iterable<string>): string[] {
        const affected = this.expandAffected(seedIds);
        return this.reconcileEntries(affected);
    }

    reconcileAll(): string[] {
        return this.reconcileEntries(new Set(this.cacheManager.getAll().map((entry) => entry.blockId)));
    }

    private reconcileEntries(affected: Set<string>): string[] {
        const cache = this.cacheManager.getCache();
        const entries = [...affected]
            .map((blockId) => cache[blockId])
            .filter((entry): entry is TaskCacheEntry => Boolean(entry));
        const changed = new Set<string>();

        // Establish every task's own score before projects inherit child scores.
        for (const entry of entries) {
            const nextOrder = calculateOrder(entry);
            if (entry.order !== nextOrder) {
                entry.order = nextOrder;
                changed.add(entry.blockId);
            }
        }

        const projects = entries
            .filter((entry) => entry.taskType === "2")
            .sort((left, right) => this.depth(right) - this.depth(left));
        for (const project of projects) {
            const nextOrder = calculateOrder(project, cache);
            if (project.order !== nextOrder) {
                project.order = nextOrder;
                changed.add(project.blockId);
            }
        }

        for (const entry of entries) {
            const blockedReason = getBlockedReason(entry, cache);
            const blocked = blockedReason !== "";
            if (entry.blocked !== blocked || entry.blockedReason !== blockedReason) {
                entry.blocked = blocked;
                entry.blockedReason = blockedReason;
                changed.add(entry.blockId);
            }
        }

        return [...changed];
    }

    private expandAffected(seedIds: Iterable<string>): Set<string> {
        const affected = new Set<string>();
        const queue = [...seedIds];
        for (let index = 0; index < queue.length; index++) {
            const blockId = queue[index];
            if (!blockId || affected.has(blockId)) continue;
            affected.add(blockId);

            const entry = this.cacheManager.get(blockId);
            if (entry) {
                this.enqueue(queue, entry.parentId);
                for (const child of this.cacheManager.getByParent(blockId)) this.enqueue(queue, child.blockId);
                if (entry.parentId) {
                    for (const sibling of this.cacheManager.getByParent(entry.parentId))
                        this.enqueue(queue, sibling.blockId);
                }
            }
            for (const dependent of this.cacheManager.getDependents(blockId)) this.enqueue(queue, dependent.blockId);
        }
        return affected;
    }

    private depth(entry: TaskCacheEntry): number {
        let depth = 0;
        let parentId = entry.parentId;
        const visited = new Set<string>();
        while (parentId && !visited.has(parentId)) {
            visited.add(parentId);
            const parent = this.cacheManager.get(parentId);
            if (!parent) break;
            depth++;
            parentId = parent.parentId;
        }
        return depth;
    }

    private enqueue(queue: string[], blockId: string | undefined): void {
        if (blockId) queue.push(blockId);
    }
}
