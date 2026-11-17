import type { Attachment } from './types';

/**
 * True for the auto-created per-assignment Drive folder that the stream
 * carries on every coursework item. Classroom shows it as a material, but
 * it is not one the teacher chose — the post's real attachments live in a
 * separate details RPC (t51ITc), so callers must not treat the folder alone
 * as "has attachments".
 */
export function isDriveFolder(a: Attachment): boolean {
	return (
		a.type === 'drive' &&
		!!a.url &&
		/^https:\/\/drive\.google\.com\/(u\/\d+\/)?drive\/folders\//.test(a.url)
	);
}

/** Whether `materials` holds anything beyond the auto-created Drive folder. */
export function hasRealMaterials(materials: Attachment[]): boolean {
	return materials.some((m) => !isDriveFolder(m));
}
