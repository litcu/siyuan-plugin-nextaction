import {
    ATTR_PARENT,
    ATTR_STATUS,
    ATTR_TASK,
    RPC_ERROR_NOT_TEXT_BLOCK,
    RPC_ERROR_PROJECT_REQUIRES_DOCUMENT,
    RPC_ERROR_TASK_NOT_FOUND,
} from "../shared/constants";
import { sql } from "../shared/sql";
import {
    isNativeTaskStructure,
    nativeTaskDefaultStatus,
    resolveEffectiveTaskParent,
    type TaskHostIdentity,
} from "../shared/task-identity";
import type { SiyuanApiPort } from "./siyuan-api";
import { cleanSlashFromTitle } from "./utils";

export type BatchTaskAttributeReader = (blockIds: string[]) => Promise<Record<string, Record<string, string>>>;

interface DiscoveredTaskRow {
    id: string;
    parent_id: string;
    content_block_id: string;
    title_content: string;
    markdown: string;
    structural_parent_id: string;
    source: "document" | "native";
    sort: number;
    updated: string;
}

interface BlockIdentityRow {
    id: string;
    parent_id: string;
    type: string;
    subtype: string;
    content: string;
    markdown: string;
    sort: number;
    updated: string;
    depth: number;
    parent_type: string;
    parent_subtype: string;
    content_block_id: string;
    content_title: string;
}

export interface TaskIdentityRecord {
    identity: TaskHostIdentity;
    attrs: Record<string, string>;
}

export interface TaskIdentityLoad {
    records: TaskIdentityRecord[];
}

export type ResolveTaskEvidence =
    | {
          kind: "inserted-native";
          blockId: string;
          contentBlockId?: string;
          parentId?: string;
          title?: string;
      }
    | { kind: "verified-document"; blockId: string; title?: string };

export interface ResolveTaskTargetInput {
    blockId: string;
    taskType: "1" | "2";
    mode: "conversion" | "existing";
    parentIdHint?: string;
    evidence?: ResolveTaskEvidence;
    readAttrs: BatchTaskAttributeReader;
}

export type ResolvedTaskTarget =
    | { kind: "reuse"; identity: TaskHostIdentity; attrs: Record<string, string> }
    | { kind: "use-document"; identity: TaskHostIdentity; attrs: Record<string, string> }
    | {
          kind: "convert-text";
          blockId: string;
          blockType: "p" | "h";
          title: string;
          structuralParentId: string;
      };

function codedError(message: string, code: number): Error & { code: number } {
    const error = new Error(message) as Error & { code: number };
    error.code = code;
    return error;
}

export class TaskIdentityResolver {
    constructor(private readonly api: SiyuanApiPort) {}

    async loadAll(readAttrs: BatchTaskAttributeReader): Promise<TaskIdentityLoad> {
        const rows: DiscoveredTaskRow[] = [];
        let lastBlockId = "";
        for (;;) {
            const stmt = sql`WITH RECURSIVE native_tasks(id) AS (
                    SELECT task.id
                      FROM blocks task
                      LEFT JOIN blocks task_list
                        ON task_list.id = task.parent_id
                       AND task_list.type = 'l'
                     WHERE task.type = 'i'
                       AND (
                            task.subtype = 't'
                            OR task_list.subtype = 't'
                       )
                ), ancestor_walk(task_id, ancestor_id, parent_id, type, subtype, depth, path) AS (
                    SELECT task.id,
                           parent.id,
                           parent.parent_id,
                           parent.type,
                           parent.subtype,
                           1,
                           ',' || task.id || ',' || parent.id || ','
                      FROM native_tasks task
                      INNER JOIN blocks child ON child.id = task.id
                      INNER JOIN blocks parent ON parent.id = child.parent_id
                    UNION ALL
                    SELECT walk.task_id,
                           parent.id,
                           parent.parent_id,
                           parent.type,
                           parent.subtype,
                           walk.depth + 1,
                           walk.path || parent.id || ','
                      FROM ancestor_walk walk
                      INNER JOIN blocks parent ON parent.id = walk.parent_id
                     WHERE walk.type != 'd'
                       AND INSTR(walk.path, ',' || parent.id || ',') = 0
                ), task_ancestors(task_id, ancestor_id, depth) AS (
                    SELECT walk.task_id, walk.ancestor_id, walk.depth
                      FROM ancestor_walk walk
                     WHERE (
                            walk.type = 'i'
                            AND (
                                walk.subtype = 't'
                                OR EXISTS (
                                    SELECT 1 FROM blocks ancestor_list
                                     WHERE ancestor_list.id = walk.parent_id
                                       AND ancestor_list.type = 'l'
                                       AND ancestor_list.subtype = 't'
                                )
                           )
                        OR (
                            walk.type = 'd'
                            AND EXISTS (
                                SELECT 1 FROM attributes document_task
                                 WHERE document_task.block_id = walk.ancestor_id
                                   AND document_task.name = ${ATTR_TASK}
                                   AND document_task.value IS NOT NULL
                                   AND document_task.value != ''
                            )
                       )
                     )
                ), structural_parents(task_id, ancestor_id) AS (
                    SELECT candidate.task_id, candidate.ancestor_id
                      FROM task_ancestors candidate
                     WHERE candidate.depth = (
                            SELECT MIN(nearest.depth)
                              FROM task_ancestors nearest
                             WHERE nearest.task_id = candidate.task_id
                       )
                ) SELECT * FROM (
                    SELECT b.id,
                           b.parent_id,
                           '' AS content_block_id,
                           b.content AS title_content,
                           b.markdown,
                           '' AS structural_parent_id,
                           'document' AS source,
                           b.sort,
                           b.updated
                      FROM blocks b
                      INNER JOIN attributes a
                        ON a.block_id = b.id
                       AND a.name = ${ATTR_TASK}
                     WHERE a.value IS NOT NULL
                       AND a.value != ''
                       AND b.type = 'd'
                    UNION ALL
                    SELECT task.id,
                           task.parent_id,
                           COALESCE((SELECT child.id FROM blocks child
                                      WHERE child.parent_id = task.id
                                        AND child.type IN ('p', 'h')
                                      ORDER BY child.sort LIMIT 1), '') AS content_block_id,
                           COALESCE((SELECT child.content FROM blocks child
                                      WHERE child.parent_id = task.id
                                        AND child.type IN ('p', 'h')
                                      ORDER BY child.sort LIMIT 1), task.content) AS title_content,
                           task.markdown,
                           COALESCE(structural_parent.ancestor_id, '') AS structural_parent_id,
                           'native' AS source,
                           task.sort,
                           task.updated
                      FROM native_tasks discovered_task
                      INNER JOIN blocks task ON task.id = discovered_task.id
                      LEFT JOIN structural_parents structural_parent
                        ON structural_parent.task_id = task.id
                ) task
                WHERE (${lastBlockId} = '' OR task.id > ${lastBlockId})
                ORDER BY task.id`;
            const page = await this.api.query<DiscoveredTaskRow>(stmt);
            if (!page?.length) break;
            rows.push(...page);
            const nextBlockId = page[page.length - 1].id;
            if (!nextBlockId || nextBlockId <= lastBlockId) {
                throw new Error("Task cache discovery cursor did not advance");
            }
            lastBlockId = nextBlockId;
        }

        if (!rows.length) return { records: [] };
        const attrsById = await readAttrs(rows.map((row) => row.id));
        const records: TaskIdentityRecord[] = [];
        for (const row of rows) {
            const attrs = attrsById[row.id] || {};
            if (row.source === "document" && !attrs[ATTR_TASK]) continue;
            records.push({
                attrs,
                identity: this.buildIdentity(row, attrs),
            });
        }
        return { records };
    }

    async resolveTarget(input: ResolveTaskTargetInput): Promise<ResolvedTaskTarget> {
        if (input.evidence?.kind === "inserted-native") {
            if (input.taskType === "2") {
                throw codedError("errProjectRequiresDocument", RPC_ERROR_PROJECT_REQUIRES_DOCUMENT);
            }
            const structuralParentId = await this.resolveStructuralParent(
                input.parentIdHint || input.evidence.parentId || "",
                input.evidence.blockId,
                true,
                input.readAttrs,
            );
            const attrs: Record<string, string> = {};
            const contentBlockId =
                input.evidence.contentBlockId || (await this.findDirectTextChildId(input.evidence.blockId));
            return {
                kind: "reuse",
                attrs,
                identity: {
                    blockId: input.evidence.blockId,
                    identificationSource: "native",
                    attrHostId: input.evidence.blockId,
                    contentBlockId: contentBlockId || undefined,
                    structuralParentId,
                    effectiveParentId: resolveEffectiveTaskParent(attrs[ATTR_PARENT], structuralParentId),
                    taskType: "1",
                    defaultStatus: "inbox",
                    title: input.evidence.title || "",
                    sort: -1,
                    updated: "",
                },
            };
        }

        if (input.evidence?.kind === "verified-document") {
            const attrs: Record<string, string> = {};
            return {
                kind: "use-document",
                attrs,
                identity: {
                    blockId: input.evidence.blockId,
                    identificationSource: "document",
                    attrHostId: input.evidence.blockId,
                    structuralParentId: "",
                    effectiveParentId: attrs[ATTR_PARENT] || "",
                    taskType: input.taskType,
                    defaultStatus: "inbox",
                    title: input.evidence.title || "",
                    sort: -1,
                    updated: "",
                },
            };
        }

        const rows = await this.loadBlockAncestry(input.blockId);
        if (!rows.length) throw codedError("Task not found: " + input.blockId, RPC_ERROR_TASK_NOT_FOUND);
        const attrsById = await input.readAttrs(rows.map((row) => row.id));
        const first = rows.find((row) => row.id === input.blockId) || rows[0];
        const nativeHost = this.nativeHostFor(first, rows);

        if (input.taskType === "2" && first.type !== "d") {
            throw codedError("errProjectRequiresDocument", RPC_ERROR_PROJECT_REQUIRES_DOCUMENT);
        }

        if (nativeHost) {
            const attrs = attrsById[nativeHost.id] || {};
            const structuralParentId = this.findStructuralParent(nativeHost.id, rows, attrsById);
            return {
                kind: "reuse",
                attrs,
                identity: this.identityFromBlock(nativeHost, attrs, structuralParentId, "native", "1"),
            };
        }

        if (first.type === "d") {
            const attrs = attrsById[first.id] || {};
            if (input.mode === "existing" && !attrs[ATTR_TASK]) {
                throw codedError("Task not found: " + input.blockId, RPC_ERROR_TASK_NOT_FOUND);
            }
            const taskType = input.mode === "existing" ? (attrs[ATTR_TASK] === "2" ? "2" : "1") : input.taskType;
            return {
                kind: "use-document",
                attrs,
                identity: this.identityFromBlock(first, attrs, "", "document", taskType),
            };
        }

        if ((first.type === "p" || first.type === "h") && input.mode === "conversion") {
            return {
                kind: "convert-text",
                blockId: first.id,
                blockType: first.type,
                title: first.content || "",
                structuralParentId: this.findStructuralParent(first.id, rows, attrsById),
            };
        }

        throw codedError("errNotTextBlock", RPC_ERROR_NOT_TEXT_BLOCK);
    }

    private buildIdentity(row: DiscoveredTaskRow, attrs: Record<string, string>): TaskHostIdentity {
        const structuralParentId = row.source === "native" ? row.structural_parent_id || "" : "";
        return {
            blockId: row.id,
            identificationSource: row.source,
            attrHostId: row.id,
            contentBlockId: row.source === "native" ? row.content_block_id || undefined : undefined,
            structuralParentId,
            effectiveParentId: resolveEffectiveTaskParent(attrs[ATTR_PARENT], structuralParentId),
            taskType: row.source === "native" ? "1" : attrs[ATTR_TASK] === "2" ? "2" : "1",
            defaultStatus:
                attrs[ATTR_STATUS] || (row.source === "native" ? nativeTaskDefaultStatus(row.markdown || "") : "todo"),
            title: row.title_content ? cleanSlashFromTitle(row.title_content.substring(0, 100)) : "",
            sort: Number(row.sort ?? -1),
            updated: row.updated || "",
        };
    }

    private identityFromBlock(
        row: BlockIdentityRow,
        attrs: Record<string, string>,
        structuralParentId: string,
        source: "document" | "native",
        taskType: "1" | "2",
    ): TaskHostIdentity {
        const title = source === "native" ? row.content_title || row.content : row.content;
        return {
            blockId: row.id,
            identificationSource: source,
            attrHostId: row.id,
            contentBlockId: source === "native" ? row.content_block_id || undefined : undefined,
            structuralParentId,
            effectiveParentId: resolveEffectiveTaskParent(attrs[ATTR_PARENT], structuralParentId),
            taskType,
            defaultStatus: attrs[ATTR_STATUS] || (source === "native" ? nativeTaskDefaultStatus(row.markdown) : "todo"),
            title: title ? cleanSlashFromTitle(title.substring(0, 100)) : "",
            sort: Number(row.sort ?? -1),
            updated: row.updated || "",
        };
    }

    private nativeHostFor(first: BlockIdentityRow, rows: BlockIdentityRow[]): BlockIdentityRow | undefined {
        if (this.isNativeRow(first)) return first;
        if (first.type !== "p" && first.type !== "h") return undefined;
        const parent = rows.find((row) => row.id === first.parent_id);
        return parent && this.isNativeRow(parent) ? parent : undefined;
    }

    private findStructuralParent(
        childId: string,
        rows: BlockIdentityRow[],
        attrsById: Record<string, Record<string, string>>,
    ): string {
        const byId = new Map(rows.map((row) => [row.id, row]));
        let currentId = byId.get(childId)?.parent_id || "";
        const visited = new Set<string>([childId]);
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const row = byId.get(currentId);
            if (!row) break;
            if (this.isNativeRow(row)) return row.id;
            if (row.type === "d") return attrsById[row.id]?.[ATTR_TASK] ? row.id : "";
            currentId = row.parent_id;
        }
        return "";
    }

    private async resolveStructuralParent(
        startId: string,
        childId: string,
        includeStart: boolean,
        readAttrs: BatchTaskAttributeReader,
    ): Promise<string> {
        if (!startId || startId === childId) return "";
        const rows = await this.loadBlockAncestry(startId);
        if (!rows.length) return "";
        const attrsById = await readAttrs(rows.map((row) => row.id));
        if (includeStart) {
            const first = rows.find((row) => row.id === startId) || rows[0];
            if (this.isNativeRow(first)) return first.id;
            if (first.type === "d" && attrsById[first.id]?.[ATTR_TASK]) return first.id;
        }
        return this.findStructuralParent(startId, rows, attrsById);
    }

    private isNativeRow(row: BlockIdentityRow): boolean {
        return isNativeTaskStructure({
            type: row.type,
            subtype: row.subtype,
            parentType: row.parent_type,
            parentSubtype: row.parent_subtype,
        });
    }

    private loadBlockAncestry(blockId: string): Promise<BlockIdentityRow[]> {
        return this.api.query<BlockIdentityRow>(sql`WITH RECURSIVE ancestry(
                id, parent_id, type, subtype, content, markdown, sort, updated, depth, path
            ) AS (
                SELECT id, parent_id, type, subtype, content, markdown, sort, updated, 0, ',' || id || ','
                  FROM blocks WHERE id = ${blockId}
                UNION ALL
                SELECT parent.id, parent.parent_id, parent.type, parent.subtype,
                       parent.content, parent.markdown, parent.sort, parent.updated,
                       child.depth + 1, child.path || parent.id || ','
                  FROM blocks parent
                  INNER JOIN ancestry child ON parent.id = child.parent_id
                 WHERE child.type != 'd'
                   AND INSTR(child.path, ',' || parent.id || ',') = 0
            ) SELECT ancestry.*,
                     COALESCE(parent.type, '') AS parent_type,
                     COALESCE(parent.subtype, '') AS parent_subtype,
                     COALESCE((SELECT text.id FROM blocks text
                                WHERE text.parent_id = ancestry.id
                                  AND text.type IN ('p', 'h')
                                ORDER BY text.sort LIMIT 1), '') AS content_block_id,
                     COALESCE((SELECT text.content FROM blocks text
                                WHERE text.parent_id = ancestry.id
                                  AND text.type IN ('p', 'h')
                                ORDER BY text.sort LIMIT 1), '') AS content_title
                FROM ancestry
                LEFT JOIN blocks parent ON parent.id = ancestry.parent_id
               ORDER BY ancestry.depth`);
    }

    private async findDirectTextChildId(listItemId: string): Promise<string> {
        const children = await this.api.request<Array<{ id?: string; type?: string }>>("/api/block/getChildBlocks", {
            id: listItemId,
        });
        const child = Array.isArray(children)
            ? children.find((item) => item?.id && (item.type === "p" || item.type === "h"))
            : undefined;
        return child?.id || "";
    }
}
