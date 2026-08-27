import {
    ACTION_KIND_ACTION,
    ACTION_KIND_STAGE,
    ALL_STATUSES,
    ATTR_DUE,
    ATTR_KIND,
    ATTR_PARENT,
    ATTR_START,
    ATTR_STATUS,
    RPC_ERROR_INVALID_PARAMS,
} from "../shared/constants";
import type { ExtractActionInput, ExtractActionResult } from "../shared/action-extraction";
import { assertBlockId } from "../shared/block-id";
import { isProjectTask } from "../shared/project-domain";
import type { SiyuanApiPort } from "./siyuan-api";
import type { TaskCreationService } from "./task-creation-service";
import type { TaskService } from "./task-service";

function invalidInput(message: string): Error & { code: number } {
    return Object.assign(new Error(message), { code: RPC_ERROR_INVALID_PARAMS });
}

export interface ActionSourcePort {
    exists(sourceBlockId: string): Promise<boolean>;
}

export class SiyuanActionSourcePort implements ActionSourcePort {
    constructor(private readonly api: SiyuanApiPort) {}

    async exists(sourceBlockId: string): Promise<boolean> {
        try {
            return await this.api.request<boolean>("/api/block/checkBlockExist", {
                id: sourceBlockId,
            });
        } catch {
            return false;
        }
    }
}

export class ActionExtractionService {
    constructor(
        private readonly taskService: TaskService,
        private readonly creation: TaskCreationService,
        private readonly sources: ActionSourcePort,
    ) {}

    async extract(input: ExtractActionInput): Promise<ExtractActionResult> {
        const sourceBlockId = assertBlockId(input.sourceBlockId, "sourceBlockId");
        if (!(await this.sources.exists(sourceBlockId))) {
            throw invalidInput(`Source block not found: ${sourceBlockId}`);
        }

        const projectId = input.projectId ? assertBlockId(input.projectId, "projectId") : "";
        if (projectId) {
            const project = this.taskService.getTask(projectId);
            if (!project || !isProjectTask(project)) {
                throw invalidInput(`Project not found: ${projectId}`);
            }
        }
        if (!(ALL_STATUSES as readonly string[]).includes(input.status)) {
            throw invalidInput(`Invalid status: ${input.status}`);
        }
        if (input.actionKind !== ACTION_KIND_ACTION && input.actionKind !== ACTION_KIND_STAGE) {
            throw invalidInput(`Invalid Action kind: ${input.actionKind}`);
        }

        const properties: Record<string, string> = {
            [ATTR_STATUS]: input.status,
            [ATTR_KIND]: input.actionKind,
            ...(projectId ? { [ATTR_PARENT]: projectId } : {}),
            ...(input.start ? { [ATTR_START]: input.start } : {}),
            ...(input.due ? { [ATTR_DUE]: input.due } : {}),
        };
        const outcome = await this.creation.create(
            {
                title: input.title,
                kind: "task",
                properties,
            },
            (task, attrs) => {
                if (!projectId && task.parentId) {
                    throw invalidInput("The Action target would add a parent; an unassigned Action was requested");
                }
                return this.taskService.updateTask(task.blockId, attrs as Record<string, string>);
            },
            { sourceReferenceBlockId: sourceBlockId, expectedParentTaskId: projectId },
        );

        return { task: outcome.task, sourceBlockId, projectId };
    }
}
