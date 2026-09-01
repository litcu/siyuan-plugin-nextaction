<script lang="ts">
    import type { AiFeatureId } from "../../../shared/ai";
    import type { I18nStrings } from "../../../shared/i18n";
    import NaAccordion from "../../ui/NaAccordion.svelte";
    import NaIcon from "../../ui/NaIcon.svelte";

    export let i18n: I18nStrings;
    export let aiPrompts: Record<AiFeatureId, string>;
    export let defaultPrompts: Record<AiFeatureId, string>;
    export let getRuntimePreview: (feature: AiFeatureId) => { input: string; schema: string; example: string };
    export let onResetPrompt: (feature: AiFeatureId) => void;

    let openFeatures: AiFeatureId[] = ["extractTasks"];

    $: features = [
        {
            id: "extractTasks" as const,
            label: i18n?.settingAiPromptExtractTasks || "Extract tasks from notes",
            description:
                i18n?.settingAiPromptExtractTasksDesc || "Identify executable tasks from selected note content.",
        },
        {
            id: "decomposeTask" as const,
            label: i18n?.settingAiPromptDecomposeTask || "Decompose task",
            description:
                i18n?.settingAiPromptDecomposeTaskDesc || "Break a task or project into concrete next actions.",
        },
        {
            id: "planMyDay" as const,
            label: i18n?.settingAiPromptPlanMyDay || "Plan My Day",
            description: i18n?.settingAiPromptPlanMyDayDesc || "Choose the most valuable tasks for today.",
        },
        {
            id: "review" as const,
            label: i18n?.settingAiPromptReview || "Smart review",
            description: i18n?.settingAiPromptReviewDesc || "Analyze GTD review groups and suggest follow-up actions.",
        },
    ];

    const variableGroups = [
        { id: "runtime", names: ["{{today}}", "{{currentDateTime}}", "{{timezone}}", "{{feature}}"] },
        {
            id: "task",
            names: [
                "{{currentTaskBlock}}",
                "{{currentTaskBlockWithChildren}}",
                "{{currentTaskBlockWithParent}}",
                "{{selectedBlocks}}",
                "{{block:blockID}}",
            ],
        },
        {
            id: "gtd",
            names: [
                "{{nextaction}}",
                "{{myDay}}",
                "{{inbox}}",
                "{{waiting}}",
                "{{someday}}",
                "{{overdue}}",
                "{{reviewDue}}",
                "{{activeProjects}}",
            ],
        },
    ];

    function variableGroupTitle(id: string): string {
        if (id === "runtime") return i18n?.settingAiVariablesRuntime || "Date & runtime";
        if (id === "task") return i18n?.settingAiVariablesTask || "Current task & notes";
        return i18n?.settingAiVariablesGtd || "GTD collections";
    }

    function isOpen(id: AiFeatureId): boolean {
        return openFeatures.includes(id);
    }

    function setOpen(id: AiFeatureId, open: boolean) {
        openFeatures = open ? Array.from(new Set([...openFeatures, id])) : openFeatures.filter((item) => item !== id);
    }

    function updatePrompt(id: AiFeatureId, value: string) {
        aiPrompts = { ...aiPrompts, [id]: value };
    }
</script>

<div class="na-page-stack na-settings-ai">
    <div class="na-settings-ai__intro">
        <span class="na-settings-ai__intro-icon"><NaIcon symbol="iconSparkles" size={18} /></span>
        <div>
            <strong>{i18n?.settingAiPromptTitle || "AI feature prompts"}</strong>
            <p>
                {i18n?.settingAiPromptDesc ||
                    "Tune how each feature works. Runtime data and strict output contracts are added automatically."}
            </p>
        </div>
    </div>

    <details class="na-settings-ai__variables">
        <summary>
            <NaIcon symbol="iconCode" size={15} />
            <span>{i18n?.settingAiVariablesTitle || "Available variables"}</span>
        </summary>
        <p>{i18n?.settingAiVariablesDesc || "Variables are replaced with real context for each request."}</p>
        {#each variableGroups as group}
            <div class="na-settings-ai__variable-group">
                <strong>{variableGroupTitle(group.id)}</strong>
                <div>
                    {#each group.names as name}<code>{name}</code>{/each}
                </div>
            </div>
        {/each}
    </details>

    <div class="na-settings-ai__editors">
        {#each features as feature}
            <NaAccordion
                title={feature.label}
                description={feature.description}
                open={isOpen(feature.id)}
                modified={aiPrompts[feature.id] !== defaultPrompts[feature.id]}
                modifiedLabel={i18n?.settingUnsavedBadge || "Modified"}
                {i18n}
                onOpenChange={(open) => setOpen(feature.id, open)}
            >
                {#snippet children()}
                    <label class="na-settings-ai__label" for={`setting-ai-prompt-${feature.id}`}
                        >{i18n?.settingAiPromptInstruction || "Feature instruction"}</label
                    >
                    <textarea
                        id={`setting-ai-prompt-${feature.id}`}
                        class="b3-text-field na-settings-ai__textarea"
                        rows={7}
                        maxlength="12000"
                        value={aiPrompts[feature.id]}
                        placeholder={defaultPrompts[feature.id]}
                        on:input={(event) => updatePrompt(feature.id, event.currentTarget.value)}
                    ></textarea>
                    <div class="na-settings-ai__footer">
                        <span
                            >{i18n?.settingAiPromptHint ||
                                "Describe the goal, decision criteria, and things the model should avoid."}</span
                        >
                        <code>{(aiPrompts[feature.id] || "").length}/12000</code>
                        <button
                            type="button"
                            class="b3-button b3-button--text"
                            on:click={() => onResetPrompt(feature.id)}>{i18n?.settingAiPromptReset || "Reset"}</button
                        >
                    </div>
                    <details class="na-settings-ai__runtime">
                        <summary
                            >{i18n?.settingAiRuntimePreview ||
                                "View fixed parts of the actual request (read-only)"}</summary
                        >
                        <p>
                            {i18n?.settingAiRuntimePreviewDesc ||
                                "These sections are generated at runtime and are not saved in the instruction."}
                        </p>
                        <div>
                            <span>{i18n?.settingAiRuntimeInput || "Input data"}</span>
                            <pre>{getRuntimePreview(feature.id).input}</pre>
                        </div>
                        <div>
                            <span>{i18n?.settingAiRuntimeSchema || "Strict output protocol"}</span>
                            <pre>{getRuntimePreview(feature.id).schema}</pre>
                        </div>
                        <div>
                            <span>{i18n?.settingAiRuntimeExample || "Complete JSON example"}</span>
                            <pre>{getRuntimePreview(feature.id).example}</pre>
                        </div>
                    </details>
                {/snippet}
            </NaAccordion>
        {/each}
    </div>
</div>

<style lang="scss">
    .na-settings-ai__editors {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .na-settings-ai__intro {
        display: flex;
        align-items: flex-start;
        gap: 11px;
        padding: 14px 16px;
        border-left: 3px solid var(--b3-theme-primary);
        border-radius: 0 var(--b3-border-radius-b, 8px) var(--b3-border-radius-b, 8px) 0;
        background: var(--b3-theme-surface);

        strong {
            display: block;
            color: var(--na-text-primary);
            font-size: 13px;
        }

        p {
            margin: 3px 0 0;
            color: var(--na-text-secondary);
            font-size: 11px;
            line-height: 17px;
        }
    }

    .na-settings-ai__intro-icon {
        color: var(--na-text-interactive);
    }

    .na-settings-ai__variables {
        padding: 0 15px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius-b, 8px);
        background: color-mix(in srgb, var(--b3-theme-surface) 72%, var(--b3-theme-background));

        summary {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 11px 0;
            color: var(--na-text-primary);
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
        }

        > p {
            margin: 0 0 10px;
            color: var(--na-text-secondary);
            font-size: 11px;
        }
    }

    .na-settings-ai__variable-group {
        display: grid;
        grid-template-columns: 112px minmax(0, 1fr);
        gap: 10px;
        padding: 8px 0;
        border-top: 1px solid var(--b3-border-color);

        strong {
            color: var(--na-text-secondary);
            font-size: 10px;
        }

        > div {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        }

        code {
            padding: 2px 5px;
            border-radius: 4px;
            color: var(--na-text-interactive);
            background: var(--b3-theme-primary-lightest);
            font: 10px/15px var(--b3-font-family-code);
        }
    }

    .na-settings-ai__label {
        display: block;
        margin: 13px 0 6px;
        color: var(--na-text-secondary);
        font-size: 11px;
        font-weight: 600;
    }

    :global(.na-settings-ai__textarea) {
        display: block;
        box-sizing: border-box;
        width: 100%;
        min-height: 138px;
        resize: vertical;
        font: 12px/1.6 var(--b3-font-family);
    }

    .na-settings-ai__footer {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 6px;
        color: var(--na-text-secondary);
        font-size: 10px;

        > span {
            flex: 1;
        }

        code {
            font-family: var(--b3-font-family-code);
        }
    }

    .na-settings-ai__runtime {
        margin-top: 10px;
        padding-top: 9px;
        border-top: 1px solid var(--b3-border-color);

        summary {
            color: var(--na-text-interactive);
            cursor: pointer;
            font-size: 11px;
            font-weight: 600;
        }

        > p {
            margin: 7px 0;
            color: var(--na-text-secondary);
            font-size: 10px;
        }

        > div {
            margin-top: 9px;
        }

        span {
            display: block;
            margin-bottom: 4px;
            color: var(--na-text-secondary);
            font-size: 10px;
            font-weight: 600;
        }

        pre {
            max-height: 220px;
            margin: 0;
            overflow: auto;
            padding: 9px 10px;
            border: 1px solid var(--b3-border-color);
            border-radius: var(--b3-border-radius);
            color: var(--na-text-primary);
            background: var(--b3-theme-background);
            font: 10px/1.5 var(--b3-font-family-code);
            white-space: pre-wrap;
        }
    }

    @media (max-width: 520px) {
        .na-settings-ai__variable-group {
            grid-template-columns: 1fr;
        }
    }
</style>
