import { isProjectTask } from "./project-domain";
import type { TaskCacheEntry } from "./types";

export interface AiTaskContextOptions {
    titleLimit?: number;
    noteLimit?: number;
    dodLimit?: number;
    tagsLimit?: number;
    dependsLimit?: number;
}

function limit(value: string, maximum: number | undefined): string {
    return maximum === undefined ? value : value.slice(0, Math.max(0, maximum));
}

/** Stable, plain-data view of a task for AI prompt context. */
export function buildAiTaskContext(task: TaskCacheEntry, options: AiTaskContextOptions = {}): Record<string, unknown> {
    const project = isProjectTask(task);
    return {
        blockId: task.blockId,
        title: limit(task.title, options.titleLimit),
        kind: project ? "project" : "task",
        actionKind: project ? null : task.actionKind || "action",
        outcome: task.outcome || "",
        dod: limit(task.dod || "", options.dodLimit),
        status: task.status,
        priority: task.priority,
        importance: task.importance,
        effort: task.effort,
        start: task.start || null,
        due: task.due || null,
        context: task.context || "",
        tags: limit(task.tags || "", options.tagsLimit),
        parentId: task.parentId || null,
        childCount: task.childIds?.length || 0,
        depends: limit(task.depends || "", options.dependsLimit),
        blocked: task.blocked,
        blockedReason: task.blockedReason || null,
        reviewDate: task.reviewDate || null,
        note: limit(task.note || "", options.noteLimit),
    };
}
