import {
    ATTR_IMPORTANCE,
    ATTR_COMPLETED,
    ATTR_PARENT,
    ATTR_PRIORITY,
    ATTR_STATUS,
    ALL_STATUSES,
    RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET,
    RPC_ERROR_PROJECT_BOARD_MOVE_UNDO_INVALID,
    RPC_ERROR_PROJECT_BOARD_MOVE_UNDO_UNSAFE,
    RPC_ERROR_TASK_NOT_FOUND,
} from "../shared/constants";
import type {
    ProjectBoardMoveInput,
    ProjectBoardMoveResult,
    ProjectBoardMoveUndo,
    ProjectBoardUndoResult,
} from "../shared/project-board-move";
import type { TaskCacheEntry } from "../shared/types";
import { assertBlockId } from "../shared/block-id";
import { isProjectTask } from "../shared/project-domain";
import { PROJECT_BOARD_IMPORTANCES, PROJECT_BOARD_PRIORITIES } from "../shared/project-board";
import type { CacheManager } from "./cache-manager";
import type { TaskService } from "./task-service";

interface UndoRecord {
    input: ProjectBoardMoveInput;
    task: TaskCacheEntry;
    previousAttrs: Record<string, string>;
    previousAfterId?: string;
    expected: TaskCacheEntry;
}

function moveError(code: number, message: string): Error & { code: number } {
    const error = new Error(message) as Error & { code: number };
    error.code = code;
    return error;
}

/** Validates and executes a single logical Project board move. */
export class ProjectBoardMoveService {
    private readonly records = new Map<string, UndoRecord>();
    private readonly credentialByTask = new Map<string, string>();
    private sequence = 0;

    constructor(
        private readonly cache: CacheManager,
        private readonly tasks: TaskService,
    ) {}

    async move(input: ProjectBoardMoveInput): Promise<ProjectBoardMoveResult> {
        const prepared = this.prepare(input);
        const attrs = this.attrsFor(prepared.task, prepared.input);
        const previousAttrs = this.previousAttrs(prepared.task, prepared.input, attrs);
        let updated = prepared.task;
        if (Object.keys(attrs).length > 0) updated = await this.tasks.updateTask(prepared.task.blockId, attrs);

        let reordered = false;
        if (!prepared.input.sortBy || prepared.input.sortBy === "order") {
            try {
                const siblings = this.siblings(updated.parentId || prepared.input.projectId, updated.blockId);
                const afterId = this.resolveReorderAnchor(prepared, siblings);
                updated = await this.tasks.reorderTask(
                    updated.blockId,
                    updated.parentId || prepared.input.projectId,
                    afterId,
                );
                reordered = true;
            } catch (error: unknown) {
                const current = this.cache.get(updated.blockId) || updated;
                return {
                    status: "partial",
                    task: current,
                    reordered: false,
                    warning: error instanceof Error ? error.message : String(error),
                };
            }
        }

        const undo = this.issueUndo({ ...prepared, previousAttrs, expected: updated });
        return { status: "success", task: updated, reordered, undo };
    }

    async undo(credential: string): Promise<ProjectBoardUndoResult> {
        const record = this.records.get(credential);
        if (!record)
            throw moveError(
                RPC_ERROR_PROJECT_BOARD_MOVE_UNDO_INVALID,
                "This board move undo is unavailable or already used",
            );
        const current = this.cache.get(record.task.blockId);
        if (!current || !this.matchesExpected(current, record.expected)) {
            this.consume(credential, record);
            throw moveError(
                RPC_ERROR_PROJECT_BOARD_MOVE_UNDO_UNSAFE,
                "The task changed after the move; undo was not applied",
            );
        }

        this.consume(credential, record);
        let restored = await this.tasks.updateTask(record.task.blockId, record.previousAttrs);
        try {
            if (!record.input.sortBy || record.input.sortBy === "order") {
                restored = await this.tasks.reorderTask(
                    record.task.blockId,
                    record.task.parentId || record.input.projectId,
                    record.previousAfterId,
                );
            }
        } catch (error: unknown) {
            // Restore the fields even when the order cannot be restored; callers get a clear failure.
            throw moveError(
                RPC_ERROR_PROJECT_BOARD_MOVE_UNDO_UNSAFE,
                `Board move fields restored but original order could not be restored: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return {
            task: restored,
            summary: `${record.task.title}: ${record.input.value} → restored`,
        };
    }

    private prepare(input: ProjectBoardMoveInput): {
        input: ProjectBoardMoveInput;
        task: TaskCacheEntry;
        previousAfterId?: string;
    } {
        const taskId = assertBlockId(input.taskId, "taskId");
        const projectId = assertBlockId(input.projectId, "projectId");
        const task = this.cache.get(taskId);
        const project = this.cache.get(projectId);
        const membership = this.cache.getProjectMembershipGraph();
        const taskNode = membership.node(taskId);
        if (!task) throw moveError(RPC_ERROR_TASK_NOT_FOUND, "Task not found");
        if (!project || !isProjectTask(project))
            throw moveError(RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET, "Move target must be a valid Project");
        if (isProjectTask(task) || taskNode?.projectId !== projectId) {
            throw moveError(
                RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET,
                "Task does not belong to the selected Project",
            );
        }
        if (
            input.groupBy === "status" &&
            (typeof input.value !== "string" || !ALL_STATUSES.includes(input.value as never))
        )
            throw moveError(RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET, "The selected status is invalid");
        if (
            input.groupBy === "priority" &&
            (typeof input.value !== "string" || !PROJECT_BOARD_PRIORITIES.includes(input.value as never))
        )
            throw moveError(RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET, "The selected priority is invalid");
        if (
            input.groupBy === "importance" &&
            (typeof input.value !== "number" || !PROJECT_BOARD_IMPORTANCES.includes(input.value as never))
        )
            throw moveError(RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET, "The selected importance is invalid");
        if (input.afterId) {
            const afterId = assertBlockId(input.afterId, "afterId");
            if (afterId === taskId || !input.visibleTaskIds || !input.visibleTaskIds.includes(afterId)) {
                throw moveError(
                    RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET,
                    "The selected board target is not visible",
                );
            }
            const target = this.cache.get(afterId);
            const targetNode = membership.node(afterId);
            if (!target || isProjectTask(target) || targetNode?.projectId !== projectId) {
                throw moveError(RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET, "The selected board target is invalid");
            }
            const taskParentId = taskNode?.effectiveParentId || projectId;
            const targetParentId = targetNode?.effectiveParentId || projectId;
            const expectedParent = input.afterParentId || targetParentId;
            if (expectedParent !== targetParentId || expectedParent !== taskParentId) {
                throw moveError(
                    RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET,
                    "Board move target must share the task's logical parent",
                );
            }
        } else if (input.afterParentId && input.afterParentId !== (taskNode?.effectiveParentId || projectId)) {
            throw moveError(
                RPC_ERROR_PROJECT_BOARD_MOVE_INVALID_TARGET,
                "Board move parent does not match the task's logical parent",
            );
        }
        const siblings = this.cache
            .getByParent(task.parentId || projectId)
            .sort((a, b) => a.sort - b.sort || a.blockId.localeCompare(b.blockId));
        const index = siblings.findIndex((item) => item.blockId === taskId);
        return {
            input: { ...input, taskId, projectId },
            task,
            previousAfterId: index > 0 ? siblings[index - 1].blockId : undefined,
        };
    }

    private attrsFor(task: TaskCacheEntry, input: ProjectBoardMoveInput): Record<string, string> {
        if (input.groupBy === "status" && task.status !== String(input.value))
            return { [ATTR_STATUS]: String(input.value) };
        if (input.groupBy === "priority" && task.priority !== String(input.value))
            return { [ATTR_PRIORITY]: String(input.value) };
        if (input.groupBy === "importance" && task.importance !== Number(input.value))
            return { [ATTR_IMPORTANCE]: String(input.value) };
        return {};
    }

    private previousAttrs(
        task: TaskCacheEntry,
        input: ProjectBoardMoveInput,
        attrs: Record<string, string>,
    ): Record<string, string> {
        if (Object.keys(attrs).length === 0) return {};
        if (input.groupBy === "status") return { [ATTR_STATUS]: task.status, [ATTR_COMPLETED]: task.completed };
        if (input.groupBy === "priority") return { [ATTR_PRIORITY]: task.priority };
        return { [ATTR_IMPORTANCE]: String(task.importance) };
    }

    private resolveReorderAnchor(
        prepared: { input: ProjectBoardMoveInput; task: TaskCacheEntry },
        siblings: TaskCacheEntry[],
    ): string | undefined {
        if (prepared.input.afterId) {
            const index = siblings.findIndex((item) => item.blockId === prepared.input.afterId);
            return index > 0 ? siblings[index - 1].blockId : undefined;
        }
        return siblings[siblings.length - 1]?.blockId;
    }

    private siblings(parentId: string, excludeId: string): TaskCacheEntry[] {
        return this.cache
            .getByParent(parentId)
            .filter((entry) => entry.blockId !== excludeId)
            .sort((a, b) => a.sort - b.sort || a.blockId.localeCompare(b.blockId));
    }

    private issueUndo(record: UndoRecord): ProjectBoardMoveUndo {
        const previous = this.credentialByTask.get(record.task.blockId);
        if (previous) this.records.delete(previous);
        const credential = `${Date.now().toString(36)}-${(++this.sequence).toString(36)}-${Math.random().toString(36).slice(2)}`;
        this.records.set(credential, record);
        this.credentialByTask.set(record.task.blockId, credential);
        return { credential, taskId: record.task.blockId, summary: `${record.task.title}: board move` };
    }

    private consume(credential: string, record: UndoRecord): void {
        this.records.delete(credential);
        if (this.credentialByTask.get(record.task.blockId) === credential)
            this.credentialByTask.delete(record.task.blockId);
    }

    private matchesExpected(current: TaskCacheEntry, expected: TaskCacheEntry): boolean {
        return (
            current.status === expected.status &&
            current.priority === expected.priority &&
            current.importance === expected.importance &&
            current.parentId === expected.parentId &&
            current.sort === expected.sort
        );
    }
}
