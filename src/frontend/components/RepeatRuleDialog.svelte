<script lang="ts">
    import type { TaskCacheEntry } from "../../shared/types";
    import {
        normalizeRepeatRule,
        parseRepeatRule,
        previewRepeatOccurrences,
        type IsoWeekday,
        type RepeatRuleV2,
    } from "../../shared/repeat";
    import type { KernelBridge } from "../kernel-bridge";
    import NaDatePicker from "../ui/NaDatePicker.svelte";
    import NaSegmentControl from "../ui/NaSegmentControl.svelte";
    import { notifyError, formatRpcError } from "../notify";

    export let task: TaskCacheEntry;
    export let bridge: KernelBridge;
    export let i18n: any;
    export let onSave: ((updated: TaskCacheEntry) => void) | undefined = undefined;
    export let onClose: (() => void) | undefined = undefined;

    const existing = parseRepeatRule(task.repeat);
    const anchorDate = (task.due || task.start || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const anchorDay = Number(anchorDate.slice(8, 10)) || 1;
    const anchorWeekday = (() => {
        const [year, month, day] = anchorDate.split("-").map(Number);
        const value = new Date(year, month - 1, day).getDay();
        return (value === 0 ? 7 : value) as IsoWeekday;
    })();

    let frequency = existing?.frequency || "week";
    let interval = existing?.interval || 1;
    let basis = existing?.basis || "schedule";
    let weekdays: IsoWeekday[] = existing?.weekdays?.length ? [...existing.weekdays] : [anchorWeekday];
    let monthlyType = existing?.monthly?.type || "dayOfMonth";
    let monthDay = existing?.monthly?.type === "dayOfMonth" ? existing.monthly.day : anchorDay;
    let monthlyNth = existing?.monthly?.type === "nthWeekday" ? String(existing.monthly.nth) : "1";
    let monthlyWeekday: IsoWeekday = existing?.monthly?.type === "nthWeekday" ? existing.monthly.weekday : anchorWeekday;
    let overflow = existing?.overflow || "lastDay";
    let missedPolicy = existing?.missedPolicy || "nextFuture";
    let endType = existing?.end.type || "never";
    let endCount = existing?.end.type === "count" ? existing.end.count : 10;
    let endDate = existing?.end.type === "date" ? existing.end.date : "";
    let saving = false;
    let validationError = "";
    let editorEl: HTMLDivElement;

    const weekdayLabels = [
        i18n?.weekdayMon || "一",
        i18n?.weekdayTue || "二",
        i18n?.weekdayWed || "三",
        i18n?.weekdayThu || "四",
        i18n?.weekdayFri || "五",
        i18n?.weekdaySat || "六",
        i18n?.weekdaySun || "日",
    ];

    $: frequencyOptions = [
        { value: "day", label: i18n?.repeatUnitDay || "天" },
        { value: "week", label: i18n?.repeatUnitWeek || "周" },
        { value: "month", label: i18n?.repeatUnitMonth || "月" },
        { value: "year", label: i18n?.repeatUnitYear || "年" },
    ];
    $: endOptions = [
        { value: "never", label: i18n?.repeatEndNever || "永不结束" },
        { value: "count", label: i18n?.repeatEndCount || "指定次数" },
        { value: "date", label: i18n?.repeatEndDate || "指定日期" },
    ];

    function toggleWeekday(day: IsoWeekday) {
        weekdays = weekdays.includes(day)
            ? weekdays.filter((item) => item !== day)
            : [...weekdays, day].sort((a, b) => a - b);
    }

    function weekdayAt(index: number): IsoWeekday {
        return (index + 1) as IsoWeekday;
    }

    function handleEditorWheel(event: WheelEvent) {
        if (!editorEl || event.deltaY === 0) return;
        const target = event.target;
        if (!(target instanceof Element)) return;

        // Calendar/time dropdowns own their wheel behavior. Everything else that
        // looks interactive should hand the wheel back to the dialog scroller.
        if (target.closest(".na-date-picker__dropdown, .na-date-picker__time-scroll")) return;
        const interactive = target.closest("input, select, textarea, button, [role='radio'], [role='switch'], .na-date-picker__input");
        if (!interactive) return;

        const maxScrollTop = editorEl.scrollHeight - editorEl.clientHeight;
        if (maxScrollTop <= 0) return;
        const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
            ? event.deltaY * 16
            : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? event.deltaY * editorEl.clientHeight
                : event.deltaY;

        event.preventDefault();
        event.stopPropagation();
        editorEl.scrollTop = Math.max(0, Math.min(maxScrollTop, editorEl.scrollTop + delta));
    }

    function applyPreset(preset: "daily" | "workdays" | "weekly" | "monthly" | "yearly") {
        interval = 1;
        if (preset === "daily") {
            frequency = "day";
        } else if (preset === "workdays") {
            frequency = "week";
            weekdays = [1, 2, 3, 4, 5];
        } else if (preset === "weekly") {
            frequency = "week";
            weekdays = [anchorWeekday];
        } else if (preset === "monthly") {
            frequency = "month";
            monthlyType = "dayOfMonth";
            monthDay = anchorDay;
        } else {
            frequency = "year";
        }
    }

    type DraftInputs = {
        frequency: string;
        interval: number;
        basis: string;
        weekdays: IsoWeekday[];
        monthlyType: string;
        monthDay: number;
        monthlyNth: string;
        monthlyWeekday: IsoWeekday;
        overflow: string;
        missedPolicy: string;
        endType: string;
        endCount: number;
        endDate: string;
    };

    function buildRule(input: DraftInputs): RepeatRuleV2 | null {
        const draft: Record<string, any> = {
            version: 2,
            frequency: input.frequency,
            interval: Number(input.interval),
            basis: input.basis,
            overflow: input.overflow,
            missedPolicy: input.missedPolicy,
            end: input.endType === "count"
                ? { type: "count", count: Number(input.endCount) }
                : input.endType === "date"
                    ? { type: "date", date: input.endDate }
                    : { type: "never" },
        };
        if (input.frequency === "week") draft.weekdays = input.weekdays;
        if (input.frequency === "month") {
            draft.monthly = input.monthlyType === "lastDay"
                ? { type: "lastDay" }
                : input.monthlyType === "nthWeekday"
                    ? { type: "nthWeekday", nth: Number(input.monthlyNth), weekday: Number(input.monthlyWeekday) }
                    : { type: "dayOfMonth", day: Number(input.monthDay) };
        }
        return normalizeRepeatRule(draft);
    }

    // Pass every draft field explicitly. Svelte only tracks dependencies visible
    // in the reactive statement; hiding them inside buildRule() leaves previews
    // stuck on the rule that was present when the dialog opened.
    $: draftRule = buildRule({
        frequency,
        interval: Number(interval),
        basis,
        weekdays,
        monthlyType,
        monthDay: Number(monthDay),
        monthlyNth,
        monthlyWeekday,
        overflow,
        missedPolicy,
        endType,
        endCount: Number(endCount),
        endDate,
    });
    $: frequencyLabel = frequency === "day"
        ? (i18n?.repeatUnit_day || i18n?.repeatUnitDay || "天")
        : frequency === "week"
            ? (i18n?.repeatUnit_week || i18n?.repeatUnitWeek || "周")
            : frequency === "month"
                ? (i18n?.repeatUnit_month || i18n?.repeatUnitMonth || "月")
                : (i18n?.repeatUnit_year || i18n?.repeatUnitYear || "年");
    $: previews = draftRule ? previewRepeatOccurrences(draftRule, task.start, task.due, 5) : [];
    $: validationError = !task.start && !task.due
        ? (i18n?.repeatNeedsDate || "请先设置开始日期或截止日期")
        : !draftRule
            ? (i18n?.invalidRepeatRule || "重复规则无效")
            : "";

    async function save() {
        if (!draftRule || validationError || saving) return;
        saving = true;
        try {
            const updated = await bridge.setRepeatRule(task.blockId, draftRule);
            onSave?.(updated);
            onClose?.();
        } catch (error: any) {
            notifyError(formatRpcError(error, i18n));
        } finally {
            saving = false;
        }
    }
</script>

<div class="na-repeat-editor" bind:this={editorEl} on:wheel|capture|nonpassive={handleEditorWheel}>
    <header class="na-repeat-editor__hero">
        <div class="na-repeat-editor__hero-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 7h11.5a3.5 3.5 0 0 1 0 7H8" />
                <path d="m8 4-3 3 3 3M19 17H7.5a3.5 3.5 0 0 1 0-7H16" />
                <path d="m16 14 3 3-3 3" />
            </svg>
        </div>
        <div class="na-repeat-editor__hero-copy">
            <span class="na-repeat-editor__eyebrow">{i18n?.repeatSettingsTitle || "重复设置"}</span>
            <h2>{task.title || (i18n?.repeatCustomRule || "重复任务")}</h2>
            <p>{i18n?.repeatEditorHint || "让同一个任务按节奏回来，日期只在发生时推进。"}</p>
        </div>
        <span class="na-repeat-editor__hero-chip">{frequencyLabel}</span>
    </header>

    <div class="na-repeat-editor__presets" aria-label={i18n?.repeatPresets || "常用规则"}>
        <div class="na-repeat-editor__section-heading">
            <span class="na-repeat-editor__step">01</span>
            <div><strong>{i18n?.repeatPresets || "快速开始"}</strong><small>{i18n?.repeatPresetHint || "先选一个接近你的节奏"}</small></div>
        </div>
        <div class="na-repeat-editor__preset-row">
            <button type="button" class:na-repeat-editor__preset--active={frequency === "day" && interval === 1} on:click={() => applyPreset("daily")}><span class="na-repeat-editor__preset-icon">D</span><span>{i18n?.repeatDaily || "每天"}</span></button>
            <button type="button" class:na-repeat-editor__preset--active={frequency === "week" && weekdays.join(",") === "1,2,3,4,5"} on:click={() => applyPreset("workdays")}><span class="na-repeat-editor__preset-icon">W</span><span>{i18n?.repeatWorkdays || "工作日"}</span></button>
            <button type="button" class:na-repeat-editor__preset--active={frequency === "week" && weekdays.length === 1} on:click={() => applyPreset("weekly")}><span class="na-repeat-editor__preset-icon">7</span><span>{i18n?.repeatWeekly || "每周"}</span></button>
            <button type="button" class:na-repeat-editor__preset--active={frequency === "month"} on:click={() => applyPreset("monthly")}><span class="na-repeat-editor__preset-icon">M</span><span>{i18n?.repeatMonthly || "每月"}</span></button>
            <button type="button" class:na-repeat-editor__preset--active={frequency === "year"} on:click={() => applyPreset("yearly")}><span class="na-repeat-editor__preset-icon">Y</span><span>{i18n?.repeatYearly || "每年"}</span></button>
        </div>
    </div>

    <div class="na-repeat-editor__layout">
        <div class="na-repeat-editor__controls">
            <section class="na-repeat-editor__card">
                <div class="na-repeat-editor__section-heading">
                    <span class="na-repeat-editor__step">02</span>
                    <div><strong>{i18n?.repeatFrequency || "重复节奏"}</strong><small>{i18n?.repeatRuleHint || "定义周期和错过后的处理方式"}</small></div>
                </div>
                <div class="na-repeat-editor__grid">
                    <div class="na-repeat-editor__field na-repeat-editor__field--wide">
                        <span>{i18n?.repeatFrequency || "频率"}</span>
                        <NaSegmentControl options={frequencyOptions} bind:value={frequency} />
                    </div>
                    <label class="na-repeat-editor__field">
                        <span>{i18n?.repeatInterval || "间隔"}</span>
                        <div class="na-repeat-editor__input-suffix"><input class="na-input" type="number" min="1" max="999" bind:value={interval} /><em>{frequencyLabel}</em></div>
                    </label>
                    <label class="na-repeat-editor__field">
                        <span>{i18n?.repeatBasis || "计算基准"}</span>
                        <select class="na-select" bind:value={basis}>
                            <option value="schedule">{i18n?.repeatBasisSchedule || "原计划日期"}</option>
                            <option value="completion">{i18n?.repeatBasisCompletion || "实际完成日期"}</option>
                        </select>
                    </label>
                    <label class="na-repeat-editor__field">
                        <span>{i18n?.repeatMissedPolicy || "错过周期"}</span>
                        <select class="na-select" bind:value={missedPolicy}>
                            <option value="nextFuture">{i18n?.repeatMissedFuture || "跳到未来最近一次"}</option>
                            <option value="catchUp">{i18n?.repeatMissedCatchUp || "逐期补做"}</option>
                        </select>
                    </label>
                </div>
            </section>

            {#if frequency === "week"}
                <section class="na-repeat-editor__card">
                    <div class="na-repeat-editor__section-heading"><span class="na-repeat-editor__step">03</span><div><strong>{i18n?.repeatWeekdays || "重复星期"}</strong><small>{i18n?.repeatWeekdayHint || "可以选择多个星期"}</small></div></div>
                    <div class="na-repeat-editor__weekdays">
                        {#each weekdayLabels as label, index}
                            <button type="button" class:na-repeat-editor__weekday--active={weekdays.includes(weekdayAt(index))} aria-pressed={weekdays.includes(weekdayAt(index))} on:click={() => toggleWeekday(weekdayAt(index))}><b>{label.slice(0, 1)}</b><small>{weekdays.includes(weekdayAt(index)) ? "✓" : ""}</small></button>
                        {/each}
                    </div>
                </section>
            {/if}

            {#if frequency === "month"}
                <section class="na-repeat-editor__card">
                    <div class="na-repeat-editor__section-heading"><span class="na-repeat-editor__step">03</span><div><strong>{i18n?.repeatMonthlyPattern || "月度模式"}</strong><small>{i18n?.repeatMonthlyHint || "固定日期或相对星期"}</small></div></div>
                    <div class="na-repeat-editor__monthly">
                        <select class="na-select" bind:value={monthlyType}>
                            <option value="dayOfMonth">{i18n?.repeatMonthDay || "每月指定日期"}</option>
                            <option value="lastDay">{i18n?.repeatLastDay || "每月最后一天"}</option>
                            <option value="nthWeekday">{i18n?.repeatNthWeekday || "每月第 N 个星期"}</option>
                        </select>
                    </div>
                    {#if monthlyType === "dayOfMonth"}
                        <div class="na-repeat-editor__conditional-grid">
                            <label class="na-repeat-editor__field"><span>{i18n?.repeatMonthDay || "日期"}</span><input class="na-input" type="number" min="1" max="31" bind:value={monthDay} /></label>
                            <label class="na-repeat-editor__field"><span>{i18n?.repeatOverflow || "月份无该日期时"}</span><select class="na-select" bind:value={overflow}><option value="lastDay">{i18n?.repeatOverflowLastDay || "使用当月最后一天"}</option><option value="skip">{i18n?.repeatOverflowSkip || "跳过该月"}</option></select></label>
                        </div>
                    {:else if monthlyType === "nthWeekday"}
                        <div class="na-repeat-editor__conditional-grid">
                            <label class="na-repeat-editor__field"><span>{i18n?.repeatNthWeekday || "序次"}</span><select class="na-select" bind:value={monthlyNth}><option value="1">{i18n?.ordinalFirst || "第一个"}</option><option value="2">{i18n?.ordinalSecond || "第二个"}</option><option value="3">{i18n?.ordinalThird || "第三个"}</option><option value="4">{i18n?.ordinalFourth || "第四个"}</option><option value="-1">{i18n?.ordinalLast || "最后一个"}</option></select></label>
                            <label class="na-repeat-editor__field"><span>{i18n?.repeatWeekdays || "星期"}</span><select class="na-select" bind:value={monthlyWeekday}>{#each weekdayLabels as label, index}<option value={index + 1}>{i18n?.weekdayPrefix || "周"}{label}</option>{/each}</select></label>
                        </div>
                    {/if}
                </section>
            {/if}

            <section class="na-repeat-editor__card">
                <div class="na-repeat-editor__section-heading"><span class="na-repeat-editor__step">04</span><div><strong>{i18n?.repeatEnd || "结束条件"}</strong><small>{i18n?.repeatEndHint || "系列可以随时暂停或重新编辑"}</small></div></div>
                <div class="na-repeat-editor__end">
                    <NaSegmentControl options={endOptions} bind:value={endType} />
                    {#if endType === "count"}<label class="na-repeat-editor__field na-repeat-editor__conditional-row"><span>{i18n?.repeatEndCount || "重复次数"}</span><input class="na-input" type="number" min="1" max="99999" bind:value={endCount} /></label>{:else if endType === "date"}<div class="na-repeat-editor__field na-repeat-editor__conditional-row"><span>{i18n?.repeatEndDate || "结束日期"}</span><NaDatePicker value={endDate} fixedDropdown={true} {i18n} on:change={(event) => { endDate = event.detail?.value || ""; }} /></div>{/if}
                </div>
            </section>
        </div>

        <aside class="na-repeat-editor__preview">
            <div class="na-repeat-editor__preview-head"><div><span class="na-repeat-editor__eyebrow">{i18n?.repeatPreview || "后续日期预览"}</span><strong>{frequencyLabel}</strong></div><span class="na-repeat-editor__live-dot">LIVE</span></div>
            <p class="na-repeat-editor__preview-note">{i18n?.repeatPreviewHint || "基于当前规则计算，不会创建新的任务块。"}</p>
            {#if previews.length > 0}
                <ol>
                    {#each previews as item, index}
                        <li><span class="na-repeat-editor__occurrence-no">{String(index + 1).padStart(2, "0")}</span><span class="na-repeat-editor__occurrence-date">{item.start || item.due}</span>{#if item.start && item.due && item.start !== item.due}<span class="na-repeat-editor__arrow">→</span><span class="na-repeat-editor__occurrence-date na-repeat-editor__occurrence-date--due">{item.due}</span>{/if}</li>
                    {/each}
                </ol>
            {:else}
                <div class="na-repeat-editor__empty"><span>—</span><p>{validationError || (i18n?.repeatNeedsDate || "请先设置开始日期或截止日期")}</p></div>
            {/if}
        </aside>
    </div>

    {#if validationError}<div class="na-repeat-editor__error"><span>!</span>{validationError}</div>{/if}

    <footer class="na-repeat-editor__footer">
        <span class="na-repeat-editor__footer-hint">{i18n?.repeatApplyHint || "应用后仍可在任务详情中暂停或跳过本次"}</span>
        <div><button type="button" class="na-button na-button--sm" on:click={() => onClose?.()}>{i18n?.cancel || "取消"}</button><button type="button" class="na-button na-button--primary na-button--sm" disabled={!!validationError || saving} on:click={save}>{saving ? (i18n?.saving || "保存中…") : (i18n?.apply || "应用")}</button></div>
    </footer>
</div>

<style>
    .na-repeat-editor {
        --na-repeat-ink: var(--b3-theme-on-background);
        --na-repeat-muted: var(--b3-theme-on-surface-light);
        --na-repeat-line: var(--b3-border-color);
        display: flex;
        flex-direction: column;
        gap: 9px;
        max-height: min(620px, calc(100vh - 120px));
        overflow: auto;
        padding: 1px 2px 2px;
        color: var(--na-repeat-ink);
        scrollbar-width: thin;
    }
    .na-repeat-editor__hero {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 11px;
        border-bottom: 1px solid var(--na-repeat-line);
        background: var(--b3-theme-background);
    }
    .na-repeat-editor__hero-mark { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 8px; color: var(--b3-theme-primary); background: var(--b3-theme-primary-lightest); }
    .na-repeat-editor__hero-mark svg { width: 17px; height: 17px; }
    .na-repeat-editor__hero-copy { min-width: 0; flex: 1; }
    .na-repeat-editor__eyebrow { display: block; color: var(--na-repeat-muted); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    .na-repeat-editor__hero h2 { overflow: hidden; margin: 2px 0 1px; color: var(--na-repeat-ink); font-size: 14px; font-weight: 650; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
    .na-repeat-editor__hero p { margin: 0; color: var(--na-repeat-muted); font-size: 10px; line-height: 1.35; }
    .na-repeat-editor__hero-chip { flex: none; padding: 4px 7px; border: 1px solid var(--b3-theme-primary); border-radius: 999px; color: var(--b3-theme-primary); background: transparent; font-size: 10px; font-weight: 650; }
    .na-repeat-editor__presets, .na-repeat-editor__card { border: 1px solid var(--na-repeat-line); border-radius: 8px; background: var(--b3-theme-surface); }
    .na-repeat-editor__presets { padding: 9px 10px 10px; }
    .na-repeat-editor__section-heading { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
    .na-repeat-editor__section-heading > div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
    .na-repeat-editor__section-heading strong { color: var(--na-repeat-ink); font-size: 11px; font-weight: 650; }
    .na-repeat-editor__section-heading small { color: var(--na-repeat-muted); font-size: 9px; line-height: 1.3; }
    .na-repeat-editor__step { display: grid; place-items: center; width: 20px; height: 20px; flex: none; border-radius: 5px; color: var(--b3-theme-primary); background: var(--b3-theme-primary-lightest); font-size: 9px; font-weight: 750; letter-spacing: .04em; }
    .na-repeat-editor__preset-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; }
    .na-repeat-editor__preset-row button { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; padding: 6px 4px; border: 1px solid var(--na-repeat-line); border-radius: 6px; color: var(--na-repeat-muted); background: var(--b3-theme-background); cursor: pointer; font-size: 10px; transition: border-color .14s ease, background .14s ease; }
    .na-repeat-editor__preset--active { border-color: var(--b3-theme-primary) !important; color: var(--b3-theme-primary) !important; background: var(--b3-theme-primary-lightest) !important; box-shadow: 0 3px 10px rgba(0, 0, 0, .06); }
    .na-repeat-editor__preset-icon { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; color: var(--b3-theme-primary); background: var(--b3-theme-background); font-size: 8px; font-weight: 800; }
    .na-repeat-editor__layout { display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(195px, .82fr); gap: 8px; align-items: start; }
    .na-repeat-editor__controls { display: flex; flex-direction: column; gap: 7px; }
    .na-repeat-editor__card { padding: 9px 10px 10px; }
    .na-repeat-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
    .na-repeat-editor__field { display: flex; min-width: 0; flex-direction: column; gap: 4px; color: var(--na-repeat-muted); font-size: 9px; }
    .na-repeat-editor__field--wide { grid-column: 1 / -1; }
    .na-repeat-editor__field :global(.na-input), .na-repeat-editor__field :global(.na-select), .na-repeat-editor__monthly :global(.na-select), .na-repeat-editor__end :global(.na-select) { width: 100%; min-height: 27px; box-sizing: border-box; }
    .na-repeat-editor__field :global(.na-segment-control), .na-repeat-editor__end :global(.na-segment-control) { display: flex; width: 100%; }
    .na-repeat-editor__field :global(.na-segment-control__option), .na-repeat-editor__end :global(.na-segment-control__option) { min-width: 0; flex: 1; padding: 4px 5px; font-size: 10px; }
    .na-repeat-editor__input-suffix { display: flex; align-items: center; gap: 7px; }
    .na-repeat-editor__input-suffix input { width: 78px !important; flex: none; }
    .na-repeat-editor__input-suffix em { color: var(--na-repeat-muted); font-size: 11px; font-style: normal; }
    .na-repeat-editor__weekdays { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
    .na-repeat-editor__weekdays button { display: flex; min-width: 0; flex-direction: column; align-items: center; justify-content: center; gap: 1px; height: 34px; border: 1px solid var(--na-repeat-line); border-radius: 6px; color: var(--na-repeat-muted); background: var(--b3-theme-background); cursor: pointer; transition: all .14s ease; }
    .na-repeat-editor__weekdays button:hover { border-color: var(--b3-theme-primary); }
    .na-repeat-editor__weekdays button b { font-size: 11px; font-weight: 650; }
    .na-repeat-editor__weekdays button small { height: 8px; color: var(--b3-theme-primary); font-size: 8px; line-height: 1; }
    .na-repeat-editor__weekday--active { border-color: var(--b3-theme-primary) !important; color: var(--b3-theme-primary) !important; background: var(--b3-theme-primary-lightest) !important; box-shadow: inset 0 -2px 0 var(--b3-theme-primary); }
    .na-repeat-editor__monthly, .na-repeat-editor__end { display: flex; min-width: 0; flex-direction: column; align-items: stretch; gap: 7px; }
    .na-repeat-editor__monthly > :global(.na-select) { width: 100%; }
    .na-repeat-editor__conditional-grid { display: grid; grid-template-columns: minmax(76px, .68fr) minmax(0, 1.32fr); gap: 7px; margin-top: 7px; }
    .na-repeat-editor__conditional-grid > * { min-width: 0; }
    .na-repeat-editor__conditional-row { width: 100%; padding-top: 1px; }
    .na-repeat-editor__preview { position: sticky; top: 0; min-height: 256px; padding: 11px; border: 1px solid var(--b3-theme-primary); border-radius: 8px; background: var(--b3-theme-primary-lightest); }
    .na-repeat-editor__preview-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .na-repeat-editor__preview-head > div { display: flex; flex-direction: column; gap: 4px; }
    .na-repeat-editor__preview-head strong { color: var(--na-repeat-ink); font-size: 14px; font-weight: 700; }
    .na-repeat-editor__live-dot { display: inline-flex; align-items: center; gap: 4px; color: var(--b3-theme-primary); font-size: 9px; font-weight: 800; letter-spacing: .08em; }
    .na-repeat-editor__live-dot::before { width: 6px; height: 6px; border-radius: 50%; background: var(--b3-theme-primary); content: ""; box-shadow: 0 0 0 3px var(--b3-theme-primary-lightest); }
    .na-repeat-editor__preview-note { margin: 7px 0 9px; color: var(--na-repeat-muted); font-size: 9px; line-height: 1.45; }
    .na-repeat-editor__preview ol { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .na-repeat-editor__preview li { display: flex; align-items: center; gap: 7px; min-height: 30px; padding: 4px 6px; border: 1px solid transparent; border-radius: 6px; background: var(--b3-theme-background); font-size: 10px; }
    .na-repeat-editor__preview li:first-child { border-color: var(--b3-theme-primary); box-shadow: 0 3px 10px rgba(0, 0, 0, .05); }
    .na-repeat-editor__occurrence-no { width: 20px; color: var(--b3-theme-primary); font-size: 9px; font-weight: 800; letter-spacing: .04em; }
    .na-repeat-editor__occurrence-date { overflow: hidden; min-width: 0; color: var(--na-repeat-ink); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .na-repeat-editor__occurrence-date--due { color: var(--na-repeat-muted); font-weight: 500; }
    .na-repeat-editor__arrow { color: var(--b3-theme-primary); font-size: 13px; }
    .na-repeat-editor__empty { display: grid; min-height: 190px; place-items: center; align-content: center; gap: 6px; color: var(--na-repeat-muted); text-align: center; }
    .na-repeat-editor__empty > span { color: var(--b3-theme-primary); font-size: 27px; font-weight: 300; }
    .na-repeat-editor__empty p { max-width: 180px; margin: 0; font-size: 11px; line-height: 1.5; }
    .na-repeat-editor__error { display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 7px; color: var(--b3-theme-error); background: var(--b3-theme-error-lightest, var(--b3-theme-primary-lightest)); font-size: 11px; }
    .na-repeat-editor__error span { display: grid; place-items: center; width: 15px; height: 15px; border: 1px solid currentColor; border-radius: 50%; font-size: 10px; font-weight: 700; }
    .na-repeat-editor__footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 2px; }
    .na-repeat-editor__footer-hint { color: var(--na-repeat-muted); font-size: 9px; line-height: 1.35; }
    .na-repeat-editor__footer > div { display: flex; flex: none; gap: 8px; }
    @media (max-width: 650px) {
        .na-repeat-editor__layout { grid-template-columns: 1fr; }
        .na-repeat-editor__preview { position: static; min-height: auto; }
        .na-repeat-editor__preview ol { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 480px) {
        .na-repeat-editor__hero-chip { display: none; }
        .na-repeat-editor__preset-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .na-repeat-editor__grid { grid-template-columns: 1fr; }
        .na-repeat-editor__field--wide { grid-column: auto; }
        .na-repeat-editor__conditional-grid { grid-template-columns: 1fr; }
        .na-repeat-editor__footer { align-items: flex-start; flex-direction: column; }
    }
</style>
