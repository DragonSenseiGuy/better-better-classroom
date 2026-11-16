import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireEnricher, upstream, workIds } from '#lib/server/http.ts';

// Attachments on the post itself. Session sync only sees their ids, so the
// details pages fetch these once per open — never during a course sync,
// because the query is one call per post.
export const GET: RequestHandler = async ({ url }) => {
	const { courseId, workId } = workIds(url);
	const postAttachments = requireEnricher('postAttachments', 'Attachments');
	return json({ attachments: await upstream(() => postAttachments(courseId, workId)) });
};
