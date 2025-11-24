export interface ZodEmitterOptions {
	"output-dir"?: string;
	"output-file"?: string;
	"package-name"?: string;
	"package-version"?: string;
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
		},
		required: [],
	} as const,
};
