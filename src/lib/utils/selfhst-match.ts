// Pure image-name -> selfh.st reference matcher. Conservative by design: a
// confident hit returns the reference, anything uncertain returns null so the UI
// keeps its generic icon (never a wrong logo). Memoized per image string so a
// list of 100 containers costs one lookup per unique image, not per render.

/**
 * Aliases ONLY for cases where the Docker image basename differs from the selfh.st
 * Reference. An image whose basename already IS a known reference (redis, grafana,
 * sonarr, ...) needs no entry - resolveBase() falls back to an exact match. Keep this
 * small and high-confidence. There is deliberately no fuzzy/substring fallback (it
 * mis-badges, e.g. `redis-exporter` -> `redis`).
 */
const IMAGE_ALIASES: Record<string, string> = {
	'pms-docker': 'plex',
	'plexinc': 'plex',
	'homeassistant': 'home-assistant',
	'hass': 'home-assistant',
	'pihole': 'pi-hole',
	'adguardhome': 'adguard-home',
	'portainer-ce': 'portainer',
	'portainer-ee': 'portainer',
	'qbittorrentvpn': 'qbittorrent',
	'postgres': 'postgresql',
	'mongo': 'mongodb'
};

/**
 * Reduce a full image reference to its lowercase basename, dropping registry
 * host, namespace, tag and digest. `lscr.io/linuxserver/sonarr:latest` -> `sonarr`.
 */
export function imageBasename(image: string): string {
	let s = (image || '').trim().toLowerCase();
	if (!s) return '';
	// strip digest, then tag
	s = s.split('@')[0];
	const lastColon = s.lastIndexOf(':');
	const lastSlash = s.lastIndexOf('/');
	if (lastColon > lastSlash) s = s.slice(0, lastColon);
	// basename after the last slash
	s = s.slice(lastSlash + 1);
	return s;
}

/** Drop separators so `thelounge` can match the reference `the-lounge`. */
function stripSeparators(s: string): string {
	return s.replace(/[-_]/g, '');
}

/**
 * A base is matched to a reference by: alias table, exact match, then a
 * separator-insensitive match (image basenames drop the hyphens the selfh.st
 * Reference keeps, e.g. `thelounge` -> `the-lounge`, `homeassistant` -> `home-assistant`).
 * The separator match is equality-after-normalization, NOT a substring/fuzzy guess, so it
 * never mis-badges (`redisexporter` has no reference and stays unmatched); the real
 * manifest has zero refs that collapse to the same separator-stripped key, so the map is
 * unambiguous. `separatorless` is prebuilt from knownRefs so the lookup stays O(1).
 */
function resolveBase(
	base: string,
	knownRefs: Set<string>,
	separatorless: Map<string, string>
): string | null {
	if (!base) return null;
	const alias = IMAGE_ALIASES[base];
	if (alias && knownRefs.has(alias)) return alias;
	if (knownRefs.has(base)) return base;
	const stripped = stripSeparators(base);
	if (!stripped) return null; // an all-separator base ("---") must not match a "" key
	const collapsed = separatorless.get(stripped);
	if (collapsed) return collapsed;
	return null;
}

/** Build the separator-stripped -> reference lookup for a manifest's reference set. */
function buildSeparatorlessMap(knownRefs: Set<string>): Map<string, string> {
	const map = new Map<string, string>();
	for (const ref of knownRefs) map.set(stripSeparators(ref), ref);
	return map;
}

/** Match a Docker image reference to a selfh.st Reference (by its basename). */
export function matchSelfhstRef(
	image: string,
	knownRefs: Set<string>,
	separatorless: Map<string, string> = buildSeparatorlessMap(knownRefs)
): string | null {
	return resolveBase(imageBasename(image), knownRefs, separatorless);
}

/**
 * Normalize a container name to a candidate reference: drop a leading slash and the
 * compose replica suffix (`-1` / `_1`), lowercase. `/immich_server_1` -> `immich_server`,
 * `/traefik-1` -> `traefik`.
 */
export function containerNameBase(name: string): string {
	let s = (name || '').trim().toLowerCase();
	if (!s) return '';
	if (s.startsWith('/')) s = s.slice(1);
	// compose appends a numeric replica index: web-1, db_1
	s = s.replace(/[-_]\d+$/, '');
	return s;
}

/**
 * Fallback match by CONTAINER NAME when the image did not resolve (e.g. an image pinned
 * by digest with no readable tag). Same confidence bar as the image path: alias table,
 * then exact name == reference. No fuzzy guessing - a generic name like `web` or `app`
 * that isn't a known reference stays unmatched.
 */
export function matchSelfhstByName(
	name: string,
	knownRefs: Set<string>,
	separatorless: Map<string, string> = buildSeparatorlessMap(knownRefs)
): string | null {
	return resolveBase(containerNameBase(name), knownRefs, separatorless);
}

/**
 * Build a memoized matcher bound to a manifest's reference set. Resolves by image first
 * (authoritative), then falls back to the container name when the image did not match.
 * Memoized per (image, name) pair so a list of 100 containers costs one lookup per unique
 * pair, not per render.
 */
export function createSelfhstMatcher(
	knownRefs: Set<string>
): (image: string, name?: string) => string | null {
	const cache = new Map<string, string | null>();
	const separatorless = buildSeparatorlessMap(knownRefs);
	return (image: string, name = '') => {
		const key = `${image} ${name}`;
		if (cache.has(key)) return cache.get(key)!;
		const ref =
			matchSelfhstRef(image, knownRefs, separatorless) ??
			matchSelfhstByName(name, knownRefs, separatorless);
		cache.set(key, ref);
		return ref;
	};
}
