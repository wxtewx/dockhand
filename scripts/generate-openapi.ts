#!/usr/bin/env node
/**
 * OpenAPI 3.0 generator / CI-checker / annotation-scaffolder for Dockhand.
 *
 * Runs under plain Node via tsx (no Bun-specific APIs) — see the
 * "generate:openapi"/"generate:openapi:check" scripts in package.json.
 *
 * Three modes, one engine (scripts/openapi/{lib,build-spec}.ts):
 *
 *   npx tsx scripts/generate-openapi.ts                 -> writes static/openapi.json
 *   npx tsx scripts/generate-openapi.ts --check          -> CI gate, exits non-zero on drift
 *   npx tsx scripts/generate-openapi.ts --check --strict-coverage
 *                                                         -> also fails on <100% @openapi coverage
 *   npx tsx scripts/generate-openapi.ts --scaffold <file> -> prints a code-grounded JSDoc draft
 *                                                            for every un-annotated handler in <file>
 *
 * Path/method/tag/auth are derived automatically from the SvelteKit route
 * tree (src/routes/**\/+server.ts, ANY depth — not just src/routes/api,
 * this also picks up src/routes/metrics and src/routes/audit* for free) and
 * from hooks.server.ts PUBLIC_PATHS. Adding a new endpoint costs ZERO manual
 * spec edits for those fields. Request/response schemas + examples come from
 * an optional, additive `@openapi` JSDoc block — see scripts/openapi/lib.ts
 * for the full grammar.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	type HandlerAnnotation,
	type HttpMethod,
	analyzeHandlerBody,
	countRawMarkers,
	discoverRoutes,
	extractPublicPaths,
	isPublic,
	parseAnnotations,
	splitMethodBodies
} from './openapi/lib';
import { buildSpec } from './openapi/build-spec';

// `import.meta.dir` is Bun-only; this script runs under plain Node via tsx,
// so derive the script directory the portable way.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(SCRIPT_DIR, '..');
const ROUTES_ROOT = join(ROOT_DIR, 'src', 'routes');
const HOOKS_FILE = join(ROOT_DIR, 'src', 'hooks.server.ts');
const PACKAGE_JSON = join(ROOT_DIR, 'package.json');
// Bundled as an importable module (src/lib) rather than read from disk at
// runtime — see src/routes/api/docs/+server.ts. The production Docker image
// only copies build/, not static/, so a static/-only spec would 404 in the
// container even though it exists in the repo/build client assets.
const LIB_OUT_FILE = join(ROOT_DIR, 'src', 'lib', 'openapi.generated.json');
// Also written to static/ so it's copied into build/client/ verbatim by the
// SvelteKit build (useful for direct static-asset access / debugging), even
// though /api/docs no longer reads from this path.
const STATIC_OUT_FILE = join(ROOT_DIR, 'static', 'openapi.json');

const args = process.argv.slice(2);
const mode = args.includes('--check') ? 'check' : args.includes('--scaffold') ? 'scaffold' : 'generate';
const strictCoverage = args.includes('--strict-coverage');

function loadEverything() {
	const { routes, skipped, fileContents } = discoverRoutes([ROUTES_ROOT], ROUTES_ROOT);
	const publicPaths = extractPublicPaths(HOOKS_FILE);
	const isPublicFn = (p: string) => isPublic(p, publicPaths);

	const annotationsByPath: Record<string, Partial<Record<HttpMethod, HandlerAnnotation>>> = {};
	const orphanMarkers: { filePath: string; rawCount: number; matchedCount: number }[] = [];

	for (const route of routes) {
		const content = fileContents.get(route.filePath) ?? readFileSync(route.filePath, 'utf-8');
		const annotations = parseAnnotations(content);
		if (Object.keys(annotations).length > 0) annotationsByPath[route.openapiPath] = annotations;

		const rawCount = countRawMarkers(content);
		const matchedCount = Object.keys(annotations).length;
		if (rawCount !== matchedCount) orphanMarkers.push({ filePath: route.filePath, rawCount, matchedCount });
	}

	const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));

	return { routes, skipped, fileContents, publicPaths, isPublicFn, annotationsByPath, orphanMarkers, version: pkg.version ?? '0.0.0' };
}

// ---------------------------------------------------------------------------
// generate
// ---------------------------------------------------------------------------

// Self-hosted Scalar API Reference — the interactive docs viewer at
// GET /api/docs/ui, with built-in multi-language request code samples.
// Vendor the standalone browser bundle so it never depends on a CDN
// (secret-safe, offline-friendly, works behind an airgapped/internal
// Dockhand deployment too).
const SCALAR_ASSETS = ['standalone.js'];

function copyScalarAssets() {
	const srcDir = join(ROOT_DIR, 'node_modules', '@scalar', 'api-reference', 'dist', 'browser');
	const destDir = join(ROOT_DIR, 'static', 'scalar');
	if (!existsSync(srcDir)) {
		console.warn('未在 node_modules 中找到 @scalar/api-reference — 跳过资源复制 (请先执行 `npm install`)');
		return false;
	}
	mkdirSync(destDir, { recursive: true });
	for (const asset of SCALAR_ASSETS) {
		copyFileSync(join(srcDir, asset), join(destDir, asset));
	}
	return true;
}

// Writes the spec to both the importable src/lib/ location (what
// /api/docs actually serves — bundled into the built server, works
// regardless of whether static/ ships in the runtime image) and to
// static/ (copied verbatim into build/client/ by the SvelteKit build;
// kept for direct static-asset access / debugging parity with before).
function writeSpecOutputs(spec: unknown) {
	const json = JSON.stringify(spec, null, 2);
	mkdirSync(dirname(LIB_OUT_FILE), { recursive: true });
	writeFileSync(LIB_OUT_FILE, json);
	mkdirSync(dirname(STATIC_OUT_FILE), { recursive: true });
	writeFileSync(STATIC_OUT_FILE, json);
}

function runGenerate() {
	const { routes, skipped, fileContents, publicPaths, isPublicFn, annotationsByPath, version } = loadEverything();
	const { spec, stats } = buildSpec({ routes, fileContents, annotationsByPath, publicPaths, isPublicFn, version });

	writeSpecOutputs(spec);
	const scalarAssetsCopied = copyScalarAssets();

	const totalOperations = Object.values(spec.paths).reduce((sum, item: any) => sum + Object.keys(item).length, 0);
	const annotatedHandlerCount = Object.values(annotationsByPath).reduce((sum, m) => sum + Object.keys(m).length, 0);

	console.log(`\n=== OpenAPI 生成器 ===`);
	console.log(`已遍历路由文件：        ${routes.length + skipped.length}`);
	console.log(`找到包含请求方法的路由： ${routes.length}`);
	console.log(`唯一 OpenAPI 路径：      ${Object.keys(spec.paths).length}`);
	console.log(`接口操作总数：          ${totalOperations}`);
	console.log(`发现标签数量：           ${spec.tags.length}`);
	console.log(`公开（无需认证）路径：    ${routes.filter((r) => isPublicFn(r.openapiPath)).length}`);
	console.log(`已添加注解的处理器：        ${annotatedHandlerCount} / ${totalOperations} (${((annotatedHandlerCount / totalOperations) * 100).toFixed(1)}%)`);
	console.log(`包含参数的接口（自动识别+注解）： ${stats.autoParamsCount} / ${totalOperations}`);
	console.log(`包含多个响应状态码的接口（自动识别+注解）： ${stats.autoMultiResponseCount} / ${totalOperations}`);
	console.log(`包含请求体的接口（自动识别+注解）： ${stats.autoBodyCount} / ${totalOperations}`);
	console.log(`跳过的文件（无请求方法）： ${skipped.length}`);
	for (const s of skipped) console.log(`  - ${relative(ROOT_DIR, s.filePath)}：${s.reason}`);
	console.log(`Scalar 资源复制：      ${scalarAssetsCopied ? '已完成（static/scalar/）' : '已跳过（详见上方警告）'}`);
	console.log(`\n输出文件： ${relative(ROOT_DIR, LIB_OUT_FILE)}（由 /api/docs 提供服务）以及 ${relative(ROOT_DIR, STATIC_OUT_FILE)}（静态副本）`);
}

// ---------------------------------------------------------------------------
// --check (6 gates)
// ---------------------------------------------------------------------------

function runCheck(): number {
	const { routes, publicPaths, isPublicFn, annotationsByPath, orphanMarkers, fileContents, version } = loadEverything();
	const { spec } = buildSpec({ routes, fileContents, annotationsByPath, publicPaths, isPublicFn, version });
	const totalOperations = Object.values(spec.paths).reduce((sum, item: any) => sum + Object.keys(item).length, 0);
	const annotatedHandlerCount = Object.values(annotationsByPath).reduce((sum, m) => sum + Object.keys(m).length, 0);

	let hardFailures = 0;
	const report: string[] = [];

	// Gate 1: coverage (soft by default)
	const coveragePct = (annotatedHandlerCount / totalOperations) * 100;
	report.push(`[校验项 1] 注解覆盖率：${annotatedHandlerCount}/${totalOperations} 处理器已添加注解 (${coveragePct.toFixed(1)}%)`);
	if (strictCoverage && coveragePct < 100) {
		report.push(`  严重失败 (--strict-coverage)：覆盖率未达到 100%`);
		hardFailures++;
	} else if (coveragePct < 100) {
		report.push(`  (仅警告 — 使用 --strict-coverage 可改为强制校验)`);
	}

	// Gate 2: path-param consistency (annotation path: name must exist in route.pathParams)
	let pathParamIssues = 0;
	for (const route of routes) {
		const perMethod = annotationsByPath[route.openapiPath];
		if (!perMethod) continue;
		for (const [method, ann] of Object.entries(perMethod)) {
			for (const name of Object.keys(ann.path)) {
				if (!route.pathParams.includes(name)) {
					report.push(`  [校验项 2] ${relative(ROOT_DIR, route.filePath)} ${method} ${route.openapiPath}：注解中的路径参数 "${name}" 在路由 {${name}} 中不存在`);
					pathParamIssues++;
				}
			}
		}
	}
	report.splice(report.length - pathParamIssues, 0, `[校验项 2] 路径参数一致性：共 ${pathParamIssues} 处问题`);
	if (pathParamIssues > 0) hardFailures++;

	// Gates 3+4: query-param drift, status-code drift (only for annotated handlers)
	let queryDrift = 0;
	let statusDrift = 0;
	const driftLines: string[] = [];
	for (const route of routes) {
		const perMethod = annotationsByPath[route.openapiPath];
		if (!perMethod) continue;
		const content = fileContents.get(route.filePath) ?? readFileSync(route.filePath, 'utf-8');
		const bodies = splitMethodBodies(content);
		for (const [method, ann] of Object.entries(perMethod) as [HttpMethod, HandlerAnnotation][]) {
			const body = bodies[method];
			if (!body) continue;
			const analysis = analyzeHandlerBody(body, route.pathParams);

			const docQuery = new Set(Object.keys(ann.query));
			const codeQuery = new Set(analysis.queryParams.map((q) => q.name));
			for (const q of codeQuery) {
				if (!docQuery.has(q)) {
					driftLines.push(`  [校验项 3] ${relative(ROOT_DIR, route.filePath)} ${method} ${route.openapiPath}：代码使用查询参数 "${q}"，但文档未登记`);
					queryDrift++;
				}
			}
			for (const q of docQuery) {
				if (!codeQuery.has(q)) {
					driftLines.push(`  [校验项 3] ${relative(ROOT_DIR, route.filePath)} ${method} ${route.openapiPath}：文档登记查询参数 "${q}"，代码未找到 (是否已废弃？)`);
					queryDrift++;
				}
			}

			const docCodes = new Set(Object.keys(ann.responses));
			const codeCodes = new Set(analysis.statusCodes.filter((c) => c !== '200'));
			for (const c of codeCodes) {
				if (!docCodes.has(c)) {
					driftLines.push(`  [校验项 4] ${relative(ROOT_DIR, route.filePath)} ${method} ${route.openapiPath}：代码使用状态码 ${c}，但文档未登记`);
					statusDrift++;
				}
			}
			for (const c of docCodes) {
				if (c !== '200' && !codeCodes.has(c)) {
					driftLines.push(`  [校验项 4] ${relative(ROOT_DIR, route.filePath)} ${method} ${route.openapiPath}：文档登记响应码 ${c}，代码无对应 status(${c})/error(${c}) (是否已废弃？)`);
					statusDrift++;
				}
			}
		}
	}
	report.push(`[校验项 3] 查询参数不一致：共 ${queryDrift} 处问题`);
	report.push(`[校验项 4] 状态码不一致：共 ${statusDrift} 处问题`);
	report.push(...driftLines);
	if (queryDrift > 0) hardFailures++;
	if (statusDrift > 0) hardFailures++;

	// Gate 5: orphan JSDoc (a @openapi marker that didn't attach to an export)
	report.push(`[校验项 5] 孤立的 @openapi 注释块：共 ${orphanMarkers.length} 个文件`);
	for (const o of orphanMarkers) {
		report.push(`  ${relative(ROOT_DIR, o.filePath)}：找到 ${o.rawCount} 个 @openapi 标记，仅 ${o.matchedCount} 绑定到导出函数`);
	}
	if (orphanMarkers.length > 0) hardFailures++;

	// Gate 6: spec validity (write both outputs, lint the static copy) via the LOCAL
	// @redocly/cli (a devDependency). It is NOT invoked through `npx --yes`: an on-demand
	// npx fetch in a fresh CI container hung this gate for HOURS. Resolve the binary from
	// node_modules; if it is not installed, SKIP (infra), do not block the release. A lint
	// that RUNS and exits non-zero is a real spec failure and is hard.
	writeSpecOutputs(spec);
	const redoclyBin = join(ROOT_DIR, 'node_modules', '.bin', 'redocly');
	if (!existsSync(redoclyBin)) {
		report.push(`[校验项 6] 规范有效性：已跳过 (未安装 @redocly/cli — 执行 npm i)`);
	} else {
		try {
			execFileSync(redoclyBin, ['lint', STATIC_OUT_FILE, '--format=summary'], {
				cwd: ROOT_DIR,
				stdio: 'pipe',
				timeout: 120_000, // belt-and-suspenders: never hang the gate
				env: { ...process.env, REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: '1' }
			});
			report.push(`[校验项 6] 规范有效性 (@redocly/cli 校验): 通过`);
		} catch (err: any) {
			// A spawn/timeout failure (ENOENT/ETIMEDOUT) is infra -> skip; a non-zero exit
			// from a lint that actually ran is a real spec problem -> hard fail.
			if (err.code === 'ETIMEDOUT' || err.code === 'ENOENT') {
				report.push(`[校验项 6] 规范有效性: 已跳过 (校验器无法执行: ${err.code})`);
			} else {
				const out = (err.stdout?.toString() ?? '') + (err.stderr?.toString() ?? '');
				report.push(`[校验项 6] @redocly/cli 校验失败:\n${out.slice(-1000)}`);
				hardFailures++;
			}
		}
	}

	console.log(`\n=== OpenAPI --check 校验报告 ===`);
	for (const line of report) console.log(line);
	console.log(`\n严重失败项数量: ${hardFailures}`);
	return hardFailures > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// --scaffold <file>
// ---------------------------------------------------------------------------

function runScaffold() {
	const idx = args.indexOf('--scaffold');
	const target = args[idx + 1];
	if (!target) {
		console.error('用法: generate-openapi.ts --scaffold <path/to/+server.ts>');
		process.exitCode = 1;
		return;
	}
	const filePath = target.startsWith('/') ? target : join(ROOT_DIR, target);
	if (!existsSync(filePath)) {
		console.error(`找不到文件: ${filePath}`);
		process.exitCode = 1;
		return;
	}
	const content = readFileSync(filePath, 'utf-8');
	const existing = parseAnnotations(content);
	const bodies = splitMethodBodies(content);

	const { routes } = discoverRoutes([ROUTES_ROOT], ROUTES_ROOT);
	const route = routes.find((r) => r.filePath === filePath);

	console.log(`# 为 ${relative(ROOT_DIR, filePath)} 生成注解草稿`);
	console.log(`# (基于代码静态分析生成 — 提交前请审阅并完善)\n`);

	for (const [method, body] of Object.entries(bodies)) {
		if (existing[method as HttpMethod]) {
			console.log(`## ${method}: 已存在 @openapi 注解，已跳过\n`);
			continue;
		}
		const analysis = analyzeHandlerBody(body, route?.pathParams ?? []);
		console.log(`## ${method} ${route?.openapiPath ?? '(路径未知)'}\n`);
		console.log('/**');
		console.log(' * @openapi');
		console.log(' * summary: 待填写 — 单行接口描述');
		for (const q of analysis.queryParams) {
			console.log(` * query: ${q.name}:${q.type} 待填写 — 参数描述 (确认是否必填、类型)`);
		}
		if (analysis.bodyFields.length > 0) {
			console.log(` * body: {${analysis.bodyFields.map((f) => `${f}:string`).join(', ')}} # 待填写：确认类型 + 必填标记 (!)`);
		}
		const codes = analysis.statusCodes.length > 0 ? analysis.statusCodes : ['200'];
		for (const c of codes) {
			console.log(` * resp-${c}: 待填写 — 响应描述${c === '200' ? ' (或填写 {字段:类型} 结构)' : ''}`);
		}
		console.log(' */');
		console.log(`export const ${method}: RequestHandler = ...\n`);
	}
}

// ---------------------------------------------------------------------------
// entrypoint
// ---------------------------------------------------------------------------

if (mode === 'check') {
	process.exitCode = runCheck();
} else if (mode === 'scaffold') {
	runScaffold();
} else {
	runGenerate();
}
