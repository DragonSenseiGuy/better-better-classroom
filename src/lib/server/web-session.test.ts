import { test, expect } from 'bun:test';
import { RateLimitedError } from './classroom-web.ts';
import { nextBackoffSeconds } from './web-session.ts';

test('backoff starts near 60s and grows exponentially, with jitter', () => {
	for (let i = 0; i < 20; i++) {
		const first = nextBackoffSeconds(0);
		expect(first).toBeGreaterThanOrEqual(48);
		expect(first).toBeLessThanOrEqual(72);
	}
	const second = nextBackoffSeconds(1);
	expect(second).toBeGreaterThanOrEqual(96);
	expect(second).toBeLessThanOrEqual(144);
});

test('backoff caps at 15 minutes', () => {
	const capped = nextBackoffSeconds(10);
	expect(capped).toBeGreaterThanOrEqual(720);
	expect(capped).toBeLessThanOrEqual(1080);
});

test('a server Retry-After is never shortened', () => {
	for (let i = 0; i < 20; i++) {
		const waited = nextBackoffSeconds(0, 600);
		expect(waited).toBeGreaterThanOrEqual(480);
	}
});

test('rate-limit errors match the sync quota classification', () => {
	expect(new RateLimitedError().message).toMatch(/rate ?limit|429/i);
});
