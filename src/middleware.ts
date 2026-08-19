import type { Model, ModelProperty, Program, Type } from "@typespec/compiler";
import {
	createMetadataInfo,
	getAllHttpServices,
	type HttpOperation,
	type HttpOperationParameter,
	type MetadataInfo,
	resolveRequestVisibility,
	Visibility,
} from "@typespec/http";

export interface ZodCodegen {
	type(type: Type): string;
	property(property: ModelProperty): string;
	propertyName(name: string): string;
	properties(model: Model): Map<string, ModelProperty>;
}

export interface MiddlewareOptions {
	schemaNames: Set<string>;
	schemasModule: string;
	packageName?: string;
	packageVersion?: string;
}

interface PayloadContext {
	codegen: ZodCodegen;
	metadata: MetadataInfo;
	identical: Map<Type, Map<Visibility, boolean>>;
	visiting: Set<Type>;
}

const PARAMETER_LOCATIONS = ["path", "query", "header", "cookie"] as const;

type ParameterLocation = (typeof PARAMETER_LOCATIONS)[number];

export function isHttpEnabled(program: Program): boolean {
	const typespec = program.getGlobalNamespaceType().namespaces.get("TypeSpec");
	return typespec?.namespaces.has("Http") ?? false;
}

export function generateMiddleware(
	program: Program,
	codegen: ZodCodegen,
	options: MiddlewareOptions,
): string | undefined {
	if (!isHttpEnabled(program)) {
		return undefined;
	}

	const [services] = getAllHttpServices(program);
	const operations = services.flatMap((service) => service.operations);

	if (operations.length === 0) {
		return undefined;
	}

	const context: PayloadContext = {
		codegen,
		metadata: createMetadataInfo(program),
		identical: new Map(),
		visiting: new Set(),
	};

	const entries = operations.map((operation) =>
		generateOperationEntry(program, operation, context),
	);
	const imports = collectSchemaImports(entries.join("\n"), options.schemaNames);

	return [
		'import { z } from "zod";',
		imports.length > 0
			? `import {\n${imports.map((name) => `\t${name},`).join("\n")}\n} from "${options.schemasModule}";\n`
			: "",
		generateHeader(options.packageName, options.packageVersion),
		OPERATION_TYPES,
		`export const operations: readonly OperationSchemas[] = [\n${entries.join("\n")}\n];\n`,
		MIDDLEWARE_RUNTIME,
	]
		.filter((part) => part !== "")
		.join("\n");
}

function generateHeader(packageName?: string, packageVersion?: string): string {
	if (!packageName && !packageVersion) {
		return "";
	}

	const lines = ["/**"];
	if (packageName) {
		lines.push(` * Package: ${packageName}`);
	}
	if (packageVersion) {
		lines.push(` * Version: ${packageVersion}`);
	}
	lines.push(" */\n");

	return lines.join("\n");
}

function generateOperationEntry(
	program: Program,
	operation: HttpOperation,
	context: PayloadContext,
): string {
	const visibility = resolveRequestVisibility(
		program,
		operation.operation,
		operation.verb,
	);
	const route = routePattern(operation.path);
	const body = generateBodySchema(operation, visibility, context);
	const parameters = generateParameterSchemas(operation, context);

	const fields = [
		`operationId: "${operationId(operation)}"`,
		`method: "${operation.verb.toUpperCase()}"`,
		`path: ${JSON.stringify(operation.path)}`,
		`pattern: /${route.pattern}/`,
		`pathParameterNames: [${route.parameterNames.map((name) => `"${name}"`).join(", ")}]`,
	];

	if (body) {
		fields.push(`body: ${body}`);
	}
	fields.push(`parameters: ${parameters}`);

	return `\t{\n${fields.map((field) => `\t\t${field},`).join("\n")}\n\t},`;
}

export function operationId(operation: HttpOperation): string {
	const container = operation.container.name;
	return container
		? `${container}_${operation.operation.name}`
		: operation.operation.name;
}

export function routePattern(path: string): {
	pattern: string;
	parameterNames: string[];
} {
	const parameterNames: string[] = [];
	const segments = path.split(/\{([^{}]*)\}/g);

	const pattern = segments
		.map((segment, index) => {
			if (index % 2 === 0) {
				return escapeRegExp(segment);
			}
			const reserved = segment.startsWith("+") || segment.startsWith("#");
			parameterNames.push(segment.replace(/^[+#]/, "").replace(/\*$/, ""));
			return reserved ? "(.+)" : "([^/]+)";
		})
		.join("");

	return { pattern: `^.*${pattern}\\/?$`, parameterNames };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

export function isJsonContentType(contentTypes: readonly string[]): boolean {
	return contentTypes.some((contentType) => {
		const mediaType = contentType.split(";")[0].trim();
		return mediaType === "application/json" || mediaType.endsWith("+json");
	});
}

function generateBodySchema(
	operation: HttpOperation,
	visibility: Visibility,
	context: PayloadContext,
): string | undefined {
	const body = operation.parameters.body;

	if (!body || body.bodyKind !== "single") {
		return undefined;
	}
	if (!isJsonContentType(body.contentTypes)) {
		return undefined;
	}

	return payloadSchema(body.type, visibility, context, body.isExplicit);
}

function generateParameterSchemas(
	operation: HttpOperation,
	context: PayloadContext,
): string {
	const grouped = new Map<ParameterLocation, string[]>();

	for (const parameter of operation.parameters.parameters) {
		const location = parameterLocation(parameter);
		if (!location) {
			continue;
		}
		const entries = grouped.get(location) ?? [];
		entries.push(
			`${context.codegen.propertyName(parameter.name)}: ${context.codegen.property(parameter.param)}`,
		);
		grouped.set(location, entries);
	}

	const locations = PARAMETER_LOCATIONS.filter((location) =>
		grouped.has(location),
	).map(
		(location) =>
			`${location}: z.object({ ${(grouped.get(location) ?? []).join(", ")} })`,
	);

	return locations.length > 0 ? `{ ${locations.join(", ")} }` : "{}";
}

function parameterLocation(
	parameter: HttpOperationParameter,
): ParameterLocation | undefined {
	return PARAMETER_LOCATIONS.find((location) => location === parameter.type);
}

function payloadSchema(
	type: Type,
	visibility: Visibility,
	context: PayloadContext,
	inExplicitBody = false,
): string {
	if (isPayloadIdentical(type, visibility, context, inExplicitBody)) {
		return context.codegen.type(type);
	}

	if (type.kind === "Union") {
		const variants = Array.from(type.variants.values()).map((variant) =>
			payloadSchema(variant.type, visibility, context),
		);
		return variants.length === 1
			? variants[0]
			: `z.union([${variants.join(", ")}])`;
	}

	if (type.kind !== "Model") {
		return context.codegen.type(type);
	}

	if (type.name === "Array" && type.indexer) {
		return `z.array(${payloadSchema(type.indexer.value, visibility | Visibility.Item, context)})`;
	}

	if (type.indexer && type.indexer.key.name === "string") {
		return `z.record(z.string(), ${payloadSchema(type.indexer.value, visibility | Visibility.Item, context)})`;
	}

	const properties: string[] = [];
	for (const [name, property] of context.codegen.properties(type)) {
		if (
			!context.metadata.isPayloadProperty(property, visibility, inExplicitBody)
		) {
			continue;
		}
		properties.push(
			`${context.codegen.propertyName(name)}: ${payloadPropertySchema(property, visibility, context)}`,
		);
	}

	return properties.length > 0
		? `z.object({ ${properties.join(", ")} })`
		: "z.object({})";
}

function payloadPropertySchema(
	property: ModelProperty,
	visibility: Visibility,
	context: PayloadContext,
): string {
	const optional = context.metadata.isOptional(property, visibility);

	if (isPayloadIdentical(property.type, visibility, context)) {
		const declared = context.codegen.property(property);
		return optional && !property.optional ? `${declared}.optional()` : declared;
	}

	const schema = payloadSchema(property.type, visibility, context);
	return optional ? `${schema}.optional()` : schema;
}

function isPayloadIdentical(
	type: Type,
	visibility: Visibility,
	context: PayloadContext,
	inExplicitBody = false,
): boolean {
	if (inExplicitBody) {
		return computePayloadIdentical(type, visibility, context, true);
	}

	const cached = context.identical.get(type)?.get(visibility);
	if (cached !== undefined) {
		return cached;
	}
	// A self-referencing model is assumed identical while it is being computed;
	// any real difference is found on one of its other properties.
	if (context.visiting.has(type)) {
		return true;
	}

	context.visiting.add(type);
	const result = computePayloadIdentical(type, visibility, context);
	context.visiting.delete(type);

	const byVisibility = context.identical.get(type) ?? new Map();
	byVisibility.set(visibility, result);
	context.identical.set(type, byVisibility);

	return result;
}

function computePayloadIdentical(
	type: Type,
	visibility: Visibility,
	context: PayloadContext,
	inExplicitBody = false,
): boolean {
	if (type.kind === "Union") {
		return Array.from(type.variants.values()).every((variant) =>
			isPayloadIdentical(variant.type, visibility, context),
		);
	}

	if (type.kind !== "Model") {
		return true;
	}

	if (type.indexer) {
		return isPayloadIdentical(
			type.indexer.value,
			visibility | Visibility.Item,
			context,
		);
	}

	for (const [, property] of context.codegen.properties(type)) {
		if (
			!context.metadata.isPayloadProperty(property, visibility, inExplicitBody)
		) {
			return false;
		}
		if (
			context.metadata.isOptional(property, visibility) !== !!property.optional
		) {
			return false;
		}
		if (!isPayloadIdentical(property.type, visibility, context)) {
			return false;
		}
	}

	return true;
}

export function collectSchemaImports(
	generated: string,
	schemaNames: Set<string>,
): string[] {
	const used = new Set<string>();

	for (const match of generated.matchAll(/\b[A-Za-z_$][\w$]*Schema\b/g)) {
		if (schemaNames.has(match[0])) {
			used.add(match[0]);
		}
	}

	return Array.from(used).sort();
}

const OPERATION_TYPES = `export interface OperationSchemas {
	readonly operationId: string;
	readonly method: string;
	readonly path: string;
	readonly pattern: RegExp;
	readonly pathParameterNames: readonly string[];
	readonly body?: z.ZodTypeAny;
	readonly parameters: {
		readonly path?: z.ZodTypeAny;
		readonly query?: z.ZodTypeAny;
		readonly header?: z.ZodTypeAny;
		readonly cookie?: z.ZodTypeAny;
	};
}
`;

const MIDDLEWARE_RUNTIME = `export interface RequestContext {
	url: string;
	init: RequestInit;
}

export interface ValidationMiddleware {
	pre(context: RequestContext): Promise<void>;
}

export interface ValidationMiddlewareOptions {
	validate?: boolean;
}

export class RequestValidationError extends Error {
	override readonly name = "RequestValidationError";
	readonly issues: z.ZodIssue[];

	constructor(
		readonly operationId: string,
		readonly method: string,
		readonly url: string,
		readonly error: z.ZodError,
	) {
		super(
			\`\${method} \${url} (\${operationId}) request body failed validation: \${error.issues
				.map((issue) => \`\${issue.path.join(".") || "<root>"}: \${issue.message}\`)
				.join("; ")}\`,
		);
		this.issues = error.issues;
	}
}

export function findOperation(
	method: string,
	url: string,
): OperationSchemas | undefined {
	const wanted = method.toUpperCase();
	const pathname = pathnameOf(url);

	return operations.find(
		(operation) =>
			operation.method === wanted && operation.pattern.test(pathname),
	);
}

export function createValidationMiddleware(
	options: ValidationMiddlewareOptions = {},
): ValidationMiddleware {
	const validate = options.validate ?? true;

	return {
		async pre(context: RequestContext): Promise<void> {
			if (!validate) {
				return;
			}

			const method = (context.init.method ?? "GET").toUpperCase();
			const operation = findOperation(method, context.url);
			if (!operation?.body) {
				return;
			}

			const body = context.init.body;
			if (typeof body !== "string") {
				return;
			}

			const contentType = headerValue(context.init, "content-type");
			if (contentType && !contentType.includes("json")) {
				return;
			}

			const result = operation.body.safeParse(parseJson(body));
			if (result.success) {
				return;
			}

			throw new RequestValidationError(
				operation.operationId,
				method,
				context.url,
				result.error,
			);
		},
	};
}

export const validationMiddleware: ValidationMiddleware =
	createValidationMiddleware();

function pathnameOf(url: string): string {
	const withoutQuery = url.split("#")[0].split("?")[0];
	const scheme = withoutQuery.indexOf("://");
	if (scheme === -1) {
		return withoutQuery;
	}

	const authority = withoutQuery.slice(scheme + 3);
	const separator = authority.indexOf("/");
	return separator === -1 ? "/" : authority.slice(separator);
}

function headerValue(init: RequestInit, name: string): string | undefined {
	const headers = init.headers;
	if (!headers) {
		return undefined;
	}
	if (headers instanceof Headers) {
		return headers.get(name) ?? undefined;
	}
	if (Array.isArray(headers)) {
		return headers.find(([key]) => key.toLowerCase() === name)?.[1];
	}

	const key = Object.keys(headers).find((header) => header.toLowerCase() === name);
	return key === undefined ? undefined : headers[key];
}

// A body that is not JSON is handed to zod as-is, so it is reported as a
// validation failure instead of a parse error thrown from the middleware.
function parseJson(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return body;
	}
}
`;

export const __test = {
	collectSchemaImports,
	generateHeader,
	generateParameterSchemas,
	isJsonContentType,
	operationId,
	payloadSchema,
	routePattern,
};
