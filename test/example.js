import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
});
