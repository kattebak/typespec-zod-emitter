import {
	createTypeSpecLibrary,
	type JSONSchemaType,
	paramMessage,
} from "@typespec/compiler";

export interface ZodEmitterOptions {
	"output-dir"?: string;
	"output-file"?: string;
	"package-name"?: string;
	"package-version"?: string;
	"emit-middleware"?: boolean;
	"middleware-file"?: string;
}

const emitterOptionsSchema: JSONSchemaType<ZodEmitterOptions> = {
	type: "object",
	additionalProperties: false,
	properties: {
		"output-dir": { type: "string", nullable: true },
		"output-file": { type: "string", nullable: true, default: "schemas.ts" },
		"package-name": { type: "string", nullable: true },
		"package-version": { type: "string", nullable: true },
		"emit-middleware": { type: "boolean", nullable: true, default: true },
		"middleware-file": {
			type: "string",
			nullable: true,
			default: "middleware.ts",
		},
	},
	required: [],
};

export const $lib = createTypeSpecLibrary({
	name: "@kattebak/typespec-zod-emitter",
	diagnostics: {
		"schema-name-qualified": {
			severity: "warning",
			messages: {
				default: paramMessage`"${"name"}" is declared in more than one namespace; emitting it as "${"qualified"}Schema".`,
			},
		},
		"duplicate-schema-name": {
			severity: "error",
			messages: {
				default: paramMessage`"${"name"}Schema" is emitted by more than one declaration and the namespace path does not tell them apart. Rename one of the declarations.`,
			},
		},
	},
	emitter: {
		options: emitterOptionsSchema,
	},
});

export const { reportDiagnostic } = $lib;
