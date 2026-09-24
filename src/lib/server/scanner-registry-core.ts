/**
 * Pure helpers for the registry-scan fallback (no docker/db imports, unit-tested).
 *
 * On a containerd/OCI image store, `docker save` can silently emit a tar whose
 * index references layer blobs that are not in the archive, so grype/trivy fail
 * with "blob not found in tar". The fix is to re-scan straight from the registry
 * (grype `registry:<ref>`, trivy without the daemon socket), which bypasses the
 * broken daemon export. These helpers classify that failure and shape the
 * registry-mode command + auth env.
 */

export type ScannerType = 'grype' | 'trivy';

/**
 * True when a scanner's output/error is the containerd daemon-export blob bug,
 * i.e. the daemon handed the scanner an incomplete tar. Matched by the stable
 * substrings both scanners print (grype via stereoscope, trivy via its analyzer).
 * Deliberately narrow: it must NOT match an auth/network failure, so the fallback
 * only fires for the export bug.
 */
export function isDaemonExportFailure(output: string | null | undefined): boolean {
	if (!output) return false;
	const s = output.toLowerCase();
	return (
		s.includes('unable to provide image from tarball') || // grype/stereoscope
		(s.includes('unable to get uncompressed layer') && s.includes('failed to analyze layer')) || // trivy
		(s.includes('does not exist') && s.includes('blobs/sha256/')) // "file blobs/sha256/... does not exist"
	);
}

/**
 * Rewrite a daemon-mode scanner command into a registry-mode one for the same image.
 * grype needs the source prefix `registry:<image>`; trivy scans the registry ref
 * as-is once the docker socket is absent, so only the image token needs to be the
 * plain ref (it already is). The image token is identified by exact match against
 * `image` (parseCliArgs substitutes {image} with the ref verbatim).
 */
export function toRegistryScanCmd(scannerType: ScannerType, cmd: string[], image: string): string[] {
	return cmd.map((tok) => {
		if (tok !== image) return tok;
		return scannerType === 'grype' ? `registry:${image}` : image;
	});
}

/**
 * Registry credentials as scanner env vars. grype reads GRYPE_REGISTRY_AUTH_*;
 * trivy reads TRIVY_USERNAME/TRIVY_PASSWORD. `authority` is the registry host so
 * grype scopes the credential to it. Returns [] when creds is null (public image,
 * anonymous access - same as before this fix).
 */
export function registryAuthEnv(
	scannerType: ScannerType,
	creds: { username: string; password: string } | null,
	authority?: string,
): string[] {
	if (!creds) return [];
	if (scannerType === 'grype') {
		const env = [
			`GRYPE_REGISTRY_AUTH_USERNAME=${creds.username}`,
			`GRYPE_REGISTRY_AUTH_PASSWORD=${creds.password}`,
		];
		if (authority) env.push(`GRYPE_REGISTRY_AUTH_AUTHORITY=${authority}`);
		return env;
	}
	return [
		`TRIVY_USERNAME=${creds.username}`,
		`TRIVY_PASSWORD=${creds.password}`,
	];
}

/**
 * Per-environment memory of "this daemon's image store loses blobs on export, so
 * skip the daemon path and scan straight from the registry". Keyed by the scan's
 * environment (envId, or the 'local' sentinel). Sticky for the process lifetime:
 * once a blob-export failure is seen for an env, every later scan on that env goes
 * registry-first, avoiding the ~15-50s wasted on a doomed `docker save`. Reset on
 * Dockhand restart so a fixed store returns to the fast daemon path automatically.
 * In-memory only - no DB, no migration.
 */
export class RegistryFallbackMemory {
	private readonly envs = new Set<string>();
	private key(envId: number | null | undefined): string {
		return envId == null ? 'local' : String(envId);
	}
	/** True if this env is known-broken and should scan registry-first. */
	prefersRegistry(envId: number | null | undefined): boolean {
		return this.envs.has(this.key(envId));
	}
	/** Record that this env's daemon export is broken (blob-loss seen). */
	markBroken(envId: number | null | undefined): void {
		this.envs.add(this.key(envId));
	}
	/** Test/reset hook. */
	clear(): void {
		this.envs.clear();
	}
}

/**
 * The registry host (authority) of an image ref, or null for an implicit-Docker-Hub
 * ref (no host component). Used to scope grype's registry auth. A host is the first
 * path segment only when it contains a '.' or ':' (or is 'localhost') - the Docker
 * ref grammar for distinguishing a registry from a Docker Hub org.
 */
export function imageRegistryAuthority(image: string): string | null {
	const firstSlash = image.indexOf('/');
	if (firstSlash === -1) return null; // e.g. "alpine:latest" -> Docker Hub
	const head = image.slice(0, firstSlash);
	if (head === 'localhost' || head.includes('.') || head.includes(':')) return head;
	return null; // e.g. "library/alpine" -> Docker Hub org, not a registry host
}
