import type { CustomFieldDef } from "../../shared/settings";
import type { TaskCacheEntry } from "../../shared/types";
import type { ProjectBoardSortBy } from "../../shared/project-board-preferences";
import { sortTasksBy } from "./filter";

/** Sort board cards independently from the project overview filter. */
export function sortProjectBoardTasks(
    tasks: TaskCacheEntry[],
    sortBy: ProjectBoardSortBy,
    sortAsc: boolean,
    customFields: CustomFieldDef[] = [],
): TaskCacheEntry[] {
    if (sortBy !== "order") return sortTasksBy(tasks, sortBy, sortAsc, customFields);
    const direction = sortAsc ? 1 : -1;
    return [...tasks].sort((left, right) => {
        if (left.sort < 0 && right.sort < 0) return left.blockId.localeCompare(right.blockId);
        if (left.sort < 0) return 1;
        if (right.sort < 0) return -1;
        return direction * (left.sort - right.sort) || left.blockId.localeCompare(right.blockId);
    });
}
