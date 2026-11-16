<script lang="ts">
	import { page } from '$app/state';
	import { useLiveQuery, eq } from '@tanstack/svelte-db';
	import { courses, materials } from '#lib/db/collections.ts';
	import { postAttachments } from '#lib/api.ts';
	import type { Attachment } from '#lib/shared/types.ts';
	import { topicById } from '#lib/db/queries.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import Attachments from '#lib/components/attachments.svelte';
	import ClassComments from '#lib/components/class-comments.svelte';
	import RichText from '#lib/components/rich-text.svelte';
	import { formatRelative } from '#lib/format.ts';
	import { displayName } from '#lib/course.ts';
	import CourseDot from '#lib/components/course-dot.svelte';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	const row = useLiveQuery({
		query: (q) =>
			q
				.from({ m: materials })
				.where(({ m }) => eq(m.id, page.params.mid))
				.innerJoin({ c: courses }, ({ m, c }) => eq(m.courseId, c.id))
				.findOne()
	});
	const topicQuery = useLiveQuery({ query: (q) => topicById(q, row.data?.m.topicId) });
	const m = $derived(row.data?.m);
	const courseName = $derived(row.data ? displayName(row.data.c) : '');
	// Session-only sync stores materials without attachment URLs; fetch them
	// from the details RPC when this page opens (one call per post).
	const limited = $derived(page.data.snapshot.source !== 'apps-script');
	let extraMaterials = $state<Attachment[] | null>(null);
	let extraMaterialsFor = $state<string | null>(null);
	$effect(() => {
		const current = m;
		if (
			!limited ||
			!current ||
			current.materials.length > 0 ||
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
		...(m?.materials ?? []),
		...(extraMaterials ?? [])
	]);
</script>

{#if m}
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div class="min-w-0">
			<a
				href={`/courses/${m.courseId}`}
				class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
			>
				<CourseDot id={m.courseId} />{courseName}
			</a>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight text-balance">{m.title}</h1>
			<p class="mt-1 text-sm text-muted-foreground">
				Material{#if topicQuery.data}
					· {topicQuery.data.name}{/if} · posted {formatRelative(m.createdAt)}
			</p>
		</div>
		{#if m.alternateLink}
			<Button variant="outline" href={m.alternateLink} target="_blank" rel="noreferrer"
				>Open in Classroom <ExternalLinkIcon data-icon="inline-end" /></Button
			>
		{/if}
	</div>
	{#if m.description}
		<RichText
			text={m.description}
			html={m.html}
			class="mt-6 max-w-[70ch] text-sm text-pretty break-words"
		/>
	{/if}
	{#if m.materials.length}
		<h2 class="mt-8 text-base font-semibold tracking-tight">Attachments</h2>
		<div class="mt-2 max-w-lg"><Attachments items={m.materials} /></div>
	{:else if limited && extraMaterials !== null && extraMaterials.length > 0}
		<!-- Post attachments are not in the session-mode stream; fetch on open. -->
		<h2 class="mt-8 text-base font-semibold tracking-tight">Attachments</h2>
		<div class="mt-2 max-w-lg"><Attachments items={attachmentItems} /></div>
	{/if}
	{#if m.courseId}
		<div class="mt-8 max-w-lg">
			<ClassComments courseId={m.courseId} workId={m.id} />
		</div>
	{/if}
{/if}
