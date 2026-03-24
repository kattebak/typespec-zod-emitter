import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
	Enum,
	Model,
	ModelProperty,
	Scalar,
	Type,
	Union,
} from "@typespec/compiler";
import { __test } from "./emitter.js";

type ModelLike = Model & { kind: "Model" };

describe("emitter helpers", () => {
	it("validates identifiers and quotes invalid names", () => {
		assert.equal(__test.isValidJavaScriptIdentifier("validName"), true);
		assert.equal(__test.isValidJavaScriptIdentifier("_valid"), true);
		assert.equal(__test.isValidJavaScriptIdentifier("kebab-case"), false);
		assert.equal(__test.isValidJavaScriptIdentifier("123name"), false);
		assert.equal(__test.isValidJavaScriptIdentifier("class"), false);

		assert.equal(__test.quotePropertyName("validName"), "validName");
		assert.equal(__test.quotePropertyName("kebab-case"), '"kebab-case"');
		assert.equal(__test.quotePropertyName("class"), '"class"');
	});

	it("generates enum schemas", () => {
		const emptyEnum = {
			name: "Empty",
			members: new Map(),
		} as unknown as Enum;

		const mixedEnum = {
			name: "Status",
			members: new Map([
				["Active", { name: "Active" }],
				["Low", { name: "Low", value: "low" }],
				["One", { name: "One", value: 1 }],
			]),
		} as unknown as Enum;

		assert.equal(
			__test.generateEnumSchema(emptyEnum),
			"export const EmptySchema = z.never();",
		);
		assert.equal(
			__test.generateEnumSchema(mixedEnum),
			'export const StatusSchema = z.enum(["Active", "low", 1]);',
		);
	});

	it("generates scalar schemas", () => {
		const stringScalar = { name: "string" } as unknown as Scalar;
		const intScalar = { name: "int32" } as unknown as Scalar;
		const utcScalar = { name: "utcDateTime" } as unknown as Scalar;
		const urlScalar = { name: "url" } as unknown as Scalar;
		const bytesScalar = { name: "bytes" } as unknown as Scalar;

		assert.equal(__test.generateScalarSchema(stringScalar), "z.string()");
		assert.equal(__test.generateScalarSchema(intScalar), "z.number()");
		assert.equal(
			__test.generateScalarSchema(utcScalar),
			"z.string().datetime()",
		);
		assert.equal(__test.generateScalarSchema(urlScalar), "z.string().url()");
		assert.equal(
			__test.generateScalarSchema(bytesScalar),
			"z.instanceof(Uint8Array)",
		);
	});

	it("generates union schemas", () => {
		const emptyUnion = { variants: new Map() } as unknown as Union;
		const singleUnion = {
			variants: new Map([["a", { type: { kind: "String", value: "a" } }]]),
		} as unknown as Union;
		const multiUnion = {
			variants: new Map([
				["a", { type: { kind: "String", value: "a" } }],
				["b", { type: { kind: "String", value: "b" } }],
			]),
		} as unknown as Union;

		assert.equal(__test.generateUnionSchema(emptyUnion), "z.never()");
		assert.equal(__test.generateUnionSchema(singleUnion), 'z.literal("a")');
		assert.equal(
			__test.generateUnionSchema(multiUnion),
			'z.union([z.literal("a"), z.literal("b")])',
		);
	});

	it("orders models and emits schemas", () => {
		const stringScalar = { kind: "Scalar", name: "string" } as Scalar;
		const modelB: ModelLike = {
			kind: "Model",
			name: "B",
			properties: new Map(),
		} as ModelLike;

		const modelA: ModelLike = {
			kind: "Model",
			name: "A",
			properties: new Map([
				[
					"child",
					{ type: modelB, optional: false } as unknown as ModelProperty,
				],
				[
					"label",
					{ type: stringScalar, optional: false } as unknown as ModelProperty,
				],
			]),
		} as ModelLike;

		const models = [modelA, modelB];
		const modelNameMap = new Map<Model, string>([
			[modelA, "A"],
			[modelB, "B"],
		]);

		const content = __test.generateZodSchemas(
			models,
			[],
			"unit-tests",
			"1.0.0",
			modelNameMap,
		);

		const indexOfB = content.indexOf("export const BSchema");
		const indexOfA = content.indexOf("export const ASchema");

		assert.equal(content.includes('import { z } from "zod";'), true);
		assert.equal(content.includes("Package: unit-tests"), true);
		assert.equal(indexOfB < indexOfA, true);
		assert.equal(content.includes("child: BSchema"), true);
	});

	it("renders array and record models", () => {
		const stringScalar = { kind: "Scalar", name: "string" } as Scalar;
		const arrayModel = {
			kind: "Model",
			name: "Array",
			indexer: { value: stringScalar },
		} as unknown as Model;
		const recordModel = {
			kind: "Model",
			name: "Record",
			indexer: { key: { name: "string" }, value: stringScalar },
		} as unknown as Model;

		assert.equal(
			__test.generateModelTypeSchema(arrayModel),
			"z.array(z.string())",
		);
		assert.equal(
			__test.generateModelTypeSchema(recordModel),
			"z.record(z.string(), z.string())",
		);
	});

	it("renders anonymous object models", () => {
		const stringScalar = { kind: "Scalar", name: "string" } as Scalar;
		const anonymousModel = {
			kind: "Model",
			name: "",
			properties: new Map([
				[
					"kebab-case",
					{ type: stringScalar, optional: false } as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		assert.equal(
			__test.generateModelTypeSchema(anonymousModel),
			'z.object({ "kebab-case": z.string() })',
		);
	});

	it("detects template declarations", () => {
		const templateModel = {
			kind: "Model",
			name: "ResultList",
			properties: new Map([
				[
					"items",
					{
						type: {
							kind: "Model",
							name: "Array",
							indexer: { value: { kind: "TemplateParameter" } },
						} as Type,
						optional: false,
					} as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		assert.equal(__test.isTemplateDeclaration(templateModel), true);
	});

	// === generateScalarSchema: additional scalar types ===

	it("generates scalar schema for boolean", () => {
		const scalar = { name: "boolean" } as unknown as Scalar;
		assert.equal(__test.generateScalarSchema(scalar), "z.boolean()");
	});

	it("generates scalar schema for plainDate", () => {
		const scalar = { name: "plainDate" } as unknown as Scalar;
		assert.equal(__test.generateScalarSchema(scalar), "z.string().date()");
	});

	it("generates scalar schema for plainTime", () => {
		const scalar = { name: "plainTime" } as unknown as Scalar;
		assert.equal(__test.generateScalarSchema(scalar), "z.string().time()");
	});

	it("generates scalar schema for offsetDateTime", () => {
		const scalar = { name: "offsetDateTime" } as unknown as Scalar;
		assert.equal(
			__test.generateScalarSchema(scalar),
			"z.string().datetime({ offset: true })",
		);
	});

	it("generates scalar schema for duration", () => {
		const scalar = { name: "duration" } as unknown as Scalar;
		assert.equal(__test.generateScalarSchema(scalar), "z.string()");
	});

	it("generates scalar schema for float32, float64, and integer numeric types", () => {
		for (const name of [
			"float32",
			"float64",
			"int64",
			"int8",
			"int16",
			"uint8",
			"uint16",
			"uint32",
			"uint64",
			"decimal",
			"numeric",
			"integer",
			"safeint",
		]) {
			const scalar = { name } as unknown as Scalar;
			assert.equal(
				__test.generateScalarSchema(scalar),
				"z.number()",
				`expected z.number() for scalar "${name}"`,
			);
		}
	});

	it("generates scalar schema for unknown/default scalar", () => {
		const scalar = { name: "someCustomScalar" } as unknown as Scalar;
		assert.equal(__test.generateScalarSchema(scalar), "z.unknown()");
	});

	it("generates scalar schema following baseScalar traversal", () => {
		const baseScalar = { name: "string" } as unknown as Scalar;
		const derivedScalar = {
			name: "MyCustomString",
			baseScalar,
		} as unknown as Scalar;
		assert.equal(__test.generateScalarSchema(derivedScalar), "z.string()");
	});

	// === generateTypeSchema: additional type kinds ===

	it("generates type schema for Enum reference", () => {
		const enumType = { kind: "Enum", name: "Status" } as unknown as Type;
		assert.equal(__test.generateTypeSchema(enumType), "StatusSchema");
	});

	it("generates type schema for Number literal", () => {
		const numType = { kind: "Number", value: 42 } as unknown as Type;
		assert.equal(__test.generateTypeSchema(numType), "z.literal(42)");
	});

	it("generates type schema for Boolean literal", () => {
		const boolType = { kind: "Boolean", value: true } as unknown as Type;
		assert.equal(__test.generateTypeSchema(boolType), "z.literal(true)");
	});

	it("generates type schema for unknown/default type kind", () => {
		const intrinsicType = { kind: "Intrinsic" } as unknown as Type;
		assert.equal(__test.generateTypeSchema(intrinsicType), "z.unknown()");
	});

	// === generatePropertySchema: optional vs required ===

	it("generates property schema with .optional() for optional property", () => {
		const stringScalar = { kind: "Scalar", name: "string" } as Scalar;
		const prop = {
			type: stringScalar,
			optional: true,
		} as unknown as ModelProperty;
		assert.equal(
			__test.generatePropertySchema(prop),
			"z.string().optional()",
		);
	});

	it("generates property schema without .optional() for required property", () => {
		const stringScalar = { kind: "Scalar", name: "string" } as Scalar;
		const prop = {
			type: stringScalar,
			optional: false,
		} as unknown as ModelProperty;
		assert.equal(__test.generatePropertySchema(prop), "z.string()");
	});

	// === generateModelSchema: mixed optional/required and empty model ===

	it("generates model schema with mixed optional and required properties", () => {
		const stringScalar = { kind: "Scalar", name: "string" } as Scalar;
		const intScalar = { kind: "Scalar", name: "int32" } as Scalar;
		const model = {
			kind: "Model",
			name: "User",
			properties: new Map([
				[
					"name",
					{ type: stringScalar, optional: false } as unknown as ModelProperty,
				],
				[
					"age",
					{ type: intScalar, optional: true } as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		const result = __test.generateModelSchema(model);
		assert.ok(result.includes("name: z.string()"));
		assert.ok(result.includes("age: z.number().optional()"));
		assert.ok(result.startsWith("export const UserSchema = z.object("));
	});

	it("generates model schema for empty model", () => {
		const model = {
			kind: "Model",
			name: "Empty",
			properties: new Map(),
		} as unknown as Model;

		assert.equal(
			__test.generateModelSchema(model),
			"export const EmptySchema = z.object({});",
		);
	});

	// === getModelDependencies ===

	it("gets model dependencies including enum dependency", () => {
		const enumType = { kind: "Enum", name: "Status" } as unknown as Type;
		const model = {
			kind: "Model",
			name: "Order",
			properties: new Map([
				[
					"status",
					{ type: enumType, optional: false } as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		const deps = __test.getModelDependencies(model);
		assert.ok(deps.has("Status"));
	});

	it("gets model dependencies from union containing model refs", () => {
		const modelRef = {
			kind: "Model",
			name: "Cat",
			indexer: undefined,
		} as unknown as Type;
		const unionType = {
			kind: "Union",
			variants: new Map([["cat", { type: modelRef }]]),
		} as unknown as Type;
		const model = {
			kind: "Model",
			name: "Pet",
			properties: new Map([
				[
					"animal",
					{ type: unionType, optional: false } as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		const deps = __test.getModelDependencies(model);
		assert.ok(deps.has("Cat"));
	});

	it("excludes self-reference from model dependencies", () => {
		const selfRef = {
			kind: "Model",
			name: "TreeNode",
			indexer: undefined,
		} as unknown as Type;
		const model = {
			kind: "Model",
			name: "TreeNode",
			properties: new Map([
				[
					"child",
					{ type: selfRef, optional: true } as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		const deps = __test.getModelDependencies(model);
		assert.equal(deps.has("TreeNode"), false);
	});

	it("gets model dependencies from Record indexer value", () => {
		const valueModel = {
			kind: "Model",
			name: "Item",
			indexer: undefined,
		} as unknown as Type;
		const recordType = {
			kind: "Model",
			name: "Record",
			indexer: { key: { name: "string" }, value: valueModel },
		} as unknown as Type;
		const model = {
			kind: "Model",
			name: "Inventory",
			properties: new Map([
				[
					"items",
					{ type: recordType, optional: false } as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		const deps = __test.getModelDependencies(model);
		assert.ok(deps.has("Item"));
	});

	it("returns empty dependencies for model with no deps", () => {
		const stringScalar = { kind: "Scalar", name: "string" } as unknown as Type;
		const model = {
			kind: "Model",
			name: "Simple",
			properties: new Map([
				[
					"label",
					{ type: stringScalar, optional: false } as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		const deps = __test.getModelDependencies(model);
		assert.equal(deps.size, 0);
	});

	// === topologicalSort ===

	it("handles circular dependencies without infinite loop", () => {
		const modelA = {
			kind: "Model",
			name: "A",
			properties: new Map([
				[
					"b",
					{
						type: { kind: "Model", name: "B", indexer: undefined } as unknown as Type,
						optional: false,
					} as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		const modelB = {
			kind: "Model",
			name: "B",
			properties: new Map([
				[
					"a",
					{
						type: { kind: "Model", name: "A", indexer: undefined } as unknown as Type,
						optional: false,
					} as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		const sorted = __test.topologicalSort([modelA, modelB], []);
		assert.equal(sorted.length, 2);
	});

	it("topological sort includes all models with no dependencies", () => {
		const modelX = {
			kind: "Model",
			name: "X",
			properties: new Map(),
		} as unknown as Model;
		const modelY = {
			kind: "Model",
			name: "Y",
			properties: new Map(),
		} as unknown as Model;

		const sorted = __test.topologicalSort([modelX, modelY], []);
		assert.equal(sorted.length, 2);
		const names = sorted.map((m) => m.name);
		assert.ok(names.includes("X"));
		assert.ok(names.includes("Y"));
	});

	it("topological sort skips enum names as dependencies", () => {
		const enumDep = {
			name: "Status",
			members: new Map(),
		} as unknown as Enum;

		const model = {
			kind: "Model",
			name: "Order",
			properties: new Map([
				[
					"status",
					{
						type: { kind: "Enum", name: "Status" } as unknown as Type,
						optional: false,
					} as unknown as ModelProperty,
				],
			]),
		} as unknown as Model;

		const sorted = __test.topologicalSort([model], [enumDep]);
		assert.equal(sorted.length, 1);
		assert.equal(sorted[0].name, "Order");
	});

	// === containsTemplateParameter ===

	it("returns false for non-template type", () => {
		const scalarType = { kind: "Scalar", name: "string" } as unknown as Type;
		assert.equal(__test.containsTemplateParameter(scalarType), false);
	});

	it("returns true for TemplateParameter nested inside Array model", () => {
		const arrayWithTemplate = {
			kind: "Model",
			name: "Array",
			indexer: { value: { kind: "TemplateParameter" } },
		} as unknown as Type;
		assert.equal(__test.containsTemplateParameter(arrayWithTemplate), true);
	});

	// === isTemplateDeclaration ===

	it("returns false for model without template params", () => {
		const model = {
			kind: "Model",
			name: "Simple",
			properties: new Map(),
		} as unknown as Model;
		assert.equal(__test.isTemplateDeclaration(model), false);
	});

	it("returns true for model with node.templateParameters", () => {
		const model = {
			kind: "Model",
			name: "Container",
			node: { templateParameters: [{ kind: "TemplateParameter" }] },
			properties: new Map(),
		} as unknown as Model;
		assert.equal(__test.isTemplateDeclaration(model), true);
	});

	// === generateUnionSchema: model and literal variants ===

	it("generates union schema with Model type variants", () => {
		const union = {
			variants: new Map([
				[
					"cat",
					{ type: { kind: "Model", name: "Cat" } as unknown as Type },
				],
				[
					"dog",
					{ type: { kind: "Model", name: "Dog" } as unknown as Type },
				],
			]),
		} as unknown as Union;

		assert.equal(
			__test.generateUnionSchema(union),
			"z.union([CatSchema, DogSchema])",
		);
	});

	it("generates union schema with Number and Boolean literal variants", () => {
		const union = {
			variants: new Map([
				["num", { type: { kind: "Number", value: 7 } as unknown as Type }],
				[
					"bool",
					{ type: { kind: "Boolean", value: false } as unknown as Type },
				],
			]),
		} as unknown as Union;

		assert.equal(
			__test.generateUnionSchema(union),
			"z.union([z.literal(7), z.literal(false)])",
		);
	});
});
