import type { SiyuanApiPort } from "./siyuan-api";

export interface ActionSourcePort {
    exists(sourceBlockId: string): Promise<boolean>;
}

export class SiyuanActionSourcePort implements ActionSourcePort {
    constructor(private readonly api: SiyuanApiPort) {}

    async exists(sourceBlockId: string): Promise<boolean> {
        try {
            return await this.api.request<boolean>("/api/block/checkBlockExist", { id: sourceBlockId });
        } catch {
            return false;
        }
    }
}
