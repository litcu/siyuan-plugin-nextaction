<script lang="ts">
    import type { I18nKey, I18nStrings } from "../../../shared/i18n";
    import type { RpcMcpStatus } from "../../../shared/rpc-methods";
    import NaIcon from "../../ui/NaIcon.svelte";
    import NaSettingRow from "../../ui/NaSettingRow.svelte";
    import NaSection from "../../ui/NaSection.svelte";

    const toolDescriptionKeys: Partial<Record<string, I18nKey>> = {
        get_task_metadata: "settingMcpToolMetadataDesc",
        search_tasks: "settingMcpToolSearchDesc",
        get_tasks: "settingMcpToolGetTasksDesc",
        get_next_actions: "settingMcpToolNextActionsDesc",
        list_projects: "settingMcpToolProjectsDesc",
        get_my_day: "settingMcpToolMyDayDesc",
        get_review: "settingMcpToolReviewDesc",
        get_statistics: "settingMcpToolStatisticsDesc",
        create_tasks: "settingMcpToolCreateDesc",
        update_tasks: "settingMcpToolUpdateDesc",
        delete_tasks: "settingMcpToolRemoveDesc",
        convert_blocks_to_tasks: "settingMcpToolConvertDesc",
        update_my_day: "settingMcpToolUpdateMyDayDesc",
        mark_tasks_reviewed: "settingMcpToolMarkReviewedDesc",
    };

    interface Props {
        i18n: I18nStrings;
        mcpEnabled: boolean;
        mcpAllowWrite: boolean;
        mcpStatus: RpcMcpStatus | null;
        mcpCopied?: boolean;
        mcpEndpoint?: string;
        onCopyEndpoint: () => void;
        onReset: () => void;
    }

    let {
        i18n,
        mcpEnabled = $bindable(),
        mcpAllowWrite = $bindable(),
        mcpStatus,
        mcpCopied = false,
        mcpEndpoint = "",
        onCopyEndpoint,
        onReset,
    }: Props = $props();
</script>

<div class="na-page-stack na-settings-mcp">
    <NaSection
        icon="iconCloud"
        title={i18n?.settingMcpAccess || i18n?.settingMcp || "MCP access"}
        description={i18n?.settingMcpAccessDesc || "Control how AI clients can discover and update NextAction tasks."}
        actionLabel={i18n?.settingResetSection || i18n?.settingReset || "Reset"}
        onAction={onReset}
    >
        <NaSettingRow
            forId="setting-mcp-enabled"
            title={i18n?.settingMcpEnabled || "Enable MCP tools"}
            description={mcpStatus && !mcpStatus.supported
                ? mcpStatus.lastError ||
                  i18n?.settingMcpUnsupportedDesc ||
                  "Upgrade SiYuan to a version that supports kernel MCP tools"
                : i18n?.settingMcpEnabledDesc || "Register read-only NextAction tools in SiYuan MCP"}
        >
            <input
                id="setting-mcp-enabled"
                class="b3-switch"
                type="checkbox"
                bind:checked={mcpEnabled}
                disabled={!mcpStatus?.supported}
            />
        </NaSettingRow>
        <NaSettingRow
            disabled={!mcpEnabled}
            forId="setting-mcp-write"
            title={i18n?.settingMcpAllowWrite || "Allow write operations"}
            description={i18n?.settingMcpAllowWriteDesc ||
                "Allow AI clients to create, update, convert, and remove tasks"}
        >
            <input
                id="setting-mcp-write"
                class="b3-switch"
                type="checkbox"
                bind:checked={mcpAllowWrite}
                disabled={!mcpEnabled}
            />
        </NaSettingRow>
        <NaSettingRow
            disabled={!mcpEnabled || !mcpAllowWrite}
            title={i18n?.settingMcpBatchOperations || "Batch CRUD"}
            description={i18n?.settingMcpBatchOperationsDesc ||
                "Create, read, update, remove, or convert up to 100 tasks per request; failures are reported per item."}
        >
            <NaIcon symbol="iconList" size={16} />
        </NaSettingRow>
        {#if mcpAllowWrite && mcpEnabled}<div class="na-settings-mcp__warning">
                <NaIcon symbol="iconTriangleAlert" size={14} />{i18n?.settingMcpWriteWarning ||
                    "Authenticated MCP clients can modify task data."}
            </div>{/if}
    </NaSection>

    <NaSection
        icon="iconLink"
        title={i18n?.settingMcpEndpoint || "Endpoint"}
        description={i18n?.settingMcpEndpointHint ||
            "Uses SiYuan's stable service port 6806 and authentication. Enabled tools are also used by SiYuan's built-in AI Agent."}
    >
        <div class="na-settings-mcp__endpoint">
            <code>{mcpEndpoint}</code>
            <button type="button" class="b3-button" onclick={onCopyEndpoint}
                ><NaIcon symbol={mcpCopied ? "iconCheck" : "iconCopy"} size={14} />{mcpCopied
                    ? i18n?.settingMcpCopied || "Copied"
                    : i18n?.settingMcpCopy || "Copy"}</button
            >
        </div>
    </NaSection>

    {#if mcpStatus?.tools?.length}
        <details class="na-settings-mcp__tools">
            <summary
                ><span>{i18n?.settingMcpToolInventory || "Tool inventory"}</span><b>{mcpStatus.tools.length}</b
                ></summary
            >
            <div>
                {#each mcpStatus.tools as tool}
                    {@const descriptionKey = toolDescriptionKeys[tool.localName]}
                    <div class="na-settings-mcp__tool-row">
                        <span class:write={tool.write}>{tool.write ? "WRITE" : "READ"}</span>
                        <div>
                            <strong>{tool.title}</strong>
                            <p class="na-settings-mcp__tool-description">
                                {descriptionKey ? i18n[descriptionKey] : tool.title}
                            </p>
                        </div>
                        <small>{tool.source}</small>
                    </div>
                {/each}
            </div>
        </details>
    {/if}
</div>

<style lang="scss">
    .na-settings-mcp__warning {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: 0 0 12px;
        padding: 8px 10px;
        border-radius: var(--b3-border-radius);
        color: var(--b3-card-warning-color);
        background: color-mix(in srgb, var(--b3-card-warning-color) 10%, transparent);
        font-size: 11px;
    }
    .na-settings-mcp__endpoint {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 0 13px;
    }
    .na-settings-mcp__endpoint code {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--na-text-primary);
        font: 11px var(--b3-font-family-code);
    }
    .na-settings-mcp__tools {
        overflow: hidden;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius-b, 8px);
        background: var(--b3-theme-surface);
    }
    .na-settings-mcp__tools summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 15px;
        color: var(--na-text-primary);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
    }
    .na-settings-mcp__tools summary b {
        min-width: 24px;
        padding: 2px 7px;
        border-radius: 999px;
        color: var(--na-text-interactive);
        background: var(--b3-theme-primary-lightest);
        font-size: 10px;
        text-align: center;
    }
    .na-settings-mcp__tool-row {
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 9px 15px;
        border-top: 1px solid var(--b3-border-color);
    }
    .na-settings-mcp__tool-row > span {
        color: var(--na-text-interactive);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.08em;
    }
    .na-settings-mcp__tool-row > span.write {
        color: var(--b3-card-warning-color);
    }
    .na-settings-mcp__tool-row strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .na-settings-mcp__tool-row strong {
        color: var(--na-text-primary);
        font-size: 11px;
        font-weight: 500;
    }
    .na-settings-mcp__tool-description {
        margin: 3px 0 0;
        color: var(--na-text-secondary);
        font-size: 11px;
        line-height: 1.5;
        overflow-wrap: anywhere;
    }
    .na-settings-mcp__tool-row small {
        color: var(--na-text-secondary);
        font: 10px var(--b3-font-family-code);
    }
    @media (max-width: 620px) {
        .na-settings-mcp__tool-row {
            grid-template-columns: 42px minmax(0, 1fr);
        }
        .na-settings-mcp__tool-row small {
            display: none;
        }
    }
</style>
