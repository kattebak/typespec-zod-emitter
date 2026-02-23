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
});
