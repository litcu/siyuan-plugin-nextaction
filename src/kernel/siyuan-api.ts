import type * as kernel from "siyuan/kernel";
import type { TaskChangeSetV2 } from "../shared/types";
import type { SiyuanApiResponse } from "./types";

export type SiyuanLogLevel = "info" | "warn" | "error";

export interface SiyuanApiPort {
    request<T = unknown>(path: `/${string}`, body?: object): Promise<T>;
    getBlockAttrs(blockId: string): Promise<Record<string, string>>;
    setBlockAttrs(blockId: string, attrs: Record<string, string>): Promise<void>;
    batchGetBlockAttrs(blockIds: string[]): Promise<Record<string, Record<string, string>>>;
    batchSetBlockAttrs(blockAttrs: Array<{ id: string; attrs: Record<string, string> }>): Promise<void>;
    query<T = Record<string, unknown>>(statement: string): Promise<T[]>;
    broadcast(name: "tasksChangedV2", payload: TaskChangeSetV2): void | Promise<void>;
    log(level: SiyuanLogLevel, message: string): void | Promise<void>;
}

export class ProductionSiyuanApi implements SiyuanApiPort {
    constructor(private readonly siyuan: kernel.ISiyuan) {}

    async request<T = unknown>(path: `/${string}`, body: object = {}): Promise<T> {
        const response = await this.siyuan.client.fetch(path, {
            method: "POST",
            body: JSON.stringify(body),
        });
        let result: SiyuanApiResponse;
        try {
            result = (await response.json()) as SiyuanApiResponse;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`SiYuan API returned non-JSON response for ${path}: ${message}`);
        }
        if (result.code !== 0) throw new Error(`API error ${result.code}: ${result.msg}`);
        return result.data as T;
    }

    getBlockAttrs(blockId: string): Promise<Record<string, string>> {
        return this.request("/api/attr/getBlockAttrs", { id: blockId });
    }

    async setBlockAttrs(blockId: string, attrs: Record<string, string>): Promise<void> {
        await this.request("/api/attr/setBlockAttrs", { id: blockId, attrs });
    }

    batchGetBlockAttrs(blockIds: string[]): Promise<Record<string, Record<string, string>>> {
        return this.request("/api/attr/batchGetBlockAttrs", { ids: blockIds });
    }

    async batchSetBlockAttrs(blockAttrs: Array<{ id: string; attrs: Record<string, string> }>): Promise<void> {
        await this.request("/api/attr/batchSetBlockAttrs", { blockAttrs });
    }

    query<T = Record<string, unknown>>(statement: string): Promise<T[]> {
        return this.request("/api/query/sql", { stmt: statement });
    }

    broadcast(name: "tasksChangedV2", payload: TaskChangeSetV2): void | Promise<void> {
        return this.siyuan.rpc?.broadcast(name, payload);
    }

    log(level: SiyuanLogLevel, message: string): void | Promise<void> {
        return this.siyuan.logger?.[level]?.(message);
    }
}

let defaultApi: SiyuanApiPort | null = null;

const uninitializedApi: SiyuanApiPort = {
    request: async () => {
        throw new Error("SiYuan API not initialized");
    },
    getBlockAttrs: async () => {
        throw new Error("SiYuan API not initialized");
    },
    setBlockAttrs: async () => {
        throw new Error("SiYuan API not initialized");
    },
    batchGetBlockAttrs: async () => {
        throw new Error("SiYuan API not initialized");
    },
    batchSetBlockAttrs: async () => {
        throw new Error("SiYuan API not initialized");
    },
    query: async () => {
        throw new Error("SiYuan API not initialized");
    },
    broadcast: () => {
        throw new Error("SiYuan API not initialized");
    },
    log: () => {},
};

export function setDefaultSiyuanApi(api: SiyuanApiPort): void {
    defaultApi = api;
}

export function getDefaultSiyuanApi(): SiyuanApiPort {
    return defaultApi ?? uninitializedApi;
}
