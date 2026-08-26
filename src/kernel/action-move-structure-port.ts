import { RPC_ERROR_INVALID_PARAMS } from "../shared/constants";
import { sql } from "../shared/sql";
import type { SiyuanApiPort } from "./siyuan-api";

export interface ActionMovePhysicalLocation {
    documentId: string;
    documentTitle: string;
    parentId: string;
    previousId: string;
    nextId: string;
}

export interface ActionMoveStructureSnapshot {
    location: ActionMovePhysicalLocation;
    subtreeIds: string[];
}

export interface ActionMoveStructurePlan {
    actionId: string;
    projectId: string;
    source: ActionMoveStructureSnapshot;
    target: {
        documentId: string;
        documentTitle: string;
    };
    state?: unknown;
}

export interface ActionMoveStructurePort {
    prepare(actionId: string, projectId: string): Promise<ActionMoveStructurePlan>;
    execute(plan: ActionMoveStructurePlan): Promise<void>;
    commit(plan: ActionMoveStructurePlan): Promise<void>;
    restore(plan: ActionMoveStructurePlan): Promise<void>;
    inspect(actionId: string, plan?: ActionMoveStructurePlan): Promise<ActionMoveStructureSnapshot>;
    isAtSource(plan: ActionMoveStructurePlan, snapshot: ActionMoveStructureSnapshot): boolean;
}

interface StructureRow {
    id: string;
    parent_id: string;
    type: string;
    subtype: string;
    content: string;
}

interface SiyuanActionMoveState {
    sourceSiblingIds: string[];
    sourceGuardId: string;
    targetListId: string;
    targetAnchorId: string;
}

interface BlockOperation {
    action?: string;
    id?: string;
    parentID?: string;
}

interface BlockTransaction {
    doOperations?: BlockOperation[];
}

interface ActionMoveStructureOptions {
    consistencyAttempts?: number;
    consistencyDelayMs?: number;
}

class TransientStructureMismatch extends Error {}

function invalidStructure(message: string): Error & { code: number } {
    const error = new Error(message) as Error & { code: number };
    error.code = RPC_ERROR_INVALID_PARAMS;
    return error;
}

function stateOf(plan: ActionMoveStructurePlan): SiyuanActionMoveState {
    const state = plan.state as SiyuanActionMoveState | undefined;
    if (!state) throw new Error("Action move structure plan is missing its runtime state");
    return state;
}

/** SiYuan-backed physical structure adapter for a single native Action move. */
export class SiyuanActionMoveStructurePort implements ActionMoveStructurePort {
    private readonly consistencyAttempts: number;
    private readonly consistencyDelayMs: number;

    constructor(
        private readonly api: SiyuanApiPort,
        options: ActionMoveStructureOptions = {},
    ) {
        this.consistencyAttempts = Math.max(1, options.consistencyAttempts ?? 40);
        this.consistencyDelayMs = Math.max(0, options.consistencyDelayMs ?? 50);
    }

    async prepare(actionId: string, projectId: string): Promise<ActionMoveStructurePlan> {
        const [source, ancestry, targetRows] = await Promise.all([
            this.inspect(actionId),
            this.loadAncestry(actionId),
            this.api.query<StructureRow>(sql`
                SELECT id, parent_id, type, subtype, content
                  FROM blocks
                 WHERE id = ${projectId}
                 LIMIT 1
            `),
        ]);
        const action = ancestry[0];
        const parent = ancestry.find((row) => row.id === action?.parent_id);
        if (!action || action.type !== "i" || !parent || parent.type !== "l") {
            throw invalidStructure("Only a native task list item with a list container can be moved");
        }
        if (action.subtype !== "t" && parent.subtype !== "t") {
            throw invalidStructure("The selected list item is not a native Action");
        }
        const target = targetRows[0];
        if (!target || target.id !== projectId || target.type !== "d") {
            throw invalidStructure("Move target must be an available Project document");
        }
        if (actionId === projectId || source.subtreeIds.includes(projectId)) {
            throw invalidStructure("An Action cannot be moved into itself or its descendants");
        }
        const sourceSiblings = await this.childBlocks(parent.id);
        if (!sourceSiblings.some((item) => item.id === actionId)) {
            throw invalidStructure("The Action is no longer present in its source list");
        }
        return {
            actionId,
            projectId,
            source,
            target: { documentId: projectId, documentTitle: target.content || projectId },
            state: {
                sourceSiblingIds: sourceSiblings.filter((item) => item.type === "i").map((item) => item.id),
                sourceGuardId: "",
                targetListId: "",
                targetAnchorId: "",
            } satisfies SiyuanActionMoveState,
        };
    }

    async execute(plan: ActionMoveStructurePlan): Promise<void> {
        const state = stateOf(plan);
        if (state.sourceSiblingIds.length === 1) {
            const operation = await this.insertTemporaryTask("insertBlock", {
                dataType: "markdown",
                data: "- [ ] NextAction temporary move guard",
                previousID: plan.actionId,
            });
            state.sourceGuardId = operation.id;
            if (operation.parentId !== plan.source.location.parentId) {
                throw new Error("SiYuan inserted the move guard outside the source list");
            }
        }

        const targetList = await this.insertTemporaryTask("appendBlock", {
            dataType: "markdown",
            data: "- [ ] NextAction temporary move anchor",
            parentID: plan.projectId,
        });
        state.targetListId = targetList.id;
        const targetChildren = await this.childBlocks(state.targetListId);
        const anchor = targetChildren.find((item) => item.type === "i");
        if (!anchor) throw new Error("SiYuan did not create a target task-list anchor");
        state.targetAnchorId = anchor.id;

        await this.api.request("/api/block/moveBlock", {
            id: plan.actionId,
            previousID: state.targetAnchorId,
            parentID: state.targetListId,
        });
    }

    async commit(plan: ActionMoveStructurePlan): Promise<void> {
        const state = stateOf(plan);
        await this.deleteIfPresent(state.targetAnchorId);
        state.targetAnchorId = "";
        if (state.sourceGuardId) {
            await this.deleteIfPresent(plan.source.location.parentId);
            state.sourceGuardId = "";
        }
    }

    async restore(plan: ActionMoveStructurePlan): Promise<void> {
        const state = stateOf(plan);
        const current = await this.inspect(plan.actionId, plan);
        if (!this.isAtSource(plan, current)) {
            const previousAvailable =
                plan.source.location.previousId && (await this.blockExists(plan.source.location.previousId));
            await this.api.request("/api/block/moveBlock", {
                id: plan.actionId,
                ...(previousAvailable
                    ? { previousID: plan.source.location.previousId }
                    : { parentID: plan.source.location.parentId }),
            });
        }

        const restoredBeforeCleanup = await this.inspect(plan.actionId, plan);
        if (
            restoredBeforeCleanup.location.documentId !== plan.source.location.documentId ||
            restoredBeforeCleanup.location.parentId !== plan.source.location.parentId
        ) {
            throw new Error("SiYuan did not restore the Action to its source list");
        }
        await this.deleteIfPresent(state.sourceGuardId);
        state.sourceGuardId = "";
        await this.deleteIfPresent(state.targetListId);
        state.targetListId = "";
        state.targetAnchorId = "";

        const restored = await this.inspect(plan.actionId, plan);
        if (!this.isAtSource(plan, restored)) throw new Error("Source position confirmation failed after cleanup");
    }

    async inspect(actionId: string, plan?: ActionMoveStructurePlan): Promise<ActionMoveStructureSnapshot> {
        let mismatch: TransientStructureMismatch | null = null;
        for (let attempt = 0; attempt < this.consistencyAttempts; attempt++) {
            try {
                return await this.inspectConsistent(actionId, plan);
            } catch (error: unknown) {
                if (!(error instanceof TransientStructureMismatch)) throw error;
                mismatch = error;
                if (attempt + 1 < this.consistencyAttempts) await this.waitForConsistency();
            }
        }
        throw invalidStructure(mismatch?.message || "Action structure did not become consistent in time");
    }

    private async inspectConsistent(
        actionId: string,
        plan?: ActionMoveStructurePlan,
    ): Promise<ActionMoveStructureSnapshot> {
        if (plan) return this.inspectPlanned(actionId, plan);
        const ancestry = await this.loadAncestry(actionId);
        const action = ancestry[0];
        if (!action) throw invalidStructure("Action block is unavailable");
        const document = ancestry.find((row) => row.type === "d");
        if (!document) throw invalidStructure("Action is not contained by a document");
        const siblings = action.parent_id ? await this.childBlocks(action.parent_id) : [];
        const index = siblings.findIndex((item) => item.id === actionId);
        if (index < 0) {
            throw new TransientStructureMismatch("Action structure did not become consistent after its parent changed");
        }
        return {
            location: {
                documentId: document.id,
                documentTitle: document.content || document.id,
                parentId: action.parent_id,
                previousId: siblings[index - 1]?.id || "",
                nextId: siblings[index + 1]?.id || "",
            },
            subtreeIds: await this.loadSubtreeIds(actionId),
        };
    }

    private async inspectPlanned(
        actionId: string,
        plan: ActionMoveStructurePlan,
    ): Promise<ActionMoveStructureSnapshot> {
        const state = stateOf(plan);
        const candidates = [
            ...(state.targetListId
                ? [
                      {
                          parentId: state.targetListId,
                          documentId: plan.target.documentId,
                          documentTitle: plan.target.documentTitle,
                      },
                  ]
                : []),
            {
                parentId: plan.source.location.parentId,
                documentId: plan.source.location.documentId,
                documentTitle: plan.source.location.documentTitle,
            },
        ];
        for (const candidate of candidates) {
            if (!(await this.blockExists(candidate.parentId))) continue;
            const siblings = await this.childBlocks(candidate.parentId);
            const index = siblings.findIndex((item) => item.id === actionId);
            if (index < 0) continue;
            return {
                location: {
                    documentId: candidate.documentId,
                    documentTitle: candidate.documentTitle,
                    parentId: candidate.parentId,
                    previousId: siblings[index - 1]?.id || "",
                    nextId: siblings[index + 1]?.id || "",
                },
                subtreeIds: await this.loadSubtreeIds(actionId),
            };
        }
        throw new TransientStructureMismatch("Action is not visible in its expected source or target container");
    }

    private async loadSubtreeIds(actionId: string): Promise<string[]> {
        const subtree = await this.api.query<{ id: string }>(sql`
            WITH RECURSIVE selected(id) AS (
                SELECT id FROM blocks WHERE id = ${actionId}
                UNION ALL
                SELECT child.id FROM blocks child INNER JOIN selected parent ON child.parent_id = parent.id
            )
            SELECT id FROM selected
        `);
        return subtree.map((row) => row.id);
    }

    private waitForConsistency(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, this.consistencyDelayMs));
    }

    isAtSource(plan: ActionMoveStructurePlan, snapshot: ActionMoveStructureSnapshot): boolean {
        const state = stateOf(plan);
        const nextMatches =
            snapshot.location.nextId === plan.source.location.nextId ||
            Boolean(state.sourceGuardId && snapshot.location.nextId === state.sourceGuardId);
        return (
            snapshot.location.documentId === plan.source.location.documentId &&
            snapshot.location.parentId === plan.source.location.parentId &&
            snapshot.location.previousId === plan.source.location.previousId &&
            nextMatches
        );
    }

    private loadAncestry(actionId: string): Promise<StructureRow[]> {
        return this.api.query<StructureRow>(sql`
            WITH RECURSIVE ancestors(id, parent_id, type, subtype, content) AS (
                SELECT id, parent_id, type, subtype, content FROM blocks WHERE id = ${actionId}
                UNION ALL
                SELECT parent.id, parent.parent_id, parent.type, parent.subtype, parent.content
                  FROM blocks parent
                  INNER JOIN ancestors child ON parent.id = child.parent_id
            )
            SELECT id, parent_id, type, subtype, content FROM ancestors
        `);
    }

    private childBlocks(parentId: string): Promise<Array<{ id: string; type: string; subtype?: string }>> {
        return this.api.request("/api/block/getChildBlocks", { id: parentId });
    }

    private async insertTemporaryTask(
        endpoint: "insertBlock" | "appendBlock",
        body: object,
    ): Promise<{ id: string; parentId: string }> {
        const transactions = await this.api.request<BlockTransaction[]>(`/api/block/${endpoint}`, body);
        const operation = transactions
            ?.flatMap((transaction) => transaction.doOperations || [])
            .find((item) => item.action === "insert" && item.id && item.parentID);
        if (!operation?.id || !operation.parentID) {
            throw new Error(`SiYuan did not return the temporary ${endpoint} block identity`);
        }
        return { id: operation.id, parentId: operation.parentID };
    }

    private blockExists(blockId: string): Promise<boolean> {
        return this.api.request("/api/block/checkBlockExist", { id: blockId });
    }

    private async deleteIfPresent(blockId: string): Promise<void> {
        if (!blockId || !(await this.blockExists(blockId))) return;
        await this.api.request("/api/block/deleteBlock", { id: blockId });
    }
}
