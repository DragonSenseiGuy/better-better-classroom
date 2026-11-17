import { test, expect } from 'bun:test';
import {
	chooseSlotWithCourses,
	CookieError,
	parseSessionPaste,
	probeErrorMessage,
	sanitizeProbeAttempts,
	withoutCookie
} from './web-probe.ts';
import { fingerprintHeaders } from './classroom-web.ts';

test('accepts a full cookie header and strips a Cookie: prefix', () => {
	expect(parseSessionPaste('SID=a; SAPISID=b').cookie).toBe('SID=a; SAPISID=b');
	expect(parseSessionPaste('Cookie: SID=a; SAPISID=b').cookie).toBe('SID=a; SAPISID=b');
	expect(parseSessionPaste('SID=a; SAPISID=b').browser).toBeUndefined();
});

test('rejects pasted values without SID', () => {
	expect(() => parseSessionPaste('SSID=a; SAPISID=b')).toThrow(CookieError);
	expect(() => parseSessionPaste(undefined)).toThrow(CookieError);
	expect(() => parseSessionPaste('')).toThrow(CookieError);
});

const CURL_BASH = `curl 'https://classroom.google.com/u/0/h/st' \\
  -H 'cookie: SID=a; HSID=h; SSID=s; APISID=p; SAPISID=b' \\
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0) Chrome/141.0.0.0 Safari/537.36' \\
  -H 'sec-ch-ua: "Google Chrome";v="141", "Not?A_Brand";v="99"' \\
  -H 'sec-ch-ua-mobile: ?0' \\
  -H 'sec-ch-ua-platform: "Windows"' \\
  -H 'accept-language: en-US,en;q=0.9' \\
  --compressed`;

const CURL_WINDOWS = `curl "^https://classroom.google.com/u/0/h/st^" `
	+ `-H "cookie: SID=a; SAPISID=b" `
	+ `-H "user-agent: Mozilla/5.0 Chrome/120.0.0.0" `
	+ `-H "sec-ch-ua-platform: \\"macOS\\""`; // prettier-ignore

const FETCH_PASTE = `fetch("https://classroom.google.com/u/0/h/st", {
  "headers": {
    "accept": "text/html",
    "cookie": "SID=a; SAPISID=b",
    "user-agent": "Mozilla/5.0 Firefox/140.0"
  },
  "body": null,
  "method": "GET"
});`;

test('parses a copied cURL command into cookie and browser fingerprint', () => {
	const parsed = parseSessionPaste(CURL_BASH);
	expect(parsed.cookie).toBe('SID=a; HSID=h; SSID=s; APISID=p; SAPISID=b');
	expect(parsed.browser).toEqual({
		userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/141.0.0.0 Safari/537.36',
		secChUa: '"Google Chrome";v="141", "Not?A_Brand";v="99"',
		secChUaMobile: '?0',
		secChUaPlatform: '"Windows"',
		acceptLanguage: 'en-US,en;q=0.9'
	});
});

test('parses the Windows Copy as cURL quoting', () => {
	const parsed = parseSessionPaste(CURL_WINDOWS);
	expect(parsed.cookie).toBe('SID=a; SAPISID=b');
	expect(parsed.browser).toEqual({
		userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
		secChUaPlatform: '"macOS"'
	});
});

test('parses a Copy as fetch paste', () => {
	const parsed = parseSessionPaste(FETCH_PASTE);
	expect(parsed.cookie).toBe('SID=a; SAPISID=b');
	expect(parsed.browser).toEqual({ userAgent: 'Mozilla/5.0 Firefox/140.0' });
});

test('rejects a cURL paste with no cookie header', () => {
	expect(() =>
		parseSessionPaste(`curl 'https://classroom.google.com/' -H 'accept: text/html'`)
	).toThrow(CookieError);
});

test('fingerprintHeaders overrides only the stored fields', () => {
	expect(fingerprintHeaders(undefined)).toEqual({});
	expect(
		fingerprintHeaders({ userAgent: 'UA', secChUaPlatform: 'Linux', acceptLanguage: 'de' })
	).toEqual({ 'user-agent': 'UA', 'sec-ch-ua-platform': 'Linux', 'accept-language': 'de' });
});

test('maps CookieError to a cookie-coded probe error', () => {
	expect(probeErrorMessage(new CookieError('Paste it all'))).toEqual({
		ok: false,
		code: 'cookie',
		message: 'Paste it all'
	});
});

test('maps unknown failures to a probe-coded error', () => {
	expect(probeErrorMessage(new Error('boom'))).toEqual({
		ok: false,
		code: 'probe',
		message: 'boom'
	});
});

test('withoutCookie strips the cookie and keeps the rest', () => {
	expect(withoutCookie({ ok: true, authuser: 1, cookie: 'SID=secret' })).toEqual({
		ok: true,
		authuser: 1
	});
});

test('sanitizeProbeAttempts strips raw captures but keeps counts', () => {
	expect(
		sanitizeProbeAttempts([
			{
				authuser: 0,
				email: 'a@x.com',
				courses: [{ id: '1', name: 'Bio', items: 3, raw: { status: 200, head: 'h' } }]
			}
		])
	).toEqual([{ authuser: 0, email: 'a@x.com', courses: [{ id: '1', name: 'Bio', items: 3 }] }]);
});

test('chooseSlotWithCourses skips a signed-in slot with no courses', () => {
	const tokens = (email?: string) => ({ at: 'a', fsid: 'f', bl: 'b', email });
	expect(
		chooseSlotWithCourses([
			{ authuser: 0, tokens: tokens('me@personal.com'), email: 'me@personal.com', courses: [] },
			{
				authuser: 1,
				tokens: tokens('me@school.edu'),
				email: 'me@school.edu',
				courses: [{ id: '123456789012', name: 'Biology 101' }]
			}
		])?.authuser
	).toBe(1);
});

test('chooseSlotWithCourses falls back to the first signed-in slot when none list courses', () => {
	const tokens = { at: 'a', fsid: 'f', bl: 'b', email: 'me@x.com' };
	expect(
		chooseSlotWithCourses([
			{ authuser: 0, tokens, email: 'me@x.com', courses: [] },
			{ authuser: 1, error: 'nope' }
		])?.authuser
	).toBe(0);
});
