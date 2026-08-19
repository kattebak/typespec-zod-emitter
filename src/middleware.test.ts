import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Model, ModelProperty, Program, Type } from "@typespec/compiler";
import { type HttpOperation, Visibility } from "@typespec/http";
import { __test, isHttpEnabled } from "./middleware.js";

const codegen = {
	type: (type: Type) => `<${(type as Model).name}>`,
	property: (property: ModelProperty) =>
		`z.string()${property.optional ? ".optional()" : ""}`,
	propertyName: (name: string) =>
		/^[a-zA-Z_$]\w*$/.test(name) ? name : `"${name}"`,
	properties: (model: Model) => model.properties,
};

function payloadContext(overrides: {
	isPayloadProperty?: (property: ModelProperty) => boolean;
	isOptional?: (property: ModelProperty) => boolean;
}) {
	return {
		codegen,
		metadata: {
			isPayloadProperty: overrides.isPayloadProperty ?? (() => true),
			isOptional: overrides.isOptional ?? ((property) => !!property.optional),
			isTransformed: () => false,
			getEffectivePayloadType: (type: Type) => type,
		},
		identical: new Map(),
		visiting: new Set(),
	};
}

function property(name: string, optional = false): ModelProperty {
	return {
		kind: "ModelProperty",
		name,
		optional,
		type: { kind: "Scalar", name: "string" },
	} as unknown as ModelProperty;
}

function model(name: string, properties: ModelProperty[]): Model {
	return {
		kind: "Model",
		name,
		properties: new Map(properties.map((prop) => [prop.name, prop])),
	} as unknown as Model;
}

describe("middleware helpers", () => {
	it("detects whether the http library is loaded", () => {
		const withHttp = {
			getGlobalNamespaceType: () => ({
				namespaces: new Map([
					["TypeSpec", { namespaces: new Map([["Http", {}]]) }],
				]),
			}),
		} as unknown as Program;

		const withoutHttp = {
			getGlobalNamespaceType: () => ({
				namespaces: new Map([["TypeSpec", { namespaces: new Map() }]]),
			}),
		} as unknown as Program;

		assert.equal(isHttpEnabled(withHttp), true);
		assert.equal(isHttpEnabled(withoutHttp), false);
	});

	it("builds route patterns that tolerate a base path", () => {
		const plain = __test.routePattern("/widgets");
		const parameterized = __test.routePattern("/widgets/{widgetId}/parts");
		const reserved = __test.routePattern("/files/{+path}");

		assert.deepEqual(plain, {
			pattern: "^.*\\/widgets\\/?$",
			parameterNames: [],
		});
		assert.deepEqual(parameterized, {
			pattern: "^.*\\/widgets\\/([^/]+)\\/parts\\/?$",
			parameterNames: ["widgetId"],
		});
		assert.deepEqual(reserved, {
			pattern: "^.*\\/files\\/(.+)\\/?$",
			parameterNames: ["path"],
		});

		assert.equal(
			new RegExp(parameterized.pattern).test("/api/v1/widgets/abc/parts"),
			true,
		);
		assert.equal(
			new RegExp(parameterized.pattern).test("/api/v1/widgets/abc/parts/1"),
			false,
		);
		assert.equal(new RegExp(plain.pattern).test("/widgets/abc"), false);
	});

	it("recognises json content types", () => {
		assert.equal(__test.isJsonContentType(["application/json"]), true);
		assert.equal(
			__test.isJsonContentType(["application/merge-patch+json"]),
			true,
		);
		assert.equal(
			__test.isJsonContentType(["application/json; charset=utf-8"]),
			true,
		);
		assert.equal(__test.isJsonContentType(["text/plain"]), false);
		assert.equal(__test.isJsonContentType([]), false);
	});

	it("names operations by container", () => {
		const contained = {
			container: { name: "Widgets" },
			operation: { name: "create" },
		} as unknown as HttpOperation;
		const global = {
			container: { name: "" },
			operation: { name: "create" },
		} as unknown as HttpOperation;

		assert.equal(__test.operationId(contained), "Widgets_create");
		assert.equal(__test.operationId(global), "create");
	});

	it("groups parameter schemas by location", () => {
		const operation = {
			parameters: {
				parameters: [
					{ type: "path", name: "widgetId", param: property("widgetId") },
					{ type: "query", name: "status", param: property("status", true) },
					{
						type: "header",
						name: "x-request-id",
						param: property("requestId"),
					},
					{ type: "unsupported", name: "ignored", param: property("ignored") },
				],
			},
		} as unknown as HttpOperation;

		assert.equal(
			__test.generateParameterSchemas(operation, payloadContext({})),
			'{ path: z.object({ widgetId: z.string() }), query: z.object({ status: z.string().optional() }), header: z.object({ "x-request-id": z.string() }) }',
		);
	});

	it("references the declared schema when the payload is unchanged", () => {
		const widget = model("Widget", [property("name"), property("tags", true)]);

		assert.equal(
			__test.payloadSchema(widget, Visibility.Create, payloadContext({})),
			"<Widget>",
		);
	});

	it("inlines the payload when properties are filtered or made optional", () => {
		const widget = model("Widget", [property("widgetId"), property("name")]);

		assert.equal(
			__test.payloadSchema(
				widget,
				Visibility.Create,
				payloadContext({
					isPayloadProperty: (prop) => prop.name !== "widgetId",
				}),
			),
			"z.object({ name: z.string() })",
		);

		assert.equal(
			__test.payloadSchema(
				widget,
				Visibility.Create,
				payloadContext({ isOptional: () => true }),
			),
			"z.object({ widgetId: z.string().optional(), name: z.string().optional() })",
		);
	});

	it("imports only schemas the operation map references", () => {
		const generated = "body: WidgetSchema, parameters: { query: StatusSchema }";
		const names = new Set(["WidgetSchema", "StatusSchema", "UnusedSchema"]);

		assert.deepEqual(__test.collectSchemaImports(generated, names), [
			"StatusSchema",
			"WidgetSchema",
		]);
		assert.deepEqual(__test.collectSchemaImports(generated, new Set()), []);
	});

	it("renders the package header", () => {
		assert.equal(__test.generateHeader(undefined, undefined), "");
		assert.equal(
			__test.generateHeader("my-api", "1.0.0"),
			"/**\n * Package: my-api\n * Version: 1.0.0\n */\n",
		);
	});
});
