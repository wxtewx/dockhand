/**
 * Validate a chown owner spec (`user`, `user:group`, `uid`, `uid:gid`) before it
 * reaches `docker exec chown`. Pure so it is unit-testable and shared by the
 * create/upload/chown paths. Rejects anything that isn't a plain user/group
 * token, so nothing shell-special or path-like can be injected into the argv.
 */

// A single user or group token: a numeric id, or a name (letters, digits, and the
// usual account punctuation `_ - .`, starting with a letter/digit/underscore).
const TOKEN = /^\w[A-Za-z0-9_.-]*$/;

export interface ChownSpec {
	/** The exact `owner[:group]` string to pass to chown. */
	value: string;
}

/**
 * Parse and validate an owner spec. Returns { value } on success, or { error }.
 * Accepts "user", "user:group", "uid", "uid:gid"; a bare token means owner only.
 */
export function parseChownSpec(input: string | null | undefined): ChownSpec | { error: string } {
	if (input == null) return { error: '必须填写所有者' };
	const raw = String(input).trim();
	if (!raw) return { error: '必须填写所有者' };
	if (raw.length > 128) return { error: '所有者内容过长' };

	const parts = raw.split(':');
	if (parts.length > 2) return { error: '所有者格式必须为 "用户" 或者 "用户:组"' };

	const [owner, group] = parts;
	if (!TOKEN.test(owner)) return { error: `无效的用户 "${owner}"` };
	if (group !== undefined && !TOKEN.test(group)) return { error: `无效的用户组 "${group}"` };

	// Normalise: bare owner stays owner-only (chown leaves the group untouched).
	return { value: group !== undefined ? `${owner}:${group}` : owner };
}
