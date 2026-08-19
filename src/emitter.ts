import type { EmitContext } from "@typespec/compiler";
import {
	type Enum,
	emitFile,
	getFormat,
	getMaxLength,
	getMaxValue,
	getMinLength,
	getMinValue,
	getPattern,
	type Model,
	type ModelProperty,
	type Namespace,
	type Program,
	resolvePath,
	type Scalar,
	type Type,
	type Union,
} from "@typespec/compiler";
import { $ } from "@typespec/compiler/typekit";
import { reportDiagnostic, type ZodEmitterOptions } from "./lib.js";
import { generateMiddleware } from "./middleware.js";

// Emitted schemas call z.string().date()/.time(), added in zod 3.23, and
// .url()/.datetime(), dropped in zod 4.
const ZOD_PEER_RANGE = "^3.23.0";

type DeclaredType = Model | Enum;
type SchemaNames = ReadonlyMap<DeclaredType, string>;

export async function $onEmit(context: EmitContext<ZodEmitterOptions>) {
	const models: Model[] = [];
	const enums: Enum[] = [];
	const typekit = $(context.program);

	function collectTypes(namespace: Namespace) {
		for (const [_, model] of namespace.models) {
			if (
				!isIntrinsicModel(model) &&
				!isTypeSpecIntrinsic(namespace) &&
				typekit.type.isUserDefined(model) &&
				!isTemplateDeclaration(model)
			) {
				models.push(model);
			}
		}

		for (const [_, enumType] of namespace.enums) {
			if (
				!isTypeSpecIntrinsic(namespace) &&
				typekit.type.isUserDefined(enumType)
			) {
				enums.push(enumType);
			}
		}

		for (const [_, ns] of namespace.namespaces) {
			collectTypes(ns);
		}
	}

	const globalNamespace = context.program.getGlobalNamespaceType();
	collectTypes(globalNamespace);

	if (models.length === 0 && enums.length === 0) {
		return;
	}

	const declarations: DeclaredType[] = [...models, ...enums];
	const { names: schemaNames, conflicts } = assignSchemaNames(declarations);

	for (const declaration of declarations) {
		const name = schemaNames.get(declaration);
		if (name && name !== declaration.name) {
			reportDiagnostic(context.program, {
				code: "schema-name-qualified",
				format: { name: declaration.name, qualified: name },
				target: declaration,
			});
		}
	}

	for (const declaration of conflicts) {
		reportDiagnostic(context.program, {
			code: "duplicate-schema-name",
			format: { name: schemaNames.get(declaration) ?? declaration.name },
			target: declaration,
		});
	}

	const outputDir = context.emitterOutputDir;
	const outputFile = context.options["output-file"] ?? "schemas.ts";
	const packageName = context.options["package-name"];
	const packageVersion = context.options["package-version"];

	const content = generateZodSchemas(
		models,
		enums,
		packageName,
		packageVersion,
		schemaNames,
		context.program,
	);

	await emitFile(context.program, {
		path: resolvePath(outputDir, outputFile),
		content,
	});

	const middlewareFile = context.options["middleware-file"] ?? "middleware.ts";
	const middleware =
		context.options["emit-middleware"] === false
			? undefined
			: generateMiddleware(
					context.program,
					{
						type: (type) =>
							generateTypeSchema(type, schemaNames, context.program),
						property: (property) =>
							generatePropertySchema(property, schemaNames, context.program),
						propertyName: quotePropertyName,
						properties: getAllProperties,
					},
					{
						schemaNames: new Set(
							declarations.map(
								(type) => `${schemaName(type, schemaNames)}Schema`,
							),
						),
						schemasModule: moduleSpecifier(outputFile),
						packageName,
						packageVersion,
					},
				);

	if (middleware) {
		await emitFile(context.program, {
			path: resolvePath(outputDir, middlewareFile),
			content: middleware,
		});
	}

	// Generate package.json if both package-name and package-version are provided
	if (packageName && packageVersion) {
		const packageJsonContent = generatePackageJson(
			packageName,
			packageVersion,
			outputFile,
			middleware ? middlewareFile : undefined,
		);
		await emitFile(context.program, {
			path: resolvePath(outputDir, "package.json"),
			content: packageJsonContent,
		});

		// Generate README.md
		const readmeContent = generateReadme(
			packageName,
			models,
			enums,
			schemaNames,
			middleware ? moduleName(middlewareFile) : undefined,
		);
		await emitFile(context.program, {
			path: resolvePath(outputDir, "README.md"),
			content: readmeContent,
		});

		// Generate tsconfig.json
		const tsconfigContent = generateTsConfig(
			middleware ? [outputFile, middlewareFile] : [outputFile],
		);
		await emitFile(context.program, {
			path: resolvePath(outputDir, "tsconfig.json"),
			content: tsconfigContent,
		});

		// Generate .npmignore
		const npmignoreContent = generateNpmIgnore();
		await emitFile(context.program, {
			path: resolvePath(outputDir, ".npmignore"),
			content: npmignoreContent,
		});
	}
}

function isIntrinsicModel(model: Model): boolean {
	const intrinsicNames = ["Array", "Record"];
	return intrinsicNames.includes(model.name);
}

function isTypeSpecIntrinsic(namespace: Namespace): boolean {
	const intrinsicNamespaces = ["TypeSpec", "Reflection"];
	return intrinsicNamespaces.includes(namespace.name);
}

function isTemplateDeclaration(model: Model): boolean {
	// Models with template parameters are template declarations (not instantiations)
	// e.g., model ResultList<T> { items: T[] }
	// We skip these because they can't be directly converted to Zod schemas

	// Check if the model declaration has template parameters in its syntax node
	if (model.node && "templateParameters" in model.node) {
		const templateParams = (
			model.node as { templateParameters?: readonly unknown[] }
		).templateParameters;
		if (templateParams && templateParams.length > 0) {
			return true;
		}
	}

	// Also check if any property has a type that is or contains a TemplateParameter
	for (const [_, prop] of model.properties) {
		if (containsTemplateParameter(prop.type)) {
			return true;
		}
	}

	return false;
}

function containsTemplateParameter(type: Type): boolean {
	if (type.kind === "TemplateParameter") {
		return true;
	}

	if (type.kind === "Model") {
		// Check array types like T[]
		if (type.name === "Array" && type.indexer) {
			return containsTemplateParameter(type.indexer.value);
		}
	}

	return false;
}

function namespaceSegments(type: DeclaredType): string[] {
	const segments: string[] = [];
	for (
		let namespace: Namespace | undefined = type.namespace;
		namespace?.name;
		namespace = namespace.namespace
	) {
		segments.unshift(namespace.name);
	}
	return segments;
}

// A declared name is unique per namespace, so prefixing the namespace path
// separates declarations that share a name. Only the names that actually
// collide are qualified, so a spec without collisions emits what it always did.
function assignSchemaNames(types: readonly DeclaredType[]): {
	names: Map<DeclaredType, string>;
	conflicts: DeclaredType[];
} {
	const byDeclaredName = new Map<string, DeclaredType[]>();
	for (const type of types) {
		const group = byDeclaredName.get(type.name);
		if (group) {
			group.push(type);
			continue;
		}
		byDeclaredName.set(type.name, [type]);
	}

	const names = new Map<DeclaredType, string>();
	const conflicts: DeclaredType[] = [];
	const taken = new Set<string>();

	for (const [declaredName, group] of byDeclaredName) {
		for (const type of group) {
			names.set(
				type,
				group.length === 1
					? declaredName
					: [...namespaceSegments(type), declaredName].join(""),
			);
		}
	}

	for (const type of types) {
		const name = names.get(type) ?? type.name;
		if (taken.has(name)) {
			conflicts.push(type);
			continue;
		}
		taken.add(name);
	}

	return { names, conflicts };
}

function schemaName(type: DeclaredType, names?: SchemaNames): string {
	return names?.get(type) ?? type.name;
}

function getModelDependencies(model: Model): Set<DeclaredType> {
	const dependencies = new Set<DeclaredType>();

	function extractDependencies(type: Type): void {
		switch (type.kind) {
			case "Model":
				// Skip intrinsic models like Array, Record
				if (!isIntrinsicModel(type) && type.name) {
					dependencies.add(type);
				}
				// Check indexer for Record types
				if (type.indexer?.value) {
					extractDependencies(type.indexer.value);
				}
				break;
			case "Enum":
				if (type.name) {
					dependencies.add(type);
				}
				break;
			case "Union":
				for (const variant of type.variants.values()) {
					extractDependencies(variant.type);
				}
				break;
		}
	}

	// Extract dependencies from all properties, including those inherited
	// from a base model — the emitted schema inlines inherited property
	// references too, so the topological sort must see them.
	for (const [_, prop] of getAllProperties(model)) {
		extractDependencies(prop.type);
	}

	// Remove self-reference
	dependencies.delete(model);

	return dependencies;
}

// Dependencies are tracked by type identity, not by name: two models declared
// in different namespaces can share a name, and only identity says which one a
// property actually refers to.
function topologicalSort(models: Model[]): Model[] {
	const declared = new Set(models);
	const visited = new Set<Model>();
	const visiting = new Set<Model>();
	const sorted: Model[] = [];

	function visit(model: Model): void {
		if (visited.has(model) || !declared.has(model)) {
			return;
		}

		if (visiting.has(model)) {
			// Circular dependency detected - skip to avoid infinite loop
			return;
		}

		visiting.add(model);

		for (const dependency of getModelDependencies(model)) {
			if (dependency.kind === "Model") {
				visit(dependency);
			}
		}

		visiting.delete(model);
		visited.add(model);
		sorted.push(model);
	}

	for (const model of models) {
		visit(model);
	}

	return sorted;
}

function generateZodSchemas(
	models: Model[],
	enums: Enum[],
	packageName?: string,
	packageVersion?: string,
	schemaNames?: SchemaNames,
	program?: Program,
): string {
	const imports = 'import { z } from "zod";\n\n';

	let header = "";
	if (packageName || packageVersion) {
		header = "/**\n";
		if (packageName) {
			header += ` * Package: ${packageName}\n`;
		}
		if (packageVersion) {
			header += ` * Version: ${packageVersion}\n`;
		}
		header += " */\n\n";
	}

	// Sort models topologically to ensure dependencies come first
	const sortedModels = topologicalSort(models);

	const enumSchemas = enums
		.map((enumType) => generateEnumSchema(enumType, schemaNames))
		.join("\n\n");

	const modelSchemas = sortedModels
		.map((model) => generateModelSchema(model, schemaNames, program))
		.join("\n\n");

	return (
		imports + header + (enumSchemas ? `${enumSchemas}\n\n` : "") + modelSchemas
	);
}

function generateEnumSchema(enumType: Enum, schemaNames?: SchemaNames): string {
	const members = Array.from(enumType.members.values());
	const name = schemaName(enumType, schemaNames);

	if (members.length === 0) {
		return `export const ${name}Schema = z.never();`;
	}

	const values = members.map((member) => {
		const value = member.value ?? member.name;
		return typeof value === "string" ? `"${value}"` : value;
	});

	return `export const ${name}Schema = z.enum([${values.join(", ")}]);`;
}

function isValidJavaScriptIdentifier(name: string): boolean {
	// Check if the name is a valid JavaScript identifier
	// Valid identifiers start with a letter, underscore, or dollar sign
	// and contain only letters, digits, underscores, or dollar signs
	const identifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
	return identifierRegex.test(name) && !isReservedWord(name);
}

function isReservedWord(name: string): boolean {
	// JavaScript reserved words that need quoting
	const reserved = new Set([
		"break",
		"case",
		"catch",
		"class",
		"const",
		"continue",
		"debugger",
		"default",
		"delete",
		"do",
		"else",
		"export",
		"extends",
		"finally",
		"for",
		"function",
		"if",
		"import",
		"in",
		"instanceof",
		"new",
		"return",
		"super",
		"switch",
		"this",
		"throw",
		"try",
		"typeof",
		"var",
		"void",
		"while",
		"with",
		"yield",
		"let",
		"static",
		"enum",
		"await",
		"implements",
		"interface",
		"package",
		"private",
		"protected",
		"public",
	]);
	return reserved.has(name);
}

function quotePropertyName(name: string): string {
	return isValidJavaScriptIdentifier(name) ? name : `"${name}"`;
}

function getAllProperties(model: Model): Map<string, ModelProperty> {
	const props = new Map<string, ModelProperty>();
	if (model.baseModel) {
		for (const [name, prop] of getAllProperties(model.baseModel)) {
			props.set(name, prop);
		}
	}
	for (const [name, prop] of model.properties) {
		props.set(name, prop);
	}
	return props;
}

function generateModelSchema(
	model: Model,
	schemaNames?: SchemaNames,
	program?: Program,
): string {
	const properties: string[] = [];

	for (const [propName, prop] of getAllProperties(model)) {
		const zodType = generatePropertySchema(prop, schemaNames, program);
		const quotedName = quotePropertyName(propName);
		properties.push(`\t${quotedName}: ${zodType}`);
	}

	const schemaBody =
		properties.length > 0 ? `{\n${properties.join(",\n")}\n}` : "{}";

	return `export const ${schemaName(model, schemaNames)}Schema = z.object(${schemaBody});`;
}

function generatePropertySchema(
	prop: ModelProperty,
	schemaNames?: SchemaNames,
	program?: Program,
): string {
	// A property may narrow the constraints of its own scalar type, so the
	// property itself is the last constraint source in the chain.
	let schema =
		prop.type.kind === "Scalar"
			? generateScalarSchema(prop.type, program, prop)
			: generateTypeSchema(prop.type, schemaNames, program);

	if (prop.optional) {
		schema += ".optional()";
	}

	return schema;
}

function generateTypeSchema(
	type: Type,
	schemaNames?: SchemaNames,
	program?: Program,
): string {
	switch (type.kind) {
		case "Scalar":
			return generateScalarSchema(type, program);
		case "Model":
			return generateModelTypeSchema(type, schemaNames, program);
		case "Enum":
			return `${schemaName(type, schemaNames)}Schema`;
		case "Union":
			return generateUnionSchema(type, schemaNames, program);
		case "String":
			return `z.literal("${type.value}")`;
		case "Number":
			return `z.literal(${type.value})`;
		case "Boolean":
			return `z.literal(${type.value})`;
		case "Intrinsic":
			return INTRINSIC_SCHEMA_MAP.get(type.name) ?? "z.unknown()";
		default:
			return "z.unknown()";
	}
}

// Without these, a `null` variant falls through to z.unknown() and the union
// it sits in accepts every value.
const INTRINSIC_SCHEMA_MAP = new Map<string, string>([
	["null", "z.null()"],
	["never", "z.never()"],
	["void", "z.void()"],
]);

const SCALAR_SCHEMA_MAP = new Map<string, string>([
	["string", "z.string()"],
	["int32", "z.number()"],
	["int64", "z.number()"],
	["float", "z.number()"],
	["float32", "z.number()"],
	["float64", "z.number()"],
	["decimal", "z.number()"],
	["numeric", "z.number()"],
	["integer", "z.number()"],
	["safeint", "z.number()"],
	["uint8", "z.number()"],
	["uint16", "z.number()"],
	["uint32", "z.number()"],
	["uint64", "z.number()"],
	["int8", "z.number()"],
	["int16", "z.number()"],
	["boolean", "z.boolean()"],
	["plainDate", "z.string().date()"],
	["plainTime", "z.string().time()"],
	["utcDateTime", "z.string().datetime()"],
	["offsetDateTime", "z.string().datetime({ offset: true })"],
	["duration", "z.string()"],
	["url", "z.string().url()"],
	["bytes", "z.instanceof(Uint8Array)"],
]);

const FORMAT_CHECK_MAP = new Map<string, string>([
	["uuid", ".uuid()"],
	["url", ".url()"],
	["uri", ".url()"],
	["email", ".email()"],
]);

interface Constraints {
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	format?: string;
	minValue?: number;
	maxValue?: number;
}

function readConstraints(program: Program, target: Type): Constraints {
	return {
		minLength: getMinLength(program, target),
		maxLength: getMaxLength(program, target),
		pattern: getPattern(program, target),
		format: getFormat(program, target),
		minValue: getMinValue(program, target),
		maxValue: getMaxValue(program, target),
	};
}

function mergeConstraints(base: Constraints, refinement: Constraints) {
	return {
		minLength: refinement.minLength ?? base.minLength,
		maxLength: refinement.maxLength ?? base.maxLength,
		pattern: refinement.pattern ?? base.pattern,
		format: refinement.format ?? base.format,
		minValue: refinement.minValue ?? base.minValue,
		maxValue: refinement.maxValue ?? base.maxValue,
	};
}

function collectConstraints(
	program: Program,
	scalar: Scalar,
	property?: ModelProperty,
): Constraints {
	// Root scalar first, so each refinement overrides the one it extends and
	// the property (if any) has the final say.
	const sources: Type[] = [];
	for (
		let current: Scalar | undefined = scalar;
		current;
		current = current.baseScalar
	) {
		sources.unshift(current);
	}
	if (property) {
		sources.push(property);
	}

	return sources.reduce<Constraints>(
		(merged, source) =>
			mergeConstraints(merged, readConstraints(program, source)),
		{},
	);
}

function toRegexLiteral(pattern: string): string {
	if (/[\n\r\u2028\u2029]/.test(pattern)) {
		return `new RegExp(${JSON.stringify(pattern)})`;
	}

	const escaped = pattern.replace(/\\.|\//g, (match) =>
		match === "/" ? "\\/" : match,
	);
	return `/${escaped}/`;
}

function applyConstraints(schema: string, constraints: Constraints): string {
	const checks: string[] = [];

	if (schema.startsWith("z.string()")) {
		const formatCheck = constraints.format
			? FORMAT_CHECK_MAP.get(constraints.format.toLowerCase())
			: undefined;
		if (formatCheck && !schema.includes(formatCheck)) {
			checks.push(formatCheck);
		}
		if (constraints.pattern !== undefined) {
			checks.push(`.regex(${toRegexLiteral(constraints.pattern)})`);
		}
		if (constraints.minLength !== undefined) {
			checks.push(`.min(${constraints.minLength})`);
		}
		if (constraints.maxLength !== undefined) {
			checks.push(`.max(${constraints.maxLength})`);
		}
	}

	if (schema.startsWith("z.number()")) {
		if (constraints.minValue !== undefined) {
			checks.push(`.min(${constraints.minValue})`);
		}
		if (constraints.maxValue !== undefined) {
			checks.push(`.max(${constraints.maxValue})`);
		}
	}

	return schema + checks.join("");
}

function generateScalarSchema(
	scalar: Scalar,
	program?: Program,
	property?: ModelProperty,
): string {
	// Walk from the current scalar UP to the root, returning the first
	// known mapping. This matches refined scalars (e.g. `url`, which extends
	// `string`) before they get walked past to their primitive root.
	let current: Scalar | undefined = scalar;
	while (current) {
		const mapped = SCALAR_SCHEMA_MAP.get(current.name);
		if (mapped) {
			if (!program) {
				return mapped;
			}
			return applyConstraints(
				mapped,
				collectConstraints(program, scalar, property),
			);
		}
		current = current.baseScalar;
	}

	return "z.unknown()";
}

function generateModelTypeSchema(
	model: Model,
	schemaNames?: SchemaNames,
	program?: Program,
): string {
	if (model.name === "Array" && model.indexer?.value) {
		const elementType = model.indexer.value;
		return `z.array(${generateTypeSchema(elementType, schemaNames, program)})`;
	}

	if (model.indexer && model.indexer.key.name === "string") {
		const valueType = model.indexer.value;
		return `z.record(z.string(), ${generateTypeSchema(valueType, schemaNames, program)})`;
	}

	// Handle anonymous object literals (inline object types)
	if (!model.name || model.name === "" || model.name === "object") {
		const properties: string[] = [];
		for (const [propName, prop] of model.properties) {
			const zodType = generatePropertySchema(prop, schemaNames, program);
			const quotedName = quotePropertyName(propName);
			properties.push(`${quotedName}: ${zodType}`);
		}
		const schemaBody =
			properties.length > 0 ? `{ ${properties.join(", ")} }` : "{}";
		return `z.object(${schemaBody})`;
	}

	// Check if this model is in our declared models map
	if (schemaNames) {
		const declaredName = schemaNames.get(model);
		if (declaredName) {
			return `${declaredName}Schema`;
		}

		// Model is not in our declared models (e.g., lifecycle-transformed models like Create<T>)
		// Generate it inline as an anonymous object
		const properties: string[] = [];
		for (const [propName, prop] of model.properties) {
			const zodType = generatePropertySchema(prop, schemaNames, program);
			const quotedName = quotePropertyName(propName);
			properties.push(`${quotedName}: ${zodType}`);
		}
		const schemaBody =
			properties.length > 0 ? `{ ${properties.join(", ")} }` : "{}";
		return `z.object(${schemaBody})`;
	}

	return `${model.name}Schema`;
}

function generateUnionSchema(
	union: Union,
	schemaNames?: SchemaNames,
	program?: Program,
): string {
	const variants = Array.from(union.variants.values());

	if (variants.length === 0) {
		return "z.never()";
	}

	if (variants.length === 1) {
		return generateTypeSchema(variants[0].type, schemaNames, program);
	}

	const schemas = variants.map((variant) =>
		generateTypeSchema(variant.type, schemaNames, program),
	);

	return `z.union([${schemas.join(", ")}])`;
}

function moduleName(fileName: string): string {
	return fileName.replace(/\.tsx?$/, "");
}

function moduleSpecifier(fileName: string): string {
	return `./${moduleName(fileName)}.js`;
}

function generatePackageJson(
	packageName: string,
	packageVersion: string,
	outputFile: string,
	middlewareFile?: string,
): string {
	const middlewareExport = middlewareFile
		? {
				[`./${moduleName(middlewareFile)}`]: {
					types: `./${moduleName(middlewareFile)}.d.ts`,
					default: moduleSpecifier(middlewareFile),
				},
			}
		: {};

	const schemasTypes = `./${moduleName(outputFile)}.d.ts`;
	const schemasDefault = moduleSpecifier(outputFile);

	const packageJson = {
		name: packageName,
		version: packageVersion,
		type: "module",
		main: schemasDefault,
		types: schemasTypes,
		exports: {
			".": {
				types: schemasTypes,
				default: schemasDefault,
			},
			...middlewareExport,
		},
		scripts: {
			prepare: "tsc",
		},
		peerDependencies: {
			zod: ZOD_PEER_RANGE,
		},
		devDependencies: {
			typescript: "^5.0.0",
		},
	};

	return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function generateReadme(
	packageName: string,
	models: Model[],
	enums: Enum[],
	schemaNames?: SchemaNames,
	middlewareModule?: string,
): string {
	const schemaList = [
		...enums.map(
			(e) => `- \`${schemaName(e, schemaNames)}Schema\` - Enum for ${e.name}`,
		),
		...models.map(
			(m) => `- \`${schemaName(m, schemaNames)}Schema\` - ${m.name} model`,
		),
	];

	const middlewareSection = middlewareModule
		? `
## Request Validation

\`${packageName}/${middlewareModule}\` carries the operation map and a request-validation
middleware for an openapi-generator \`typescript-fetch\` client. Attach it to the
client configuration and every JSON request body is validated against its
operation schema before the request is sent.

\`\`\`typescript
import { Configuration, DefaultApi } from "./generated-client";
import { validationMiddleware } from "${packageName}/${middlewareModule}";

const api = new DefaultApi(
  new Configuration({ basePath, middleware: [validationMiddleware] }),
);
\`\`\`

An invalid body rejects with a \`RequestValidationError\` carrying the zod
\`issues\`. Use \`createValidationMiddleware({ validate: false })\` to attach the
middleware with validation turned off.
`
		: "";

	const exampleName = models[0]
		? schemaName(models[0], schemaNames)
		: undefined;

	return `# ${packageName}

Auto-generated Zod schemas from TypeSpec definitions.

## Installation

\`\`\`bash
npm install ${packageName} zod@${ZOD_PEER_RANGE}
\`\`\`

The schemas use the zod 3 string format checks \`.url()\`, \`.datetime()\`,
\`.date()\` and \`.time()\`, so the peer range is \`${ZOD_PEER_RANGE}\`. Zod 4 is not
supported.

## Usage

\`\`\`typescript
import { ${exampleName}Schema } from "${packageName}";
import { z } from "zod";

// Validate data
const data = {
  // your data here
};

const validated = ${exampleName}Schema.parse(data);

// Type inference
type ${exampleName} = z.infer<typeof ${exampleName}Schema>;
\`\`\`

## Available Schemas

${schemaList.join("\n")}
${middlewareSection}
## Generated by

This package was generated using [@kattebak/typespec-zod-emitter](https://github.com/kattebak/typespec-zod-emitter).
`;
}

function generateTsConfig(files: string[] = ["schemas.ts"]): string {
	const tsconfig = {
		compilerOptions: {
			target: "ES2020",
			module: "ESNext",
			moduleResolution: "bundler",
			declaration: true,
			declarationMap: true,
			sourceMap: true,
			outDir: ".",
			rootDir: ".",
			strict: true,
			esModuleInterop: true,
			skipLibCheck: true,
			forceConsistentCasingInFileNames: true,
		},
		include: files,
		exclude: ["node_modules"],
	};

	return `${JSON.stringify(tsconfig, null, 2)}\n`;
}

function generateNpmIgnore(): string {
	return `tsconfig.json
*.tsp
tsp-output/
node_modules/
*.log
.DS_Store
`;
}

export const __test = {
	ZOD_PEER_RANGE,
	applyConstraints,
	assignSchemaNames,
	containsTemplateParameter,
	generateEnumSchema,
	generateModelSchema,
	generateModelTypeSchema,
	generatePropertySchema,
	generateScalarSchema,
	generateTypeSchema,
	generateUnionSchema,
	generateZodSchemas,
	getAllProperties,
	getModelDependencies,
	isTemplateDeclaration,
	isValidJavaScriptIdentifier,
	mergeConstraints,
	quotePropertyName,
	toRegexLiteral,
	topologicalSort,
};
