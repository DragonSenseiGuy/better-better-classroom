// Cookie-backed record source: lets the app sync without an Apps Script
// deployment, for school accounts where script.google.com is disabled.
//
// Coverage (v1):
// - courses: the gXtzob list query the web app boots with (id, name,
//   section, room, owner, calendar, timestamps, active/archived). The home
//   HTML scrape stays only as a fallback: the page is a JS shell with no
//   course data, so it yields section/room-empty rows when used.
// - posts: the stream RPC already used for enrichment. Titles and timestamps
//   are best-effort; due dates, max points, topic ids and the per-assignment
//   Drive folder are mapped from the stream (probe-verified), and topic
//   names come from the ZZFlc list query. Per-item attachment URLs still
//   need another RPC, and material posts carry no attachments yet.
// - people: members + profiles RPCs, same as enrichment.
// - submissions: the student-keyed Zj93ge query the to-do pages use,
//   batched per course: state (assigned / turned in / returned / reclaimed),
//   late flag, turn-in time and the assigned grade. That fills the grades
//   tab and the to-do states in session mode. Per-submission attachments
//   stay on the enrich path (querySubmissionAttachments), as before.
//   Turn-in / reclaim also work through the web session (enrich path).
//
// Registration order in hooks keeps Apps Script primary: this provider only
// serves when no script connection is saved.

import {
	SessionError,
	encodeCourseId,
	fetchSubmissions,
	fetchTopics,
	writeSubmissionState,
	type StreamItem
} from './classroom-web';
import { parseCoursesHtml, describeHomeHtml, type WebCourse } from './course-discovery';
import {
	ensureProfiles,
	fetchCoursePeople,
	fetchManyCoursePeople,
	findProfileByEmail,
	iterateCourseStream,
	requireSession,
	sessionCourseList,
	sessionTokensWithHtml,
	toRawTeacher,
	withWebStudent
} from './web-session';
import { getCourse, getWebSession } from './store';
import type {
	Provider,
	RawAnnouncement,
	RawAttachment,
	RawCourse,
	RawCourseContent,
	RawCourseWork,
	RawLookup,
	RawMaterial,
	RawOverview,
	RawSubmission,
	RawSubmissionAction,
	RawTeacher
} from './providers';

const courseUrl = (courseId: string) =>
	`https://classroom.google.com/c/${encodeCourseId(courseId)}`;

const TITLE_FALLBACK_LENGTH = 120;

async function overview(since: number): Promise<RawOverview> {
	const session = requireSession();
	const { tokens, html } = await sessionTokensWithHtml(session);
	// Primary signal: the list RPC the web app boots with. The home HTML is
	// a JS shell with no course data, so it stays only as a fallback for
	// list-RPC failures (its shapes are a subset of the RPC fields).
	const listed = await sessionCourseList(session).catch(() => []);
	type Discovered = WebCourse & Partial<RawCourse> & { courseState?: string };
	const discovered: Discovered[] = listed.length ? listed : parseCoursesHtml(html);
	if (discovered.length === 0) {
		const d = describeHomeHtml(html);
		throw new SessionError(
			`Signed in${tokens.email ? ` as ${tokens.email}` : ''} on slot /u/${session.authuser}/, ` +
				`but no courses were found (list RPC empty; ${Math.round(d.bytes / 1024)}KB, links:${d.courseLinks} ` +
				`pairs:${d.idPairs} init:${d.initData}). ` +
				`If that slot is a personal account, reconnect with a cookie from your school account. ` +
				`If courses are visible there, Google may have changed the page markup — please report this line.`
		);
	}
	// Like the Apps Script source, incremental syncs skip member resolution:
	// rosters rarely change, and the store preserves previous teachers.
	// Newly discovered courses always resolve teachers — there is nothing
	// preserved for them yet. Fan-out lives in fetchManyCoursePeople so the
	// enrichment path and this record source share one pipeline.
	const full = !since;
	const needRoster = discovered.filter((d) => full || !getCourse(d.id));
	const { teachersByCourse, errors } = await fetchManyCoursePeople(
		session,
		needRoster.map((d) => d.id)
	);
	// fetchManyCoursePeople already ensured every roster profile through the
	// single writer; resolve the overview identity from the same store read.
	const profiles = await ensureProfiles(session, []);
	const courses: RawCourse[] = discovered.map((d: Discovered) => ({
		id: d.id,
		name: d.name,
		section: d.section,
		descriptionHeading: d.descriptionHeading,
		room: d.room,
		ownerId: d.ownerId,
		courseState: d.courseState ?? 'ACTIVE',
		alternateLink: courseUrl(d.id),
		calendarId: d.calendarId,
		creationTime: d.creationTime,
		updateTime: d.updateTime,
		teachers: teachersByCourse.get(d.id)
	}));
	const me = tokens.email?.toLowerCase();
	const mine = findProfileByEmail(profiles, me);
	// Stable id across runs: web:<email> until a synced profile matches,
	// so the first sync does not churn the profile row on the second.
	const profileId = mine?.id ?? (me ? `web:${me}` : 'me');
	return {
		profile: {
			id: profileId,
			name: mine?.author.name,
			email: tokens.email,
			photoUrl: mine?.author.photoUrl
		},
		courses,
		errors
	};
}

function postBase(courseId: string, item: StreamItem, path: string) {
	// The stream exposes creation time only; creationTime is the honest
	// field. Edits to existing posts surface on full syncs, not incremental
	// filters.
	return {
		id: item.id,
		materials: [] as RawAttachment[],
		alternateLink: `${courseUrl(courseId)}/${path}`,
		creationTime: item.createdAt ? new Date(item.createdAt).toISOString() : undefined,
		creatorUserId: item.creatorId
	};
}

const postTitle = (item: StreamItem) =>
	item.title || item.text.slice(0, TITLE_FALLBACK_LENGTH) || 'Untitled';

// The stream carries the due instant as a millisecond epoch; the store's
// dueAt() rebuilds an instant from {year, month, day} + {hours, minutes} via
// Date.UTC, so hand it the UTC components of the observed instant and the
// round-trip is exact.
const dueParts = (dueAt?: number) => {
	if (!dueAt) return {};
	const d = new Date(dueAt);
	return {
		dueDate: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
		dueTime: { hours: d.getUTCHours(), minutes: d.getUTCMinutes() }
	};
};

async function courseContent(
	courseId: string,
	since: number,
	wantSubmissions: boolean
): Promise<RawCourseContent> {
	const session = requireSession();
	const announcements: RawAnnouncement[] = [];
	const courseWork: RawCourseWork[] = [];
	const materials: RawMaterial[] = [];
	// Every coursework id the stream showed, kept even when the since filter
	// drops it: the submission read below wants all of the course's work so
	// grades and states stay current between full syncs.
	const workIds: string[] = [];
	// No early break on `since`: stream ordering isn't established as
	// creation-descending, so stopping at the first stale item could drop
	// content. Filter on creation time instead; edits to existing posts
	// arrive on full syncs (and text/author edits via enrichment).
	for await (const page of iterateCourseStream(session, courseId)) {
		for (const item of page.items) {
			if (since && item.createdAt && item.createdAt < since) continue;
			// Probe-mapped stream shapes (see the session-probe findings):
			// coursework carries due date, points and a topic reference;
			// materials are wrapper-7 posts with titles but no schedule node.
			// Both lack per-item attachment URLs in the stream — coursework
			// exposes only its auto-created Drive folder, and material
			// attachments are referenced by id and need another RPC.
			if (item.kind === 'courseWork') {
				workIds.push(item.id);
				courseWork.push({
					...postBase(courseId, item, `a/${item.id}/details`),
					...(item.driveFolderUrl
						? {
								materials: [{ type: 'drive', url: item.driveFolderUrl } satisfies RawAttachment]
							}
						: {}),
					title: postTitle(item),
					description: item.text,
					state: 'PUBLISHED',
					workType: 'ASSIGNMENT',
					...dueParts(item.dueAt),
					maxPoints: item.maxPoints,
					topicId: item.topicId
				});
			} else if (item.kind === 'material') {
				materials.push({
					...postBase(courseId, item, `m/${item.id}`),
					title: postTitle(item),
					description: item.text,
					topicId: item.topicId
				});
			}
			// Announcements are the default bucket: the classifier only
			// returns courseWork or material on a positive wrapper signal.
			else announcements.push({ ...postBase(courseId, item, `p/${item.id}`), text: item.text });
		}
	}
	// Submissions come from the student-keyed Zj93ge query the to-do pages
	// use (see fetchSubmissions); topic names from the ZZFlc list query.
	// Each failure only degrades to an error entry the sync reports like
	// any other, so one flaky RPC never takes the whole content pass down.
	let submissions: RawSubmission[] = [];
	let topics: { id: string; name: string; updateTime?: string }[] = [];
	const errors: Record<string, string> = {};
	try {
		const { session: web, studentId, jar, tokens } = await withWebStudent();
		if (wantSubmissions && workIds.length > 0) {
			const records = await fetchSubmissions(
				jar,
				web.authuser,
				tokens,
				workIds.map((workId) => ({ studentId, workId, courseId }))
			);
			submissions = records.map((r) => ({
				// Deterministic per (work, student); the store keys rows by id
				// and submissionAction echoes it back unchanged.
				id: `${r.workId}:${r.studentId}`,
				courseWorkId: r.workId,
				state: r.state,
				late: r.late,
				assignedGrade: r.assignedGrade,
				alternateLink: `${courseUrl(courseId)}/a/${r.workId}/details`,
				courseWorkType: 'ASSIGNMENT',
				...(r.updatedAt
					? {
							creationTime: new Date(r.updatedAt).toISOString(),
							updateTime: new Date(r.updatedAt).toISOString()
						}
					: {}),
				attachments: []
			}));
		}
		topics = (await fetchTopics(jar, web.authuser, tokens, courseId)).map((t) => ({
			id: t.id,
			name: t.name,
			...(t.updateTime ? { updateTime: new Date(t.updateTime).toISOString() } : {})
		}));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (wantSubmissions && workIds.length > 0) errors.submissions = message;
		errors.topics = message;
	}
	// materials is a real list now, but still empty for material posts whose
	// attachments need another RPC.
	return {
		partial: since > 0,
		announcements,
		courseWork,
		materials,
		submissions,
		...(topics.length > 0 ? { topics } : {}),
		...(Object.keys(errors).length > 0 ? { errors } : {})
	};
}

async function lookup(courseId: string, users: string[]): Promise<RawLookup> {
	const session = requireSession();
	try {
		// fetchCoursePeople already ensured every roster profile through the
		// single writer; one more ensure covers only non-roster user ids
		// (and returns the full map without a write when there are none).
		const people = await fetchCoursePeople(session, courseId);
		const roster = new Set([...people.teachers, ...people.students].map((t) => t.userId));
		const extraIds = users.filter((id) => id && !roster.has(id));
		const profiles = await ensureProfiles(session, extraIds);
		const extraPeople: RawTeacher[] = extraIds.map((id) => toRawTeacher(id, profiles[id]));
		return { teachers: people.teachers, people: extraPeople };
	} catch (err) {
		return { errors: { teachers: err instanceof Error ? err.message : String(err) } };
	}
}

async function submissionAction(
	action: 'turnIn' | 'reclaim',
	courseId: string,
	workId: string,
	submissionId: string
): Promise<RawSubmissionAction> {
	const { session, studentId, jar, tokens } = await withWebStudent();
	const result = await writeSubmissionState(
		action,
		jar,
		session.authuser,
		tokens,
		studentId,
		workId,
		courseId
	);
	const now = new Date().toISOString();
	return {
		submission: {
			id: submissionId,
			courseWorkId: workId,
			state: result.turnedIn ? 'TURNED_IN' : 'RECLAIMED_BY_STUDENT',
			late: false,
			creationTime: now,
			updateTime: now,
			attachments: []
		}
	};
}

export const webRecordsProvider: Provider = {
	status: () => {
		const session = getWebSession();
		return {
			id: 'web-records',
			label: 'Session sync',
			role: 'records',
			state: session ? 'ready' : 'off',
			active: false,
			detail: session ? 'Cookie saved. Grades unavailable in session mode.' : 'No cookie saved.'
		};
	},
	records: { overview, courseContent, lookup, submissionAction }
};
