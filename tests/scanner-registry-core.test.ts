import { describe, test, expect } from 'bun:test';
import {
	isDaemonExportFailure,
	toRegistryScanCmd,
	registryAuthEnv,
	imageRegistryAuthority,
	RegistryFallbackMemory,
} from '../src/lib/server/scanner-registry-core';

// Real failure output taken verbatim from issue #1569 / #1350 logs.
const GRYPE_BLOB_FAIL =
	`[0000] INFO gathered packages packages=0\n` +
	`[0000] ERROR failed to catalog: errors occurred attempting to resolve 'oci.jeuznetwork.net/poi/starboard-discord-bot:latest':\n` +
	` - snap: snap file "oci.jeuznetwork.net/poi/starboard-discord-bot:latest" does not exist\n` +
	` - docker: unable to provide image from tarball: file blobs/sha256/59a242dc0cb5 does not exist`;

const TRIVY_BLOB_FAIL =
	`FATAL Fatal error run error: image scan error: scan error: scan failed: failed analysis: ` +
	`analyze error: pipeline error: failed to analyze layer (sha256:06cfb6): unable to get uncompressed layer ` +
	`sha256:06cfb6: unable to open: failed to initialize the struct from the temporary file: file blobs/sha256/59a242 `;

const AUTH_FAIL =
	`oci-model: failed to fetch descriptor: GET https://oci.jeuznetwork.net/v2/poi/starboard-discord-bot/manifests/latest: ` +
	`unexpected status code 401 Unauthorized: {"code":"UNAUTHORIZED","message":"authentication required"}`;

describe('isDaemonExportFailure', () => {
	test('matches the grype tarball-missing-blob failure', () => {
		expect(isDaemonExportFailure(GRYPE_BLOB_FAIL)).toBe(true);
	});
	test('matches the trivy uncompressed-layer failure', () => {
		expect(isDaemonExportFailure(TRIVY_BLOB_FAIL)).toBe(true);
	});
	test('does NOT match a 401 auth failure (fallback must not fire on auth errors)', () => {
		expect(isDaemonExportFailure(AUTH_FAIL)).toBe(false);
	});
	test('does NOT match a clean/empty output', () => {
		expect(isDaemonExportFailure('')).toBe(false);
		expect(isDaemonExportFailure(null)).toBe(false);
		expect(isDaemonExportFailure('gathered packages packages=184')).toBe(false);
	});
	test('does NOT match a generic network error', () => {
		expect(isDaemonExportFailure('dial tcp: connection refused')).toBe(false);
	});
	test('does NOT match on the bare phrase "not found in tar" without the blob context', () => {
		// The signature must be specific to the blob-export bug; a stray "not found in
		// tar" in some other error must not trigger a registry fallback + mark-broken.
		expect(isDaemonExportFailure('some archive entry not found in tar listing')).toBe(false);
	});
});

describe('toRegistryScanCmd', () => {
	const IMG = 'oci.jeuznetwork.net/poi/starboard-discord-bot:latest';
	test('grype: prefixes the image token with registry:', () => {
		const daemon = ['-o', 'json', '-v', IMG];
		expect(toRegistryScanCmd('grype', daemon, IMG)).toEqual(['-o', 'json', '-v', `registry:${IMG}`]);
	});
	test('trivy: leaves the image token as the plain ref', () => {
		const daemon = ['image', '--format', 'json', IMG];
		expect(toRegistryScanCmd('trivy', daemon, IMG)).toEqual(['image', '--format', 'json', IMG]);
	});
	test('only the exact image token is rewritten, not a flag that contains it', () => {
		const daemon = ['-o', 'json', IMG];
		const out = toRegistryScanCmd('grype', daemon, IMG);
		expect(out.filter((t) => t.startsWith('registry:')).length).toBe(1);
		expect(out[0]).toBe('-o');
		expect(out[1]).toBe('json');
	});
});

describe('registryAuthEnv', () => {
	const creds = { username: 'poi', password: 's3cret' };
	test('grype: GRYPE_REGISTRY_AUTH_* with authority', () => {
		expect(registryAuthEnv('grype', creds, 'oci.jeuznetwork.net')).toEqual([
			'GRYPE_REGISTRY_AUTH_USERNAME=poi',
			'GRYPE_REGISTRY_AUTH_PASSWORD=s3cret',
			'GRYPE_REGISTRY_AUTH_AUTHORITY=oci.jeuznetwork.net',
		]);
	});
	test('trivy: TRIVY_USERNAME/PASSWORD', () => {
		expect(registryAuthEnv('trivy', creds)).toEqual(['TRIVY_USERNAME=poi', 'TRIVY_PASSWORD=s3cret']);
	});
	test('null creds -> no auth env (public image, anonymous)', () => {
		expect(registryAuthEnv('grype', null, 'ghcr.io')).toEqual([]);
		expect(registryAuthEnv('trivy', null)).toEqual([]);
	});
	test('grype without authority omits the AUTHORITY var', () => {
		expect(registryAuthEnv('grype', creds)).toEqual([
			'GRYPE_REGISTRY_AUTH_USERNAME=poi',
			'GRYPE_REGISTRY_AUTH_PASSWORD=s3cret',
		]);
	});
});

describe('imageRegistryAuthority', () => {
	test('private registry host with dot', () => {
		expect(imageRegistryAuthority('oci.jeuznetwork.net/poi/bot:latest')).toBe('oci.jeuznetwork.net');
	});
	test('ghcr.io', () => {
		expect(imageRegistryAuthority('ghcr.io/mealie-recipes/mealie:latest')).toBe('ghcr.io');
	});
	test('host with port', () => {
		expect(imageRegistryAuthority('registry.bor6.pl:5000/app:tag')).toBe('registry.bor6.pl:5000');
	});
	test('localhost', () => {
		expect(imageRegistryAuthority('localhost:5000/app')).toBe('localhost:5000');
	});
	test('implicit Docker Hub (no host) -> null', () => {
		expect(imageRegistryAuthority('alpine:latest')).toBeNull();
		expect(imageRegistryAuthority('library/alpine:latest')).toBeNull();
	});
});

describe('RegistryFallbackMemory', () => {
	test('an unseen env prefers the daemon path (not registry)', () => {
		const m = new RegistryFallbackMemory();
		expect(m.prefersRegistry(5)).toBe(false);
		expect(m.prefersRegistry(null)).toBe(false);
	});
	test('once marked broken, that env prefers registry on later scans', () => {
		const m = new RegistryFallbackMemory();
		m.markBroken(5);
		expect(m.prefersRegistry(5)).toBe(true);
	});
	test('is per-env: marking one env does not affect another', () => {
		const m = new RegistryFallbackMemory();
		m.markBroken(5);
		expect(m.prefersRegistry(7)).toBe(false);
		expect(m.prefersRegistry(null)).toBe(false);
	});
	test('the local sentinel (null/undefined) is its own env and is stable', () => {
		const m = new RegistryFallbackMemory();
		m.markBroken(null);
		expect(m.prefersRegistry(null)).toBe(true);
		expect(m.prefersRegistry(undefined)).toBe(true);
		expect(m.prefersRegistry(1)).toBe(false);
	});
	test('clear resets everything (restart semantics)', () => {
		const m = new RegistryFallbackMemory();
		m.markBroken(5);
		m.clear();
		expect(m.prefersRegistry(5)).toBe(false);
	});
});
