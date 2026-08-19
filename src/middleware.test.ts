import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Model, ModelProperty, Program, Type } from "@typespec/compiler";
import { createTestHost } from "@typespec/compiler/testing";
import {
	createMetadataInfo,
	getAllHttpServices,
	type HttpOperation,
	resolveRequestVisibility,
	Visibility,
} from "@typespec/http";
import { HttpTestLibrary } from "@typespec/http/testing";
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

async function compile(source: string): Promise<Program> {
	const host = await createTestHost({ libraries: [HttpTestLibrary] });
	host.addTypeSpecFile(
		"main.tsp",
		`import "@typespec/http";\nusing Http;\n${source}`,
	);
	await host.compile("main.tsp");
	return host.program;
}

function requestVisibilities(program: Program): Map<string, Visibility> {
	const [services] = getAllHttpServices(program);

	return new Map(
		services
			.flatMap((service) => service.operations)
			.map((operation) => [
				operation.operation.name,
				resolveRequestVisibility(program, operation.operation, operation.verb),
			]),
	);
}

function payloadContextFor(program: Program) {
	return {
		codegen,
		metadata: createMetadataInfo(program),
		identical: new Map(),
		visiting: new Set(),
	};
}

function bodyTypes(program: Program): Map<string, Type> {
	const [services] = getAllHttpServices(program);

	return new Map(
		services
			.flatMap((service) => service.operations)
			.flatMap((operation) => {
				const body = operation.parameters.body;
				return body?.bodyKind === "single"
					? [[operation.operation.name, body.type] as const]
					: [];
			}),
	);
}

function bodySchemas(program: Program): Map<string, string> {
	const [services] = getAllHttpServices(program);
	const context = payloadContextFor(program);

	const entries = services
		.flatMap((service) => service.operations)
		.flatMap((operation) => {
			const body = operation.parameters.body;
			if (!body || body.bodyKind !== "single") {
				return [];
			}
			const visibility = resolveRequestVisibility(
				program,
				operation.operation,
				operation.verb,
			);
			return [
				[
					operation.operation.name,
					__test.payloadSchema(body.type, visibility, context, body.isExplicit),
				] as const,
			];
		});

	return new Map(entries);
}

const KENNEL_SERVICE = `
model Kennel {
  @visibility(Lifecycle.Read)
  kennelId: string;

  @visibility(Lifecycle.Create)
  registrationCode: string;

  @visibility(Lifecycle.Update)
  supersedesKennelId: string;

  name: string;
}

@service
@route("/kennels")
namespace Kennels {
  @post
  op create(@body kennel: Kennel): Kennel;

  @route("/{kennelId}")
  @put
  op replace(@path kennelId: string, @body kennel: Kennel): Kennel;

  @route("/{kennelId}")
  @patch
  op update(@path kennelId: string, @body kennel: Kennel): Kennel;
}
`;

describe("payload visibility against compiler metadata", () => {
	it("resolves the verb visibilities the payload walk is driven by", async () => {
		const visibilities = requestVisibilities(await compile(KENNEL_SERVICE));

		assert.equal(visibilities.get("create"), Visibility.Create);
		assert.equal(visibilities.get("update"), Visibility.Update);
		assert.equal(
			visibilities.get("replace"),
			Visibility.Create | Visibility.Update,
		);
	});

	it("keeps create-only and update-only properties in a PUT body", async () => {
		const bodies = bodySchemas(await compile(KENNEL_SERVICE));

		assert.equal(
			bodies.get("create"),
			"z.object({ registrationCode: z.string(), name: z.string() })",
		);
		assert.equal(
			bodies.get("update"),
			"z.object({ supersedesKennelId: z.string(), name: z.string() })",
		);
		assert.equal(
			bodies.get("replace"),
			"z.object({ registrationCode: z.string(), supersedesKennelId: z.string(), name: z.string() })",
		);
	});

	it("leaves a PUT body required where a merge-patch body is optional", async () => {
		const program = await compile(`
model Kennel {
  name: string;
  capacity: int32;
}

@service
@route("/kennels")
namespace Kennels {
  @route("/{kennelId}")
  @put
  op replace(@path kennelId: string, @body kennel: Kennel): Kennel;
}
`);
		const kennel = bodyTypes(program).get("replace");
		assert.ok(kennel);

		// The Patch flag is what makes a property optional; the Create|Update
		// bitmask a PUT resolves to does not carry it.
		assert.equal(
			__test.payloadSchema(
				kennel,
				Visibility.Create | Visibility.Update,
				payloadContextFor(program),
			),
			"<Kennel>",
		);
		assert.equal(
			__test.payloadSchema(
				kennel,
				Visibility.Update | Visibility.Patch,
				payloadContextFor(program),
			),
			"z.object({ name: z.string().optional(), capacity: z.string().optional() })",
		);
	});

	it("inlines a declared union whose variants transform under visibility", async () => {
		const bodies = bodySchemas(
			await compile(`
model Collar {
  @visibility(Lifecycle.Read)
  collarId: string;

  material: string;
}

model Microchip {
  chipId: string;
}

union PetTag {
  collar: Collar,
  microchip: Microchip,
}

@service
@route("/pets")
namespace Pets {
  @post
  op tag(@body tag: PetTag): void;
}
`),
		);

		assert.equal(
			bodies.get("tag"),
			"z.union([z.object({ material: z.string() }), <Microchip>])",
		);
	});
});
