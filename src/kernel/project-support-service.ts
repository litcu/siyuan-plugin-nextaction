import { RPC_ERROR_INVALID_PARAMS } from "../shared/constants";
import { assertBlockId } from "../shared/block-id";
import { sql } from "../shared/sql";
import type { ProjectSupportData, ProjectSupportDirection, ProjectSupportItem, TaskCacheEntry } from "../shared/types";
import type { SiyuanApiPort } from "./siyuan-api";

export interface ProjectSupportQueryCandidate {
    blockId: string;
    documentId: string;
    title: string;
    blockType: string;
}

export interface ProjectSupportQueryPort {
    projectDocumentExists(projectId: string): Promise<boolean>;
    listForwardReferences(projectId: string): Promise<ProjectSupportQueryCandidate[]>;
    listDirectBacklinks(projectId: string): Promise<ProjectSupportQueryCandidate[]>;
}

interface ProjectSupportQueryRow {
    block_id: string;
    document_id: string;
    title: string;
    block_type: string;
}

function toCandidate(row: ProjectSupportQueryRow): ProjectSupportQueryCandidate {
    return {
        blockId: row.block_id,
        documentId: row.document_id,
        title: row.title,
        blockType: row.block_type,
    };
}

export class SiyuanProjectSupportQueryPort implements ProjectSupportQueryPort {
    constructor(private readonly api: Pick<SiyuanApiPort, "query">) {}

    async projectDocumentExists(projectId: string): Promise<boolean> {
        const rows = await this.api.query<{ id: string }>(sql`
            SELECT id
              FROM blocks
             WHERE id = ${projectId}
               AND type = 'd'
             LIMIT 1
        `);
        return rows[0]?.id === projectId;
    }

    async listForwardReferences(projectId: string): Promise<ProjectSupportQueryCandidate[]> {
        const rows = await this.api.query<ProjectSupportQueryRow>(sql`
            SELECT target.id AS block_id,
                   target.root_id AS document_id,
                   COALESCE(
                       NULLIF(TRIM(target.content), ''),
                       NULLIF(TRIM(target.name), ''),
                       NULLIF(TRIM(target.hpath), ''),
                       target.id
                   ) AS title,
                   target.type AS block_type
              FROM refs AS reference
              JOIN blocks AS source ON source.id = reference.block_id
              JOIN blocks AS target ON target.id = reference.def_block_id
             WHERE reference.root_id = ${projectId}
               AND reference.def_block_id <> ${projectId}
               AND reference.type <> 'query_embed'
             GROUP BY target.id, target.root_id, target.content, target.name, target.hpath, target.type
             ORDER BY MIN(reference.rowid) ASC, target.id ASC
        `);
        return rows.map(toCandidate);
    }

    async listDirectBacklinks(projectId: string): Promise<ProjectSupportQueryCandidate[]> {
        const rows = await this.api.query<ProjectSupportQueryRow>(sql`
            SELECT source.id AS block_id,
                   source.root_id AS document_id,
                   COALESCE(
                       NULLIF(TRIM(source.content), ''),
                       NULLIF(TRIM(source.name), ''),
                       NULLIF(TRIM(source.hpath), ''),
                       source.id
                   ) AS title,
                   source.type AS block_type
              FROM refs AS reference
              JOIN blocks AS source ON source.id = reference.block_id
             WHERE reference.def_block_id = ${projectId}
               AND reference.root_id <> ${projectId}
               AND reference.type <> 'query_embed'
             GROUP BY source.id, source.root_id, source.content, source.name, source.hpath, source.type,
                      source.updated, source.sort
             ORDER BY source.updated DESC, source.root_id ASC, source.sort ASC, source.id ASC
        `);
        return rows.map(toCandidate);
    }
}

function invalidProjectTarget(): Error {
    const error = new Error("projectId must identify a valid Project document") as Error & { code: number };
    error.code = RPC_ERROR_INVALID_PARAMS;
    return error;
}

export class ProjectSupportService {
    constructor(private readonly port: ProjectSupportQueryPort) {}

    async load(project: TaskCacheEntry | null): Promise<ProjectSupportData> {
        if (!project || project.taskType !== "2" || project.identificationSource !== "document") {
            throw invalidProjectTarget();
        }

        const projectId = assertBlockId(project.blockId, "projectId");
        if (!(await this.port.projectDocumentExists(projectId))) throw invalidProjectTarget();
        const [forward, backlinks] = await Promise.all([
            this.port.listForwardReferences(projectId),
            this.port.listDirectBacklinks(projectId),
        ]);
        const items = new Map<string, ProjectSupportItem>();
        this.merge(items, forward, "forward", projectId);
        this.merge(items, backlinks, "backlink", projectId);
        return { projectId, items: [...items.values()] };
    }

    private merge(
        items: Map<string, ProjectSupportItem>,
        candidates: ProjectSupportQueryCandidate[],
        direction: ProjectSupportDirection,
        projectId: string,
    ): void {
        for (const candidate of candidates) {
            if (
                !candidate.blockId ||
                !candidate.documentId ||
                candidate.blockId === projectId ||
                candidate.documentId === projectId
            ) {
                continue;
            }
            const existing = items.get(candidate.blockId);
            if (existing) {
                if (!existing.directions.includes(direction)) existing.directions.push(direction);
                continue;
            }
            items.set(candidate.blockId, {
                blockId: candidate.blockId,
                documentId: candidate.documentId,
                title: candidate.title,
                kind: candidate.blockType === "d" ? "document" : "block",
                blockType: candidate.blockType,
                directions: [direction],
            });
        }
    }
}
