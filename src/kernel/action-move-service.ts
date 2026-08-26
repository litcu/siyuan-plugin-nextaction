import {
    ATTR_PARENT,
    RPC_ERROR_ACTION_MOVE_NOT_MOVED,
    RPC_ERROR_ACTION_MOVE_RECOVERED,
    RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED,
    RPC_ERROR_ACTION_MOVE_UNDO_INVALID,
    RPC_ERROR_ACTION_MOVE_UNDO_UNSAFE,
    RPC_ERROR_CIRCULAR_REF,
} from "../shared/constants";
import type {
    ActionMoveInput,
    ActionMovePreview,
    ActionMoveResult,
    ActionMoveUndoInput,
    ActionMoveUndoResult,
} from "../shared/action-move";
import { assertBlockId } from "../shared/block-id";
import { isProjectTask } from "../shared/project-domain";
import type { CacheManager } from "./cache-manager";
import type { TaskIdentityResolver } from "./task-identity-resolver";
import type { ConfirmedTaskChanges, TaskRepository } from "./task-repository";
import type {
    ActionMoveStructurePlan,
    ActionMoveStructurePort,
    ActionMoveStructureSnapshot,
} from "./action-move-structure-port";

interface PreparedActionMove {
    plan: ActionMoveStructurePlan;
    preview: ActionMovePreview;
    attrs: Record<string, string>;
}

type ActionMoveExecution =
    | { kind: "moved"; task: ActionMoveResult["task"]; prepared: PreparedActionMove }
    | {
          kind: "failed";
          error: Error & { code: number };
      };

interface ActionMoveUndoRecord {
    prepared: PreparedActionMove;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const expected = new Set(left);
    return right.every((id) => expected.has(id));
}

function taskAttrs(attrs: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith("custom-na-")));
}

/** Moves native Action structure while keeping task state synchronized from authoritative reads. */
export class ActionMoveService {
    private readonly undoRecords = new Map<string, ActionMoveUndoRecord>();
    private readonly undoCredentialByAction = new Map<string, string>();
    private undoCredentialSequence = 0;

    constructor(
        private readonly cache: CacheManager,
        private readonly repository: TaskRepository,
        private readonly identities: TaskIdentityResolver,
        private readonly structure: ActionMoveStructurePort,
    ) {}

    async preview(input: ActionMoveInput): Promise<ActionMovePreview> {
        return (await this.prepare(input)).preview;
    }

    async move(input: ActionMoveInput): Promise<ActionMoveResult> {
        const execution = await this.repository.withConfirmedChanges<ActionMoveExecution>(async (changes) => {
            const prepared = await this.prepare(input);
            try {
                await this.structure.execute(prepared.plan);
                await this.confirmTargetStructure(prepared.plan);
                await this.confirmTaskIdentity(prepared, changes, false);
                await this.structure.commit(prepared.plan);
                await this.confirmTargetStructure(prepared.plan);
                const task = await this.confirmTaskIdentity(
                    prepared,
                    changes,
                    true,
                    prepared.preview.nextEffectiveParentId,
                );
                return { kind: "moved", task, prepared };
            } catch (cause: unknown) {
                return this.recover(prepared, changes, cause);
            }
        });
        if (execution.kind === "failed") throw execution.error;
        const undo = this.issueUndo(execution.prepared);
        return { task: execution.task, preview: execution.prepared.preview, undo };
    }

    async undo(input: ActionMoveUndoInput): Promise<ActionMoveUndoResult> {
        const record = this.consumeUndo(input.credential);
        const { prepared } = record;
        return this.repository.withConfirmedChanges<ActionMoveUndoResult>(async (changes) => {
            const current = await this.structure.inspect(prepared.plan.actionId, prepared.plan);
            if (
                !this.structure.isAtTarget(prepared.plan, current) ||
                !sameIds(prepared.plan.source.subtreeIds, current.subtreeIds)
            ) {
                throw moveError(
                    RPC_ERROR_ACTION_MOVE_UNDO_UNSAFE,
                    "The Action has moved again or changed; undo was not applied",
                    undefined,
                );
            }
            try {
                await this.structure.validateUndoSource(prepared.plan);
                await this.structure.restore(prepared.plan);
                const restored = await this.structure.inspect(prepared.plan.actionId, prepared.plan);
                if (
                    !this.structure.isAtSource(prepared.plan, restored) ||
                    !sameIds(prepared.plan.source.subtreeIds, restored.subtreeIds)
                ) {
                    throw new Error("Action undo confirmation failed");
                }
                const task = await this.confirmTaskIdentity(
                    prepared,
                    changes,
                    true,
                    prepared.preview.currentEffectiveParentId,
                );
                return {
                    task,
                    summary: `${prepared.preview.actionTitle}: ${prepared.preview.target.title} → ${prepared.preview.source.title}`,
                };
            } catch (cause: unknown) {
                if ((cause as { code?: unknown } | null)?.code === RPC_ERROR_ACTION_MOVE_UNDO_UNSAFE) throw cause;
                throw moveError(
                    RPC_ERROR_ACTION_MOVE_UNDO_UNSAFE,
                    "The original Action position is no longer safe; undo was not applied",
                    cause,
                );
            }
        });
    }

    private issueUndo(prepared: PreparedActionMove) {
        const previousCredential = this.undoCredentialByAction.get(prepared.plan.actionId);
        if (previousCredential) this.undoRecords.delete(previousCredential);
        const credential = this.createUndoCredential();
        this.undoRecords.set(credential, { prepared });
        this.undoCredentialByAction.set(prepared.plan.actionId, credential);
        return {
            credential,
            actionId: prepared.plan.actionId,
            summary: `${prepared.preview.actionTitle}: ${prepared.preview.source.title} → ${prepared.preview.target.title}`,
        };
    }

    private createUndoCredential(): string {
        this.undoCredentialSequence++;
        const randomPart = () =>
            Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
                .toString(36)
                .padStart(11, "0");
        return `${Date.now().toString(36)}-${this.undoCredentialSequence.toString(36)}-${randomPart()}-${randomPart()}`;
    }

    private consumeUndo(credential: string): ActionMoveUndoRecord {
        const record = this.undoRecords.get(credential);
        if (!record) {
            throw moveError(
                RPC_ERROR_ACTION_MOVE_UNDO_INVALID,
                "This undo is unavailable, expired, or already used",
                undefined,
            );
        }
        this.undoRecords.delete(credential);
        if (this.undoCredentialByAction.get(record.prepared.plan.actionId) === credential) {
            this.undoCredentialByAction.delete(record.prepared.plan.actionId);
        }
        return record;
    }

    private async confirmTargetStructure(plan: ActionMoveStructurePlan): Promise<ActionMoveStructureSnapshot> {
        const moved = await this.structure.inspect(plan.actionId, plan);
        if (moved.location.documentId !== plan.projectId) {
            throw new Error("Action move confirmation failed: target document mismatch");
        }
        if (!sameIds(plan.source.subtreeIds, moved.subtreeIds)) {
            throw new Error("Action move confirmation failed: content subtree changed");
        }
        return moved;
    }

    private async confirmTaskIdentity(
        prepared: PreparedActionMove,
        changes: ConfirmedTaskChanges,
        refresh: boolean,
        confirmedEffectiveParentId?: string,
    ) {
        const resolved = await this.identities.resolveTarget({
            blockId: prepared.plan.actionId,
            taskType: "1",
            mode: "existing",
            readAttrs: (blockIds) => this.repository.batchGetBlockAttrs(blockIds),
        });
        if (resolved.kind !== "reuse" || resolved.identity.identificationSource !== "native") {
            throw new Error("Action move confirmation failed: native task identity changed");
        }
        if (!sameAttrs(taskAttrs(prepared.attrs), taskAttrs(resolved.attrs))) {
            throw new Error("Action move confirmation failed: task attributes changed");
        }
        if (!refresh) return this.cache.get(prepared.plan.actionId)!;
        return changes.refreshEntry({
            blockId: prepared.plan.actionId,
            attrs: resolved.attrs,
            existing: this.cache.get(prepared.plan.actionId),
            titleOverride: resolved.identity.title,
            identity: {
                identificationSource: resolved.identity.identificationSource,
                attrHostId: resolved.identity.attrHostId,
                contentBlockId: resolved.identity.contentBlockId,
                parentId: confirmedEffectiveParentId ?? resolved.identity.effectiveParentId,
                taskType: resolved.identity.taskType,
                status: resolved.identity.defaultStatus,
            },
        });
    }

    private async recover(
        prepared: PreparedActionMove,
        changes: ConfirmedTaskChanges,
        cause: unknown,
    ): Promise<ActionMoveExecution> {
        let beforeRecovery: ActionMoveStructureSnapshot | null = null;
        try {
            beforeRecovery = await this.structure.inspect(prepared.plan.actionId, prepared.plan);
        } catch {
            // An unreadable position must be treated as potentially moved.
        }
        const wasAtSource = beforeRecovery ? this.structure.isAtSource(prepared.plan, beforeRecovery) : false;
        try {
            await this.structure.restore(prepared.plan);
            const restored = await this.structure.inspect(prepared.plan.actionId, prepared.plan);
            if (
                !this.structure.isAtSource(prepared.plan, restored) ||
                !sameIds(prepared.plan.source.subtreeIds, restored.subtreeIds)
            ) {
                throw new Error("Action move recovery confirmation failed");
            }
            if (!wasAtSource) {
                await this.confirmTaskIdentity(prepared, changes, true, prepared.preview.currentEffectiveParentId);
            }
            return {
                kind: "failed",
                error: moveError(
                    wasAtSource ? RPC_ERROR_ACTION_MOVE_NOT_MOVED : RPC_ERROR_ACTION_MOVE_RECOVERED,
                    wasAtSource ? "Action was not moved" : "Action move failed and the original position was restored",
                    cause,
                ),
            };
        } catch (recoveryCause: unknown) {
            try {
                const current = await this.structure.inspect(prepared.plan.actionId, prepared.plan);
                if (!sameIds(prepared.plan.source.subtreeIds, current.subtreeIds)) {
                    throw new Error("Action move recovery failed with a changed content subtree");
                }
                const confirmedEffectiveParentId = this.structure.isAtSource(prepared.plan, current)
                    ? prepared.preview.currentEffectiveParentId
                    : current.location.documentId === prepared.plan.projectId
                      ? prepared.preview.nextEffectiveParentId
                      : null;
                if (confirmedEffectiveParentId === null) {
                    throw new Error("Action move recovery left the Action outside its expected containers");
                }
                await this.confirmTaskIdentity(prepared, changes, true, confirmedEffectiveParentId);
            } catch {
                changes.deleteEntry(prepared.plan.actionId);
            }
            return {
                kind: "failed",
                error: moveError(
                    RPC_ERROR_ACTION_MOVE_RECOVERY_FAILED,
                    "Action move failed and automatic recovery could not be confirmed; inspect the document structure",
                    recoveryCause,
                ),
            };
        }
    }

    private async prepare(input: ActionMoveInput): Promise<PreparedActionMove> {
        const actionId = assertBlockId(input.actionId, "actionId");
        const projectId = assertBlockId(input.projectId, "projectId");
        const action = this.cache.get(actionId);
        if (!action || action.identificationSource !== "native" || action.taskType !== "1") {
            throw new Error("Only a single native Action can be moved");
        }
        const project = this.cache.get(projectId);
        if (!project || !isProjectTask(project)) throw new Error("Move target must be a valid Project document");

        const [plan, attrs] = await Promise.all([
            this.structure.prepare(actionId, projectId, input.destination),
            this.repository.getBlockAttrs(actionId),
        ]);
        const explicitParentId = attrs[ATTR_PARENT] || "";
        if (!explicitParentId) this.assertNoLogicalCycle(actionId, projectId);
        const nextEffectiveParentId = explicitParentId || projectId;
        return {
            plan,
            attrs,
            preview: {
                actionId,
                actionTitle: action.title,
                source: {
                    documentId: plan.source.location.documentId,
                    title: plan.source.location.documentTitle,
                },
                target: { projectId, title: plan.target.documentTitle || project.title },
                placements: plan.target.placements,
                destination: plan.target.destination,
                currentEffectiveParentId: action.parentId,
                nextEffectiveParentId,
                effectiveParentWillChange: action.parentId !== nextEffectiveParentId,
                explicitParentPreserved: Boolean(explicitParentId),
            },
        };
    }

    private assertNoLogicalCycle(actionId: string, projectId: string): void {
        const visited = new Set<string>();
        let currentId = projectId;
        while (currentId) {
            if (currentId === actionId) {
                throw moveError(RPC_ERROR_CIRCULAR_REF, "Moving this Action would create a parent cycle", undefined);
            }
            if (visited.has(currentId)) {
                throw moveError(RPC_ERROR_CIRCULAR_REF, "The target Project already has a parent cycle", undefined);
            }
            visited.add(currentId);
            currentId = this.cache.get(currentId)?.parentId || "";
        }
    }
}

function sameAttrs(left: Record<string, string>, right: Record<string, string>): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => right[key] === left[key]);
}

function moveError(code: number, message: string, cause: unknown): Error & { code: number } {
    const error = new Error(message) as Error & { code: number; cause?: unknown };
    error.code = code;
    error.cause = cause;
    return error;
}
