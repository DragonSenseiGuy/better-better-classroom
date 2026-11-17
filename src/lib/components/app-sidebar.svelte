<script lang="ts">
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { browser } from '$app/env';
	import { courseLabel, displayName, type CourseRef as Course } from '#lib/course.ts';
	import { loadArchivedOpen, saveArchivedOpen } from '#lib/sidebar-prefs.ts';
	import { cn } from '#lib/utils.js';
	import { createCourseOrder, type OrderSection } from '#lib/course-reorder.svelte.ts';
	import CourseAvatar from '#lib/components/course-avatar.svelte';
	import CourseMenu from '#lib/components/course-menu.svelte';
	import { editCourse } from '#lib/course-editor.svelte.ts';
	import { Home as HomeIcon, HomeFill } from '@material-symbols-svg/svelte/rounded/icons/home';
	import { Inbox as InboxIcon, InboxFill } from '@material-symbols-svg/svelte/rounded/icons/inbox';
	import {
		AssignmentTurnedIn as TodoIcon,
		AssignmentTurnedInFill as TodoFill
	} from '@material-symbols-svg/svelte/rounded/icons/assignment-turned-in';
	import {
		CalendarMonth as CalendarIcon,
		CalendarMonthFill
	} from '@material-symbols-svg/svelte/rounded/icons/calendar-month';
	import {
		Settings as SettingsIcon,
		SettingsFill
	} from '@material-symbols-svg/svelte/rounded/icons/settings';
	import { School as SchoolIcon } from '@material-symbols-svg/svelte/rounded/icons/school';
	import { Archive as ArchiveIcon } from '@material-symbols-svg/svelte/rounded/icons/archive';
	import { KeyboardArrowDown as ChevronDownIcon } from '@material-symbols-svg/svelte/rounded/icons/keyboard-arrow-down';
	import { DragIndicator as GripIcon } from '@material-symbols-svg/svelte/rounded/icons/drag-indicator';

	let {
		courses,
		archivedCourses = [],
		inboxCount = 0,
		todoCount = 0
	}: {
		courses: Course[];
		archivedCourses?: Course[];
		inboxCount?: number;
		todoCount?: number;
	} = $props();

	const sidebar = Sidebar.useSidebar();
	afterNavigate(() => sidebar.setOpenMobile(false));

	const order = createCourseOrder(
		() => courses,
		() => archivedCourses
	);

	const nav = $derived([
		{ href: '/', label: 'Home', icon: HomeIcon, active: HomeFill, count: 0 },
		{ href: '/inbox', label: 'Inbox', icon: InboxIcon, active: InboxFill, count: inboxCount },
		{ href: '/todo', label: 'To-do', icon: TodoIcon, active: TodoFill, count: todoCount },
		{
			href: '/calendar',
			label: 'Calendar',
			icon: CalendarIcon,
			active: CalendarMonthFill,
			count: 0
		}
	]);
	const isActive = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	const settingsActive = $derived(page.url.pathname.startsWith('/settings'));

	// Archived starts minimized; the last toggle choice persists across reloads.
	let archivedOpen = $state(browser ? loadArchivedOpen(localStorage) : false);
	const archivedIds = $derived(new Set(archivedCourses.map((c) => c.id)));
	const activeCourseId = $derived.by(() => {
		const path = page.url.pathname;
		return path.startsWith('/courses/') ? (path.split('/')[2] ?? null) : null;
	});
	// Keep the current course visible when it lives in the archived section.
	$effect(() => {
		if (activeCourseId && archivedIds.has(activeCourseId)) archivedOpen = true;
	});
	$effect(() => {
		saveArchivedOpen(browser ? localStorage : null, archivedOpen);
	});
	const toggleArchived = () => (archivedOpen = !archivedOpen);
</script>

{#snippet courseRows(section: OrderSection, dimmed = false)}
	{@const rows = order.ordered(section)}
	{#each rows as course, index (course.id)}
		{@const isDragging = order.dragId === course.id}
		{@const isOver = order.overId === course.id && order.dragSection === section}
		{@const label = courseLabel(course.section)}
		<Sidebar.MenuItem
			class={cn('flex items-center gap-0.5', isDragging && 'opacity-50')}
			ondragover={(e) => order.dragOver(section, course.id, e)}
			ondrop={(e) => order.drop(section, course.id, e)}
			ondragleave={(e) => order.dragLeave(course.id, e)}
		>
			<!-- Insertion indicator: top/bottom edge based on pointer half. -->
			{#if isOver}
				<span
					aria-hidden="true"
					class={cn(
						'pointer-events-none absolute right-1 left-6 h-0.5 rounded-full bg-sidebar-ring',
						order.dropPosition === 'after' ? 'bottom-0' : 'top-0'
					)}
				></span>
			{/if}
			<span
				role="button"
				tabindex="0"
				draggable="true"
				title="Drag to reorder"
				aria-label={`Reorder ${displayName(course)}. Press arrow keys to move.`}
				aria-grabbed={isDragging}
				class="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-on-surface-variant opacity-60 transition-opacity focus-visible:opacity-100 active:cursor-grabbing md:opacity-0 md:group-hover/menu-item:opacity-100 md:focus-visible:opacity-100 [&_svg]:size-4"
				ondragstart={(e) => order.dragStart(section, course.id, e)}
				ondragend={order.dragEnd}
				onkeydown={(e) => {
					if (e.key === 'ArrowUp') {
						e.preventDefault();
						order.move(section, course.id, -1);
					} else if (e.key === 'ArrowDown') {
						e.preventDefault();
						order.move(section, course.id, 1);
					}
				}}
			>
				<GripIcon />
			</span>
			<div class="min-w-0 flex-1">
				<CourseMenu
					{course}
					onRename={editCourse}
					onMoveUp={index > 0 ? () => order.move(section, course.id, -1) : undefined}
					onMoveDown={index < rows.length - 1 ? () => order.move(section, course.id, 1) : undefined}
				>
					<Sidebar.MenuButton
						size="lg"
						class="pl-3"
						isActive={page.url.pathname.startsWith(`/courses/${course.id}`)}
						tooltipContent={displayName(course)}
					>
						{#snippet child({ props })}
							<a
								href={`/courses/${course.id}`}
								{...props}
								draggable="false"
								ondragstart={(e) => e.preventDefault()}
								class:opacity-70={dimmed}
							>
								<CourseAvatar
									id={course.id}
									name={displayName(course)}
									class="size-8! text-label-lg"
								/>
								<span class="grid min-w-0 leading-tight">
									<span class="truncate">{displayName(course)}</span>
									{#if label}<span class="truncate text-label-md font-normal opacity-80"
											>{label}</span
										>{/if}
								</span>
							</a>
						{/snippet}
					</Sidebar.MenuButton>
				</CourseMenu>
			</div>
		</Sidebar.MenuItem>
	{/each}
{/snippet}

<Sidebar.Root collapsible="offcanvas">
	<Sidebar.Content class="pt-2">
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu class="gap-0.5">
					{#each nav as item (item.href)}
						{@const active = isActive(item.href)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active}>
								{#snippet child({ props })}
									<a href={item.href} {...props}>
										{#if active}<item.active />{:else}<item.icon />{/if}
										<span>{item.label}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
							{#if item.count > 0}
								<Sidebar.MenuBadge>{item.count > 99 ? '99+' : item.count}</Sidebar.MenuBadge>
							{/if}
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
		<div class="mx-7 my-2 h-px bg-outline-variant"></div>
		<Sidebar.Group>
			<Sidebar.GroupLabel class="gap-3 [&>svg]:size-6"><SchoolIcon />Enrolled</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu
					class="gap-0.5"
					aria-label="Courses, drag to reorder"
					ondragover={(e) => {
						if (order.dragId && order.dragSection === 'visible') e.preventDefault();
					}}
					ondrop={(e) => order.dropAtEnd('visible', e)}
				>
					{@render courseRows('visible')}
					{#if courses.length === 0}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton>
								{#snippet child({ props })}
									<a href="/settings" {...props}
										><span class="text-on-surface-variant"
											>{archivedCourses.length
												? 'No visible courses — see Archived below'
												: 'No courses synced yet'}</span
										></a
									>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/if}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
		{#if archivedCourses.length}
			<Sidebar.Group>
				<Sidebar.GroupLabel class="gap-0.5 pr-2">
					<button
						type="button"
						onclick={toggleArchived}
						aria-expanded={archivedOpen}
						aria-label={archivedOpen ? 'Collapse archived courses' : 'Expand archived courses'}
						class="flex size-6 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface"
					>
						<ChevronDownIcon
							class={cn('size-4 transition-transform duration-200', archivedOpen && 'rotate-180')}
						/>
					</button>
					<a
						href="/archived"
						class="flex min-w-0 flex-1 items-center gap-1.5 text-on-surface-variant hover:text-on-surface"
					>
						<ArchiveIcon class="size-4 shrink-0" />
						<span class="truncate">Archived ({archivedCourses.length})</span>
					</a>
				</Sidebar.GroupLabel>
				{#if archivedOpen}
					<Sidebar.GroupContent>
						<Sidebar.Menu
							class="gap-0.5"
							aria-label="Archived courses, drag to reorder"
							ondragover={(e) => {
								if (order.dragId && order.dragSection === 'archived') e.preventDefault();
							}}
							ondrop={(e) => order.dropAtEnd('archived', e)}
						>
							{@render courseRows('archived', true)}
						</Sidebar.Menu>
					</Sidebar.GroupContent>
				{/if}
			</Sidebar.Group>
		{/if}
	</Sidebar.Content>
	<Sidebar.Footer class="px-3 pb-3">
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton isActive={settingsActive}>
					{#snippet child({ props })}
						<a href="/settings" {...props}>
							{#if settingsActive}<SettingsFill />{:else}<SettingsIcon />{/if}
							<span>Settings</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
</Sidebar.Root>
