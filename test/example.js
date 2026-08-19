import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createValidationMiddleware,
	findOperation,
	operations,
	validationMiddleware,
} from "../build/zod-schemas/middleware.js";
import * as Schemas from "../build/zod-schemas/schemas.ts";

describe("zod schema smoke tests", () => {
	it("parses a valid user", () => {
		const validUser = {
			id: "123",
			name: "John Doe",
			email: "john@example.com",
			age: 30,
			isActive: true,
			status: "Active",
			priority: "high",
		};

		const result = Schemas.UserSchema.parse(validUser);

		assert.equal(result.id, "123");
		assert.equal(result.email, "john@example.com");
	});

	it("rejects a user missing required fields", () => {
		const invalidUser = {
			id: "123",
			name: "Jane Doe",
			isActive: true,
			status: "Active",
			priority: "low",
		};

		assert.throws(() => Schemas.UserSchema.parse(invalidUser));
	});

	it("rejects a user with wrong types", () => {
		const invalidUser = {
			id: "123",
			name: "Jane Doe",
			email: "jane@example.com",
			age: "thirty",
			isActive: true,
			status: "Active",
			priority: "low",
		};

		assert.throws(() => Schemas.UserSchema.parse(invalidUser));
	});

	it("parses a valid post with arrays and metadata", () => {
		const validPost = {
			id: "post-1",
			title: "Introduction to TypeSpec",
			content: "TypeSpec is a language for defining APIs...",
			authorId: "123",
			tags: ["typespec", "api", "tutorial"],
			metadata: { category: "tutorial", difficulty: "beginner" },
			published: true,
			createdAt: new Date().toISOString(),
		};

		const result = Schemas.PostSchema.parse(validPost);

		assert.equal(result.id, "post-1");
		assert.equal(result.metadata.category, "tutorial");
	});

	it("parses a minimal profile with optional fields omitted", () => {
		const minimalProfile = {
			userId: "123",
			address: {
				street: "123 Main St",
				city: "Springfield",
				zipCode: "12345",
				country: "USA",
			},
			socialLinks: ["https://twitter.com/johndoe"],
		};

		const result = Schemas.ProfileSchema.parse(minimalProfile);

		assert.equal(result.userId, "123");
		assert.equal(result.address.city, "Springfield");
	});

	it("validates enum values", () => {
		assert.equal(Schemas.StatusSchema.parse("Active"), "Active");
		assert.equal(Schemas.PrioritySchema.parse("low"), "low");
		assert.throws(() => Schemas.StatusSchema.parse("Unknown"));
	});

	it("parses user list derived from generic template", () => {
		const userList = {
			continuationToken: "next",
			items: [
				{
					id: "123",
					name: "John Doe",
					email: "john@example.com",
					isActive: true,
					status: "Active",
					priority: "high",
				},
			],
		};

		const result = Schemas.UserListSchema.parse(userList);
		assert.equal(result.items.length, 1);
		assert.equal(result.items[0].id, "123");
	});

	it("parses lifecycle create params", () => {
		const createPayload = {
			name: "Widget",
			price: 19.99,
			inStock: true,
			attributes: [
				{
					key: "color",
					value: "red",
				},
			],
			productId: "ignore-me",
			createdAt: 1700000000,
		};

		const result = Schemas.ProductCreateParamsSchema.parse(createPayload);
		assert.equal(result.attributes[0].key, "color");
		assert.equal("productId" in result, false);
		assert.equal("createdAt" in result, false);
	});

	it("parses lifecycle update params", () => {
		const updatePayload = {
			name: "Updated Widget",
		};

		const result = Schemas.ProductUpdateParamsSchema.parse(updatePayload);
		assert.deepEqual(result, {});
	});

	it("parses full product schema", () => {
		const product = {
			productId: "product-1",
			name: "Widget",
			price: 19.99,
			inStock: true,
			attributes: [
				{
					attributeId: "attr-1",
					productId: "product-1",
					key: "color",
					value: "red",
				},
			],
			createdAt: 1700000000,
			updatedAt: 1700001000,
		};

		const result = Schemas.ProductSchema.parse(product);
		assert.equal(result.productId, "product-1");
		assert.equal(result.attributes[0].attributeId, "attr-1");
	});

	it("parses product attribute create params", () => {
		const createPayload = {
			key: "size",
			value: "large",
			attributeId: "ignore-me",
			productId: "ignore-me",
		};

		const result =
			Schemas.ProductAttributeCreateParamsSchema.parse(createPayload);
		assert.equal(result.key, "size");
		assert.equal("attributeId" in result, false);
		assert.equal("productId" in result, false);
	});

	it("parses product attribute update params", () => {
		const updatePayload = {
			value: "large",
			attributeId: "ignore-me",
			productId: "ignore-me",
		};

		const result =
			Schemas.ProductAttributeUpdateParamsSchema.parse(updatePayload);
		assert.equal("attributeId" in result, false);
		assert.equal("productId" in result, false);
		if ("value" in result) {
			assert.equal(result.value, "large");
		}
	});

	it("parses anonymous object fields", () => {
		const upload = {
			item: {
				id: "item-1",
				name: "Widget",
			},
			urls: {
				s3: "https://s3.example.com/item-1",
			},
		};

		const result = Schemas.ItemUploadSchema.parse(upload);
		assert.equal(result.item.name, "Widget");
		assert.equal(result.urls.s3, "https://s3.example.com/item-1");
	});

	it("parses complex anonymous objects", () => {
		const complex = {
			metadata: {
				author: "Ada",
				tags: ["release", "notes"],
				settings: {
					visibility: "public",
					downloadable: true,
				},
			},
		};

		const result = Schemas.ComplexUploadSchema.parse(complex);
		assert.equal(result.metadata.settings.visibility, "public");
		assert.equal(result.metadata.tags.length, 2);
	});

	it("accepts empty anonymous object schema", () => {
		const result = Schemas.EmptyObjectTestSchema.parse({ emptyData: {} });
		assert.deepEqual(result.emptyData, {});
	});

	it("parses quoted and reserved identifiers", () => {
		const invalidIdentifiers = {
			"kebab-case": "value",
			"with space": "value",
			"123numeric": "value",
			"special@char": "value",
			normalKey: "value",
		};

		const reservedWords = {
			class: "value",
			const: "value",
			return: "value",
			function: "value",
			normalProp: "value",
		};

		const invalidIdentifiersResult =
			Schemas.InvalidIdentifiersSchema.parse(invalidIdentifiers);
		const reservedWordsResult =
			Schemas.ReservedWordsSchema.parse(reservedWords);

		assert.equal(invalidIdentifiersResult["kebab-case"], "value");
		assert.equal(reservedWordsResult.class, "value");
	});

	it("parses invalid identifiers inside anonymous objects", () => {
		const payload = {
			data: {
				"kebab-case": "value",
				"another-kebab": 42,
				validKey: true,
			},
		};

		const result = Schemas.AnonymousWithInvalidKeysSchema.parse(payload);
		assert.equal(result.data["another-kebab"], 42);
		assert.equal(result.data.validKey, true);
	});

	it("does not emit generic template schemas", () => {
		assert.equal("ResultListSchema" in Schemas, false);
	});

	it("enforces URL shape for the url scalar", () => {
		const valid = Schemas.WebsiteSchema.parse({
			homepage: "https://example.com",
		});
		assert.equal(valid.homepage, "https://example.com");

		assert.throws(() => Schemas.WebsiteSchema.parse({ homepage: "not-a-url" }));
	});

	it("enforces URL shape for a derived scalar that extends url", () => {
		const valid = Schemas.SecureLinkSchema.parse({
			target: "https://example.com/x",
		});
		assert.equal(valid.target, "https://example.com/x");

		assert.throws(() => Schemas.SecureLinkSchema.parse({ target: "nope" }));
	});

	it("emits inherited properties from a base model", () => {
		const goodDog = {
			animalId: "dog-1",
			legs: 4,
			status: "goodBoy",
			breed: "Labrador",
		};

		// A `Dog extends Animal` schema must accept all inherited base properties.
		const result = Schemas.DogSchema.parse(goodDog);
		assert.equal(result.animalId, "dog-1");
		assert.equal(result.breed, "Labrador");

		// Dropping an inherited base property must fail validation, proving the
		// inherited property survived into the generated schema.
		const missingInherited = { status: "goodBoy", breed: "Labrador" };
		assert.throws(() => Schemas.DogSchema.parse(missingInherited));

		// The subclass override must win on a name collision: `status` is
		// narrowed to the literal "goodBoy", so the base's plain string must
		// be rejected.
		const overridden = { ...goodDog, status: "anything" };
		assert.throws(() => Schemas.DogSchema.parse(overridden));
	});

	it("tracks a model-typed property inherited from a base model as a dependency", () => {
		// A successful import of the schemas module already proves the
		// topological sort placed NestedTargetSchema before TopSubSchema
		// (otherwise this file would fail to load with a ReferenceError).
		const result = Schemas.TopSubSchema.parse({
			ref: { label: "hello" },
			ownField: "value",
		});
		assert.equal(result.ref.label, "hello");
		assert.throws(() => Schemas.TopSubSchema.parse({ ownField: "value" }));
	});
});

const BASE_PATH = "https://api.example.com/v1";

function request(method, path, body) {
	return {
		url: `${BASE_PATH}${path}`,
		init: {
			method,
			headers: { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		},
	};
}

describe("request validation middleware smoke tests", () => {
	it("maps every operation to a method and a path matcher", () => {
		const create = findOperation("POST", `${BASE_PATH}/widgets`);
		const update = findOperation("PATCH", `${BASE_PATH}/widgets/widget-1`);
		const list = findOperation("get", `${BASE_PATH}/widgets?status=Active`);

		assert.equal(operations.length, 6);
		assert.equal(create.operationId, "Widgets_create");
		assert.equal(update.operationId, "Widgets_update");
		assert.equal(list.operationId, "Widgets_list");
		assert.equal(findOperation("POST", `${BASE_PATH}/gadgets`), undefined);
		assert.equal(
			list.parameters.query.parse({ status: "Active" }).status,
			"Active",
		);
		assert.deepEqual(update.pathParameterNames, ["widgetId"]);
	});

	it("omits read-only properties from the create body schema", () => {
		const create = findOperation("POST", `${BASE_PATH}/widgets`);

		assert.equal(
			"widgetId" in
				create.body.parse({
					widgetId: "widget-1",
					name: "Widget",
					quantity: 1,
				}),
			false,
		);
	});

	it("passes a valid body through untouched", async () => {
		const context = request("POST", "/widgets", {
			name: "Widget",
			quantity: 2,
		});
		const body = context.init.body;

		assert.equal(await validationMiddleware.pre(context), undefined);
		assert.equal(context.init.body, body);
	});

	it("rejects an invalid body before the request is sent", async () => {
		const context = request("POST", "/widgets", { name: "Widget" });

		await assert.rejects(
			() => validationMiddleware.pre(context),
			(error) => {
				assert.equal(error.name, "RequestValidationError");
				assert.equal(error.operationId, "Widgets_create");
				assert.equal(
					error.issues.some((issue) => issue.path.join(".") === "quantity"),
					true,
				);
				assert.equal(error.error.issues.length, error.issues.length);
				return true;
			},
		);
	});

	it("rejects a body that is not valid json", async () => {
		const context = request("POST", "/widgets");
		context.init.body = "not json";

		await assert.rejects(() => validationMiddleware.pre(context), {
			name: "RequestValidationError",
		});
	});

	it("validates a body that references a named schema", async () => {
		const valid = request("POST", "/widgets/products", {
			name: "Widget",
			price: 9.99,
			inStock: true,
			attributes: [{ key: "color", value: "red" }],
		});
		const invalid = request("POST", "/widgets/products", {
			name: "Widget",
			price: "free",
			inStock: true,
			attributes: [],
		});

		assert.equal(await validationMiddleware.pre(valid), undefined);
		await assert.rejects(() => validationMiddleware.pre(invalid), {
			name: "RequestValidationError",
		});
	});

	it("ignores requests it has no schema for", async () => {
		const unmapped = request("POST", "/gadgets", { name: 1 });
		const withoutBody = request("GET", "/widgets");
		const nonJson = request("POST", "/widgets", { name: "Widget" });
		nonJson.init.headers = { "Content-Type": "text/plain" };

		assert.equal(await validationMiddleware.pre(unmapped), undefined);
		assert.equal(await validationMiddleware.pre(withoutBody), undefined);
		assert.equal(await validationMiddleware.pre(nonJson), undefined);
	});

	it("skips validation when the opt-out flag is set", async () => {
		const context = request("POST", "/widgets", { name: "Widget" });

		assert.equal(
			await createValidationMiddleware({ validate: false }).pre(context),
			undefined,
		);
		await assert.rejects(() => createValidationMiddleware().pre(context));
	});
});
