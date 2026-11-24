/**
 * TLS options for an LDAP client. The server certificate is always verified; a configured
 * CA becomes the trust anchor (for a private directory CA) instead of turning checking off.
 * LDAP_TLS_SKIP_VERIFY=true is the operator's explicit way out for a directory whose
 * certificate cannot be fixed yet: it turns verification off and says so in the log.
 */
export function ldapTlsSkipVerify(raw: string | undefined = process.env.LDAP_TLS_SKIP_VERIFY): boolean {
	return raw?.trim().toLowerCase() === 'true';
}

let warned = false;

export function ldapTlsOptions(
	tlsCa: string | null | undefined,
	skipVerify: boolean = ldapTlsSkipVerify()
): { rejectUnauthorized: boolean; ca?: string[] } {
	if (skipVerify) {
		if (!warned) {
			warned = true;
			console.warn(
				'[LDAP] LDAP_TLS_SKIP_VERIFY=true：不会校验目录服务器证书。任何位于 Dockhand 与 LDAP 服务器之间的主体都可以读取登录用户的密码。请修复证书或配置的 CA 并移除此配置项。'
			);
		}
		return { rejectUnauthorized: false };
	}
	return tlsCa ? { rejectUnauthorized: true, ca: [tlsCa] } : { rejectUnauthorized: true };
}
