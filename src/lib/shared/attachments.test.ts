import { test, expect } from 'bun:test';
import { hasRealMaterials, isDriveFolder } from './attachments';
import type { Attachment } from './types';

const folder = (authuser?: number): Attachment => ({
	type: 'drive',
	url:
		authuser === undefined
			? 'https://drive.google.com/drive/folders/abc'
			: `https://drive.google.com/u/${authuser}/drive/folders/abc`
});

test('isDriveFolder matches pinned and unpinned stream folder URLs only', () => {
	expect(isDriveFolder(folder())).toBe(true);
	expect(isDriveFolder(folder(1))).toBe(true);
	expect(isDriveFolder({ type: 'drive', url: 'https://drive.google.com/file/d/abc/view' })).toBe(
		false
	);
	expect(isDriveFolder({ type: 'link', url: 'https://drive.google.com/drive/folders/abc' })).toBe(
		false
	);
	expect(isDriveFolder({ type: 'drive' })).toBe(false);
});

test('hasRealMaterials: the auto-created folder alone does not count as attachments', () => {
	expect(hasRealMaterials([])).toBe(false);
	expect(hasRealMaterials([folder(0)])).toBe(false);
	expect(
		hasRealMaterials([folder(0), { type: 'drive', url: 'https://docs.google.com/document/d/x' }])
	).toBe(true);
	expect(hasRealMaterials([{ type: 'youtube' }])).toBe(true);
});
