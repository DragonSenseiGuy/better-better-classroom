<script lang="ts">
	import { page } from '$app/state';
	import { useLiveQuery } from '@tanstack/svelte-db';
	import { setSearchParam } from '#lib/navigation.ts';
	import { workWithContext } from '#lib/db/queries.ts';
	import { displayName } from '#lib/course.ts';
	import { summarize, byDue, type WorkSummary } from '#lib/work.ts';
	import { dueDayStart, startOfDay, formatDate, formatTime, dayLabel } from '#lib/format.ts';
	import * as ToggleGroup from '#lib/components/ui/toggle-group/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import PageHeader from '#lib/components/page-header.svelte';
	import WorkItem from '#lib/components/work-item.svelte';
	import CourseDot from '#lib/components/course-dot.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	const workQuery = useLiveQuery({ query: workWithContext });
	const all = $derived(
		workQuery.data.map((r) => summarize(r.w, r.s ?? undefined, displayName(r.c))).sort(byDue)
	);

	type View = 'month' | 'agenda';
	const readView = (v: string | null): View => (v === 'agenda' ? 'agenda' : 'month');
	let view = $state<View>(readView(page.url.searchParams.get('view')));
	function setView(v: string) {
		view = readView(v);
		setSearchParam('view', view, 'month');
	}

	const DAY = 86_400_000;
	const now = Date.now();
	const today = startOfDay(now);

	// ---- month grid ------------------------------------------------------
	// Monday-first, matching the to-do week grid. Items land on their due day
	// (local start for dated dues, UTC-midnight-mapped otherwise), so the
	// round-trip is exact the same way it is in the week grid.
	const mondayOf = (t: number) => {
		const d = new Date(t);
		const shift = (d.getDay() + 6) % 7;
		return startOfDay(t - shift * DAY);
	};
	const monthOf = (t: number) => {
		const d = new Date(t);
		return { y: d.getFullYear(), m: d.getMonth() };
	};
	const monthStart = (y: number, m: number) => new Date(y, m, 1).getTime();
	const nextMonth = (y: number, m: number, step: number) => {
		const n = m + step;
		return { y: y + Math.floor(n / 12), m: ((n % 12) + 12) % 12 };
	};
	const cursor = monthOf(now);
	let shown = $state(cursor);
	const shownStart = $derived(monthStart(shown.y, shown.m));
	const shownLabel = $derived(
		formatDate(shownStart, { month: 'long', year: 'numeric' }, false, now)
	);
	const gridStart = $derived(mondayOf(shownStart));
	const gridEnd = $derived(
		// Always 6 rows: a stable grid beats a shifting one.
		gridStart + 42 * DAY
	);
	const gridDays = $derived(Array.from({ length: 42 }, (_, i) => gridStart + i * DAY));

	const monthFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow' });
	const numFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric' });

	const byDay = $derived.by(() => {
		const map = new Map<number, WorkSummary[]>();
		for (const w of all) {
			if (w.dueAt === undefined) continue;
			const day = dueDayStart(w.dueAt, w.hasDueTime);
			if (day < gridStart || day >= gridEnd) continue;
			map.set(day, [...(map.get(day) ?? []), w]);
		}
		return map;
	});
	const undatedCount = $derived(all.filter((w) => w.dueAt === undefined).length);

	// ---- agenda ----------------------------------------------------------
	const agenda = $derived.by(() => {
		const overdue: WorkSummary[] = [];
		const upcoming = new Map<number, WorkSummary[]>();
		const undated: WorkSummary[] = [];
		for (const w of all) {
			if (w.dueAt === undefined) {
				undated.push(w);
				continue;
			}
			const day = dueDayStart(w.dueAt, w.hasDueTime);
			if (w.status === 'missing' || day < today) overdue.push(w);
			else upcoming.set(day, [...(upcoming.get(day) ?? []), w]);
		}
		return { overdue, upcoming, undated };
	});
	const agendaDays = $derived([...agenda.upcoming.keys()].sort((a, b) => a - b));
</script>

<div class="p-4 md:p-6">
	<PageHeader title="Calendar" description="Due dates from your assignments, laid out locally.">
		{#snippet actions()}
			<ToggleGroup.Root type="single" value={view} onValueChange={setView} variant="outline">
				<ToggleGroup.Item value="month">Month</ToggleGroup.Item>
				<ToggleGroup.Item value="agenda">Agenda</ToggleGroup.Item>
			</ToggleGroup.Root>
		{/snippet}
	</PageHeader>

	{#if view === 'month'}
		<div class="mt-6 flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-base font-semibold tracking-tight">{shownLabel}</h2>
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Previous month"
					onclick={() => (shown = nextMonth(shown.y, shown.m, -1))}><ChevronLeftIcon /></Button
				>
				<Button
					variant="outline"
					size="sm"
					disabled={shown.y === cursor.y && shown.m === cursor.m}
					onclick={() => (shown = cursor)}>Today</Button
				>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Next month"
					onclick={() => (shown = nextMonth(shown.y, shown.m, 1))}><ChevronRightIcon /></Button
				>
			</div>
		</div>
		<div class="mt-3 grid grid-cols-7 gap-1 text-xs text-muted-foreground sm:gap-2">
			{#each Array.from({ length: 7 }, (_, i) => i) as col (col)}
				<span class="px-1 text-center sm:text-left">{monthFmt.format(gridStart + col * DAY)}</span>
			{/each}
		</div>
		<div class="mt-1 grid grid-cols-7 gap-1 sm:gap-2">
			{#each gridDays as day (day)}
				{@const items = byDay.get(day) ?? []}
				{@const isToday = day === today}
				{@const inMonth = day >= shownStart && day < monthStart(shown.y, shown.m + 1)}
				<section
					class={`min-h-20 rounded-lg border p-1 sm:p-2 ${isToday ? 'border-foreground/30 bg-accent/40' : ''} ${inMonth ? '' : 'opacity-50'}`}
				>
					<h3 class="flex items-baseline justify-between px-1 text-xs">
						<span class={isToday ? 'font-semibold' : 'font-medium text-muted-foreground'}
							>{numFmt.format(day)}</span
						>
						{#if items.length >= 4}
							<Badge variant="secondary" class="text-[10px]">{items.length}</Badge>
						{/if}
					</h3>
					<ul role="list" class="mt-1 flex flex-col gap-0.5">
						{#each items.slice(0, 3) as w (w.id)}
							<li>
								<a
									href={`/courses/${w.courseId}/work/${w.id}`}
									class="block rounded-md border bg-card px-1.5 py-1 text-[11px] leading-tight hover:bg-accent"
								>
									<span class="flex items-center gap-1">
										<CourseDot id={w.courseId} size="sm" class="shrink-0" />
										<span class="truncate font-medium">{w.title}</span>
									</span>
									{#if w.hasDueTime && w.dueAt}
										<span class="block text-[10px] text-muted-foreground tabular-nums"
											>{formatTime(w.dueAt)}</span
										>
									{/if}
								</a>
							</li>
						{/each}
						{#if items.length > 3}
							<li class="px-1 text-[10px] text-muted-foreground">+{items.length - 3} more</li>
						{/if}
					</ul>
				</section>
			{/each}
		</div>
		{#if undatedCount}
			<p class="mt-3 text-xs text-muted-foreground">
				{undatedCount}
				{undatedCount === 1 ? 'assignment has' : 'assignments have'} no due date — see
				<a class="underline hover:text-foreground" href="/todo">To-do</a>.
			</p>
		{/if}
	{:else}
		{#if agenda.overdue.length}
			<section class="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
				<h2 class="text-sm font-medium text-destructive">Overdue</h2>
				<div class="mt-1 flex flex-col">
					{#each agenda.overdue as w (w.id)}<WorkItem work={w} />{/each}
				</div>
			</section>
		{/if}
		{#if agendaDays.length === 0 && agenda.overdue.length === 0 && agenda.undated.length === 0}
			<Empty.Root class="mt-6 border border-dashed">
				<Empty.Header>
					<Empty.Media variant="icon"><CalendarDaysIcon /></Empty.Media>
					<Empty.Title>No dated work</Empty.Title>
					<Empty.Description>
						Assignments with due dates show up here once they are synced.
					</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else}
			<div class="mt-4 flex flex-col gap-4">
				{#each agendaDays as day (day)}
					<section>
						<h2 class="text-sm font-semibold tracking-tight">{dayLabel(day, now)}</h2>
						<div class="mt-1 flex flex-col">
							{#each agenda.upcoming.get(day) ?? [] as w (w.id)}<WorkItem work={w} />{/each}
						</div>
					</section>
				{/each}
				{#if agenda.undated.length}
					<section>
						<h2 class="text-sm font-semibold tracking-tight text-muted-foreground">No due date</h2>
						<div class="mt-1 flex flex-col">
							{#each agenda.undated as w (w.id)}<WorkItem work={w} />{/each}
						</div>
					</section>
				{/if}
			</div>
		{/if}
	{/if}
</div>
