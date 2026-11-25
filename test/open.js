import assert from "node:assert/strict";
import { decode, WireBSchema } from "../build/zod-schemas-open/schemas.ts";

const row = { kind: "B", id: "w", status: "Retired", revision: 3 };
const extra = "Unrecognised";
assert.equal(WireBSchema.safeParse(row).success, false);
assert.deepEqual(decode("WireBSchema", { ...row, extra }), {
	success: true,
	data: { ...row, status: extra, revision: extra },
	unrecognised: ["Retired", 3],
});
assert.deepEqual(decode("WireSchema", { kind: "C", id: "w", extra }), {
	success: true,
	data: { kind: extra, id: "w", extra },
	unrecognised: ["C"],
});
assert.equal(decode("WireSchema", { kind: "A", id: "w" }).success, false);
assert.equal(decode("WireSchema", { kind: "C", id: 1 }).success, false);
const rule = { test: "header", key: "x", match: "Regex" };
assert.deepEqual(decode("RuleTestSchema", rule).unrecognised, ["Regex"]);
const known = { ...row, status: "Active", revision: 1, extra };
assert.deepEqual(decode("WireBSchema", known).unrecognised, []);
