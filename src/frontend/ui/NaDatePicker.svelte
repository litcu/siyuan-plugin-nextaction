<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";

    export let value: string = ""; // "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" or ""
    export let placeholder: string = "";
    export let disabled: boolean = false;
    export let defaultTime: string = ""; // "HH:mm" e.g. "09:00" or "23:59"
    export let requireTime: boolean = false; // if true, time selection is mandatory
    export let fixedDropdown: boolean = false; // if true, use position:fixed for dropdown (for Dialog containers)
    export let i18n: any = null;

    const dispatch = createEventDispatcher<{ change: { value: string } }>();

    let open = false;
    let viewYear: number;
    let viewMonth: number; // 0-11
    let containerEl: HTMLElement;
    let hoverDate: string = "";
    let timeMode: boolean = false;
    let selectedHour: number = 0;
    let selectedMinute: number = 0;
    let hourListEl: HTMLElement;
    let minuteListEl: HTMLElement;
    let hourSnapTimer: ReturnType<typeof setTimeout> | null = null;
    let minuteSnapTimer: ReturnType<typeof setTimeout> | null = null;
    let isSnappingHour = false;
    let isSnappingMinute = false;

    $: weekdays = i18n?.dpWeekdays ? i18n.dpWeekdays.split(",") : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    $: todayLabel = i18n?.dpToday || "Today";
    $: okLabel = i18n?.dpOk || "OK";
    $: clearLabel = i18n?.dpClear || "Clear";
    $: dateOnlyLabel = i18n?.dpDateOnly || "Date Only";
    $: setTimeLabel = i18n?.dpSetTime || "Set Time";
    $: hourLabel = i18n?.dpHour || "H";
    $: minuteLabel = i18n?.dpMinute || "Min";
    const HOURS = Array.from({ length: 24 }, (_, i) => i);
    const MINUTES = Array.from({ length: 60 }, (_, i) => i);
    const ITEM_H = 22;
    const SNAP_DELAY = 80;

    $: today = getToday();
    $: displayText = value ? formatDateTimeDisplay(value) : "";
    $: calendarDays = buildCalendarDays(viewYear, viewMonth);
    $: datePart = value ? value.split("T")[0] : "";

    function getToday(): string {
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function pad(n: number): string {
        return n < 10 ? `0${n}` : `${n}`;
    }

    function formatDateTimeDisplay(iso: string): string {
        if (!iso) return "";
        const hasTime = iso.includes("T");
        if (hasTime) {
            const [dateStr, timeStr] = iso.split("T");
            const parts = dateStr.split("-");
            if (parts.length !== 3) return iso;
            return `${parts[0]}/${parts[1]}/${parts[2]} ${timeStr}`;
        }
        const parts = iso.split("-");
        if (parts.length !== 3) return iso;
        return `${parts[0]}/${parts[1]}/${parts[2]}`;
    }

    function parseDate(iso: string): { year: number; month: number; day: number } | null {
        const dateStr = iso.split("T")[0];
        const parts = dateStr.split("-");
        if (parts.length !== 3) return null;
        return { year: parseInt(parts[0]), month: parseInt(parts[1]), day: parseInt(parts[2]) };
    }

    function parseTime(iso: string): { hour: number; minute: number } {
        if (!iso.includes("T")) return { hour: 0, minute: 0 };
        const timeStr = iso.split("T")[1];
        if (!timeStr) return { hour: 0, minute: 0 };
        const parts = timeStr.split(":");
        return { hour: parseInt(parts[0]) || 0, minute: parseInt(parts[1]) || 0 };
    }

    function clampMinute(m: number): number {
        return Math.max(0, Math.min(59, m));
    }

    function buildCalendarDays(year: number, month: number): { date: string; day: number; inMonth: boolean }[] {
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const daysInPrevMonth = new Date(year, month, 0).getDate();

        const days: { date: string; day: number; inMonth: boolean }[] = [];

        for (let i = firstDay - 1; i >= 0; i--) {
            const d = daysInPrevMonth - i;
            const m = month === 0 ? 12 : month;
            const y = month === 0 ? year - 1 : year;
            days.push({ date: `${y}-${pad(m)}-${pad(d)}`, day: d, inMonth: false });
        }

        for (let d = 1; d <= daysInMonth; d++) {
            days.push({ date: `${year}-${pad(month + 1)}-${pad(d)}`, day: d, inMonth: true });
        }

        const remaining = 42 - days.length;
        for (let d = 1; d <= remaining; d++) {
            const m = month === 11 ? 1 : month + 2;
            const y = month === 11 ? year + 1 : year;
            days.push({ date: `${y}-${pad(m)}-${pad(d)}`, day: d, inMonth: false });
        }

        return days;
    }

    function initViewModel() {
        const dateStr = value ? value.split("T")[0] : "";
        if (dateStr) {
            const parsed = parseDate(dateStr);
            if (parsed) {
                viewYear = parsed.year;
                viewMonth = parsed.month - 1;
                return;
            }
        }
        const now = new Date();
        viewYear = now.getFullYear();
        viewMonth = now.getMonth();
    }

    function initTimeFromValue() {
        if (value && value.includes("T")) {
            const t = parseTime(value);
            selectedHour = t.hour;
            selectedMinute = clampMinute(t.minute);
            timeMode = true;
        } else {
            if (requireTime) {
                const dt = defaultTime || "09:00";
                const parts = dt.split(":");
                selectedHour = parseInt(parts[0]) || 0;
                selectedMinute = clampMinute(parseInt(parts[1]) || 0);
                timeMode = true;
            } else {
                selectedHour = 0;
                selectedMinute = 0;
                timeMode = false;
            }
        }
    }

    let dropdownStyle = "";

    function updateDropdownPosition() {
        if (!fixedDropdown || !open || !containerEl) return;
        const rect = containerEl.getBoundingClientRect();
        dropdownStyle = `position:fixed;z-index:9999;left:${rect.left}px;top:${rect.bottom + 4}px;width:228px;`;
    }

    function toggleOpen() {
        if (disabled) return;
        if (!open) {
            initViewModel();
            initTimeFromValue();
            if (timeMode || requireTime) scrollToSelected();
        }
        open = !open;
        if (open && fixedDropdown) {
            // Use requestAnimationFrame to ensure DOM is ready
            requestAnimationFrame(() => updateDropdownPosition());
        }
    }

    function selectDay(date: string) {
        if (timeMode || requireTime) {
            value = `${date}T${pad(selectedHour)}:${pad(selectedMinute)}`;
            const parsed = parseDate(date);
            if (parsed) {
                viewYear = parsed.year;
                viewMonth = parsed.month - 1;
            }
        } else {
            value = date;
            open = false;
            dispatch("change", { value });
        }
    }

    function selectToday() {
        if (timeMode) {
            value = `${today}T${pad(selectedHour)}:${pad(selectedMinute)}`;
            initViewModel();
        } else {
            value = today;
            initViewModel();
            open = false;
            dispatch("change", { value });
        }
    }

    function toggleTimeMode() {
        if (requireTime) return; // cannot disable time when required
        timeMode = !timeMode;
        if (timeMode) {
            if (!value || !value.includes("T")) {
                const dt = defaultTime || "00:00";
                const parts = dt.split(":");
                selectedHour = parseInt(parts[0]) || 0;
                selectedMinute = clampMinute(parseInt(parts[1]) || 0);
            }
            scrollToSelected();
        } else {
            if (value && value.includes("T")) {
                value = value.split("T")[0];
            }
            open = false;
            dispatch("change", { value });
        }
    }

    function confirmDateTime() {
        if (timeMode || requireTime) {
            const d = value ? value.split("T")[0] : today;
            value = `${d}T${pad(selectedHour)}:${pad(selectedMinute)}`;
        }
        open = false;
        dispatch("change", { value });
    }

    function clearValue() {
        value = "";
        timeMode = false;
        open = false;
        dispatch("change", { value: "" });
    }

    function onHourClick(h: number) {
        selectedHour = h;
        if (hourListEl) hourListEl.scrollTop = HOURS.indexOf(h) * ITEM_H;
    }

    function onMinuteClick(m: number) {
        selectedMinute = m;
        if (minuteListEl) minuteListEl.scrollTop = MINUTES.indexOf(m) * ITEM_H;
    }

    function snapAfterScroll(el: HTMLElement, isHour: boolean) {
        if (!el) return;
        const maxIdx = isHour ? 23 : 59;
        const idx = Math.round(el.scrollTop / ITEM_H);
        const clamped = Math.max(0, Math.min(maxIdx, idx));
        const targetTop = clamped * ITEM_H;
        if (Math.abs(el.scrollTop - targetTop) < 1) return;
        if (isHour) isSnappingHour = true; else isSnappingMinute = true;
        el.scrollTo({ top: targetTop, behavior: 'smooth' });
        const onEnd = () => {
            el.removeEventListener('scroll', onEnd);
            el.removeEventListener('touchend', onEnd);
            if (isHour) isSnappingHour = false; else isSnappingMinute = false;
        };
        el.addEventListener('scroll', onEnd);
        el.addEventListener('touchend', onEnd);
    }

    function handleHourScroll() {
        if (!hourListEl || isSnappingHour) return;
        const idx = Math.round(hourListEl.scrollTop / ITEM_H);
        const clamped = Math.max(0, Math.min(23, idx));
        if (clamped !== selectedHour) selectedHour = clamped;
        if (hourSnapTimer) clearTimeout(hourSnapTimer);
        hourSnapTimer = setTimeout(() => snapAfterScroll(hourListEl, true), SNAP_DELAY);
    }

    function handleMinuteScroll() {
        if (!minuteListEl || isSnappingMinute) return;
        const idx = Math.round(minuteListEl.scrollTop / ITEM_H);
        const clamped = Math.max(0, Math.min(MINUTES.length - 1, idx));
        if (MINUTES[clamped] !== selectedMinute) selectedMinute = MINUTES[clamped];
        if (minuteSnapTimer) clearTimeout(minuteSnapTimer);
        minuteSnapTimer = setTimeout(() => snapAfterScroll(minuteListEl, false), SNAP_DELAY);
    }

    function scrollToSelected() {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (hourListEl) hourListEl.scrollTop = HOURS.indexOf(selectedHour) * ITEM_H;
                if (minuteListEl) minuteListEl.scrollTop = MINUTES.indexOf(selectedMinute) * ITEM_H;
            });
        });
    }

    function prevMonth() {
        if (viewMonth === 0) { viewMonth = 11; viewYear--; } else { viewMonth--; }
    }

    function nextMonth() {
        if (viewMonth === 11) { viewMonth = 0; viewYear++; } else { viewMonth++; }
    }

    function handleClickOutside(e: MouseEvent) {
        if (containerEl && !containerEl.contains(e.target as Node)) open = false;
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") open = false;
    }

    onMount(() => { initViewModel(); });
</script>

<svelte:window on:click={handleClickOutside} on:keydown={handleKeydown} />

<div class="na-date-picker" bind:this={containerEl}>
    <div
        class="na-date-picker__input"
        class:na-date-picker__input--open={open}
        class:na-date-picker__input--disabled={disabled}
        on:click={toggleOpen}
        role="combobox"
        aria-expanded={open}
        aria-controls="na-date-picker-calendar"
        aria-haspopup="grid"
        aria-disabled={disabled}
        tabindex={disabled ? -1 : 0}
        on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(); } }}
    >
        {#if displayText}
            <span class="na-date-picker__value">{displayText}</span>
        {:else}
            <span class="na-date-picker__placeholder">{placeholder}</span>
        {/if}
        <span class="na-date-picker__icon">
            {#if value && value.includes("T")}
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="8" cy="8" r="6" /><polyline points="8,4 8,8 11,8" />
                </svg>
            {:else}
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="3" width="12" height="11" rx="1.5" /><line x1="2" y1="7" x2="14" y2="7" /><line x1="5" y1="1" x2="5" y2="4.5" /><line x1="11" y1="1" x2="11" y2="4.5" />
                </svg>
            {/if}
        </span>
    </div>

    {#if open}
        <div class="na-date-picker__dropdown" class:na-date-picker__dropdown--fixed={fixedDropdown} style={fixedDropdown ? dropdownStyle : ""} id="na-date-picker-calendar" on:click|stopPropagation>
            <!-- Calendar -->
            <div class="na-date-picker__header">
                <button class="na-date-picker__nav" on:click={prevMonth} aria-label="Previous month">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="10,3 5,8 10,13" /></svg>
                </button>
                <span class="na-date-picker__month-year">{i18n?.dpYearMonth ? i18n.dpYearMonth.replace("{y}", String(viewYear)).replace("{m}", String(viewMonth + 1)) : `${viewYear}/${viewMonth + 1}`}</span>
                <button class="na-date-picker__nav" on:click={nextMonth} aria-label="Next month">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,3 11,8 6,13" /></svg>
                </button>
            </div>

            <div class="na-date-picker__weekdays">
                {#each weekdays as day}
                    <span class="na-date-picker__weekday">{day}</span>
                {/each}
            </div>

            <div class="na-date-picker__days">
                {#each calendarDays as cell}
                    <button
                        class="na-date-picker__day"
                        class:na-date-picker__day--selected={cell.date === datePart}
                        class:na-date-picker__day--today={cell.date === today}
                        class:na-date-picker__day--outside={!cell.inMonth}
                        on:click={() => selectDay(cell.date)}
                        on:mouseenter={() => hoverDate = cell.date}
                        on:mouseleave={() => hoverDate = ""}
                        disabled={disabled}
                    >
                        {cell.day}
                    </button>
                {/each}
            </div>

            <!-- Time section: stacked below calendar, same width -->
            {#if timeMode || requireTime}
                <div class="na-date-picker__time-section">
                    <div class="na-date-picker__time-row">
                        <div class="na-date-picker__time-col">
                            <span class="na-date-picker__time-label">{hourLabel}</span>
                            <div class="na-date-picker__time-scroll" bind:this={hourListEl} on:scroll={handleHourScroll}>
                                <div class="na-date-picker__time-pad"></div>
                                {#each HOURS as h}
                                    <button class="na-date-picker__time-item" class:na-date-picker__time-item--active={h === selectedHour} on:click|stopPropagation={() => onHourClick(h)}>
                                        {pad(h)}
                                    </button>
                                {/each}
                                <div class="na-date-picker__time-pad"></div>
                            </div>
                        </div>
                        <span class="na-date-picker__time-sep">:</span>
                        <div class="na-date-picker__time-col">
                            <span class="na-date-picker__time-label">{minuteLabel}</span>
                            <div class="na-date-picker__time-scroll" bind:this={minuteListEl} on:scroll={handleMinuteScroll}>
                                <div class="na-date-picker__time-pad"></div>
                                {#each MINUTES as m}
                                    <button class="na-date-picker__time-item" class:na-date-picker__time-item--active={m === selectedMinute} on:click|stopPropagation={() => onMinuteClick(m)}>
                                        {pad(m)}
                                    </button>
                                {/each}
                                <div class="na-date-picker__time-pad"></div>
                            </div>
                        </div>
                    </div>
                </div>
            {/if}

            <!-- Footer -->
            <div class="na-date-picker__footer">
                <button class="na-date-picker__time-toggle" on:click={toggleTimeMode} disabled={requireTime}>
                    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="8" cy="8" r="6" /><polyline points="8,4 8,8 11,8" />
                    </svg>
                    <span>{timeMode ? dateOnlyLabel : setTimeLabel}</span>
                </button>
                <div class="na-date-picker__footer-actions">
                    <button class="na-date-picker__action" on:click={selectToday}>{todayLabel}</button>
                    {#if timeMode || requireTime}
                        <button class="na-date-picker__action na-date-picker__action--primary" on:click={confirmDateTime}>{okLabel}</button>
                    {/if}
                    <button class="na-date-picker__action na-date-picker__action--danger" on:click={clearValue}>{clearLabel}</button>
                </div>
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
    .na-date-picker {
        position: relative;
        width: 100%;
    }

    /* ── Input trigger ── */
    .na-date-picker__input {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--na-control-height);
        padding: 0 var(--na-space-md);
        background: var(--b3-theme-background);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        cursor: pointer;
        transition: border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        user-select: none;
    }
    .na-date-picker__input:hover { border-color: var(--b3-theme-primary-light); }
    .na-date-picker__input:focus-visible { border-color: var(--b3-theme-primary); outline: none; }
    .na-date-picker__input--open { border-color: var(--b3-theme-primary); }
    .na-date-picker__input--disabled { opacity: 0.35; cursor: not-allowed; }

    .na-date-picker__value { font-size: var(--na-font-size-md); color: var(--b3-theme-on-background); flex: 1; }
    .na-date-picker__placeholder { font-size: var(--na-font-size-md); color: var(--b3-theme-on-surface-light); flex: 1; }
    .na-date-picker__icon { display: flex; align-items: center; color: var(--b3-theme-on-surface-light); flex-shrink: 0; margin-left: var(--na-space-xs); }

    /* ── Dropdown ── */
    .na-date-picker__dropdown {
        position: absolute;
        z-index: 20;
        left: 0;
        width: 228px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-lg);
        box-shadow: var(--na-shadow-dialog);
        margin-top: 4px;
        padding: var(--na-space-sm);
        animation: na-dp-fade 0.15s ease-out;
    }

    .na-date-picker__dropdown--fixed {
        position: fixed;
        margin-top: 0;
    }

    @keyframes na-dp-fade {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
    }

    /* ── Calendar header ── */
    .na-date-picker__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px 0 var(--na-space-xs);
    }

    .na-date-picker__nav {
        display: flex; align-items: center; justify-content: center;
        width: 22px; height: 22px; padding: 0;
        border: none; background: none;
        color: var(--b3-theme-on-surface-light);
        cursor: pointer; border-radius: var(--na-radius-sm);
        transition: background 0.15s, color 0.15s;
    }
    .na-date-picker__nav:hover { background: var(--b3-theme-surface-light); color: var(--b3-theme-on-background); }

    .na-date-picker__month-year {
        font-size: var(--na-font-size-md);
        font-weight: 500;
        color: var(--b3-theme-on-background);
    }

    /* ── Weekdays ── */
    .na-date-picker__weekdays {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        margin-bottom: 2px;
    }
    .na-date-picker__weekday {
        text-align: center;
        font-size: var(--na-font-size-xs);
        color: var(--b3-theme-on-surface-light);
        padding: 2px 0;
        font-weight: 500;
    }

    /* ── Day grid ── */
    .na-date-picker__days {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        gap: 1px;
    }
    .na-date-picker__day {
        display: flex; align-items: center; justify-content: center;
        width: 28px; height: 26px; margin: 0 auto; padding: 0;
        border: none; background: none;
        color: var(--b3-theme-on-background);
        font-size: var(--na-font-size-sm);
        cursor: pointer; border-radius: var(--na-radius-sm);
        transition: background 0.1s, color 0.1s;
        position: relative;
    }
    .na-date-picker__day:hover { background: var(--b3-theme-surface-light); }
    .na-date-picker__day--outside { color: var(--b3-theme-on-surface-light); opacity: 0.45; }
    .na-date-picker__day--today { font-weight: 600; }
    .na-date-picker__day--today::after {
        content: ""; position: absolute; bottom: 2px; left: 50%; transform: translateX(-50%);
        width: 4px; height: 2px; border-radius: 1px; background: var(--b3-theme-primary);
    }
    .na-date-picker__day--selected { background: var(--b3-theme-primary); color: var(--b3-theme-on-primary); font-weight: 500; }
    .na-date-picker__day--selected.na-date-picker__day--today::after { background: var(--b3-theme-on-primary); }
    .na-date-picker__day--selected:hover { background: var(--b3-theme-primary-light); color: var(--b3-theme-on-primary); }
    .na-date-picker__day--outside.na-date-picker__day--selected { opacity: 1; color: var(--b3-theme-on-primary); }

    /* ── Time section: below calendar, same width, Ant Design style ── */
    .na-date-picker__time-section {
        margin-top: var(--na-space-xs);
        padding-top: var(--na-space-xs);
        border-top: 1px solid var(--na-color-divider);
    }

    .na-date-picker__time-row {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        gap: 4px;
    }

    .na-date-picker__time-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .na-date-picker__time-label {
        font-size: 10px;
        color: var(--b3-theme-on-surface-light);
        font-weight: 500;
        margin-bottom: 2px;
    }

    .na-date-picker__time-scroll {
        width: 100%;
        height: calc(3 * 22px); /* 66px — 3 visible items */
        overflow-y: auto;
        overscroll-behavior-y: contain;
        will-change: scroll-position;
        border: 1px solid var(--na-color-divider);
        border-radius: var(--na-radius-md);
        background: var(--b3-theme-background);

        &::-webkit-scrollbar { width: 0; display: none; }
    }

    .na-date-picker__time-pad {
        height: 22px;
        flex-shrink: 0;
    }

    .na-date-picker__time-item {
        display: flex; align-items: center; justify-content: center;
        height: 22px; width: 100%; padding: 0;
        border: none; background: none;
        color: var(--b3-theme-on-surface-light);
        font-size: var(--na-font-size-sm);
        font-variant-numeric: tabular-nums;
        cursor: pointer;
        border-radius: 2px;

        &:hover { background: var(--b3-theme-surface-light); }
    }

    .na-date-picker__time-item--active {
        color: var(--b3-theme-primary);
        font-weight: 600;
        background: var(--b3-theme-primary-lightest);
    }

    .na-date-picker__time-sep {
        display: flex; align-items: center; justify-content: center;
        width: 14px;
        font-size: var(--na-font-size-md);
        font-weight: 600;
        color: var(--b3-theme-on-background);
        padding-top: 14px; /* offset for label */
        flex-shrink: 0;
    }

    /* ── Footer ── */
    .na-date-picker__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding-top: var(--na-space-xs);
        margin-top: var(--na-space-xs);
        border-top: 1px solid var(--na-color-divider);
    }

    .na-date-picker__time-toggle {
        display: flex; align-items: center; gap: 3px;
        padding: 3px 6px;
        border: none; background: none;
        color: var(--b3-theme-primary);
        font-size: var(--na-font-size-xs);
        cursor: pointer; border-radius: var(--na-radius-sm);
        transition: background 0.15s;

        &:hover { background: var(--b3-theme-primary-lightest); }
    }

    .na-date-picker__footer-actions {
        display: flex; align-items: center; gap: 2px;
    }

    .na-date-picker__action {
        padding: 3px 8px; border: none; background: none;
        color: var(--b3-theme-primary);
        font-size: var(--na-font-size-sm); font-weight: 500;
        cursor: pointer; border-radius: var(--na-radius-sm);
        transition: background 0.15s;
    }
    .na-date-picker__action:hover { background: var(--b3-theme-primary-lightest); }

    .na-date-picker__action--primary {
        background: var(--b3-theme-primary); color: var(--b3-theme-on-primary);
        border-radius: var(--na-radius-md); padding: 3px 10px;
    }
    .na-date-picker__action--primary:hover { background: var(--b3-theme-primary-light); color: var(--b3-theme-on-primary); }

    .na-date-picker__action--danger { color: var(--b3-theme-error); }
    .na-date-picker__action--danger:hover { background: rgba(231, 76, 60, 0.08); }
</style>
