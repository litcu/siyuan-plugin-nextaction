import type {
    AiProposal,
    AiProposalApplyItemResult,
    AiProposalApplyResult,
    AiProposalContext,
    AiProposedTask,
    AiWriteTarget,
} from "../shared/ai";
import { validateAiProposal } from "../shared/ai";
import { ATTR_DEPENDS } from "../shared/constants";
import type { TaskCacheEntry } from "../shared/types";
import type { TaskService } from "./task-service";
import type { CreateTaskDestination, CreateTaskInput } from "../shared/task-creation";
import type { ActionSourcePort } from "./action-extraction-service";
import type { TaskCreationOptions } from "./task-creation-service";
import { getErrorMessage, McpToolError } from "./mcp-tool-error";

type CreateTaskHandler = (
    input: CreateTaskInput,
    options?: TaskCreationOptions,
) => Promise<{ task: any; warnings?: string[] }>;
type ConvertTaskHandler = (input: Record<string, any>) => Promise<{ task: any; warnings?: string[] }>;

function isRetryableApplyError(error: unknown): boolean {
    return !(error instanceof McpToolError && error.mcpCode === "PARTIAL_SUCCESS");
}

function applyErrorStatus(error: unknown): "failed" | "partial" {
    return error instanceof McpToolError && error.mcpCode === "PARTIAL_SUCCESS" ? "partial" : "failed";
}

export class AiProposalService {
    private readonly taskService: TaskService;
    private readonly createTask: CreateTaskHandler;
    private readonly convertTask: ConvertTaskHandler;
    private readonly sources: ActionSourcePort;

    constructor(
        taskService: TaskService,
        createTask: CreateTaskHandler,
        convertTask: ConvertTaskHandler,
        sources: ActionSourcePort,
    ) {
        this.taskService = taskService;
        this.createTask = createTask;
        this.convertTask = convertTask;
        this.sources = sources;
    }

    validate(input: unknown, context: AiProposalContext = {}) {
        return validateAiProposal(input, context);
    }

    async apply(input: unknown, context: AiProposalContext = {}): Promise<AiProposalApplyResult> {
        const preview = validateAiProposal(input);
        if (
            preview.proposal.feature === "extractTasks" &&
            (preview.proposal.tasks?.length || 0) > 0 &&
            !context.sourceBlockIds?.length
        ) {
            throw new Error("sourceBlockIds are required for extractTasks input context");
        }
        const validation = validateAiProposal(input, context);
        if (validation.errors.length) throw new Error(validation.errors.join("; "));
        const proposal = validation.proposal;
        if (proposal.feature === "review") throw new Error("Review proposals are read-only");

        if (proposal.feature === "extractTasks") {
            const sourceBlockIds = [...new Set((proposal.tasks || []).map((task) => task.sourceBlockId!))];
            for (const sourceBlockId of sourceBlockIds) {
                if (!(await this.sources.exists(sourceBlockId))) {
                    throw new Error(`Source block not found: ${sourceBlockId}`);
                }
            }
        }

        if (proposal.feature === "planMyDay") {
            const current = await this.taskService.getMyDay();
            const existing = new Set(current.tasks.map((item) => item.blockId));
            let next = current;
            const warnings: string[] = [];
            for (const suggestion of proposal.myDay || []) {
                if (existing.has(suggestion.blockId)) continue;
                if (!this.taskService.getTask(suggestion.blockId)) {
                    warnings.push(`Task not found: ${suggestion.blockId}`);
                    continue;
                }
                next = await this.taskService.addTaskToMyDay(suggestion.blockId);
                existing.add(suggestion.blockId);
            }
            return { feature: proposal.feature, created: [], converted: [], myDay: next, warnings, items: [] };
        }

        const created: TaskCacheEntry[] = [];
        const converted: TaskCacheEntry[] = [];
        const warnings = [...(proposal.warnings || [])];
        const items: AiProposalApplyItemResult[] = [];
        const createdIds: Array<string | undefined> = new Array(proposal.tasks?.length || 0);
        const pendingIndexes = new Set((proposal.tasks || []).map((_task, index) => index));
        const orderedIndexes: number[] = [];
        while (pendingIndexes.size > 0) {
            const readyIndexes = [...pendingIndexes].filter((index) =>
                (proposal.tasks?.[index].dependsOnIndexes || []).every((dependencyIndex) =>
                    orderedIndexes.includes(dependencyIndex),
                ),
            );
            if (readyIndexes.length === 0) {
                // Validation rejects cycles; retain deterministic behavior if an invalid proposal reaches this layer.
                orderedIndexes.push(...pendingIndexes);
                break;
            }
            for (const index of readyIndexes) {
                orderedIndexes.push(index);
                pendingIndexes.delete(index);
            }
        }
        for (const index of orderedIndexes) {
            const item = proposal.tasks![index];
            const missingDependencies = (item.dependsOnIndexes || []).filter(
                (dependencyIndex) => !createdIds[dependencyIndex],
            );
            if (missingDependencies.length > 0) {
                const dependencyIndexes = item.dependsOnIndexes || [];
                items[index] = {
                    index,
                    sourceBlockId: item.sourceBlockId,
                    target: proposal.target?.type || "mcp_default",
                    status: "failed",
                    error: "A dependency suggestion was not applied",
                    retryable:
                        missingDependencies.length === dependencyIndexes.length &&
                        missingDependencies.every((dependencyIndex) => items[dependencyIndex]?.retryable === true),
                };
                continue;
            }
            const fields = this.toFields(item);
            const properties = item.status === undefined ? fields : { status: item.status, ...fields };
            const target = proposal.target || ({ type: "mcp_default" } as AiWriteTarget);
            try {
                if (target.type === "original" && item.sourceBlockId) {
                    const result = await this.convertTask({
                        blockId: item.sourceBlockId,
                        cleanTitle: item.title,
                        kind: item.kind === "project" ? "project" : "task",
                        properties,
                    });
                    converted.push(result.task);
                    createdIds[index] = result.task.blockId;
                    warnings.push(...(result.warnings || []));
                    items[index] = {
                        index,
                        sourceBlockId: item.sourceBlockId,
                        target: target.type,
                        status: "converted",
                        task: result.task,
                        retryable: false,
                    };
                    continue;
                }

                const destination: CreateTaskDestination | undefined =
                    target.type === "document" ||
                    target.type === "current_document" ||
                    target.type === "source_document"
                        ? { type: "document", documentId: target.documentId }
                        : target.type === "child"
                          ? { type: "block", parentBlockId: target.parentBlockId }
                          : target.type === "source_child"
                            ? { type: "block", parentBlockId: item.sourceBlockId }
                            : undefined;
                const result = await this.createTask(
                    {
                        title: item.title,
                        kind: item.kind === "project" ? "project" : "task",
                        destination,
                        properties,
                    },
                    proposal.feature === "extractTasks"
                        ? {
                              sourceReferenceBlockId: item.sourceBlockId,
                              expectedParentTaskId: item.parentId || "",
                          }
                        : undefined,
                );
                created.push(result.task);
                createdIds[index] = result.task.blockId;
                warnings.push(...(result.warnings || []));
                items[index] = {
                    index,
                    sourceBlockId: item.sourceBlockId,
                    target: target.type,
                    status: "created",
                    task: result.task,
                    retryable: false,
                };
            } catch (error: unknown) {
                const message = getErrorMessage(error);
                items[index] = {
                    index,
                    sourceBlockId: item.sourceBlockId,
                    target: target.type,
                    status: applyErrorStatus(error),
                    error: message,
                    retryable: !item.dependsOnIndexes?.length && isRetryableApplyError(error),
                };
            }
        }

        // Dependency indexes refer to proposal-local task positions. Apply them after all IDs exist.
        for (let index = 0; index < (proposal.tasks || []).length; index++) {
            const item = proposal.tasks![index];
            if (!item.dependsOnIndexes?.length) continue;
            const targetId = createdIds[index];
            const dependencyIds = item.dependsOnIndexes.map((dep) => createdIds[dep]).filter(Boolean);
            if (!targetId) continue;
            try {
                if (dependencyIds.length !== item.dependsOnIndexes.length) {
                    throw new Error("A dependency suggestion was not applied");
                }
                const updated = await this.taskService.updateTask(targetId, {
                    [ATTR_DEPENDS]: dependencyIds.join("|"),
                });
                const position = created.findIndex((task) => task.blockId === targetId);
                if (position >= 0) created[position] = updated;
                const convertedPosition = converted.findIndex((task) => task.blockId === targetId);
                if (convertedPosition >= 0) converted[convertedPosition] = updated;
                items[index] = { ...items[index], task: updated };
            } catch (error: unknown) {
                const message = getErrorMessage(error);
                items[index] = {
                    ...items[index],
                    status: "partial",
                    error: message,
                    retryable: false,
                };
            }
        }

        return { feature: proposal.feature, created, converted, myDay: null, warnings, items };
    }

    private toFields(item: AiProposedTask): Record<string, any> {
        const fields: Record<string, any> = {};
        for (const key of [
            "priority",
            "importance",
            "effort",
            "start",
            "due",
            "contexts",
            "tags",
            "note",
            "outcome",
            "dod",
            "actionKind",
        ] as const) {
            if (item[key] !== undefined) fields[key] = item[key];
        }
        if (item.parentId !== undefined) fields.parentId = item.parentId;
        return fields;
    }
}
