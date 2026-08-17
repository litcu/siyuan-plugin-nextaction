import { getAllEditor, type IProtyle, type Plugin, type Protyle } from "siyuan";
import type { KernelBridge } from "../kernel-bridge";
import { taskStore } from "../stores/task-store";
import { notifyError, notifyInfo, notifyOperationError } from "../notify";
import { runAiExtractTasks } from "../ai/ai-feature-service";
import { assertBlockId } from "../../shared/block-id";

type CommandProtyle = {
    toolbar?: IProtyle["toolbar"];
    wysiwyg?: IProtyle["wysiwyg"];
    block?: IProtyle["block"];
    protyle?: IProtyle;
    transaction?: Protyle["transaction"];
    wysiwygElement?: HTMLElement;
};

export class TaskCommandController {
    private commandsRegistered = false;

    constructor(
        private readonly plugin: Plugin,
        private readonly isMobile: boolean,
        private readonly getBridge: () => KernelBridge,
        private readonly openPanel: () => void,
    ) {}

    registerSlashCommands(): void {
        // Slash menu items
        this.plugin.protyleSlash = [
            {
                filter: [this.plugin.i18n.convertToTask, "convert to task", "ntask", "zrw"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">[NextAction] ${this.plugin.i18n.convertToTask}</span></div>`,
                id: "convertToTask",
                callback: async (protyle: CommandProtyle, nodeElement: HTMLElement) => {
                    const cleanTitle = await this.clearSlashCommand(protyle, nodeElement);

                    const blockId = nodeElement.dataset.nodeId;
                    if (!blockId) {
                        notifyError(this.plugin.i18n.errorCannotDetermineBlockId || "Cannot determine block ID");
                        return;
                    }
                    try {
                        await this.doConvertToTask(blockId, cleanTitle);
                        notifyInfo(this.plugin.i18n.convertToTaskSuccess);
                        void taskStore.loadTasks();
                    } catch (e) {
                        console.error("[NextAction] convertToTask error:", e);
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            },
            {
                filter: [this.plugin.i18n.convertToProject, "convert to project", "nproject", "zxm"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">[NextAction] ${this.plugin.i18n.convertToProject}</span></div>`,
                id: "convertToProject",
                callback: async (protyle: CommandProtyle, nodeElement: HTMLElement) => {
                    const cleanTitle = await this.clearSlashCommand(protyle, nodeElement);

                    const blockId = nodeElement.dataset.nodeId;
                    if (!blockId) {
                        notifyError(this.plugin.i18n.errorCannotDetermineBlockId || "Cannot determine block ID");
                        return;
                    }
                    try {
                        await this.doConvertToTask(blockId, cleanTitle, "2");
                        notifyInfo(this.plugin.i18n.convertToProjectSuccess);
                        void taskStore.loadTasks();
                    } catch (e) {
                        console.error("[NextAction] convertToProject error:", e);
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            },
            {
                filter: [
                    this.plugin.i18n.convertToTaskWithChildren,
                    "convert to task with children",
                    "ntaskchildren",
                    "zrwz",
                ],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">[NextAction] ${this.plugin.i18n.convertToTaskWithChildren}</span></div>`,
                id: "convertToTaskWithChildren",
                callback: async (protyle: CommandProtyle, nodeElement: HTMLElement) => {
                    const cleanTitle = await this.clearSlashCommand(protyle, nodeElement);

                    const blockId = nodeElement.dataset.nodeId;
                    if (!blockId) {
                        notifyError(this.plugin.i18n.errorCannotDetermineBlockId || "Cannot determine block ID");
                        return;
                    }
                    try {
                        const result = await this.doConvertToTaskWithChildren(blockId, cleanTitle);
                        const msg = this.plugin.i18n.convertToTaskWithChildrenResult
                            .replace("{converted}", String(result.converted))
                            .replace("{skipped}", String(result.skipped));
                        notifyInfo(msg);
                        void taskStore.loadTasks();
                    } catch (e) {
                        console.error("[NextAction] convertToTaskWithChildren error:", e);
                        notifyOperationError(e, this.plugin.i18n);
                    }
                },
            },
            {
                filter: [this.plugin.i18n.aiExtractTasks || "AI 提取任务", "extract tasks", "zrw-ai"],
                html: `<div class="b3-list-item__first"><span class="b3-list-item__text">[NextAction] ${this.plugin.i18n.aiExtractTasks || "AI 提取任务"}</span></div>`,
                id: "aiExtractTasks",
                callback: async (protyle: CommandProtyle, nodeElement: HTMLElement) => {
                    await this.clearSlashCommand(protyle, nodeElement);
                    const blockId = nodeElement.dataset.nodeId;
                    if (!blockId) {
                        notifyError(this.plugin.i18n.errorCannotDetermineBlockId || "Cannot determine block ID");
                        return;
                    }
                    await runAiExtractTasks([blockId]);
                },
            },
        ];
    }

    private getEditor(): Protyle | undefined {
        return getAllEditor()[0];
    }

    private getCommandBlockId(protyle?: CommandProtyle): string {
        const currentProtyle = protyle || this.getEditor()?.protyle;
        const savedRange = currentProtyle?.toolbar?.range;
        const rangeNode = savedRange?.startContainer;
        const rangeElement = rangeNode instanceof HTMLElement ? rangeNode : rangeNode?.parentElement;
        const rangeBlock = rangeElement?.closest?.("[data-node-id]") as HTMLElement | null;
        if (rangeBlock?.dataset?.nodeId) {
            return rangeBlock.dataset.nodeId;
        }

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const node = selection.getRangeAt(0).startContainer;
            const element = node instanceof HTMLElement ? node : node.parentElement;
            const selectionBlock = element?.closest?.("[data-node-id]") as HTMLElement | null;
            if (selectionBlock?.dataset?.nodeId) {
                return selectionBlock.dataset.nodeId;
            }
        }

        const selected = ((currentProtyle as CommandProtyle).wysiwygElement?.querySelector(
            ".protyle-wysiwyg--select",
        ) || currentProtyle?.wysiwyg?.element?.querySelector(".protyle-wysiwyg--select")) as HTMLElement | null;
        return selected?.dataset?.nodeId || currentProtyle?.block?.rootID || "";
    }

    private async runConvertCommand(protyle?: CommandProtyle, taskType: string = "1"): Promise<void> {
        const blockId = this.getCommandBlockId(protyle);
        if (!blockId) return;
        try {
            await this.doConvertToTask(blockId, undefined, taskType);
            notifyInfo(
                taskType === "2" ? this.plugin.i18n.convertToProjectSuccess : this.plugin.i18n.convertToTaskSuccess,
            );
            void taskStore.loadTasks();
        } catch (e) {
            notifyOperationError(e, this.plugin.i18n);
        }
    }

    private async runConvertWithChildrenCommand(protyle?: CommandProtyle): Promise<void> {
        const blockId = this.getCommandBlockId(protyle);
        if (!blockId) return;
        try {
            const result = await this.doConvertToTaskWithChildren(blockId);
            const msg = this.plugin.i18n.convertToTaskWithChildrenResult
                .replace("{converted}", String(result.converted))
                .replace("{skipped}", String(result.skipped));
            notifyInfo(msg);
            void taskStore.loadTasks();
        } catch (e) {
            notifyOperationError(e, this.plugin.i18n);
        }
    }

    private async waitForSlashCommandPersistence(blockId: string, slashCommand: string): Promise<void> {
        const command = slashCommand.trim();
        if (!blockId || !command) return;

        // protyle.transaction queues /api/transactions without exposing a completion
        // promise. Poll the authoritative kramdown endpoint before a follow-up AI
        // request so it cannot observe the pre-cleanup block content.
        for (let attempt = 0; attempt < 12; attempt++) {
            try {
                const response = await fetch("/api/block/getBlockKramdown", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: blockId, mode: "md" }),
                });
                if (response.ok) {
                    const payload = await response.json();
                    if (
                        payload?.code === 0 &&
                        typeof payload?.data?.kramdown === "string" &&
                        !payload.data.kramdown.includes(command)
                    )
                        return;
                }
            } catch (_e) {
                // The transaction may still be in flight; retry below.
            }
            await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 25));
        }
    }

    /**
     * Remove the slash query and persist the edit through SiYuan's transaction API.
     * Plugin slash callbacks do not receive the built-in menu cleanup automatically.
     */
    private async clearSlashCommand(protyle: CommandProtyle, nodeElement: HTMLElement): Promise<string> {
        const oldHTML = nodeElement.outerHTML;
        const savedRange = protyle?.toolbar?.range;
        const selection = window.getSelection();
        const range = savedRange || (selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null);
        const slashCommand = range?.toString() || "";
        if (range) {
            try {
                range.deleteContents();
            } catch (_e) {
                /* ignore */
            }
        }

        const cleanTitle = (nodeElement.querySelector('[contenteditable="true"]')?.textContent || "").trim();
        const blockId = nodeElement.dataset.nodeId;
        const newHTML = nodeElement.outerHTML;
        if (blockId && newHTML !== oldHTML && typeof protyle?.transaction === "function") {
            nodeElement.setAttribute("data-editing", "true");
            protyle.transaction(
                [
                    {
                        id: blockId,
                        data: newHTML,
                        action: "update",
                    },
                ],
                [
                    {
                        id: blockId,
                        data: oldHTML,
                        action: "update",
                    },
                ],
            );
        }
        if (blockId && newHTML !== oldHTML) {
            await this.waitForSlashCommandPersistence(blockId, slashCommand);
        }
        return cleanTitle;
    }

    private async runRefreshCommand(): Promise<void> {
        try {
            await this.getBridge().recalcAllOrders();
            void taskStore.loadTasks();
            notifyInfo(`${this.plugin.i18n.refreshTasks} ✓`);
        } catch (e) {
            notifyOperationError(e, this.plugin.i18n);
        }
    }

    async doConvertToTaskWithChildren(
        blockId: string,
        cleanTitle?: string,
        taskType: string = "1",
    ): Promise<{ converted: number; skipped: number }> {
        try {
            return await this.getBridge().convertToTaskWithChildren(blockId, cleanTitle, taskType);
        } catch (rpcErr) {
            console.warn(
                "[NextAction] doConvertToTaskWithChildren RPC failed:",
                rpcErr instanceof Error ? rpcErr.message : String(rpcErr),
            );
            throw rpcErr;
        }
    }

    /** Convert a block through the authoritative kernel write path. */
    async doConvertToTask(blockId: string, cleanTitle?: string, taskType: string = "1") {
        blockId = assertBlockId(blockId);
        return this.getBridge().convertToTask(blockId, cleanTitle, taskType);
    }

    getCurrentDocumentId(): string {
        return this.getEditor()?.protyle?.block?.rootID || "";
    }

    registerCommands(): void {
        if (this.commandsRegistered) return;
        this.commandsRegistered = true;
        // Commands
        this.plugin.addCommand({
            langKey: "convertToTask",
            langText: `[${this.plugin.i18n.pluginName}] ${this.plugin.i18n.convertToTask}`,
            hotkey: "",
            callback: () => {
                void this.runConvertCommand();
            },
            editorCallback: (protyle: CommandProtyle) => {
                void this.runConvertCommand(protyle);
            },
            globalCallback: () => {
                void this.runConvertCommand();
            },
        });

        this.plugin.addCommand({
            langKey: "refreshTasks",
            langText: `[${this.plugin.i18n.pluginName}] ${this.plugin.i18n.refreshTasks}`,
            hotkey: "",
            callback: () => {
                void this.runRefreshCommand();
            },
            globalCallback: () => {
                void this.runRefreshCommand();
            },
            editorCallback: () => {
                void this.runRefreshCommand();
            },
            dockCallback: () => {
                void this.runRefreshCommand();
            },
        });

        this.plugin.addCommand({
            langKey: "convertToProject",
            langText: `[${this.plugin.i18n.pluginName}] ${this.plugin.i18n.convertToProject}`,
            hotkey: "",
            callback: () => {
                void this.runConvertCommand(undefined, "2");
            },
            editorCallback: (protyle: CommandProtyle) => {
                void this.runConvertCommand(protyle, "2");
            },
            globalCallback: () => {
                void this.runConvertCommand(undefined, "2");
            },
        });

        this.plugin.addCommand({
            langKey: "convertToTaskWithChildren",
            langText: `[${this.plugin.i18n.pluginName}] ${this.plugin.i18n.convertToTaskWithChildren}`,
            hotkey: "",
            callback: () => {
                void this.runConvertWithChildrenCommand();
            },
            editorCallback: (protyle: CommandProtyle) => {
                void this.runConvertWithChildrenCommand(protyle);
            },
            globalCallback: () => {
                void this.runConvertWithChildrenCommand();
            },
        });

        if (!this.isMobile) {
            this.plugin.addCommand({
                langKey: "openTaskPanel",
                langText: `[${this.plugin.i18n.pluginName}] ${this.plugin.i18n.openTaskPanel}`,
                hotkey: "",
                callback: () => {
                    this.openPanel();
                },
                globalCallback: () => {
                    this.openPanel();
                },
                editorCallback: () => {
                    this.openPanel();
                },
                dockCallback: () => {
                    this.openPanel();
                },
            });
        }

        this.plugin.addCommand({
            langKey: "aiExtractTasks",
            langText: `[${this.plugin.i18n.pluginName}] ${this.plugin.i18n.aiExtractTasks || "AI 提取任务"}`,
            hotkey: "",
            callback: () => {
                const blockId = this.getCommandBlockId();
                if (blockId) void runAiExtractTasks([blockId]);
            },
            editorCallback: (protyle: CommandProtyle) => {
                const blockId = this.getCommandBlockId(protyle);
                if (blockId) void runAiExtractTasks([blockId]);
            },
            globalCallback: () => {
                const blockId = this.getCommandBlockId();
                if (blockId) void runAiExtractTasks([blockId]);
            },
        });
    }

    dispose(): void {
        this.plugin.protyleSlash = [];
    }
}
