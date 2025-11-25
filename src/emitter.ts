import type { EmitContext } from "@typespec/compiler";
import {
	type Enum,
	emitFile,
	type Model,
	type ModelProperty,
	type Namespace,
	resolvePath,
	type Scalar,
	type Type,
	type Union,
} from "@typespec/compiler";
import { $ } from "@typespec/compiler/typekit";
import type { ZodEmitterOptions } from "./lib.js";

export async function $onEmit(context: EmitContext<ZodEmitterOptions>) {
	const models: Model[] = [];
	const enums: Enum[] = [];
	const typekit = $(context.program);

	function collectTypes(namespace: Namespace) {
		for (const [_, model] of namespace.models) {
			if (
				!isIntrinsicModel(model) &&
				!isTypeSpecIntrinsic(namespace) &&
				typekit.type.isUserDefined(model)
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

	const outputDir = context.emitterOutputDir;
	const outputFile = context.options["output-file"] ?? "schemas.ts";
	const packageName = context.options["package-name"];
	const packageVersion = context.options["package-version"];

	const content = generateZodSchemas(
		models,
		enums,
		packageName,
		packageVersion,
	);

	await emitFile(context.program, {
		path: resolvePath(outputDir, outputFile),
		content,
	});

	// Generate package.json if both package-name and package-version are provided
	if (packageName && packageVersion) {
		const packageJsonContent = generatePackageJson(packageName, packageVersion);
		await emitFile(context.program, {
			path: resolvePath(outputDir, "package.json"),
			content: packageJsonContent,
		});

		// Generate README.md
		const readmeContent = generateReadme(packageName, models, enums);
		await emitFile(context.program, {
			path: resolvePath(outputDir, "README.md"),
			content: readmeContent,
		});

		// Generate tsconfig.json
		const tsconfigContent = generateTsConfig();
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

	// Extract dependencies from all properties
	for (const [_, prop] of model.properties) {
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
		.map((model) => generateModelSchema(model))
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

function generateModelSchema(model: Model): string {
	const properties: string[] = [];

	for (const [propName, prop] of model.properties) {
		const zodType = generatePropertySchema(prop);
		properties.push(`\t${propName}: ${zodType}`);
	}

	const schemaBody =
		properties.length > 0 ? `{\n${properties.join(",\n")}\n}` : "{}";

	return `export const ${model.name}Schema = z.object(${schemaBody});`;
}

function generatePropertySchema(prop: ModelProperty): string {
	let schema = generateTypeSchema(prop.type);

	if (prop.optional) {
		schema += ".optional()";
	}

	return schema;
}

function generateTypeSchema(type: Type): string {
	switch (type.kind) {
		case "Scalar":
			return generateScalarSchema(type);
		case "Model":
			return generateModelTypeSchema(type);
		case "Enum":
			return `${type.name}Schema`;
		case "Union":
			return generateUnionSchema(type);
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

function generateScalarSchema(scalar: Scalar): string {
	let baseScalar = scalar;
	while (baseScalar.baseScalar) {
		baseScalar = baseScalar.baseScalar;
	}

	switch (baseScalar.name) {
		case "string":
			return "z.string()";
		case "int32":
		case "int64":
		case "float":
		case "float32":
		case "float64":
		case "decimal":
		case "numeric":
		case "integer":
		case "safeint":
		case "uint8":
		case "uint16":
		case "uint32":
		case "uint64":
		case "int8":
		case "int16":
			return "z.number()";
		case "boolean":
			return "z.boolean()";
		case "plainDate":
		case "plainTime":
		case "utcDateTime":
		case "offsetDateTime":
			return "z.date()";
		case "duration":
			return "z.string()";
		case "url":
			return "z.string().url()";
		case "bytes":
			return "z.instanceof(Uint8Array)";
		default:
			return "z.unknown()";
	}
}

function generateModelTypeSchema(model: Model): string {
	if (model.name === "Array" && model.indexer?.value) {
		const elementType = model.indexer.value;
		return `z.array(${generateTypeSchema(elementType)})`;
	}

	if (model.indexer && model.indexer.key.name === "string") {
		const valueType = model.indexer.value;
		return `z.record(z.string(), ${generateTypeSchema(valueType)})`;
	}

	return `${model.name}Schema`;
}

function generateUnionSchema(union: Union): string {
	const variants = Array.from(union.variants.values());

	if (variants.length === 0) {
		return "z.never()";
	}

	if (variants.length === 1) {
		return generateTypeSchema(variants[0].type);
	}

	const schemas = variants.map((variant) => generateTypeSchema(variant.type));

	return `z.union([${schemas.join(", ")}])`;
}

function generatePackageJson(
	packageName: string,
	packageVersion: string,
): string {
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
		},
		peerDependencies: {
			zod: "^3.0.0",
		},
	};

	return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function generateReadme(
	packageName: string,
	models: Model[],
	enums: Enum[],
): string {
	const schemaList = [
		...enums.map((e) => `- \`${e.name}Schema\` - Enum for ${e.name}`),
		...models.map((m) => `- \`${m.name}Schema\` - ${m.name} model`),
	];

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

## Generated by

This package was generated using [@kattebak/typespec-zod-emitter](https://github.com/kattebak/typespec-zod-emitter).
`;
}

function generateTsConfig(): string {
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
		include: ["schemas.ts"],
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
