import { test, expect } from 'bun:test';
import { dueAt, updatedAtMs } from './time';

const iso = (n: number) => new Date(n).toISOString();

test('updatedAtMs prefers updateTime over creationTime', () => {
	expect(updatedAtMs(iso(1789395973678), iso(1789500000000))).toBe(1789500000000);
});

test('updatedAtMs falls back to creationTime when updateTime is missing', () => {
	expect(updatedAtMs(iso(1789395973678), undefined)).toBe(1789395973678);
});

test('updatedAtMs is 0 only when both times are missing', () => {
	expect(updatedAtMs(undefined, undefined)).toBe(0);
});

// The web record source hands sync the UTC components of the due instant it
// captured from the stream, so this round-trip must be exact.
test('dueAt round-trips the UTC components of a due instant', () => {
	const instant = 1794585540000; // 2026-11-13T04:59:00Z = Nov 13, 11:59 PM EST
	const d = new Date(instant);
	expect(
		dueAt(
			{ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() },
			{ hours: d.getUTCHours(), minutes: d.getUTCMinutes() }
		)
	).toEqual({ dueAt: instant, hasDueTime: true });
});
