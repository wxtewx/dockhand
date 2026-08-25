/**
 * Assembles the final OpenAPI 3.0.3 document from discovered routes +
 * static analysis of every handler + (optional, additive) annotations.
 * Shared by `generate` and `--check` (check needs the assembled spec to
 * hand to the validators).
 *
 * Layering, cheapest to most precise:
 *   1. Auto-base   — path/method/tag/auth (always, from the route tree +
 *                     hooks.server.ts) PLUS parameters/responses/requestBody
 *                     derived from static analysis of the handler's own code
 *                     (query params via url.searchParams, status codes via
 *                     status:/error(), body fields via destructuring).
 *   2. JSDoc override — an `@openapi` block on the handler replaces/extends
 *                     the auto values with hand-authored summaries, exact
 *                     types, examples, and precise descriptions.
 * An un-annotated handler is therefore NOT a bare stub anymore — it shows
 * every parameter, status code, and body field the static analysis could
 * find in its own source, just with generic descriptions instead of
 * hand-written ones.
 */

import {
	type DiscoveredRoute,
	type HandlerAnnotation,
	type HttpMethod,
	type StaticAnalysis,
	analyzeHandlerBody,
	miniSchemaToOpenApi,
	splitMethodBodies,
	synthesizeExample
} from './lib';

export interface BuildSpecInput {
	routes: DiscoveredRoute[];
	fileContents: Map<string, string>;
	annotationsByPath: Record<string, Partial<Record<HttpMethod, HandlerAnnotation>>>;
	publicPaths: string[];
	isPublicFn: (path: string) => boolean;
	version: string;
}

function genericParamDescription(kind: 'path' | 'query', name: string): string {
	return `${kind === 'path' ? '路径' : '查询'} 参数 "${name}" (从处理器源码自动检测 — 该参数暂无 @openapi 注解)`;
}

export function buildSpec({ routes, fileContents, annotationsByPath, isPublicFn, version }: BuildSpecInput) {
	const paths: Record<string, Record<string, unknown>> = {};

	// Track auto-enrichment stats for the generator's own report (parameters
	// beyond path, responses beyond a single 200, or a requestBody — any of
	// which the static analysis contributed without a human writing a line).
	let autoParamsCount = 0;
	let autoMultiResponseCount = 0;
	let autoBodyCount = 0;

	for (const route of routes) {
		const pathItem = (paths[route.openapiPath] ??= {});
		const security = isPublicFn(route.openapiPath) ? [] : [{ cookieAuth: [] }, { bearerAuth: [] }];
		const content = fileContents.get(route.filePath);
		const bodies = content ? splitMethodBodies(content) : {};

		for (const method of route.methods) {
			const operationId = `${method.toLowerCase()}_${route.openapiPath.replace(/^\//, '').replace(/[{}]/g, '').replace(/\//g, '_')}`;
			const annotation = annotationsByPath[route.openapiPath]?.[method];
			const methodBody = bodies[method];
			const analysis: StaticAnalysis = methodBody
				? analyzeHandlerBody(methodBody, route.pathParams)
				: { queryParams: [], pathParamTypes: {}, statusCodes: [], bodyFields: [] };

			// --- parameters: auto path + auto query, JSDoc enriches/adds -------
			const pathParamAnnotations = annotation?.path ?? {};
			const parameters: Record<string, unknown>[] = route.pathParams.map((p) => {
				const enrich = pathParamAnnotations[p];
				const autoType = analysis.pathParamTypes[p]; // only set when inferred as non-string
				return {
					name: p,
					in: 'path',
					required: true,
					schema: { type: enrich?.type ?? autoType ?? 'string' },
					description: enrich?.description || genericParamDescription('path', p)
				};
			});

			// Query params: union of auto-detected (from code) and annotated
			// (JSDoc can also document a query param the static analysis missed,
			// e.g. a dynamically-built key). Annotation wins when both exist.
			const annotatedQueryNames = new Set(Object.keys(annotation?.query ?? {}));
			for (const q of analysis.queryParams) {
				if (annotatedQueryNames.has(q.name)) continue; // annotation takes precedence, added below
				parameters.push({
					name: q.name,
					in: 'query',
					required: false, // static analysis can't safely tell required vs optional for query params
					schema: { type: q.type },
					description: genericParamDescription('query', q.name)
				});
			}
			if (annotation) {
				for (const [name, q] of Object.entries(annotation.query)) {
					parameters.push({ name, in: 'query', required: q.required, schema: { type: q.type }, description: q.description });
				}
			}
			if (parameters.length > route.pathParams.length) autoParamsCount++;

			// --- responses: auto status codes, JSDoc enriches/adds ------------
			const responses: Record<string, Record<string, unknown>> = {};
			const annotatedCodes = new Set(Object.keys(annotation?.responses ?? {}));
			for (const code of analysis.statusCodes) {
				if (annotatedCodes.has(code)) continue; // annotation takes precedence, added below
				responses[code] = {
					description: code.startsWith('2')
						? '成功响应 (自动检测状态码 — 该响应暂无 @openapi 注解)'
						: '错误响应 (自动检测状态码 — 该响应暂无 @openapi 注解)'
				};
			}
			if (annotation) {
				for (const [code, resp] of Object.entries(annotation.responses)) {
					const entry: Record<string, unknown> = { description: resp.description };
					if (resp.schema) {
						const example = resp.example ?? synthesizeExample(resp.schema);
						entry.content = { 'application/json': { schema: miniSchemaToOpenApi(resp.schema), example } };
					}
					responses[code] = entry;
				}
			}
			const hasSuccessResponse = Object.keys(responses).some((code) => code.startsWith('2'));
			if (!hasSuccessResponse) {
				// Neither static analysis nor annotation found an explicit 2xx —
				// every SvelteKit handler that doesn't throw returns *some*
				// success response, so default to 200 rather than omit it.
				responses['200'] = { description: '成功响应' };
			}
			if (Object.keys(responses).length > 1) autoMultiResponseCount++;

			// --- requestBody: auto body fields (POST/PUT/PATCH only), JSDoc enriches/replaces ---
			let requestBody: Record<string, unknown> | undefined;
			if (annotation?.body) {
				const example = annotation.bodyExample ?? synthesizeExample(annotation.body);
				requestBody = {
					required: true,
					content: { 'application/json': { schema: miniSchemaToOpenApi(annotation.body), example } }
				};
			} else if (annotation?.bodyRaw) {
				// A non-JSON raw body (e.g. application/x-tar): binary string schema.
				const schema: Record<string, unknown> = { type: 'string', format: 'binary' };
				if (annotation.bodyRaw.description) schema.description = annotation.bodyRaw.description;
				requestBody = {
					required: true,
					content: { [annotation.bodyRaw.mediaType]: { schema } }
				};
			} else if (annotation?.bodyMultipart) {
				// A multipart/form-data body with a single (possibly array) file field.
				const mp = annotation.bodyMultipart;
				const fieldSchema: Record<string, unknown> = mp.array
					? { type: 'array', items: { type: mp.type === 'binary' ? 'string' : mp.type, format: mp.type === 'binary' ? 'binary' : undefined } }
					: { type: mp.type === 'binary' ? 'string' : mp.type, format: mp.type === 'binary' ? 'binary' : undefined };
				if (mp.description) fieldSchema.description = mp.description;
				requestBody = {
					required: true,
					content: {
						'multipart/form-data': {
							schema: {
								type: 'object',
								properties: { [mp.field]: fieldSchema },
								...(mp.required ? { required: [mp.field] } : {})
							}
						}
					}
				};
			} else if (['POST', 'PUT', 'PATCH'].includes(method) && analysis.bodyFields.length > 0) {
				const properties = Object.fromEntries(analysis.bodyFields.map((f) => [f, { type: 'string' }]));
				requestBody = {
					required: false, // static analysis can't tell which destructured fields are actually required
					content: {
						'application/json': {
							schema: {
								type: 'object',
								properties,
								description:
									'从处理器请求体解构赋值自动检测字段 — 通用字符串类型，该请求体暂无 @openapi 注解。'
							}
						}
					}
				};
			}
			if (requestBody) autoBodyCount++;

			const operation: Record<string, unknown> = {
				operationId,
				tags: [route.tag],
				summary: annotation?.summary ?? `${method} ${route.openapiPath} (自动生成 — 暂无 @openapi 注解)`,
				parameters,
				responses,
				security
			};
			if (annotation?.description) operation.description = annotation.description;
			if (requestBody) operation.requestBody = requestBody;

			pathItem[method.toLowerCase()] = operation;
		}
	}

	const spec = {
		openapi: '3.0.3',
		info: {
			title: 'Dockhand API',
			version,
			description:
				'A由 scripts/generate-openapi.ts 从 src/routes/**/+server.ts 自动生成。 ' +
				'路径、HTTP 请求方法、标签与鉴权要求将从路由目录树和 hooks.server.ts 的 PUBLIC_PATHS 自动获取。参数、响应状态码、请求体字段额外从各处理器源码自动检测（查询参数通过 url.searchParams，状态码通过 status:/error()，请求体字段通过解构赋值）——因此新增接口无需手动编辑规范即可展示真实参数与响应。处理器上可选附加 `@openapi` JSDoc 注解，可替换通用自动描述，支持自定义摘要、精确类型与示例。'
		},
		servers: [{ url: '/' }],
		tags: Array.from(new Set(routes.map((r) => r.tag)))
			.sort()
			.map((t) => ({ name: t })),
		components: {
			securitySchemes: {
				cookieAuth: {
					type: 'apiKey',
					in: 'cookie',
					name: 'dockhand_session',
					description: '登录时设置的会话 Cookie (src/lib/server/auth.ts validateSession)。'
				},
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'dh_<43-char base64url>',
					description:
						'用户范围 API 令牌（src/lib/server/api-tokens.ts）。仅在 /api/* 和 /metrics 路由下，不存在会话 Cookie 时生效 (src/hooks.server.ts)。频率限制：单个 IP 连续 10 次失败后，5 分钟内返回 429。'
				}
			}
		},
		security: [{ cookieAuth: [] }, { bearerAuth: [] }],
		paths
	};

	return { spec, stats: { autoParamsCount, autoMultiResponseCount, autoBodyCount } };
}
