import assert from "node:assert/strict";
import * as schemas from "../build/zod-schemas-namespace/schemas.ts";

const order = {
	status: "Active",
	item: { id: "i", name: "n" },
	root: { children: [{ children: [] }] },
};
assert.deepEqual(schemas.OrderSchema.parse(order), order);
assert.equal(
	schemas.OrderSchema.safeParse({ ...order, status: "Gone" }).success,
	false,
);
assert.equal("UnusedSchema" in schemas, false);
