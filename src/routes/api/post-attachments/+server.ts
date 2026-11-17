import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireEnricher, upstream, workIds } from '#lib/server/http.ts';

// Attachments on the post itself. Session sync only sees their ids, so the
// sync walk backfills them a bounded slice per tick; this endpoint stays
// as the on-demand path for posts the backfill has not reached yet.
export const GET: RequestHandler = async ({ url }) => {
	const { courseId, workId } = workIds(url);
	const postAttachments = requireEnricher('postAttachments', 'Attachments');
	return json({ attachments: await upstream(() => postAttachments(courseId, workId)) });
};
