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
import type { ZodEmitterOptions } from "./lib.js";
import { generateMiddleware } from "./middleware.js";

export async function $onEmit(context: EmitContext<ZodEmitterOptions>) {
	const models: Model[] = [];
	const enums: Enum[] = [];
	const modelNameMap = new Map<Model, string>();
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
				// Store the declared name for this model
				modelNameMap.set(model, model.name);
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

	const outputDir = context.emitterOutputDir;
	const outputFile = context.options["output-file"] ?? "schemas.ts";
	const packageName = context.options["package-name"];
	const packageVersion = context.options["package-version"];

	const content = generateZodSchemas(
		models,
		enums,
		packageName,
		packageVersion,
		modelNameMap,
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
							generateTypeSchema(type, modelNameMap, context.program),
						property: (property) =>
							generatePropertySchema(property, modelNameMap, context.program),
						propertyName: quotePropertyName,
						properties: getAllProperties,
					},
					{
						schemaNames: new Set(
							[...models, ...enums].map((type) => `${type.name}Schema`),
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

function getModelDependencies(model: Model): Set<string> {
	const dependencies = new Set<string>();

	function extractDependencies(type: Type): void {
		switch (type.kind) {
			case "Model":
				// Skip intrinsic models like Array, Record
				if (!isIntrinsicModel(type) && type.name) {
					dependencies.add(type.name);
				}
				// Check indexer for Record types
				if (type.indexer?.value) {
					extractDependencies(type.indexer.value);
				}
				break;
			case "Enum":
				if (type.name) {
					dependencies.add(type.name);
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
	dependencies.delete(model.name);

	return dependencies;
}

function topologicalSort(models: Model[], enums: Enum[]): Model[] {
	const enumNames = new Set(enums.map((e) => e.name));
	const modelMap = new Map(models.map((m) => [m.name, m]));
	const visited = new Set<string>();
	const visiting = new Set<string>();
	const sorted: Model[] = [];

	function visit(modelName: string): void {
		if (visited.has(modelName)) {
			return;
		}

		// Skip if it's an enum or doesn't exist in our model map
		if (enumNames.has(modelName) || !modelMap.has(modelName)) {
			return;
		}

		if (visiting.has(modelName)) {
			// Circular dependency detected - skip to avoid infinite loop
			return;
		}

		visiting.add(modelName);
		const model = modelMap.get(modelName);
		if (!model) {
			return;
		}
		const dependencies = getModelDependencies(model);

		for (const dep of dependencies) {
			visit(dep);
		}

		visiting.delete(modelName);
		visited.add(modelName);
		sorted.push(model);
	}

	// Visit all models
	for (const model of models) {
		visit(model.name);
	}

	return sorted;
}

function generateZodSchemas(
	models: Model[],
	enums: Enum[],
	packageName?: string,
	packageVersion?: string,
	modelNameMap?: Map<Model, string>,
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
	const sortedModels = topologicalSort(models, enums);

	const enumSchemas = enums
		.map((enumType) => generateEnumSchema(enumType))
		.join("\n\n");

	const modelSchemas = sortedModels
		.map((model) => generateModelSchema(model, modelNameMap, program))
		.join("\n\n");

	return (
		imports + header + (enumSchemas ? `${enumSchemas}\n\n` : "") + modelSchemas
	);
}

function generateEnumSchema(enumType: Enum): string {
	const members = Array.from(enumType.members.values());

	if (members.length === 0) {
		return `export const ${enumType.name}Schema = z.never();`;
	}

	const values = members.map((member) => {
		const value = member.value ?? member.name;
		return typeof value === "string" ? `"${value}"` : value;
	});

	return `export const ${enumType.name}Schema = z.enum([${values.join(", ")}]);`;
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
	modelNameMap?: Map<Model, string>,
	program?: Program,
): string {
	const properties: string[] = [];

	for (const [propName, prop] of getAllProperties(model)) {
		const zodType = generatePropertySchema(prop, modelNameMap, program);
		const quotedName = quotePropertyName(propName);
		properties.push(`\t${quotedName}: ${zodType}`);
	}

	const schemaBody =
		properties.length > 0 ? `{\n${properties.join(",\n")}\n}` : "{}";

	return `export const ${model.name}Schema = z.object(${schemaBody});`;
}

function generatePropertySchema(
	prop: ModelProperty,
	modelNameMap?: Map<Model, string>,
	program?: Program,
): string {
	// A property may narrow the constraints of its own scalar type, so the
	// property itself is the last constraint source in the chain.
	let schema =
		prop.type.kind === "Scalar"
			? generateScalarSchema(prop.type, program, prop)
			: generateTypeSchema(prop.type, modelNameMap, program);

	if (prop.optional) {
		schema += ".optional()";
	}

	return schema;
}

function generateTypeSchema(
	type: Type,
	modelNameMap?: Map<Model, string>,
	program?: Program,
): string {
	switch (type.kind) {
		case "Scalar":
			return generateScalarSchema(type, program);
		case "Model":
			return generateModelTypeSchema(type, modelNameMap, program);
		case "Enum":
			return `${type.name}Schema`;
		case "Union":
			return generateUnionSchema(type, modelNameMap, program);
		case "String":
			return `z.literal("${type.value}")`;
		case "Number":
			return `z.literal(${type.value})`;
		case "Boolean":
			return `z.literal(${type.value})`;
		default:
			return "z.unknown()";
	}
}

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
	modelNameMap?: Map<Model, string>,
	program?: Program,
): string {
	if (model.name === "Array" && model.indexer?.value) {
		const elementType = model.indexer.value;
		return `z.array(${generateTypeSchema(elementType, modelNameMap, program)})`;
	}

	if (model.indexer && model.indexer.key.name === "string") {
		const valueType = model.indexer.value;
		return `z.record(z.string(), ${generateTypeSchema(valueType, modelNameMap, program)})`;
	}

	// Handle anonymous object literals (inline object types)
	if (!model.name || model.name === "" || model.name === "object") {
		const properties: string[] = [];
		for (const [propName, prop] of model.properties) {
			const zodType = generatePropertySchema(prop, modelNameMap, program);
			const quotedName = quotePropertyName(propName);
			properties.push(`${quotedName}: ${zodType}`);
		}
		const schemaBody =
			properties.length > 0 ? `{ ${properties.join(", ")} }` : "{}";
		return `z.object(${schemaBody})`;
	}

	// Check if this model is in our declared models map
	if (modelNameMap) {
		const declaredName = modelNameMap.get(model);
		if (declaredName) {
			return `${declaredName}Schema`;
		}

		// Model is not in our declared models (e.g., lifecycle-transformed models like Create<T>)
		// Generate it inline as an anonymous object
		const properties: string[] = [];
		for (const [propName, prop] of model.properties) {
			const zodType = generatePropertySchema(prop, modelNameMap, program);
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
	modelNameMap?: Map<Model, string>,
	program?: Program,
): string {
	const variants = Array.from(union.variants.values());

	if (variants.length === 0) {
		return "z.never()";
	}

	if (variants.length === 1) {
		return generateTypeSchema(variants[0].type, modelNameMap, program);
	}

	const schemas = variants.map((variant) =>
		generateTypeSchema(variant.type, modelNameMap, program),
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

	const packageJson = {
		name: packageName,
		version: packageVersion,
		type: "module",
		main: "./schemas.js",
		types: "./schemas.d.ts",
		exports: {
			".": {
				types: "./schemas.d.ts",
				default: "./schemas.js",
			},
			...middlewareExport,
		},
		scripts: {
			prepare: "tsc",
		},
		peerDependencies: {
			zod: "^3.0.0",
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
	middlewareModule?: string,
): string {
	const schemaList = [
		...enums.map((e) => `- \`${e.name}Schema\` - Enum for ${e.name}`),
		...models.map((m) => `- \`${m.name}Schema\` - ${m.name} model`),
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

	return `# ${packageName}

Auto-generated Zod schemas from TypeSpec definitions.

## Installation

\`\`\`bash
npm install ${packageName} zod
\`\`\`

## Usage

\`\`\`typescript
import { ${models[0]?.name}Schema } from "${packageName}";
import { z } from "zod";

// Validate data
const data = {
  // your data here
};

const validated = ${models[0]?.name}Schema.parse(data);

// Type inference
type ${models[0]?.name} = z.infer<typeof ${models[0]?.name}Schema>;
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
	applyConstraints,
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
