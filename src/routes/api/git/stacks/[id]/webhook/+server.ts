import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGitStack } from '$lib/server/db';
import { deployGitStack } from '$lib/server/git';
import { auditGitStack } from '$lib/server/audit';
import crypto from 'node:crypto';

function verifySignature(payload: string, signature: string | null, secret: string): boolean {
	if (!signature) return false;

	// Support both GitHub and GitLab webhook signatures
	// GitHub: sha256=<hash>
	// GitLab: just the token value in X-Gitlab-Token header

	if (signature.startsWith('sha256=')) {
		const expectedSignature = 'sha256=' + crypto
			.createHmac('sha256', secret)
			.update(payload)
			.digest('hex');
		const sigBuf = Buffer.from(signature);
		const expectedBuf = Buffer.from(expectedSignature);
		if (sigBuf.length !== expectedBuf.length) return false;
		return crypto.timingSafeEqual(sigBuf, expectedBuf);
	}

	// GitLab uses X-Gitlab-Token which should match exactly
	return signature === secret;
}

function detectSource(request: Request): string {
	if (request.headers.get('x-hub-signature-256')) return 'github';
	if (request.headers.get('x-gitlab-token')) return 'gitlab';
	return 'unknown';
}

export const POST: RequestHandler = async (event) => {
	const { params, request } = event;
	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的堆栈 ID' }, { status: 400 });
		}

		const gitStack = await getGitStack(id);
		if (!gitStack) {
			return json({ error: 'Git 堆栈不存在' }, { status: 404 });
		}

		if (!gitStack.webhookEnabled) {
			return json({ error: '此堆栈未启用 Webhook' }, { status: 403 });
		}

		const source = detectSource(request);

		// Verify webhook secret if set
		if (gitStack.webhookSecret) {
			const payload = await request.text();
			const githubSignature = request.headers.get('x-hub-signature-256');
			const gitlabToken = request.headers.get('x-gitlab-token');

			const signature = githubSignature || gitlabToken;

			if (!verifySignature(payload, signature, gitStack.webhookSecret)) {
				await auditGitStack(event, 'webhook', id, gitStack.stackName, gitStack.environmentId, {
					method: 'POST', source, error: 'invalid_signature'
				});
				return json({ error: '无效的 Webhook 签名' }, { status: 401 });
			}
		}

		// Deploy the git stack (syncs and deploys only if there are changes)
		const result = await deployGitStack(id, { force: false });
		await auditGitStack(event, 'webhook', id, gitStack.stackName, gitStack.environmentId, {
			method: 'POST', source, result: result.skipped ? 'skipped' : result.success ? 'deployed' : 'failed'
		});
		return json(result);
	} catch (error: any) {
		console.error('Webhook 错误:', error);
		return json({ success: false, error: error.message }, { status: 500 });
	}
};

// Also support GET for simple polling/manual triggers
export const GET: RequestHandler = async (event) => {
	const { params, url } = event;
	try {
		const id = parseInt(params.id);
		if (isNaN(id)) {
			return json({ error: '无效的堆栈 ID' }, { status: 400 });
		}

		const gitStack = await getGitStack(id);
		if (!gitStack) {
			return json({ error: 'Git 堆栈不存在' }, { status: 404 });
		}

		if (!gitStack.webhookEnabled) {
			return json({ error: '此堆栈未启用 Webhook' }, { status: 403 });
		}

		// Verify secret via query parameter for GET requests
		const secret = url.searchParams.get('secret');
		if (gitStack.webhookSecret && secret !== gitStack.webhookSecret) {
			await auditGitStack(event, 'webhook', id, gitStack.stackName, gitStack.environmentId, {
				method: 'GET', source: 'get', error: 'invalid_secret'
			});
			return json({ error: '无效的 Webhook 密钥' }, { status: 401 });
		}

		// Deploy the git stack (syncs and deploys only if there are changes)
		const result = await deployGitStack(id, { force: false });
		await auditGitStack(event, 'webhook', id, gitStack.stackName, gitStack.environmentId, {
			method: 'GET', source: 'get', result: result.skipped ? 'skipped' : result.success ? 'deployed' : 'failed'
		});
		return json(result);
	} catch (error: any) {
		console.error('Webhook GET 错误:', error);
		return json({ success: false, error: error.message }, { status: 500 });
	}
};
