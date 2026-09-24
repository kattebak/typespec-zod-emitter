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

async function emitUnion(variants: string, union: string): Promise<string> {
	const [result] = await Tester.compileAndDiagnose(`
		enum Kind { A: "A", B: "B" }
		${variants}
		${union}
		model Holder { shape: Shape; }
	`);

	await $onEmit({
		program: result.program,
		emitterOutputDir: outputDir,
		options: { "emit-middleware": false },
	} as unknown as EmitContext<ZodEmitterOptions>);

	const schemas = result.fs.fs.get(`${outputDir}/schemas.ts`) ?? "";
	return schemas.match(/shape: (.*)/)?.[1] ?? "";
}

const noEnvelope =
	'@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })';

describe("discriminated unions", () => {
	it("emits z.discriminatedUnion for enum member discriminators", async () => {
		const shape = await emitUnion(
			"model Alpha { kind: Kind.A; a: string; } model Beta { kind: Kind.B; b: string; }",
			`${noEnvelope} union Shape { A: Alpha, B: Beta }`,
		);

		assert.equal(
			shape,
			'z.discriminatedUnion("kind", [AlphaSchema, BetaSchema])',
		);
	});

	it("emits z.discriminatedUnion for string literal discriminators", async () => {
		const shape = await emitUnion(
			'model Alpha { kind: "A"; } model Beta { kind: "B"; }',
			`${noEnvelope} union Shape { A: Alpha, B: Beta }`,
		);

		assert.equal(
			shape,
			'z.discriminatedUnion("kind", [AlphaSchema, BetaSchema])',
		);
	});

	const fallbacks: [string, string, string][] = [
		[
			"an undecorated union",
			"model Alpha { kind: Kind.A; } model Beta { kind: Kind.B; }",
			"union Shape { A: Alpha, B: Beta }",
		],
		[
			"the default object envelope",
			"model Alpha { kind: Kind.A; } model Beta { kind: Kind.B; }",
			'@discriminated(#{ discriminatorPropertyName: "kind" }) union Shape { A: Alpha, B: Beta }',
		],
		[
			"a non-literal discriminator",
			"model Alpha { kind: string; } model Beta { kind: Kind.B; }",
			`${noEnvelope} union Shape { A: Alpha, B: Beta }`,
		],
		[
			"an optional discriminator",
			"model Alpha { kind?: Kind.A; } model Beta { kind: Kind.B; }",
			`${noEnvelope} union Shape { A: Alpha, B: Beta }`,
		],
		[
			"a missing discriminator",
			"model Alpha { a: string; } model Beta { kind: Kind.B; }",
			`${noEnvelope} union Shape { A: Alpha, B: Beta }`,
		],
		[
			"a variant that is not a model",
			"model Beta { kind: Kind.B; }",
			`${noEnvelope} union Shape { A: string, B: Beta }`,
		],
		[
			"a default variant",
			"model Alpha { kind: Kind.A; } model Beta { kind: Kind.B; } model Other { kind: string; }",
			`${noEnvelope} union Shape { A: Alpha, B: Beta, Other }`,
		],
	];

	for (const [label, variants, union] of fallbacks) {
		it(`falls back to z.union for ${label}`, async () => {
			const shape = await emitUnion(variants, union);
			assert.match(shape, /^z\.union\(\[/);
		});
	}
});
