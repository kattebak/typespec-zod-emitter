import assert from "node:assert/strict";
import { OrderSchema } from "../build/zod-schemas-namespace/schemas.ts";

const order = { status: "Active", item: { id: "i", name: "n" } };
assert.deepEqual(OrderSchema.parse(order), order);
assert.equal(
	OrderSchema.safeParse({ ...order, status: "Gone" }).success,
	false,
);
