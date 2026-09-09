import { isProjectTask } from "../../shared/project-domain";
import type { TaskCacheEntry } from "../../shared/types";

export function projectScopeOptions(tasks: readonly TaskCacheEntry[], query: string) {
    const keyword = query.trim().toLowerCase();
    return tasks
        .filter(isProjectTask)
        .map((task) => ({ id: task.blockId, label: task.title.trim() || task.blockId }))
        .filter((option) => option.label.toLowerCase().includes(keyword) || option.id.toLowerCase().includes(keyword))
        .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
