export interface ZodEmitterOptions {
	"output-dir"?: string;
	"output-file"?: string;
	"package-name"?: string;
	"package-version"?: string;
	"emit-middleware"?: boolean;
	"middleware-file"?: string;
}

export const $lib = {
	"emitter-options-schema": {
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
	} as const,
};
