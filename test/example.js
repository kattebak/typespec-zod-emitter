import {
	PostSchema,
	ProfileSchema,
	UserSchema,
} from "../build/zod-schemas/schemas.ts";

console.log("=== Zod Validation Examples ===\n");

console.log("1. Valid User:");
try {
	const validUser = {
		id: "123",
		name: "John Doe",
		email: "john@example.com",
		age: 30,
		isActive: true,
		status: "Active",
		priority: "high",
	};
	const result = UserSchema.parse(validUser);
	console.log("✓ Valid:", JSON.stringify(result, null, 2));
} catch (error) {
	console.log("✗ Error:", error.message);
}

console.log("\n2. Invalid User (missing required field):");
try {
	const invalidUser = {
		id: "123",
		name: "Jane Doe",
		isActive: true,
		status: "Active",
		priority: "low",
	};
	UserSchema.parse(invalidUser);
} catch (error) {
	console.log(
		"✗ Validation failed:",
		error.errors[0].message,
		"at",
		error.errors[0].path.join("."),
	);
}

console.log("\n3. Invalid User (wrong type):");
try {
	const invalidUser = {
		id: "123",
		name: "Jane Doe",
		email: "jane@example.com",
		age: "thirty",
		isActive: true,
		status: "Active",
		priority: "low",
	};
	UserSchema.parse(invalidUser);
} catch (error) {
	console.log(
		"✗ Validation failed:",
		error.errors[0].message,
		"at",
		error.errors[0].path.join("."),
	);
}

console.log("\n4. Valid Post with arrays and metadata:");
try {
	const validPost = {
		id: "post-1",
		title: "Introduction to TypeSpec",
		content: "TypeSpec is a language for defining APIs...",
		authorId: "123",
		tags: ["typespec", "api", "tutorial"],
		metadata: { category: "tutorial", difficulty: "beginner" },
		published: true,
		createdAt: new Date(),
	};
	const _result = PostSchema.parse(validPost);
	console.log("✓ Valid post created");
} catch (error) {
	console.log("✗ Error:", error.message);
}

console.log("\n5. Optional fields in Profile:");
try {
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
	const _result = ProfileSchema.parse(minimalProfile);
	console.log("✓ Valid profile (optional fields omitted)");
} catch (error) {
	console.log("✗ Error:", error.message);
}

console.log("\n6. Type inference:");
const user = UserSchema.parse({
	id: "123",
	name: "John Doe",
	email: "john@example.com",
	isActive: true,
	status: "Active",
	priority: "high",
});
console.log(
	"✓ TypeScript will infer the type:",
	typeof user,
	"with properties:",
	Object.keys(user).join(", "),
);

console.log("\n=== All tests completed ===");
