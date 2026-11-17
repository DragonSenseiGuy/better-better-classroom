<script lang="ts">
	import { page } from '$app/state';
	import { useLiveQuery, eq } from '@tanstack/svelte-db';
	import { courses, materials } from '#lib/db/collections.ts';
	import { postAttachments } from '#lib/api.ts';
	import type { Attachment } from '#lib/shared/types.ts';
	import { topicById } from '#lib/db/queries.ts';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import Attachments from '#lib/components/attachments.svelte';
	import ClassComments from '#lib/components/class-comments.svelte';
	import RichText from '#lib/components/rich-text.svelte';
	import PostHeader from '#lib/components/post-header.svelte';
	import { formatRelative } from '#lib/format.ts';
	import { MenuBook as MenuBookIcon } from '@material-symbols-svg/svelte/rounded/icons/menu-book';

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
	const teacher = $derived(
		row.data?.m.author?.name ??
			row.data?.c.teachers.find((t) => t.userId === row.data?.m.creatorUserId)?.name ??
			row.data?.c.teachers[0]?.name
	);
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
	<article class="max-w-4xl">
		<PostHeader
			courseId={m.courseId}
			title={m.title}
			byline={[teacher, formatRelative(m.createdAt)].filter(Boolean).join(' • ')}
			alternateLink={m.alternateLink}
		>
			{#snippet icon()}<MenuBookIcon />{/snippet}
			{#snippet meta()}
				<span>Material</span>
				{#if topicQuery.data}<Badge variant="outline">{topicQuery.data.name}</Badge>{/if}
			{/snippet}
		</PostHeader>
		<div class="mt-6 sm:pl-16">
			{#if m.description}
				<RichText
					text={m.description}
					html={m.html}
					class="max-w-[70ch] text-body-lg text-pretty break-words text-on-surface"
				/>
			{/if}
			{#if attachmentItems.length || (limited && extraMaterials === null)}
				<!-- Post attachments are not in the session-mode stream; fetch on open. -->
				<div class="mt-6"><Attachments items={attachmentItems} /></div>
			{/if}
		</div>
		{#if m.courseId}
			<div class="mt-8 max-w-lg sm:pl-16">
				<ClassComments courseId={m.courseId} workId={m.id} />
			</div>
		{/if}
	</article>
{/if}
