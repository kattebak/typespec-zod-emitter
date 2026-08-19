import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { EmitContext } from "@typespec/compiler";
import { createTester } from "@typespec/compiler/testing";
import { __test, $onEmit } from "./emitter.js";
import type { ZodEmitterOptions } from "./lib.js";

const packageRoot = join(import.meta.dirname, "..");
const outputDir = "/emit";

const Tester = createTester(packageRoot, { libraries: ["@typespec/http"] });

async function emit(
	code: string,
	options: ZodEmitterOptions = {},
): Promise<Map<string, string>> {
	const result = await Tester.compile(code);

	await $onEmit({
		program: result.program,
		emitterOutputDir: outputDir,
		options,
	} as unknown as EmitContext<ZodEmitterOptions>);

	return new Map(
		[...result.fs.fs]
			.filter(([path]) => path.startsWith(`${outputDir}/`))
			.map(([path, content]) => [path.slice(outputDir.length + 1), content]),
	);
}

const petStore = `
	import "@typespec/http";
	using Http;

	@service
	namespace PetStore;

	model Pet {
		name: string;
		homepage: url;
	}

	@route("/pets")
	@post
	op adopt(@body pet: Pet): Pet;
`;

const petStoreWithoutOperations = `
	import "@typespec/http";
	using Http;

	@service
	namespace PetStore;

	model Pet {
		name: string;
	}
`;

const petStoreWithoutHttp = `
	namespace PetStore;

	model Pet {
		name: string;
	}
`;

const packageOptions: ZodEmitterOptions = {
	"package-name": "@petstore/schemas",
	"package-version": "1.2.3",
};

describe("$onEmit", () => {
	it("emits schemas, middleware and the package scaffolding", async () => {
		const files = await emit(petStore, packageOptions);

		assert.deepEqual(
			[...files.keys()].sort(),
			[
				".npmignore",
				"README.md",
				"middleware.ts",
				"package.json",
				"schemas.ts",
				"tsconfig.json",
			].sort(),
		);
	});

	it("emits nothing for a spec with no models or enums", async () => {
		const files = await emit("namespace PetStore;", packageOptions);

		assert.deepEqual([...files.keys()], []);
	});

	it("emits only the schema file without a package name and version", async () => {
		const files = await emit(petStore);

		assert.deepEqual([...files.keys()].sort(), ["middleware.ts", "schemas.ts"]);
	});

	it("skips the middleware when emit-middleware is false", async () => {
		const files = await emit(petStore, {
			...packageOptions,
			"emit-middleware": false,
		});

		assert.equal(files.has("middleware.ts"), false);

		const manifest = JSON.parse(files.get("package.json") ?? "{}");
		assert.deepEqual(Object.keys(manifest.exports), ["."]);

		const tsconfig = JSON.parse(files.get("tsconfig.json") ?? "{}");
		assert.deepEqual(tsconfig.include, ["schemas.ts"]);

		assert.equal(files.get("README.md")?.includes("Request Validation"), false);
	});

	it("skips the middleware for a spec that never imports the http library", async () => {
		const files = await emit(petStoreWithoutHttp, packageOptions);

		assert.equal(files.has("middleware.ts"), false);
		assert.equal(files.has("schemas.ts"), true);
	});

	it("skips the middleware for a service with no operations", async () => {
		const files = await emit(petStoreWithoutOperations, packageOptions);

		assert.equal(files.has("middleware.ts"), false);
		assert.equal(files.has("schemas.ts"), true);
	});

	it("honours custom output-file and middleware-file names", async () => {
		const files = await emit(petStore, {
			...packageOptions,
			"output-file": "validators.ts",
			"middleware-file": "guard.ts",
		});

		assert.equal(files.has("validators.ts"), true);
		assert.equal(files.has("schemas.ts"), false);
		assert.equal(files.has("guard.ts"), true);
		assert.equal(files.has("middleware.ts"), false);

		assert.match(files.get("guard.ts") ?? "", /from "\.\/validators\.js"/);

		const manifest = JSON.parse(files.get("package.json") ?? "{}");
		assert.equal(manifest.main, "./validators.js");
		assert.equal(manifest.types, "./validators.d.ts");
		assert.deepEqual(manifest.exports, {
			".": { types: "./validators.d.ts", default: "./validators.js" },
			"./guard": { types: "./guard.d.ts", default: "./guard.js" },
		});

		const tsconfig = JSON.parse(files.get("tsconfig.json") ?? "{}");
		assert.deepEqual(tsconfig.include, ["validators.ts", "guard.ts"]);

		assert.match(files.get("README.md") ?? "", /@petstore\/schemas\/guard/);
	});

	it("pins the generated package to a zod 3 peer range", async () => {
		const files = await emit(petStore, packageOptions);

		assert.match(files.get("schemas.ts") ?? "", /z\.string\(\)\.url\(\)/);

		const manifest = JSON.parse(files.get("package.json") ?? "{}");
		assert.equal(manifest.peerDependencies.zod, __test.ZOD_PEER_RANGE);
		assert.match(__test.ZOD_PEER_RANGE, /^\^3\./);

		const readme = files.get("README.md") ?? "";
		assert.ok(readme.includes(`zod@${__test.ZOD_PEER_RANGE}`));
		assert.ok(readme.includes("Zod 4 is not"));
	});

	it("declares the same zod range for the emitter itself", async () => {
		const manifest = JSON.parse(
			await readFile(join(packageRoot, "package.json"), "utf8"),
		);

		assert.equal(manifest.peerDependencies.zod, __test.ZOD_PEER_RANGE);
		assert.equal(manifest.devDependencies.zod, __test.ZOD_PEER_RANGE);
	});
});
