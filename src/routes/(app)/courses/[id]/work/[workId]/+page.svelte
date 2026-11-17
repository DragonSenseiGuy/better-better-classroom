<script lang="ts">
	import { page } from '$app/state';
	import { useLiveQuery, eq } from '@tanstack/svelte-db';
	import { courses, courseWork, submissions } from '#lib/db/collections.ts';
	import { postAttachments } from '#lib/api.ts';
	import { hasRealMaterials } from '#lib/shared/attachments.ts';
	import type { Attachment } from '#lib/shared/types.ts';
	import { topicById } from '#lib/db/queries.ts';
	import { gradePercent, statusLabel, summarize, type WorkSummary } from '#lib/work.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import Attachments from '#lib/components/attachments.svelte';
	import ClassComments from '#lib/components/class-comments.svelte';
	import RichText from '#lib/components/rich-text.svelte';
	import PostHeader from '#lib/components/post-header.svelte';
	import { formatDate, formatDateLong, formatRelative, formatTime } from '#lib/format.ts';
	import { displayName } from '#lib/course.ts';
	import { Assignment as AssignmentIcon } from '@material-symbols-svg/svelte/rounded/icons/assignment';
	import { Help as QuestionIcon } from '@material-symbols-svg/svelte/rounded/icons/help';
	import SubmissionFiles from './submission-files.svelte';
	import SubmissionActions from './submission-actions.svelte';
	import PrivateComments from './private-comments.svelte';

	const row = useLiveQuery({
		query: (q) =>
			q
				.from({ w: courseWork })
				.where(({ w }) => eq(w.id, page.params.workId))
				.innerJoin({ c: courses }, ({ w, c }) => eq(w.courseId, c.id))
				.leftJoin({ s: submissions }, ({ w, s }) => eq(w.id, s.courseWorkId))
				.findOne()
	});
	const topicQuery = useLiveQuery({ query: (q) => topicById(q, row.data?.w.topicId) });

	const w = $derived(
		row.data ? summarize(row.data.w, row.data.s ?? undefined, displayName(row.data.c)) : null
	);
	const sub = $derived(row.data?.s ?? null);
	const teacher = $derived(
		row.data?.w.author?.name ??
			row.data?.c.teachers.find((t) => t.userId === row.data?.w.creatorUserId)?.name ??
			row.data?.c.teachers[0]?.name
	);
	// Session-only sync maps due dates, points, submission states, grades and
	// topic names; per-item attachment URLs are backfilled by the sync walk,
	// and this page fetches them itself for posts not yet reached.
	const limited = $derived(page.data.snapshot.source !== 'apps-script');
	// Material attachments live in a separate details RPC the stream does not
	// carry, so in session mode we fetch them for this post on open. Apps
	// Script snapshots already include them.
	let extraMaterials = $state<Attachment[] | null>(null);
	let extraMaterialsFor = $state<string | null>(null);
	$effect(() => {
		const current = w;
		if (
			!limited ||
			!current ||
			// A coursework row's only material may be the auto-created Drive
			// folder the stream carries; that is not a reason to skip the
			// details fetch — its real attachments load only here.
			hasRealMaterials(current.materials) ||
			!current.courseId ||
			extraMaterialsFor === current.id
		)
			return;
		extraMaterialsFor = current.id;
		postAttachments({ courseId: current.courseId, workId: current.id })
			.then((found) => {
				if (extraMaterialsFor === current.id) extraMaterials = found;
			})
			.catch(() => {
				// Details RPC unavailable for this post; leave the section as-is.
			});
	});
	const attachmentItems = $derived<Attachment[]>([
		...(w?.materials ?? []),
		...(extraMaterials ?? [])
	]);
	const due = $derived(
		!w || w.dueAt === undefined
			? null
			: w.hasDueTime
				? `${formatDate(w.dueAt)}, ${formatTime(w.dueAt)}`
				: formatDate(w.dueAt, { day: 'numeric', month: 'short' }, true)
	);

	/** The status Classroom shows at the top right of "Your work". */
	function workState(w: WorkSummary): { text: string; tone: string } {
		const late = w.late ? ' · late' : '';
		if (w.status === 'graded' && w.assignedGrade !== undefined)
			return {
				text: (w.maxPoints ? `${w.assignedGrade}/${w.maxPoints}` : String(w.assignedGrade)) + late,
				tone: 'text-on-surface'
			};
		if (w.status === 'missing') return { text: 'Missing', tone: 'text-error' };
		if (w.status === 'turnedIn' && w.late) return { text: 'Done late', tone: 'text-warning' };
		if (w.status === 'turnedIn' || w.status === 'returned')
			return { text: statusLabel[w.status] + late, tone: 'text-success' };
		return { text: 'Assigned', tone: 'text-on-surface-variant' };
	}
</script>

{#if w}
	<div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
		<article class="min-w-0">
			<PostHeader
				courseId={w.courseId}
				title={w.title}
				byline={[teacher, `${formatRelative(w.createdAt)}`].filter(Boolean).join(' • ')}
				alternateLink={w.alternateLink}
			>
				{#snippet icon()}
					{#if w.workType.endsWith('QUESTION')}<QuestionIcon />{:else}<AssignmentIcon />{/if}
				{/snippet}
				{#snippet meta()}
					<span>{w.maxPoints ? `${w.maxPoints} points` : 'Ungraded'}</span>
					{#if due}
						<span class="h-4 w-px bg-outline-variant" aria-hidden="true"></span>
						<span title={w.dueAt ? formatDateLong(w.dueAt, !w.hasDueTime) : undefined}
							>Due {due}</span
						>
					{/if}
					{#if topicQuery.data}
						<Badge variant="outline" class="ml-auto">{topicQuery.data.name}</Badge>
					{/if}
				{/snippet}
			</PostHeader>

			<div class="mt-6 sm:pl-16">
				{#if w.description}
					<RichText
						text={w.description}
						html={w.html}
						class="max-w-[70ch] text-body-lg text-pretty break-words text-on-surface"
					/>
				{:else}
					<p class="text-body-lg text-on-surface-variant">No instructions were given.</p>
				{/if}
				{#if attachmentItems.length || (limited && extraMaterials === null)}
					<!-- attachmentItems merges the row's materials with the details
					     fetch, so a post whose only stored material is the Drive
					     folder still gains its real attachments here. -->
					<div class="mt-6"><Attachments items={attachmentItems} /></div>
				{/if}
			</div>

			{#if limited}
				<div
					class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-3 py-2 text-body-md text-on-surface-variant sm:ml-16"
				>
					<span
						>Session mode: grades, topics and to-do states sync; per-item attachments load when you
						open an item. Connect the Apps Script source for the full picture.</span
					>
					<Button variant="outline" size="sm" href="/setup">Connect Apps Script</Button>
				</div>
			{/if}
		</article>

		<!-- M3 elevated cards (Compose ElevatedCardTokens): CornerMedium 12px, surface-container-low,
		     elevation level 1, 16px padding; Classroom shows both side cards raised -->
		<aside class="flex flex-col gap-4">
			<section
				class="rounded-md bg-surface-container-low p-4 shadow-[0_1px_2px_0_rgb(0_0_0/0.3),0_1px_3px_1px_rgb(0_0_0/0.15)]"
				aria-labelledby="your-work"
			>
				<div class="flex items-baseline justify-between gap-2">
					<h2 id="your-work" class="text-title-lg text-on-surface">Your work</h2>
					{#if sub}
						{@const state = workState(w)}
						<span class="text-label-lg {state.tone}">{state.text}</span>
					{/if}
				</div>
				{#if sub}
					{#if w.assignedGrade !== undefined && w.maxPoints}
						<Progress value={gradePercent(w) ?? 0} class="mt-3 h-1.5" />
					{:else if w.assignedGrade === undefined && w.draftGrade !== undefined}
						<p class="mt-3 text-body-md text-on-surface-variant">
							Draft grade
							<span class="font-medium text-on-surface tabular-nums"
								>{w.draftGrade}{#if w.maxPoints}<span class="text-on-surface-variant"
										>/{w.maxPoints}</span
									>{/if}</span
							>
						</p>
					{/if}
					<p class="mt-1 text-body-sm text-on-surface-variant">
						Updated {formatRelative(sub.updatedAt)}
					</p>
					<div class="mt-4"><SubmissionFiles work={w} fallback={sub.attachments} /></div>
					<SubmissionActions work={w} submission={sub} />
				{:else}
					<p class="mt-2 text-body-md text-on-surface-variant">
						No submission record yet. Files and comments below load live from Classroom when a
						session is connected.
					</p>
				{/if}
			</section>
			{#if sub}
				<section
					class="rounded-md bg-surface-container-low p-4 shadow-[0_1px_2px_0_rgb(0_0_0/0.3),0_1px_3px_1px_rgb(0_0_0/0.15)]"
				>
					<PrivateComments work={w} {teacher} />
				</section>
			{/if}
			<section
				class="rounded-md bg-surface-container-low p-4 shadow-[0_1px_2px_0_rgb(0_0_0/0.3),0_1px_3px_1px_rgb(0_0_0/0.15)]"
			>
				<ClassComments courseId={w.courseId} workId={w.id} />
			</section>
		</aside>
	</div>
{/if}
