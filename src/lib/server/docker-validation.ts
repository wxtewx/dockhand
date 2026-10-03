import { json } from '@sveltejs/kit';

/**
 * Checks if a value contains path traversal or injection characters.
 * Rejects: .., /, \, null bytes, % (catches double-encoding).
 */
function containsPathTraversal(value: string): boolean {
	return value.includes('..') || value.includes('/') || value.includes('\\') || value.includes('\0') || value.includes('%');
}

/**
 * Validates a Docker resource ID/name from URL params.
 * Returns a 400 Response if invalid, null if valid.
 */
export function validateDockerIdParam(id: string, resourceType = 'resource'): Response | null {
	if (!id || containsPathTraversal(id)) {
		return json({ error: `${resourceType} ID 无效` }, { status: 400 });
	}
	return null;
}

/**
 * Validates a restic snapshot ID (hex string, 8-64 chars).
 * Returns a 400 Response if invalid, null if valid.
 */
export function validateSnapshotId(id: string): Response | null {
	if (!id || !/^[0-9a-f]{8,64}$/.test(id)) {
		return json({ error: '无效快照 ID' }, { status: 400 });
	}
	return null;
}
