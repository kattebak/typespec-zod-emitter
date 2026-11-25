export const decodeRuntime = `type UnknownVariant<K extends string, B> = Record<string, unknown> & Record<K, "Unrecognised"> & B;
const unrecognisedValue = () => "Unrecognised" as const;
function openSchema<O extends boolean, S extends z.ZodType, F extends z.ZodType>(open: O, schema: S, fallback: () => F) {
	return (open ? z.union([schema, fallback()]) : schema) as unknown as (O extends true ? z.ZodType<z.output<S> | z.output<F>> : S);
}
function openVariant<K extends string, B = {}>(key: K, tags: readonly string[], base?: () => (z.ZodType & { readonly _output: B })) {
	const tag = z.string().refine((value) => !tags.includes(value)).transform(unrecognisedValue);
	return z.lazy(() => {
		const schema = base?.() as { shape: z.ZodRawShape } | undefined;
		return z.object({ ...schema?.shape, [key]: tag }).passthrough();
	}) as unknown as z.ZodType<UnknownVariant<K, B>>;
}
let opened: ReturnType<typeof createSchemas<true>> | undefined;
const getOpen = () => (opened ??= createSchemas<true>(true));
type SchemaKey = Exclude<keyof typeof OpenSchemas, "prototype">;
type Decoded<K extends SchemaKey> = z.output<ReturnType<(typeof OpenSchemas)[K]>>;
export function decode<K extends SchemaKey>(key: K, value: unknown):
	| { success: true; data: Decoded<K>; unrecognised: unknown[] }
	| { success: false; error: z.ZodError } {
	const result = getOpen()[key].safeParse(value);
	if (!result.success) return result;
	const unrecognised: unknown[] = [];
	function walk(input: unknown, output: unknown) {
		if (output === "Unrecognised" && input !== output) unrecognised.push(input);
		if (!input || !output || typeof input !== "object" || typeof output !== "object") return;
		for (const [key, child] of Object.entries(output)) walk(Reflect.get(input, key), child);
	}
	walk(value, result.data);
	return { ...result, data: result.data as Decoded<K>, unrecognised };
}`;
