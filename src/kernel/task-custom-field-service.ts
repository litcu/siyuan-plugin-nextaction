import type { TaskCacheEntry } from "../shared/types";
import { ATTR_EXT_PREFIX } from "../shared/constants";
import { encodeCustomFieldValue, isCustomFieldApplicable, validateCustomFieldDefinition } from "../shared/custom-fields";
import type { CacheManager } from "./cache-manager";
import type { TaskRepository } from "./task-repository";
import type { TaskRuntimeState } from "./task-runtime-state";

export class TaskCustomFieldService {
    constructor(
        private readonly cacheManager: CacheManager,
        private readonly repository: TaskRepository,
        private readonly runtime: TaskRuntimeState,
    ) {}

    getCustomFieldDiagnostics(): { fields: Array<{ fieldId: string; key: string; status: string; count: number }>; orphans: Array<{ key: string; count: number; sampleBlockIds: string[] }> } {
            const definitions = new Map(this.runtime.getSettings().customFields.map(field => [field.key, field]));
            const counts = new Map<string, number>();
            const orphanSamples = new Map<string, string[]>();
            for (const entry of this.cacheManager.getAll()) {
                for (const key of Object.keys(entry.customFields || {})) {
                    if (definitions.has(key)) {
                        counts.set(key, (counts.get(key) || 0) + 1);
                    } else {
                        const samples = orphanSamples.get(key) || [];
                        if (samples.length < 5) samples.push(entry.blockId);
                        orphanSamples.set(key, samples);
                    }
                }
            }
            return {
                fields: this.runtime.getSettings().customFields.map(field => ({ fieldId: field.id, key: field.key, status: field.status, count: counts.get(field.key) || 0 })),
                orphans: [...orphanSamples.entries()].map(([key, sampleBlockIds]) => ({ key, count: this.cacheManager.getAll().filter(entry => Object.prototype.hasOwnProperty.call(entry.customFields || {}, key)).length, sampleBlockIds })),
            };
        }

    async purgeCustomField(fieldId: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
            const field = this.runtime.getSettings().customFields.find(item => item.id === fieldId);
            if (!field) throw new Error("Custom field not found: " + fieldId);
            if (field.status !== "archived") throw new Error("Only archived custom fields can be purged");
            return this.clearCustomFieldValues(field.key);
        }

    async purgeOrphanCustomField(key: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
            const fieldKey = key?.startsWith(ATTR_EXT_PREFIX) ? key.slice(ATTR_EXT_PREFIX.length) : key;
            if (!fieldKey) throw new Error("key is required");
            return this.clearCustomFieldValues(fieldKey);
        }

    validateAttrs(blockId: string, attrs: Record<string, string>): string | null {
            const extensionKeys = Object.keys(attrs).filter(key => key.startsWith(ATTR_EXT_PREFIX));
            if (extensionKeys.length === 0) return null;
            const entry = this.cacheManager.get(blockId);
            const taskMap = new Map(this.cacheManager.getAll().map(item => [item.blockId, item]));
            for (const key of extensionKeys) {
                const fieldKey = key.slice(ATTR_EXT_PREFIX.length);
                const field = this.runtime.getSettings().customFields.find(item => item.key === fieldKey);
                const rawValue = attrs[key];
                // Empty values are allowed for cleanup, including archived and orphaned fields.
                if (rawValue === "") continue;
                if (!field) return `Unknown custom field: ${fieldKey}`;
                const definitionError = validateCustomFieldDefinition(field);
                if (definitionError) return definitionError;
                if (field.status !== "active") return `Custom field is archived: ${fieldKey}`;
                if (entry && !isCustomFieldApplicable(field, entry, taskMap)) return `Custom field is not applicable to task: ${fieldKey}`;
                try {
                    encodeCustomFieldValue(field, rawValue);
                } catch (error: unknown) {
                    return `${fieldKey}: ${error instanceof Error ? error.message : String(error)}`;
                }
            }
            return null;
        }

    private async clearCustomFieldValues(fieldKey: string): Promise<{ cleared: number; failedBlockIds: string[] }> {
            this.runtime.assertReady();
            const targets = this.cacheManager.getAll().filter(entry => Object.prototype.hasOwnProperty.call(entry.customFields || {}, fieldKey));
            if (targets.length === 0) return { cleared: 0, failedBlockIds: [] };
            const lock = await this.repository.acquireWithTimeout();
            try {
                const blockAttrs = targets.map(entry => ({ id: entry.blockId, attrs: { [ATTR_EXT_PREFIX + fieldKey]: "" } }));
                const result = await this.repository.batchWriteAttrs(blockAttrs);
                const clearedIds = Object.keys(result.attrsByBlockId);
                for (const blockId of clearedIds) {
                    const entry = this.cacheManager.get(blockId);
                    if (!entry) continue;
                    const attrs = result.attrsByBlockId[blockId];
                    this.repository.cache(this.repository.buildEntry(blockId, attrs, entry));
                    this.repository.recordChange(blockId, "update");
                }
                if (clearedIds.length > 0) this.repository.publishChanges();
                return { cleared: clearedIds.length, failedBlockIds: result.failedBlockIds };
            } finally {
                lock.release();
            }
        }
}
