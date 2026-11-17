// Cookie probes: verify a pasted cookie can load Classroom before saving it.
//
// Separate from web-session.ts on purpose. Probes use a throwaway jar and
// never touch the token cache, rotation state, or profile store — they run
// before any session exists. Session caching lives in web-session.ts.

import {
	fetchCourseList,
	fetchHomeHtml,
	fetchStreamPage,
	isSlotExhausted,
	parseTokens,
	type BrowserFingerprint,
	type CookieJar,
	type RawCapture,
	type WebTokens
} from './classroom-web';
import { describeHomeHtml, type HomeDiag } from './course-discovery';
import { errorMessage } from './http';
import { isVisible } from '#lib/course.ts';
import { getProfile, listAll, listByCourse } from './store';

export type ProbeError = { ok: false; code: 'cookie' | 'probe' | 'state'; message: string };

/** Pasted-cookie validation failure; carries its own code so routes never cast. */
export class CookieError extends Error {
	readonly code = 'cookie' as const;
}

const MAX_AUTHUSER_SLOTS = 5;

const PASTE_HINT =
	'Open DevTools → Network on classroom.google.com, right-click the first request → Copy → Copy as cURL, and paste the whole command here. Pasting just the Cookie header also works.';

/** Client-hint headers worth replaying, keyed by their header name. */
const FINGERPRINT_HEADER_KEYS = {
	'user-agent': 'userAgent',
	'sec-ch-ua': 'secChUa',
	'sec-ch-ua-mobile': 'secChUaMobile',
	'sec-ch-ua-platform': 'secChUaPlatform',
	'accept-language': 'acceptLanguage'
} as const;

const stripCookiePrefix = (value: string) => value.replace(/^cookie:\s*/i, '').trim();

/**
 * Parses header dumps from DevTools "Copy as cURL" (bash single quotes and
 * Windows double quotes) and "Copy as fetch" into a lowercase header map.
 * Returns null when the text is not a recognizable command, so the caller
 * can fall back to treating it as a plain Cookie header.
 */
function parseDevtoolsHeaders(text: string): Record<string, string> | null {
	const headers: Record<string, string> = {};
	if (/^curl\b/i.test(text)) {
		// Bash copy escapes inner quotes as \"; Windows uses \" around the
		// whole value, so unescape only inside double-quoted captures.
		const re = /(?:^|[\s^])-(?:H|--header)\s+(?:'([^']*)'|"((?:[^"\\]|\\.)*)")/g;
		for (const m of text.matchAll(re)) {
			const raw = (m[1] ?? m[2] ?? '').replace(/\\"/g, '"');
			const i = raw.indexOf(':');
			if (i > 0) headers[raw.slice(0, i).trim().toLowerCase()] = raw.slice(i + 1).trim();
		}
		return Object.keys(headers).length ? headers : null;
	}
	if (/^(?:await\s+)?fetch\(/i.test(text)) {
		const re = /"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
		for (const m of text.matchAll(re)) headers[m[1].toLowerCase()] = m[2].replace(/\\"/g, '"');
		return Object.keys(headers).length ? headers : null;
	}
	return null;
}

function pickFingerprint(headers: Record<string, string>): BrowserFingerprint | undefined {
	const browser: Record<string, string> = {};
	for (const [header, key] of Object.entries(FINGERPRINT_HEADER_KEYS)) {
		const value = headers[header];
		if (value) browser[key] = value;
	}
	return Object.keys(browser).length ? (browser as BrowserFingerprint) : undefined;
}

export type SessionPaste = { cookie: string; browser?: BrowserFingerprint };

/**
 * Canonical validation for a pasted cookie: a DevTools "Copy as cURL" or
 * "Copy as fetch" command, a `Cookie: …` header, or the bare cookie string.
 * Returns the cookie plus the real browser headers when the paste carries
 * them, so the session can replay the fingerprint it was minted with. Both
 * session routes share this so SID/SAPISID requirements never drift.
 */
export function parseSessionPaste(value: unknown): SessionPaste {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new CookieError(PASTE_HINT);
	const devtools = parseDevtoolsHeaders(text);
	if (devtools) {
		const cookie = stripCookiePrefix(devtools.cookie ?? '');
		if (!/(^|;\s*)SID=/.test(cookie))
			throw new CookieError(
				'That command has no Cookie header. Copy it from a signed-in classroom.google.com request.'
			);
		return { cookie, browser: pickFingerprint(devtools) };
	}
	// Plain cookie: strip the header-name prefix DevTools copies as `Cookie: SID=…`.
	const cookie = stripCookiePrefix(text);
	if (!/(^|;\s*)SID=/.test(cookie)) throw new CookieError(PASTE_HINT);
	return { cookie };
}

export function probeErrorMessage(err: unknown): ProbeError {
	if (err instanceof CookieError) return { ok: false, code: 'cookie', message: err.message };
	return { ok: false, code: 'probe', message: errorMessage(err) };
}

export type SlotProbe = {
	authuser: number;
	tokens?: WebTokens;
	email?: string;
	html?: string;
	path?: string;
	diag?: HomeDiag;
	courses?: { id: string; name: string }[];
	error?: string;
};

/** Enumerates account slots 0..maxSlots with a pasted cookie. Shared by both probes. */
async function listSlots(
	cookie: string,
	browser?: BrowserFingerprint,
	maxSlots = MAX_AUTHUSER_SLOTS
): Promise<{ jar: CookieJar; slots: SlotProbe[] }> {
	const jar: CookieJar = { cookie, browser };
	const slots: SlotProbe[] = [];
	for (let authuser = 0; authuser < maxSlots; authuser++) {
		try {
			const { html, path } = await fetchHomeHtml(jar, authuser);
			const tokens = parseTokens(html);
			// The home HTML is a JS shell with no course data; count courses
			// through the list RPC instead. A list failure still leaves a
			// signed-in slot — the diag line reports the shape for triage.
			let courses: { id: string; name: string }[] = [];
			try {
				courses = (await fetchCourseList(jar, authuser, tokens)).map(({ id, name }) => ({
					id,
					name
				}));
			} catch {
				/* keep the signed-in slot; courses stays empty */
			}
			slots.push({
				authuser,
				tokens,
				email: tokens.email,
				html,
				path,
				diag: describeHomeHtml(html),
				courses
			});
		} catch (err) {
			slots.push({ authuser, error: errorMessage(err) });
			if (isSlotExhausted(err)) break;
		}
	}
	return { jar, slots };
}

/**
 * Pure pick: prefer the first slot whose list RPC returned courses. Keeps the
 * network enumeration above separate so this choice is unit-testable.
 */
export function chooseSlotWithCourses(slots: SlotProbe[]): SlotProbe | undefined {
	let fallback: SlotProbe | undefined;
	for (const slot of slots) {
		if (slot.error || !slot.tokens) continue;
		fallback ??= slot;
		if ((slot.courses?.length ?? 0) > 0) return slot;
	}
	return fallback;
}

/**
 * Setup-path probe: verifies a pasted cookie loads Classroom without needing
 * synced courses. Tries account slots and keeps the first that lists courses
 * (not just the first signed-in slot: with multi-login the personal /u/0
 * slot usually signs in fine but holds no courses, which used to surface
 * later as "no courses were found on the Classroom home page").
 */
export async function probeSessionBase(
	cookie: string,
	browser?: BrowserFingerprint
): Promise<
	| {
			ok: true;
			authuser: number;
			email?: string;
			cookie: string;
			browser?: BrowserFingerprint;
			courseCount: number;
			code?: undefined;
	  }
	| { ok: false; message: string; code: string }
> {
	const { jar, slots } = await listSlots(cookie, browser);
	const hit = chooseSlotWithCourses(slots);
	if (hit?.tokens) {
		const courseCount = hit.courses?.length ?? 0;
		if (courseCount > 0)
			return {
				ok: true,
				authuser: hit.authuser,
				email: hit.email,
				cookie: jar.cookie,
				browser,
				courseCount
			};
		const fmt = (s: SlotProbe) => {
			const d = s.diag;
			const shape = d
				? `${Math.round(d.bytes / 1024)}KB links:${d.courseLinks} pairs:${d.idPairs} init:${d.initData}`
				: 'unparsed';
			return `/u/${s.authuser}/ = ${s.email} (${s.courses?.length ?? 0} courses, ${s.path ?? 'unknown path'}, ${shape})`;
		};
		const seen = slots.filter((s) => s.email).map(fmt);
		return {
			ok: false,
			code: 'cookie',
			message:
				`Signed in${hit.email ? ` as ${hit.email}` : ''}, but no courses were found on the Classroom ` +
				`home page (checked ${seen.join(', ') || 'no signed-in slots'}). ` +
				`If your courses live on a school account, paste a cookie from a window signed in ` +
				`with only that account, or report this line if courses are visible there.`
		};
	}
	return {
		ok: false,
		code: 'cookie',
		message: slots.at(-1)?.error ?? 'No signed-in Google account found in that cookie.'
	};
}

/**
 * Samples one stream page per course until a slot proves it can load posts.
 * Single-page reads only: this is a connectivity check, not a sync.
 */
export type ProbeAttempt = {
	authuser: number;
	email?: string;
	error?: string;
	courses: { id: string; name: string; items: number; raw?: RawCapture }[];
};

async function sampleSlot(
	jar: CookieJar,
	slot: SlotProbe & { tokens: WebTokens },
	courses: { id: string; name: string }[]
): Promise<{ ok: boolean; sample: number; courses: ProbeAttempt['courses']; error?: string }> {
	const sampled: ProbeAttempt['courses'] = [];
	let firstError: string | undefined;
	for (const course of courses) {
		const raw: RawCapture[] = [];
		try {
			const page = await fetchStreamPage(
				jar,
				slot.authuser,
				slot.tokens,
				course.id,
				10,
				undefined,
				raw
			);
			sampled.push({ id: course.id, name: course.name, items: page.items.length, raw: raw[0] });
			if (page.items.length > 0) return { ok: true, sample: page.items.length, courses: sampled };
		} catch (err) {
			sampled.push({ id: course.id, name: course.name, items: 0, raw: raw[0] });
			// A single course can fail while the slot is fine (e.g. an
			// archived or inaccessible course), so keep sampling the rest
			// and report the first error only if nothing loads.
			firstError ??= errorMessage(err);
			continue;
		}
	}
	return { ok: false, sample: 0, courses: sampled, error: firstError };
}

export type ProbeResult =
	| {
			ok: true;
			authuser: number;
			sample: number;
			cookie: string;
			browser?: BrowserFingerprint;
			attempts: ProbeAttempt[];
	  }
	| ({ ok: false; code: 'probe' | 'state'; attempts: ProbeAttempt[] } & { message: string });

/**
 * Single coercion point for "safe to log/return" probe results. Both probe
 * endpoints persist the cookie server-side and must never echo it back to
 * the client or into stored meta — strip it here instead of repeating the
 * destructure per route.
 */
export function withoutCookie<T extends { cookie?: string }>(result: T): Omit<T, 'cookie'> {
	const safe = { ...result };
	delete safe.cookie;
	return safe;
}

/**
 * Debug RPC captures (`raw` 600-char heads) prove connectivity but must never
 * leave the server: strip them before persisting to meta or returning to the
 * client. `withoutCookie` only strips the cookie.
 */
export function sanitizeProbeAttempts(attempts: ProbeAttempt[]): ProbeAttempt[] {
	return attempts.map((a) => ({
		...a,
		courses: a.courses.map(({ raw: _omitted, ...rest }) => rest)
	}));
}

/**
 * Settings-path probe: matches the cookie's account slots against already
 * synced courses (and the app profile email), sampling stream pages to prove
 * a slot can actually load posts.
 */
export async function probeSession(
	cookie: string,
	browser?: BrowserFingerprint
): Promise<ProbeResult> {
	const courses = listAll('courses').filter(isVisible);
	const attempts: ProbeAttempt[] = [];
	if (courses.length === 0)
		return {
			ok: false,
			code: 'state',
			message: 'Sync your courses first, then add the Classroom session.',
			attempts
		};
	const me = getProfile()?.email?.toLowerCase();
	const { jar, slots } = await listSlots(cookie, browser);
	const sample = courses
		.map((c) => ({ c, n: listByCourse('announcements', c.id).length }))
		.sort((a, b) => b.n - a.n)
		.slice(0, 3)
		.map((x) => x.c);
	for (const slot of slots) {
		const attempt: ProbeAttempt = { authuser: slot.authuser, courses: [] };
		attempts.push(attempt);
		if (!slot.tokens) {
			attempt.error = slot.error;
			continue;
		}
		attempt.email = slot.email;
		if (!slot.tokens.email) {
			attempt.error = 'That account slot exposed no email; skipping.';
			continue;
		}
		if (me && slot.tokens.email.toLowerCase() !== me) continue;
		const result = await sampleSlot(jar, slot as SlotProbe & { tokens: WebTokens }, sample);
		attempt.courses.push(...result.courses);
		if (result.error) attempt.error = result.error;
		if (result.ok)
			return {
				ok: true,
				authuser: slot.authuser,
				sample: result.sample,
				cookie: jar.cookie,
				browser,
				attempts
			};
	}
	const seen = attempts.filter((a) => a.email).map((a) => `/u/${a.authuser}/ = ${a.email}`);
	return {
		ok: false,
		code: 'probe',
		message: me
			? `None of the signed-in accounts (${seen.join(', ') || 'none found'}) could load posts as ${me}.`
			: `No signed-in account in that cookie could load posts (${seen.join(', ') || 'none found'}).`,
		attempts
	};
}
