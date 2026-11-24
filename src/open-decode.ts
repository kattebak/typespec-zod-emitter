export const decodeRuntime = `type OpenValue<O extends boolean, T> = O extends true ? T : never;
type UnknownVariant<K extends string> = Record<string, unknown> & Record<K, "Unrecognised">;
type OpenSchema<O extends boolean, S extends z.ZodType, T> = O extends true ? z.ZodType<z.output<S> | T> : S;
const unrecognisedValue = () => "Unrecognised" as const;
function openSchema<O extends boolean, S extends z.ZodType, F extends z.ZodType>(open: O, schema: S, fallback: () => F) {
	return (open ? z.union([schema, fallback()]) : schema) as unknown as OpenSchema<O, S, z.output<F>>;
}
function openUnion<O extends boolean, S extends z.ZodType, K extends string, B extends z.ZodType = z.ZodType<{}>>(
	open: O, schema: S, key: K, tags: readonly (string | number | boolean)[], base?: () => B,
) {
	return openSchema(open, schema, () => z.preprocess((value) => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) return;
		const tag = Object.getOwnPropertyDescriptor(value, key)?.value;
		if (!tags.includes(tag) && tags.some((known) => typeof known === typeof tag)) {
			return { ...value, [key]: unrecognisedValue() };
		}
	}, z.lazy(() => {
		const model = base?.() as { shape: z.ZodRawShape } | undefined;
		return z.object({ ...model?.shape, [key]: z.literal("Unrecognised") }).passthrough();
	})) as unknown as z.ZodType<UnknownVariant<K> & z.output<B>>);
}
let opened: ReturnType<typeof createSchemas<true>> | undefined;
declare const schemaKey: unique symbol;
type Closed = ReturnType<typeof createSchemas<false>>;
type Decoded<S extends z.ZodType> = S extends { readonly [schemaKey]: infer K extends keyof Closed }
	? z.output<NonNullable<typeof opened>[K]> : z.output<S>;
export function decode<S extends z.ZodType>(schema: S, value: unknown):
	| { success: true; data: Decoded<S>; unrecognised: unknown[] }
	| { success: false; error: z.ZodError } {
	const key = (Object.keys(closed) as (keyof Closed)[]).find((key) => closed[key] === schema);
	const result = (key === undefined ? schema : (opened ??= createSchemas(true))[key]).safeParse(value);
	if (!result.success) return result;
	const unrecognised: unknown[] = [];
	function walk(input: unknown, output: unknown) {
		if (output === "Unrecognised") unrecognised.push(input);
		if (input && output && typeof input === "object" && typeof output === "object") {
			for (const key of Object.keys(output)) walk(Reflect.get(input, key), Reflect.get(output, key));
		}
	}
	walk(value, result.data);
	return { success: true, data: result.data as Decoded<S>, unrecognised };
}
`;
