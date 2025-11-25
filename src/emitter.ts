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
import type { ZodEmitterOptions } from "./lib.js";

export async function $onEmit(context: EmitContext<ZodEmitterOptions>) {
	const models: Model[] = [];
	const enums: Enum[] = [];

	function collectTypes(namespace: Namespace) {
		for (const [_, model] of namespace.models) {
			if (!isIntrinsicModel(model) && !isTypeSpecIntrinsic(namespace)) {
				models.push(model);
			}
		}

		for (const [_, enumType] of namespace.enums) {
			if (!isTypeSpecIntrinsic(namespace)) {
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
}

function isIntrinsicModel(model: Model): boolean {
	const intrinsicNames = ["Array", "Record"];
	return intrinsicNames.includes(model.name);
}

function isTypeSpecIntrinsic(namespace: Namespace): boolean {
	const intrinsicNamespaces = ["TypeSpec", "Reflection"];
	return intrinsicNamespaces.includes(namespace.name);
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

	const enumSchemas = enums
		.map((enumType) => generateEnumSchema(enumType))
		.join("\n\n");

	const modelSchemas = models
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
