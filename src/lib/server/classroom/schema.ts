// Reverse-engineered wire schema for Classroom's internal batchexecute RPCs.
//
// These endpoints speak protobuf-over-JSON: every message is a positional
// array where index N-1 holds field number N, gaps are null, and nested
// messages are nested arrays. Google ships no field names, so the names and
// numbers below are recovered from observed traffic (see probe captures) and
// from intuition about the domain, the way a modding community maps an
// undocumented binary format. Treat them as a best-effort map, not gospel:
// when Google reorders a field the decoder returns undefined for it rather
// than throwing, and a new capture updates the number here.

import { f, rep, message } from './proto';

// ---- shared -------------------------------------------------------------

/** `[id]` — a bare id in its own array. */
export const IdBox = message<{ id: string }>('IdBox', { 1: f('id', 'string') });

/** `[id, [courseId]]` — identifies a post within a course. */
export const PostKey = message<{ id: string; course: { id: string } }>('PostKey', {
	1: f('id', 'string'),
	2: f('course', IdBox, 'course id wrapped in its own array')
});

// ---- stream (rpc pONvgf, tag hrsi.qr) -----------------------------------

export const Paging = message<{ hasMore: boolean; token: string }>('Paging', {
	1: f('hasMore', 'bool'),
	2: f('token', 'string', 'continuation token, wrapped: [token]')
});

export const StreamEnvelope = message<{
	tag: string;
	paging: { hasMore: boolean; token: string };
	entries: unknown[];
}>(
	'StreamEnvelope',
	{
		1: f('tag', 'string', '"hrsi.qr"'),
		2: f('paging', Paging),
		3: rep('entries', 'json', 'each is [kind, ...] wrapping one PostItem')
	},
	'hrsi.qr'
);

/**
 * One post. Announcements arrive as entry `[3, null, [PostItem]]`; coursework
 * as `[2, [PostItem, schedule, folder]]`; materials as
 * `[7, null, null, null, null, [PostItem]]`. The kind wrapper is stripped by
 * findItem before decoding. Rich text sits several levels deep
 * in field 28 and stays a hand-walked locator (findRichText) because its
 * position varies by post type. Field 6 holds the title on coursework and
 * materials; on announcements the same slot carries a content array, and field
 * 2 holds a millisecond timestamp. Both stay `unknown` at the wire boundary
 * because the proto decoder cannot distinguish "string title" from "array
 * content" — `parsePostMeta` in classroom-web.ts is the single place that
 * coerces them to clean types.
 *
 * Field 15 is a topic reference `[[topicId, [courseId]]]` observed on
 * coursework, materials and announcements alike; the topic *name* is not in
 * the stream and needs the classwork topics RPC.
 */
export const TopicRef = message<{ id: string; course: { id: string } }>('TopicRef', {
	1: f('id', 'string'),
	2: f('course', IdBox)
});

export const PostItem = message<{
	key: { id: string; course: { id: string } };
	creator: { id: string };
	rawTimestamp: unknown;
	rawTitle: unknown;
	topicRefs?: { id: string; course: { id: string } }[];
}>('PostItem', {
	1: f('key', PostKey),
	2: f('rawTimestamp', 'json', 'millisecond timestamp on observed traffic'),
	5: f('creator', IdBox, 'author user id, web-side namespace (12 digits)'),
	6: f('rawTitle', 'json', 'string title on work/materials, array on announcements'),
	15: rep('topicRefs', TopicRef, 'topic reference(s); names come from the topics RPC')
});

/**
 * Coursework scheduling node, the second element of a wrapper-2 entry body
 * (`[2, [PostItem, schedule, folder]]`). Probe-mapped against live traffic
 * (see the session-probe findings): field 1 is the due instant in ms, 23:59
 * in the viewer's timezone when the teacher set only a date, and null when
 * there is no due date at all. Field 4 is the maximum point value.
 */
export const WorkSchedule = message<{ dueAt?: number; assignedAt?: number; maxPoints?: number }>(
	'WorkSchedule',
	{
		1: f('dueAt', 'json', 'ms-epoch due instant, or null when the work has no due date'),
		2: f('assignedAt', 'json', 'ms-epoch, observed equal to the post creation time'),
		4: f('maxPoints', 'int', 'maximum points; absent on ungraded work')
	}
);

/**
 * Coursework Drive-folder node, the third element of a wrapper-2 entry body.
 * Field 3 is the auto-created per-assignment Drive folder URL. Field 1 is a
 * per-assignment opaque string of constant length (73 on observed traffic) —
 * not user-visible text, deliberately unmapped.
 */
export const WorkFolder = message<{ label?: string; folderUrl?: string }>('WorkFolder', {
	1: f('label', 'json', 'opaque constant-length string; not user-visible text'),
	3: f('folderUrl', 'string', 'auto-created per-assignment Drive folder URL')
});

/** Body of a wrapper-2 entry: `[PostItem, schedule, folder, …]`. */
export const WorkBody = message<{
	item: {
		key: { id: string; course: { id: string } };
		creator: { id: string };
		rawTimestamp: unknown;
		rawTitle: unknown;
		topicRefs?: { id: string; course: { id: string } }[];
	};
	schedule?: { dueAt?: number; assignedAt?: number; maxPoints?: number };
	folder?: { label?: string; folderUrl?: string };
}>('WorkBody', {
	1: f('item', PostItem),
	2: f('schedule', WorkSchedule),
	3: f('folder', WorkFolder)
});

// ---- profiles (rpc UG41I, tag hrq.usr) ----------------------------------

export const ProfileEntry = message<{
	key: { id: string };
	name: string;
	email: string;
	photoUrl: string;
}>('ProfileEntry', {
	1: f('key', IdBox),
	2: f('name', 'string'),
	3: f('email', 'string'),
	5: f('photoUrl', 'string', '//lh3… host-relative; needs https: prefix')
});

export const ProfilesEnvelope = message<{ tag: string; entries: unknown[] }>(
	'ProfilesEnvelope',
	{
		1: f('tag', 'string', '"hrq.usr"'),
		3: rep('entries', 'json', 'each is a ProfileEntry')
	},
	'hrq.usr'
);

// ---- course members (rpc gXtzob, tag hrq.crs) ---------------------------
//
// The member record is the exception to the positional rule: field 3 is a
// map keyed by *stringified field numbers*, so it decodes as a plain object
// rather than an array. Students live under key "8", teachers under "22",
// each an array of [userId] boxes. parseMembersPayload reads it directly.
export const MEMBERS = { students: '8', teachers: '22' } as const;
